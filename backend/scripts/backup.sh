#!/usr/bin/env bash
# Postgres + MinIO backup. Run from host (not inside container).
# Stores artifacts under ./backups/YYYY-MM-DD/.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT_DIR}"

if [ -f .env ]; then
  set -a; . ./.env; set +a
fi

TS="$(date +%F_%H%M%S)"
DEST="backups/${TS}"
mkdir -p "${DEST}"

echo "[backup] postgres → ${DEST}/postgres.dump"
docker compose exec -T postgres pg_dump -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -Fc \
  > "${DEST}/postgres.dump"

echo "[backup] minio → ${DEST}/minio.tar.gz"
docker run --rm \
  -v worktimepro_miniodata:/data:ro \
  -v "$(pwd)/${DEST}:/out" \
  alpine sh -c "tar czf /out/minio.tar.gz -C /data ."

echo "[backup] done: ${DEST}"
