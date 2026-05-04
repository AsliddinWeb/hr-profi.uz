# Hr-Profi

Multi-tenant SaaS HR / attendance / payroll tizimi. Bir nechta kompaniyalar bitta domendan
foydalanadi, har biri o'z xodimlari, smenalari, oyliklari va KPI'larini boshqaradi.

## Asosiy xususiyatlar

- **Multi-tenant** — shared DB, har jadvalda `company_id`, SQLAlchemy event listener auto-filter
- **Real-time oylik** — har attendance check-out'dan keyin Celery oylikni qayta hisoblaydi va
  WebSocket orqali ilovaga jonatadi
- **3 turdagi attendance** — mobil ilova (GPS + selfie), Face ID qurilma, QR kod
- **Smena turlari** — fixed, flexible, hybrid; overtime auto-detect
- **KPI engine** — auto-compute formula bo'yicha (attendance, sales, custom webhook)
- **3 til** — UZ (default), RU, EN
- **Bitta `docker compose up -d` bilan deploy**

## Stack

| Layer | Tech |
|-------|------|
| Backend | FastAPI 0.115+ async, PG16 + SQLAlchemy 2.0, Redis 7, Celery, MinIO |
| Admin Web | React 18 + Vite + TS, Tailwind, shadcn/ui, TanStack Query, Zustand |
| Mobile | Expo SDK 51+ (RN, TS), expo-router, Camera + Location, NativeWind |
| Client Web | Next.js 14 PWA |
| Infra | Docker Compose, Traefik + Let's Encrypt, GitHub Actions, Sentry |

## Tezkor boshlash (dev)

```bash
git clone <repo>
cd Hr-Profi_New
cp .env.example .env          # to'ldir (parollar, secret_key)
make up                       # docker compose up -d
make migrate                  # alembic upgrade head
make seed                     # boshlang'ich Owner user yaratiladi
```

API: http://localhost:8000/docs
Admin Web: http://localhost:5173
Client Web: http://localhost:3000

## Production deploy (Ubuntu 22.04 LTS)

```bash
git clone <repo>
cd Hr-Profi_New
cp .env.example .env          # DOMAIN, ACME_EMAIL, parollarni real qilib qoy
make prod-up
```

Traefik avtomatik Let's Encrypt sertifikat oladi. Birinchi marta DNS A-record `DOMAIN`
ga ishora qilishi kerak.

## Loyiha strukturasi

```
backend/        FastAPI API + Celery + Alembic
admin-web/      Owner + Company admin panel (React + Vite)
mobile/         Xodim mobil ilova (Expo)
client-web/     PWA (Next.js) — ilovasiz xodimlar uchun
infra/          Traefik, nginx, postgres init
```

## Phasealar

- **Phase 1** (joriy) — Multi-tenant, Auth, Owner panel, Company/Branch CRUD, DevOps
- **Phase 2** — Employee, Shifts, Attendance (mobile), RN ilova MVP
- **Phase 3** — Real-time salary, KPI, bonuses/deductions, leaves, WebSocket
- **Phase 4** — Face ID device, QR, anomaly detection, push notifications
- **Phase 5** — Client web, reports/export, polish, monitoring

## Litsenziya

Proprietary.
