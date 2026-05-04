#!/usr/bin/env bash
# Postgres + MinIO backup. Cron'dan kuniga 03:00 da chaqiriladi.
#
# Crontab:
#   0 3 * * * /home/projects/hr-profi.uz/scripts/backup.sh >> /var/log/hr-profi-backup.log 2>&1
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="/home/backups/hr-profi"
RETENTION_DAYS=7
DATE="$(date +%F_%H%M)"

mkdir -p "$BACKUP_DIR/postgres" "$BACKUP_DIR/minio"

cd "$PROJECT_DIR"

# .env'dan POSTGRES_USER/DB ni o'qiymiz.
# shellcheck disable=SC1091
set -a
. ./.env
set +a

# --- Postgres ---
PGFILE="$BACKUP_DIR/postgres/${POSTGRES_DB}_${DATE}.sql.gz"
echo "▶ pg_dump → $PGFILE"
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --clean --if-exists \
  | gzip -9 > "$PGFILE"
echo "  $(du -h "$PGFILE" | cut -f1) yozildi"

# --- MinIO (mc orqali) ---
# minio konteyneri ichida `mc` bor — uni ishlatamiz, host'ga o'rnatish shart emas.
MINIO_FILE="$BACKUP_DIR/minio/minio_${DATE}.tar.gz"
echo "▶ MinIO data tar → $MINIO_FILE"
docker run --rm \
  --volumes-from "$(docker compose -f docker-compose.yml -f docker-compose.prod.yml ps -q minio)" \
  -v "$BACKUP_DIR/minio:/backup" \
  alpine:3.20 \
  sh -c "tar czf /backup/minio_${DATE}.tar.gz -C /data ." 2>/dev/null || {
  echo "  (MinIO bo'sh yoki mavjud emas — o'tib ketamiz)"
}

# --- Eski backuplarni tozalash ---
echo "▶ ${RETENTION_DAYS} kundan eski backuplarni o'chirish"
find "$BACKUP_DIR/postgres" -type f -mtime +"$RETENTION_DAYS" -delete
find "$BACKUP_DIR/minio"    -type f -mtime +"$RETENTION_DAYS" -delete

echo "✓ Backup tugadi: $DATE"
