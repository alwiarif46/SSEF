# Seb Orchard — mobile client

Expo SDK 52 · React Native 0.76 · WatermelonDB 0.27 (SQLite, JSI) · offline-first.

- Local DB schema is generated from the shared `SYNC_TABLES` (`@orchard/domain`) — `src/db/schemaDef.ts`, `src/db/schema.ts`.
- All agronomy runs on-device with `@orchard/domain` (stage, `planStage`, compliance, maturity, risk), so planning works with no signal.
- Sync: `src/sync/sync.ts` (WatermelonDB pull/push against `/v1/sync`), auto on foreground, reconnect and every 15 min.
- Reference data: bundled SKUAST-K 2026 fallback, refreshed from `/v1/reference/current` with ETag (`src/state/reference.tsx`).

## Run
```bash
npm install                      # from repo root (workspaces)
npm run build -w packages/reference -w packages/domain
cd apps/mobile && npx expo prebuild && npx expo run:android   # JSI SQLite needs a dev build, not Expo Go
```
Set the API URL in Settings (default `http://10.0.2.2:8080` = host machine from the Android emulator).

## Checks
```bash
npm run typecheck -w apps/mobile
npm test -w apps/mobile
```
