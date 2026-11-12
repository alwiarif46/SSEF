# API contract (v1)

Base URL `/v1`. JSON. Auth: `Authorization: Bearer <JWT>`; JWT claims `sub` (user id), `tid` (tenant id), `role` (`owner|manager|worker`). Tenant context is taken from the token only — never from request bodies.

## Auth
| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/v1/auth/signup` | `{ tenantName, name, phone, password }` | `{ token, user, tenant }` (creates tenant + owner) |
| POST | `/v1/auth/login` | `{ phone, password }` | `{ token, user }` |
| GET | `/v1/me` | – | `{ user, tenant }` |
| GET | `/v1/users` | – | users of tenant (manager+) |
| POST | `/v1/users` | `{ name, phone, password, role }` | owner only; creates manager/worker |
| POST | `/v1/push-tokens` | `{ token, platform }` | registers Expo push token |

## Reference data (global, season-versioned)
| GET | `/v1/reference/current` | `ETag`/`If-None-Match` supported. Returns `ReferenceBundle` (see `packages/reference/src/types.ts`). |
| GET | `/v1/reference/versions` | list of versions with status |

## Sync (WatermelonDB protocol)
- `GET /v1/sync?last_pulled_at=<ms|0>&schema_version=1` → `{ changes: { <table>: { created: Row[], updated: Row[], deleted: string[] } }, timestamp: <ms> }`
- `POST /v1/sync?last_pulled_at=<ms>` body `{ changes }` (same shape) → `{ ok: true, rejected: [{table,id,reason}], conflicts: [{table,id,fields}] }`
- Tables and columns: `packages/domain/src/schema.ts` (`SYNC_TABLES`). Rows use the same snake_case column names; `json` columns are JSON strings on the wire; `id` is a client-generated UUID; `tenant_id`, `server_updated_at`, `deleted_at` are server-owned and stripped from pushes.
- Conflict policy per table: `packages/domain/src/sync.ts` (`TABLE_POLICIES`). Append-only rows (`spray_events`, `harvest_records`, …) become `locked` once accepted; later updates are rejected — create a new row with `corrects_id`.
- Role gates per table: `SYNC_TABLES[].roles`.
- `infection_alerts`, `weather_daily` are pull-only; clients may only push `acknowledged*` on alerts.

## Intelligence (server-computed, also computable offline on-device via `@orchard/domain`)
| GET | `/v1/orchards/:id/weather?days=7` | hourly + daily, observed + forecast |
| GET | `/v1/orchards/:id/risk` | scab wetness progress, PAT, disease risk indices, codling-moth DD |
| GET | `/v1/blocks/:id/plan?date=YYYY-MM-DD&tank=200` | `planStage` output for the current stage |
| POST | `/v1/spray/validate` | `{ blockId, date, chemicalIds[], stageId? }` → `Violation[]` |
| GET | `/v1/advisories/:district` | IMD/SKUAST agromet advisory links (Meghdoot deep link) |

## Reports
| GET | `/v1/reports/spray-log.csv?season=2026&orchardId=` | traceability log (product, CIBRC reg. no., batch, dealer, invoice, PHI check) |
| GET | `/v1/reports/season?season=2026` | season summary: sprays, cost, boxes, revenue per block |
