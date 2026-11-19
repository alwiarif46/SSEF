# Lane B — Media & documents

Photo/document storage, the spray certificate PDF and CSV import. All server code lives in
`apps/api/src/lanes/media/` and is registered from `lanes/media/index.ts` inside its own
encapsulated Fastify context (multipart and `text/csv` parsing are scoped to it). Every route
authenticates itself; tenant context always comes from the session JWT (or, for `?t=` links, from
a server-signed media token).

## Storage

| Env | Default | Meaning |
|---|---|---|
| `MEDIA_DRIVER` | `local` | `local` or `s3` |
| `MEDIA_DIR` | `./data/media` | root for the local driver |
| `S3_BUCKET`, `S3_REGION` (`auto`), `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` | – | S3-compatible storage (AWS S3, Cloudflare R2: `S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com`, MinIO: path style) |
| `MEDIA_URL_TTL_SEC` | `900` | lifetime of signed `?t=` links |
| `MEDIA_PRESIGN_TTL_SEC` | `300` | lifetime of S3 presigned redirects |
| `MEDIA_SIGNING_SECRET` | derived from `JWT_SECRET` | HMAC key for media links (separate audience from session tokens) |

Object keys are `tenantId/yyyy/mm/<uuid>.<ext>`, built only on the server; the database enforces
the tenant prefix (`CHECK storage_key LIKE tenant_id || '/%'`) and the local driver refuses any key
that does not match the pattern or escapes the root. The local driver writes to a temp file and
renames, so a crash never leaves a truncated object.

### Table `media` (migration `005_media.sql`)
`id, tenant_id, kind ('photo'|'document'), content_type, bytes, sha256, storage_key, entity_table,
entity_id, uploaded_by, created_at, deleted_at`. RLS enabled + forced, `tenant_isolation` policy,
owned by `orchard_owner`; the app role has SELECT/INSERT/UPDATE (no DELETE — removal is a soft
delete). `uploaded_by` is a composite FK `(tenant_id, uploaded_by) → users(tenant_id, id)` (the
migration adds the `users (tenant_id, id)` unique index it needs). Rows are immutable apart from
`deleted_at`, and a deleted row cannot be restored (trigger). pgTAP: `apps/api/db-tests/media.sql`.

`entity_id` is deliberately not a foreign key: a phone may upload a photo before the record it
belongs to has synced.

## Endpoints

| Method | Path | Who | Notes |
|---|---|---|---|
| POST | `/v1/media` | any role | `multipart/form-data`: one `file` part (≤ 10 MB) + optional `entityTable`, `entityId`, `replaces` fields (also accepted as query params). Returns `201 { id, url, mediaId, kind, contentType, bytes, sha256, signedUrl, expiresAt, deduplicated }`; `200` with `deduplicated: true` when the tenant already has identical bytes. `413` too large, `415` wrong type. |
| GET | `/v1/media/:id` | Bearer **or** `?t=<signed>` | Local driver streams the bytes (`nosniff`, sandbox CSP, ETag = sha256); S3 driver answers `302` to a short-lived presigned URL. Other tenants get `404`. |
| GET | `/v1/media/:id/meta` | Bearer | metadata + a fresh signed link |
| GET | `/v1/media/links?ids=a,b` | Bearer | batch signed links for thumbnails (≤ 100; ids of other tenants are silently absent) |
| GET | `/v1/media?entityTable=&entityId=` | Bearer | media attached to a record |
| DELETE | `/v1/media/:id` | manager+ | soft-deletes the row, removes the object, and removes the reference from the record's `photos` |
| GET | `/v1/reports/spray-certificate.pdf?blockId=&season=` | manager+ | spray certificate (below) |
| GET | `/v1/import/templates/:kind` | any role | CSV template with an example row |
| POST | `/v1/import/:kind?dryRun=true\|false` | manager+ | body `text/csv` or JSON `{ csv, dryRun? }`; **dry run is the default** |

**Content checks.** The stored type is decided by magic bytes (JPEG `FF D8 FF`, PNG signature,
`RIFF…WEBP`, `%PDF-`), never by the client header. A declared allowed type that disagrees with the
content, any other declared type, or unrecognised content is rejected with `415`.
`application/octet-stream` is accepted and typed by content.

**EXIF / GPS.** Uploaded bytes are stored unmodified, so EXIF — including GPS — is **kept**: the
location of a scab lesion or mite hotspot is agronomically useful and stays inside the tenant.
Objects are only served to the owning tenant (or holders of a link minted for that tenant).
The web client re-encodes photos when downscaling (orientation applied, EXIF dropped); scouting
records carry their own `lat`/`lng`.

**Signed links.** `?t=` is an HS256 JWT with audience `seb-orchard:media`, bound to one media id
and one tenant, expiring after `MEDIA_URL_TTL_SEC`. A session JWT is not accepted as `t`, and a
media token cannot be used as a session token.

## Photos in records

`scouting_observations.photos` (and `chemical_inventory.photos`) keep their existing JSON-array
shape. Entries are either legacy **local URIs** (what the mobile app writes at capture time) or
**references** `{ "url": "/v1/media/<id>", "mediaId": "<id>" }`. The key order matches Postgres
jsonb's canonical order so the sync `field_merge` union (which compares JSON text) dedupes the
server's and the device's copies of the same reference.

When an upload names `entityTable` + `entityId`, the server writes the reference into that row in
the same transaction — replacing the `replaces` local URI in place if given — so other devices
and the web see the photo on their next pull even before the uploading phone syncs again.

## Mobile (`apps/mobile/src/media/`)
* `photos.ts` — pure helpers (normalise, replace, FormData `{ uri, name, type }` parts, retry
  bookkeeping with exponential back-off 30 s → 6 h, permanent failure on 400/403/413/415/422 or
  after 12 attempts). Tested in `apps/mobile/test/media.test.ts`.
* `uploader.ts` — background uploader. The queue is **derived from the records** (any local URI
  still in a `photos` array is pending), so nothing is lost if the app is killed; only the retry
  log lives in Watermelon local storage. After upload the local URI is swapped for the reference.
* `sync/sync.ts` — after every record sync the uploader is kicked in the background; record sync
  never waits for it. If uploads changed records, one follow-up sync pushes the references.
* `screens/field.tsx` — saving a scouting observation triggers a sync; the field home shows
  thumbnails (uploaded photos load from the API with the Bearer token), the number of photos
  waiting, and a "Retry photo uploads" button when some failed permanently.

## Web (`apps/web/src/media/`)
* Block → Scouting: **Add photo** (file input with `capture="environment"`), downscaled in the
  browser to ≤ 1600 px JPEG, uploaded on save (linked to the new record's id) and saved as
  references. History shows thumbnails via batch signed links; click to view.
* Reports: per-block **Certificate** download.
* Import: choose the kind, download the template, paste or upload a CSV, check (dry run) with a
  per-row preview of errors and warnings, then import.

## Spray certificate
`buildCertificate()` is a pure function of the block's season records and the reference bundle;
`renderCertificatePdf()` draws it with pdfkit (A4 landscape, standard fonts, footer on every page).
Contents: tenant, orchard (district, tehsil/village, khasra, location, elevation), block (system,
rootstock, planting year, area, trees, varieties, full bloom, expected harvest), every spray line
(date, stage, product, active ingredients, FRAC/IRAC, dose/100 L, quantity, batch, CIBRC reg. no.
from the inventory lots drawn, operator, compliance flags, override reason), corrections and the
records they supersede (struck through), harvest reference, last pesticide spray date and days
before harvest, a PHI verdict per product, an overall verdict with reasons, the reference schedule
version, generated timestamp and a disclaimer.

PHI rules: the harvest reference is the first recorded pick of the season (non-superseded),
otherwise the block's expected harvest date. Each application is compared to the first pick on or
after it (applications after the last pick are post-harvest and do not count). Required interval =
max(label PHI, 21-day hard stop): shorter → **FAIL**; inside the bundle's de-facto stop window
(28 days) → **WARN**; otherwise **PASS**. Nutrients/cultural inputs are N/A. No harvest date →
**PENDING**. Overall is **NON-COMPLIANT** on any FAIL or a regulatory flag (banned, unregistered,
no label claim, unknown product) on an effective spray.

## CSV import
Kinds: `orchards`, `blocks`, `spray_events`, `harvest_records`. Headers are matched
case-insensitively (spaces → `_`); unknown columns are reported and ignored. Up to 5,000 rows.
References are by name: orchard name → id, block name (plus orchard when names repeat) → id,
product by catalogue id, product name or active ingredient(s) (ambiguous ingredients such as
"mancozeb" must use the product name), stage by id or name, variety/rootstock by id or name,
operator by team-member name or phone. Dates may be `YYYY-MM-DD` or `DD/MM/YYYY`.
Spray rows with the same `spray_ref` (default: block + date + stage) become one tank-mix event;
quantity defaults to dose × total litres / 100.

Validated rows are written through the sync `push()` as a `Changes` payload, so imports get the
same role gates, append-only locking, server compliance re-check (flags appear as warnings) and
inventory FIFO draw-down as a device push — omit `quantity`/`unit` for historical sprays whose
stock is not in the inventory. A dry run executes that push inside a transaction that is rolled
back, so the preview shows exactly what would be accepted, rejected or flagged. A real import is
all-or-nothing: any invalid row → `422` and nothing is written. Possible duplicates of existing
sprays/harvests are reported as warnings. Exports guard against spreadsheet formula injection.

## Tests
* `apps/api/test/lane-media.test.ts` — upload (all types), magic-byte rejection, size limit,
  dedupe, cross-tenant denial (Bearer, signed link minted for another tenant, delete, attach),
  signed-link expiry and binding, delete, local + S3 drivers (presigned redirect), certificate PDF
  and PHI logic, CSV parsing, templates, dry-run and import for all four kinds.
* `apps/api/db-tests/media.sql` — RLS/force, ownership, grants, composite FK, key prefix, type and
  size checks, immutability, soft delete.
* `apps/mobile/test/media.test.ts` — pure photo/queue logic.

## Known limits
* A media row records one primary entity; when the same bytes are attached to a second record
  (dedupe), deleting the media removes the reference from the primary record only (the other
  record's thumbnail then shows as unavailable).
* The mobile picker stores JPEGs at quality 0.5 without resizing (no image-manipulation module is
  installed); the server's 10 MB cap applies.
