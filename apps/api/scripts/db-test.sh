#!/usr/bin/env bash
# Release-blocking RLS policy tests (pgTAP). Requires migrated DB + pgtap extension.
set -euo pipefail
URL="${MIGRATION_DATABASE_URL:-postgres://postgres:postgres@localhost:5432/orchard}"
psql "$URL" -qc 'CREATE EXTENSION IF NOT EXISTS pgtap'
pg_prove -d "$URL" "$(dirname "$0")/../db-tests/"*.sql
