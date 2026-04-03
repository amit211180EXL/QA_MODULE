#!/usr/bin/env bash
set -euo pipefail

# One-click server DB bootstrap + Prisma migration/seed for QA Platform.
# Usage:
#   ./scripts/bootstrap-server.sh
#   POSTGRES_USER=postgres POSTGRES_DB=postgres ./scripts/bootstrap-server.sh
#   BOOTSTRAP_SQL=./db-server-bootstrap.sql ./scripts/bootstrap-server.sh

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-postgres}"
POSTGRES_HOST="${POSTGRES_HOST:-localhost}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
BOOTSTRAP_SQL="${BOOTSTRAP_SQL:-$ROOT_DIR/db-server-bootstrap.sql}"

if ! command -v psql >/dev/null 2>&1; then
  echo "Error: psql is not installed or not in PATH."
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "Error: pnpm is not installed or not in PATH."
  exit 1
fi

if [[ ! -f "$BOOTSTRAP_SQL" ]]; then
  echo "Error: bootstrap SQL file not found at $BOOTSTRAP_SQL"
  exit 1
fi

if [[ ! -f "$ROOT_DIR/.env" ]]; then
  echo "Error: .env not found in repo root ($ROOT_DIR/.env)."
  echo "Create it first (for example: cp .env.example .env)."
  exit 1
fi

echo "[1/5] Running PostgreSQL bootstrap SQL..."
psql \
  -h "$POSTGRES_HOST" \
  -p "$POSTGRES_PORT" \
  -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" \
  -f "$BOOTSTRAP_SQL"

echo "[2/5] Installing dependencies..."
pnpm install

echo "[3/5] Generating Prisma clients..."
pnpm db:generate

echo "[4/5] Applying Prisma migrations..."
pnpm db:migrate:deploy:all

echo "[5/5] Seeding database..."
pnpm db:seed

echo "Done. Server database bootstrap and app DB setup completed successfully."
