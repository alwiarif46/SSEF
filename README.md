# Seb Orchard — Kashmir apple orchard management

Multi-tenant, offline-first orchard management for apple growers in the Kashmir Valley (and Ladakh). The primary content is the **SKUAST-K 2026 Integrated Management Guide** (15 phenological stages), distributed through the J&K Department of Horticulture. Everything else in the app is labelled *supplementary*.

## Monorepo

| Path | What |
|---|---|
| `packages/reference` | Season-versioned global reference data: SKUAST-K 2026 schedule (15 stages, 43 recommendations), 57-product chemical catalogue (CIBRC status, FRAC/IRAC, PHI = max(SKUAST, CIBRC)), pests and thresholds, 23 varieties, 8 rootstocks, frost critical temperatures, fertiliser tables, safety rules. |
| `packages/domain` | Pure TypeScript engines, shared by the server and the device (so they work offline): tank scaler, compliance (de-facto PHI, label PHI, molecule rotation, FRAC caps, bloom, tank-mix rules, CIBRC gate, regulatory impact), revised Mills scab model with the Kashmir PAT ascospore model, codling-moth degree days (single sine, horizontal cutoff), alert generator (scab, protect-before-rain, frost, hail, spray window, heat, codling moth), stage planner (elevation-shifted windows, need-based thresholds, low-spray programme for Rvi6 varieties), harvest maturity, fertiliser splits, disease risk indices, sync merge rules, and the shared sync schema. |
| `apps/api` | Fastify API on Postgres 16 with row-level security, the WatermelonDB sync endpoint, auth (JWT carrying tenant and role), the weather and alert worker, push notifications, and reports. |
| `apps/mobile` | Expo SDK 52 / React Native client on WatermelonDB (offline-first; on-device planner, sync, scouting, harvest, inventory, tasks). Needs a dev build (`npx expo prebuild && npx expo run:android`) — JSI SQLite does not run in Expo Go. |
| `docs/` | API contract (`api.md`) and research sources plus open discrepancies (`research/sources.md`). |

## Run locally

```bash
docker compose up --build
```

Or run it without Docker. This needs Postgres 16 and pgTAP:

```bash
npm install
```

```bash
npm run build
```

```bash
MIGRATION_DATABASE_URL=postgres://postgres:postgres@localhost:5432/orchard node apps/api/dist/migrate.js
```

```bash
node apps/api/dist/server.js
```

```bash
node apps/api/dist/worker.js --once
```

## Tests

```bash
npm test
```

```bash
npm run db:test
```

`npm test` runs the domain unit tests, the API integration tests against a throwaway Postgres database, and a schema-drift check. `npm run db:test` runs the pgTAP row-level-security tests; these block a release.

## Multi-tenancy and security
- One Postgres database with a shared schema. Every tenant table carries `tenant_id`, with `ENABLE` and `FORCE ROW LEVEL SECURITY`.
- The policy is `tenant_id = app.current_tenant()`, and the tenant context is set per transaction with `set_config(..., true)`, which is safe under PgBouncer transaction mode.
- The application connects as `orchard_app`, which has no `BYPASSRLS`, owns no tables and cannot write reference data.
- The only cross-tenant paths are narrow `SECURITY DEFINER` functions: login lookup, signup, the weather-target list, and the push outbox.
- Composite foreign keys `(tenant_id, parent_id)` stop a row from referencing another tenant's parent. Foreign-key checks bypass RLS, so this guard is needed.
- `tenant_id` cannot be changed after insert. Spray, harvest, nutrient, phenology and trap records are append-only once synced: a DB trigger enforces this and the API enforces it too. Corrections are new rows linked by `corrects_id`.
- Roles (owner, manager, worker) are enforced per table and per action on top of RLS (`SYNC_TABLES[].roles`).

## Product rules enforced in code
- The app recommends only CIBRC-registered products with an apple label claim. Banned molecules (malathion and dimethoate on apple, dicofol, dinocap, methomyl, monocrotophos) are blocked. A newly banned molecule automatically flags every schedule entry that lists it and shows the alternatives (`/v1/reference/impact`).
- No spray within 21 days of planned harvest (block), and a warning inside 28 days. Each product's label PHI is also enforced.
- The same molecule is never allowed in consecutive sprays of the same class, including inside mixtures. Sharing a FRAC/IRAC group with the previous spray gives a warning, and high-risk groups have per-season caps (DMI ≤ 4, QoI ≤ 3, SDHI ≤ 3, MBC ≤ 2).
- The SKUAST-K general instructions are encoded: no insecticides at bloom, no fungicide and insecticide in one tank, and a 3–4 day gap between the two.
- Prediction models are advisory (`advisory: true`) until a region is calibrated. They never suppress a scheduled spray.
- Recorded sprays are facts. The server re-checks compliance and stores flagged violations; it does not refuse the record.

## Weather
Weather is pulled per orchard latitude and longitude. Provider adapters:
- Open-Meteo (self-hosted, or the commercial `customer-api`)
- Visual Crossing
- NASA POWER (history and calibration only)
- A deterministic synthetic provider for development

**The hosted free Open-Meteo API is non-commercial only. Production must use a self-hosted instance or a commercial key.**
