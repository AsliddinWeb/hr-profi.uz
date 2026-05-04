#!/usr/bin/env bash
# Production deploy/redeploy.
# Server: /home/projects/hr-profi.uz/ ichida ishga tushiriladi.
#
# Foydalanish:
#   ./scripts/deploy.sh                # default: pull + build + up
#   ./scripts/deploy.sh --no-build     # rebuildsiz tezda restart
#   ./scripts/deploy.sh --reset-volumes # postgres/minio volume'larni ham qayta yaratadi (DIQQAT)
set -euo pipefail

cd "$(dirname "$0")/.."

ENV_FILE=".env"
COMPOSE_FILES=(-f docker-compose.yml -f docker-compose.prod.yml)
NO_BUILD=0
RESET_VOLUMES=0

for arg in "$@"; do
  case "$arg" in
    --no-build) NO_BUILD=1 ;;
    --reset-volumes) RESET_VOLUMES=1 ;;
    *) echo "Unknown arg: $arg" >&2; exit 2 ;;
  esac
done

if [[ ! -f "$ENV_FILE" ]]; then
  echo "❌ $ENV_FILE topilmadi. .env.production.example ni '$ENV_FILE' ga ko'chiring va to'ldiring."
  exit 1
fi

echo "▶ Git: tekshirish va pull"
git fetch --all --prune
git pull --ff-only

if [[ "$RESET_VOLUMES" == "1" ]]; then
  read -rp "⚠ DIQQAT: postgres/redis/minio volume'lari o'chiriladi. Davom etish? (yes/NO) " ans
  [[ "$ans" == "yes" ]] || { echo "Bekor qilindi."; exit 1; }
  docker compose "${COMPOSE_FILES[@]}" down -v
fi

if [[ "$NO_BUILD" == "0" ]]; then
  echo "▶ Build: api, admin_web, client_web, landing"
  docker compose "${COMPOSE_FILES[@]}" build --pull
fi

echo "▶ Up: postgres → migration (api ichida) → barcha servislar"
docker compose "${COMPOSE_FILES[@]}" up -d --remove-orphans

echo "▶ Servislar holati:"
docker compose "${COMPOSE_FILES[@]}" ps

echo "▶ Sog'lik tekshirish (5s kutamiz)…"
sleep 5
for url in \
  "http://127.0.0.1:8100/health" \
  "http://127.0.0.1:8101/" \
  "http://127.0.0.1:8102/" \
  "http://127.0.0.1:8103/"; do
  status=$(curl -s -o /dev/null -w "%{http_code}" "$url" || echo "ERR")
  echo "   $url → $status"
done

echo "✓ Deploy tugadi."
