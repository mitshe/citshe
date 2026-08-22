#!/bin/sh
set -e

# Wait for Postgres to accept connections (compose healthcheck usually covers
# this, but this makes the API robust to a slow DB start).
echo "[citshe-api] applying database migrations…"
if npx prisma migrate deploy 2>/dev/null; then
  echo "[citshe-api] migrations applied."
else
  echo "[citshe-api] migrate deploy failed — falling back to db push."
  npx prisma db push --skip-generate --accept-data-loss || true
fi

echo "[citshe-api] starting: $*"
exec "$@"
