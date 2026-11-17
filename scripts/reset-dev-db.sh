#!/usr/bin/env bash
# Development only: drops and recreates the local database with fictional demo data.
# Refuses to run unless the owner URL points at localhost.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
case "$DATABASE_URL_OWNER" in *@localhost:*|*@127.0.0.1:*) ;; *) echo "Refusing: not a local database." >&2; exit 1;; esac
DB="${DATABASE_URL_OWNER##*/}"
psql "${DATABASE_URL_OWNER%/*}/postgres" -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS \"$DB\" WITH (FORCE)" -c "CREATE DATABASE \"$DB\""
npx tsx scripts/migrate.ts
npx tsx scripts/seed-demo.ts
