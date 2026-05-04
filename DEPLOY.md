# Hr-Profi — Production deploy

Server: DigitalOcean Ubuntu, host nginx 80/443'ni egallaydi va proxy qiladi.

## Topologiya

```
hr-profi.uz       → host nginx → 127.0.0.1:8103 → landing
admin.hr-profi.uz → host nginx → 127.0.0.1:8101 → admin-web (nginx + SPA)
my.hr-profi.uz    → host nginx → 127.0.0.1:8102 → client-web (Next.js)
api.hr-profi.uz   → host nginx → 127.0.0.1:8100 → FastAPI/Gunicorn
files.hr-profi.uz → host nginx → 127.0.0.1:9100 → MinIO (S3)
```

Postgres / Redis Docker network ichida — host'dan ko'rinmaydi.

---

## 1. Mahalliydan GitHub'ga push

```bash
cd /path/to/Hr-Profi_New
git init
git add .
git commit -m "Init Hr-Profi monorepo"
git branch -M main
git remote add origin https://github.com/AsliddinWeb/hr-profi.uz.git
git push -u origin main
```

---

## 2. Server tayyorgarligi

### a) Repo clone

```bash
ssh root@<server-ip>
cd /home/projects
git clone https://github.com/AsliddinWeb/hr-profi.uz.git hr-profi.uz
cd hr-profi.uz
```

### b) `.env` yaratish

```bash
cp .env.production.example .env
nano .env
```

`change-me-...` qiymatlarini almashtiring:
- `SECRET_KEY` — `openssl rand -hex 48`
- `POSTGRES_PASSWORD` — `openssl rand -base64 24`
- `MINIO_ROOT_PASSWORD` — `openssl rand -base64 24`
- `DATABASE_URL` — yangi parol bilan yangilang
- `VAPID_PRIVATE_KEY` / `PUBLIC_KEY` — push notification ishlatmoqchi bo'lsangiz

### c) Backup papkasi

```bash
mkdir -p /home/backups/hr-profi/{postgres,minio}
chmod 700 /home/backups/hr-profi
```

---

## 3. Stack'ni ko'tarish

```bash
cd /home/projects/hr-profi.uz
./scripts/deploy.sh
```

Birinchi marta build ~5–10 daqiqa oladi.

Tekshirish:
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
curl -s http://127.0.0.1:8100/health
curl -s http://127.0.0.1:8103/
```

---

## 4. Host nginx vhost'lar

```bash
# Repodan nusxa olamiz:
sudo cp /home/projects/hr-profi.uz/infra/nginx/*.conf /etc/nginx/sites-available/

# Yoqamiz (symlink):
for f in hr-profi.uz admin.hr-profi.uz my.hr-profi.uz api.hr-profi.uz files.hr-profi.uz; do
  sudo ln -sf /etc/nginx/sites-available/$f.conf /etc/nginx/sites-enabled/$f.conf
done

# Sintaksis tekshirish + reload
sudo nginx -t && sudo systemctl reload nginx
```

---

## 5. TLS — Let's Encrypt

certbot avval host'da o'rnatilganmi tekshiring:
```bash
which certbot || sudo apt install -y certbot python3-certbot-nginx
```

Sertifikatlarni olish (certbot vhost konfiglarini avtomatik 443'ga o'zgartiradi):
```bash
sudo certbot --nginx \
  -d hr-profi.uz -d www.hr-profi.uz \
  -d admin.hr-profi.uz \
  -d my.hr-profi.uz \
  -d api.hr-profi.uz \
  -d files.hr-profi.uz \
  --email admin@hr-profi.uz --agree-tos --redirect --no-eff-email
```

Auto-renewal:
```bash
sudo systemctl enable --now certbot.timer
```

---

## 6. Birinchi OWNER yaratish

API ichidagi seed komandasi (yoki shell):
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec api \
  python -m app.scripts.create_owner \
    --email owner@hr-profi.uz \
    --password 'StrongTemporary!' \
    --full-name 'Owner Asliddin'
```

> Agar `app.scripts.create_owner` mavjud bo'lmasa, `make seed` Makefile target'idan foydalaning yoki backend `app/scripts/` ichidagi mavjud script nomini ishlating.

---

## 7. Backup cron

```bash
sudo crontab -e
# qatorni qo'shing:
0 3 * * * /home/projects/hr-profi.uz/scripts/backup.sh >> /var/log/hr-profi-backup.log 2>&1
```

Tekshirish: `tail -f /var/log/hr-profi-backup.log`.

---

## 8. Monitoring va loglar

```bash
# Servislar:
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps

# Loglar (oxirgi 100 satr):
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs --tail=100 api
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs --tail=100 -f api  # follow

# RAM/CPU:
docker stats --no-stream

# Backup hajmi:
du -sh /home/backups/hr-profi/*
```

---

## 9. Yangilanishni deploy qilish

```bash
cd /home/projects/hr-profi.uz
./scripts/deploy.sh           # pull + rebuild + up
./scripts/deploy.sh --no-build # rebuildsiz tezda restart
```

---

## RAM eslatma

Server 1GB RAM da. Lite mode (`gunicorn -w 1`, `celery --concurrency=1`,
`shared_buffers=64MB`, container resource limits) ~600MB da sig'ishi
kerak. Agar `docker stats`'da OOM ko'rsangiz:

1. `swap`'ni kattalashtiring (hozirgi 2GB ni 4GB ga):
   ```bash
   sudo swapoff /swapfile && sudo fallocate -l 4G /swapfile && \
   sudo mkswap /swapfile && sudo swapon /swapfile
   ```
2. Yoki droplet'ni 2GB+ ga upgrade qiling.
