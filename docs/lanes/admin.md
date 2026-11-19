# Lane C: Platform admin

This lane is the staff console for running the platform. It covers tenants and billing, weather-worker health, reference-data publishing and an audit trail. Platform admins are **not** tenant users. They have their own table, their own token type and their own app (`apps/admin`).

## Data model (`apps/api/migrations/006_admin.sql`)

| Table | Purpose |
|---|---|
| `platform_admins (id, email UNIQUE lower-case, name, password_hash, active, created_at)` | Staff accounts (scrypt hashes, same format as tenant users) |
| `admin_audit_log (id, admin_id NULL=system/CLI, action, target, detail jsonb, created_at)` | Append-only. A trigger rejects UPDATE/DELETE, even for the owner. |
| `worker_runs (id bigserial, started_at, finished_at, orchards, hours, alerts, new_alerts, pushed, errors jsonb[], provider)` | One row per worker cycle |

All three tables are global (no `tenant_id`) and owned by `orchard_owner`. **`orchard_app` has no privileges on them.** The app reaches them only through `SECURITY DEFINER` functions. Each is owned by `orchard_owner`, has a pinned `search_path` and `REVOKE ALL FROM PUBLIC`, and has `GRANT EXECUTE TO orchard_app`:

| Function | Notes |
|---|---|
| `app.admin_lookup(email)` | Login lookup, case-insensitive |
| `app.admin_get(id)` | Checks on every request that the admin still exists and is active. Never returns the hash. |
| `app.admin_record_audit(admin_id, action, target, detail)` / `app.admin_list_audit(limit, before)` | Action must be a slug (`tenant.plan_update`). Results are keyset-paginated by id. |
| `app.worker_run_start(provider)` / `app.worker_run_finish(id, …, errors)` | Finishing is one-shot: a finished run can't be rewritten |
| `app.admin_list_worker_runs(limit)` | Newest first, max 500 |
| `app.admin_list_tenants()` | Per-tenant **aggregates only**: name, plan, billing, district, created, active users, orchards, blocks, sprays this season (IST year, corrections excluded), and last activity (max `server_updated_at` across the main sync tables). No tenant row contents. |
| `app.admin_set_tenant_plan(tenant_id, plan, billing_status)` | NULL keeps a field unchanged. Returns the new and previous values for the audit entry. No row means the tenant was not found. |
| `app.admin_store_reference(version_id, season, status, bundle, etag)` | The only reference write path for the app role. It enforces that the ids, season and status match `bundle.version`, that the status is draft, under_review or published, and that `published` has a non-empty `verifiedBy` and `verifiedAt`. A stored version is **never demoted**: a `published` or `superseded` row can only be overwritten by `published`, and an `under_review` row (servable) cannot be overwritten by a `draft`, so a revision of a live bundle needs a new version id. A season older than the newest published season cannot be published, and `under_review` is refused for a season newer than the newest published one (an unsigned bundle would otherwise be served ahead of the signed one, since `currentReference` orders by season). On publish it **supersedes** every other published version, plus any `under_review` row for a newer season, and rewrites `bundle.version.status` in those rows too. Refusals raise `check_violation` (23514). Writes take a table lock so concurrent stores see a stable view. |

pgTAP: `apps/api/db-tests/admin.sql` (42 assertions). It checks ownership, that the app can't SELECT/INSERT any of the three tables, that no function is executable by PUBLIC, that every function works, that the store refuses an unsigned publish, that a draft or under_review store never clobbers a published, superseded or under-review version, that older seasons and unsigned newer-season under_review bundles are refused, that at most one version is published, and that the audit log is append-only.

## Admin authentication (`apps/api/src/lanes/admin/auth.ts`)

- Tokens are HS256 with the same `JWT_SECRET`, but with issuer `seb-orchard-admin`, audience `seb-admin`, claim `scope: platform-admin` and no `tid`. They expire after `ADMIN_JWT_TTL`, default `12h`.
- A tenant token is rejected on admin routes because it has no audience and the wrong issuer. An admin token is rejected on tenant routes because the issuer is wrong and `tid` is missing. Tests cover both directions, at the HTTP level and the verifier level.
- Every `/v1/admin/*` route except login calls `admin_get`. A deactivated admin loses access at once, even with an unexpired token.
- Login throttling is in-memory and cannot be used to lock an admin out: 8 failures per 15 minutes per **email + IP** pair, or 40 per IP, gives a 429; per email there is only an exponential **backoff** (none for the first 4 failures, then 100 ms doubling, capped at 5 s), never a hard lock. Every counter is updated whether or not the email exists. An unknown email is still checked against a dummy scrypt hash, and every failed login (known or unknown email) writes the same `admin.login_failed` audit row, so neither timing nor throttling reveals which accounts exist.

### First admin

```bash
npm run build -w @orchard/api
MIGRATION_DATABASE_URL=postgres://postgres:postgres@localhost:5432/orchard \
  node apps/api/dist/lanes/admin/create-admin.js ops@example.in "Platform Ops" 'a-long-password'
# --reset updates name/password of an existing admin and reactivates it
```

The CLI connects with the owner/migration URL on purpose: the application role has no way to create admins. Each create or reset writes an audit entry (`admin.create_cli` / `admin.reset_cli`).

## Endpoints (all JSON; every route except login needs `Authorization: Bearer <admin token>`)

| Method | Path | Body / query | Returns |
|---|---|---|---|
| POST | `/v1/admin/login` | `{ email, password }` | `{ token, admin }` (audited) |
| GET | `/v1/admin/me` | – | `{ id, email, name }` |
| GET | `/v1/admin/tenants` | `?q=` (name/district/plan/id) | `TenantSummary[]` aggregates |
| PATCH | `/v1/admin/tenants/:id` | `{ plan?, billing_status? }` (strict, at least one) | `{ id, name, plan, billing_status }`. Audited as `tenant.plan_update` with before/after values. |
| GET | `/v1/admin/worker-runs` | `?limit=50` | `{ runs, health: { status, lastRunAt, message }, intervalMin }` |
| GET | `/v1/admin/reference` | – | `{ current: { versionId, etag, status }, versions: [{ version_id, season, status, etag, published_at, verified_by, counts… }] }` |
| GET | `/v1/admin/reference/:versionId` | – | stored `ReferenceBundle` (starting point for an edit) |
| POST | `/v1/admin/reference/validate` | `ReferenceBundle` JSON | `{ ok, errors[], regulatoryImpact[], diff, against }` |
| POST | `/v1/admin/reference/publish` | `{ bundle, status: draft\|under_review\|published, verifiedBy? }` (`verifiedBy` required for `published`) | 201 `{ version_id, status, etag, published_at, superseded[], warnings[] }`. 422 `{ error, errors[] }` when the bundle is refused (validation errors, missing sign-off); 409 `{ error }` when the store would break a publishing invariant (demoting a stored version, older season, unsigned bundle outranking the published one). Audited as `reference.store`. |
| GET | `/v1/admin/audit` | `?limit=100&before=<id>` | newest-first audit entries with admin email/name |

Worker health is one of `ok`, `degraded` (some orchards failed), `failing` (every orchard failed, or a run never finished), `stale` (no run for more than 3 intervals), `running` or `unknown` (no runs yet).

### Reference validation and publishing (`apps/api/src/lanes/admin/bundle.ts`)

1. **Shape check (zod, passthrough).** The JSON must have the `ReferenceBundle` shape. Unknown extra fields are kept, so newer fields survive a round-trip.
2. **Integrity check.** This runs `validateBundle` from `@orchard/reference`: ids resolve, **no recommendation lists a banned product**, doses are positive and stage orders are unique. On top of that it checks for duplicate stage, chemical and pest ids and that the effective dates are in order.
3. **`regulatoryImpact`** comes from `@orchard/domain` and lists each recommendation affected by a banned or restricted product, with the remaining alternatives.
4. **Diff against the bundle currently served** (`currentReference`). It reports stages, recommendations and chemicals added, removed and changed (with the changed field names), version-field changes, chemical regulatory-status changes, and **dose changes per product per stage** (`{stage, recommendationId, chemicalId, before, after, kind}`).
5. **Publish rules.** `published` and `under_review` bundles are served to growers, so they need **zero errors**. `published` also needs the publisher's own `verifiedBy` in the request (`--verified-by` for the CLI). A `verifiedBy`/`verifiedAt` already embedded in the bundle, for example one loaded from an earlier signed version and then edited, is **ignored**: the request's `verifiedBy` and a fresh `verifiedAt` are stamped, and drafts and `under_review` bundles are stored with no sign-off at all. A `draft` may carry errors (they come back as `warnings`) because drafts are never served. The etag is the same `bundleEtag` that migrations use. The local reference cache is cleared after a store.

`apps/api/scripts/publish-reference.mjs` now uses the same `prepareBundle` and `storeReference` from `dist/lanes/admin/bundle.js`, so it applies the same checks and the same SECURITY DEFINER write. It also takes `--verified-by` and writes a `reference.store_cli` audit entry.

## Worker run log (`apps/api/src/worker.ts`)

`runCycle(db, provider, bundle, now)` keeps its signature and `CycleResult` return shape. Each call now records a `worker_runs` row: the start time, then totals and the per-orchard `errors` when it finishes. If the cycle can't enumerate its targets, that failure is recorded as `{ orchardId: '*' }` and rethrown. `recordedCycle(…, after)` is what the worker process uses: it runs the push drain inside the same recorded run, so `pushed` is stored, and a push failure becomes a `push: …` error rather than crashing the tick. The run log is best-effort: if it can't be written, the error is logged and the cycle still runs.

## Admin console (`apps/admin`)

React 18 + Vite + react-router 6. Styles and components are copied from `apps/web`, plus `admin.css`. The session is kept in `sessionStorage` under its own keys.

- **Tenants**: summary stats, search, billing filter, sort, and an edit-plan/billing dialog.
- **Worker runs**: health indicator (also shown in the sidebar, refreshed every minute) and a run table. Rows with errors expand into a per-orchard list.
- **Reference data**: the versions list (serving marker, sign-off, etag) and a four-step flow: load (upload a file, paste JSON, or start from a stored version), validate (errors, regulatory impact, diff with a dose-change table), review and sign off (status, `verifiedBy`, a confirmation checkbox), stored. Editing the JSON after validating makes the result stale and blocks publishing until you validate again.
- **Audit log**: action filter, expandable JSON detail, "load older" pagination.

Dev: `npm run dev -w @orchard/admin` runs on :5174 and proxies `/v1` to `:8080` (`API_URL` overrides it). Build: `npm run build -w @orchard/admin`.

## Tests

- `apps/api/test/lane-admin.test.ts` uses a throwaway DB `orchard_lane_admin_<pid>`. It covers the CLI bootstrap, login, tenant tokens rejected on admin routes and admin tokens rejected on tenant routes, deactivation, the aggregate-only tenant list, audited plan changes, validate catching a banned product, regulatory impact and dose diffs, publish needing `verifiedBy` and zero errors, an embedded old `verifiedBy` never being inherited (422), a draft never clobbering a published, superseded or under-review version (409), older-season and unsigned-newer-season refusals, superseding, the store function's own guards, login throttling per email+IP with backoff (no lockout) and identical handling of unknown emails, worker runs (including errors and push counts) and health classification.
- `apps/api/db-tests/admin.sql`: `pg_prove -d <db> db-tests/rls.sql db-tests/admin.sql`.

## Known gaps / notes for integration

- `migrate.ts` (frozen) re-runs `seedReference(BUNDLE_2026)` on every migrate. Its `ON CONFLICT` resets `skuastk-2026` to the compiled `under_review` status and content. If an admin publishes over `skuastk-2026`, the next migration run reverts it. Publish edited content under a **new version id** (for example `skuastk-2026.1`), or change `seedReference` to `DO NOTHING` when a row exists (that file belongs to no lane).
- `currentReference` caches for 5 minutes per process. A publish clears the cache only in the API process that handled it, so other replicas pick up the new bundle within 5 minutes.
- The login throttle is per process (in memory). Behind several replicas, put a shared limiter (gateway or Redis) in front of `/v1/admin/login`.
- `docs/api.md` is outside this lane, so the admin endpoints are documented here only.
