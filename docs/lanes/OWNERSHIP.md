# Parallel build lanes — file ownership

Three lanes build at the same time. Each lane may create or edit ONLY the paths it owns. Everything else is frozen.

## Frozen (no lane edits)
- `packages/**` (reference data, domain engines, `SYNC_TABLES` in `schema.ts`, `sync.ts`)
- `apps/api/migrations/001_core.sql`, `002_sync_tables.sql`, `003_extras.sql`, `apps/api/scripts/gen-sync-ddl.mjs`
- `apps/api/src/app.ts`, `config.ts`, `db.ts`, `auth.ts`, `migrate.ts`, `reference.ts`, `server.ts`, `advisories.ts`, `weather/**`
- `apps/web/src/main.tsx`, `api.ts`, `data.tsx`, `ui.tsx`, `lib.ts`, `charts.tsx`, `styles.css` (append-only CSS goes in your lane's own CSS file imported from your own page)
- Root `package.json`, `package-lock.json`, every other `package.json` — **do not run `npm install`**; dependencies are pre-installed. Need another one? Report it, don't add it.
- `README.md`, `.github/**`, `docker-compose.yml`, `infra/**`, `db-tests/rls.sql`

## Lane A — Accounts
- `apps/api/src/routes/auth.ts`, `apps/api/src/lanes/accounts/**`, `apps/api/src/push.ts`, `apps/api/src/sync/sync.ts`
- `apps/api/migrations/004_accounts.sql`, `apps/api/test/api.test.ts`, `apps/api/test/lane-accounts.test.ts`, `apps/api/db-tests/accounts.sql`
- `apps/web/src/pages/Auth.tsx`, `Team.tsx`, `Settings.tsx`
- `apps/mobile/src/screens/auth.tsx`, `apps/mobile/src/screens/more.tsx`
- `docs/lanes/accounts.md`

## Lane B — Media & documents
- `apps/api/src/lanes/media/**`, `apps/api/migrations/005_media.sql`, `apps/api/test/lane-media.test.ts`, `apps/api/db-tests/media.sql`
- `apps/web/src/pages/Block.tsx`, `Reports.tsx`, `Import.tsx`, `apps/web/src/media/**`
- `apps/mobile/src/sync/**`, `apps/mobile/src/screens/field.tsx`, `apps/mobile/src/media/**`, `apps/mobile/test/media.test.ts`
- `docs/lanes/media.md`

## Lane C — Platform admin
- `apps/api/src/lanes/admin/**`, `apps/api/src/worker.ts`, `apps/api/scripts/publish-reference.mjs`, `apps/api/migrations/006_admin.sql`, `apps/api/test/lane-admin.test.ts`, `apps/api/db-tests/admin.sql`
- `apps/admin/src/**`, `apps/admin/index.html`, `apps/admin/vite.config.ts`, `apps/admin/test/**`
- `docs/lanes/admin.md`

## Rules
- Migrations must not reference tables/columns created by another lane's migration.
- Each lane's routes are registered from its own `lanes/<name>/index.ts` (`register(app, db)`), already wired into `app.ts`.
- New tenant tables: `tenant_id`, `ENABLE` + `FORCE ROW LEVEL SECURITY`, policy `tenant_id = app.current_tenant()`, owner `orchard_owner`, grants to `orchard_app`. Add pgTAP tests in your own `db-tests/<lane>.sql`.
- New tenant data is served by REST routes in your lane, not by adding to `SYNC_TABLES`.
