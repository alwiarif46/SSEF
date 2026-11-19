# Lane A — Accounts

SMS OTP login, password reset, Postgres-backed login throttling, worker orchard
assignment and per-user notification preferences.

Code: `apps/api/src/lanes/accounts/**`, `apps/api/src/routes/auth.ts`,
`apps/api/src/push.ts`, `apps/api/src/sync/sync.ts`, migration
`apps/api/migrations/004_accounts.sql`. Tests: `apps/api/test/lane-accounts.test.ts`
(vitest, real Postgres) and `apps/api/db-tests/accounts.sql` (pgTAP).

## Endpoints

### Public (no token)

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/v1/auth/otp/request` | `{ phone, purpose: 'login' \| 'reset' }` | `200 { ok: true, expiresInSec }` — identical whether or not the phone has an account. `429 { error, retryAfterSec }` (+ `Retry-After`) when rate-limited. |
| POST | `/v1/auth/otp/verify` | `{ phone, code, purpose }` | `login` → `{ token, user }` (same shape as `/v1/auth/login`). `reset` → `{ resetToken, expiresInSec }`. `401` for wrong / expired / used / burnt codes. |
| POST | `/v1/auth/password/reset` | `{ resetToken, password }` (8–128 chars) | `200 { ok: true }`; `401` when the token is unknown, expired or already used. |
| POST | `/v1/auth/login` | `{ phone, password }` | unchanged contract; `429` + `Retry-After` while locked. |
| POST | `/v1/auth/signup` | unchanged | unchanged |

### Authenticated

| Method | Path | Role | Body | Returns |
|---|---|---|---|---|
| GET | `/v1/user-orchards` | manager+ | – | `[{ userId, orchardIds[] }]` for every user with assignments |
| GET | `/v1/users/:id/orchards` | manager+ | – | `{ userId, role, orchardIds[] }` (`404` outside the tenant) |
| PUT | `/v1/users/:id/orchards` | manager+ | `{ orchardIds: string[] }` (replaces the set; `[]` clears it) | `{ userId, orchardIds }`. `400` for non-workers or unknown/deleted orchards (`{ error, orchardIds }`). |
| GET | `/v1/me/notifications` | any | – | `{ alertTypes, minSeverity, quietHoursStart, quietHoursEnd, smsFallback, options: { alertTypes, severities, timezone } }` (defaults when never saved) |
| PUT | `/v1/me/notifications` | any | `{ alertTypes: string[] \| null, minSeverity: 'low'\|'medium'\|'high'\|'critical', quietHoursStart: 'HH:MM' \| null, quietHoursEnd: 'HH:MM' \| null, smsFallback: boolean }` | the saved preferences |

`alertTypes: null` means every type; `[]` means none. Quiet hours are IST
wall-clock times, both set or both null, and may wrap midnight (`22:00`–`06:00`).

## Behaviour

### OTP
- 6-digit codes from `crypto.randomInt`, valid 5 minutes, single use. Only
  `HMAC-SHA256(OTP_PEPPER, "otp:<purpose>:<phone>:<code>")` is stored.
- Max 5 verification attempts per code; the 5th wrong guess burns it. Issuing a
  new code supersedes any outstanding code for the same phone and purpose. A
  login code never works for reset and vice versa.
- Rate limits (per phone and per client IP, counted for known *and* unknown
  phones so responses never reveal whether a number is registered): 30 s resend
  cooldown, 5 requests per phone and 30 per IP per hour.
- Codes are delivered by SMS only to active accounts; unknown phones get the same
  `200` but nothing is sent. SMS delivery failures are logged, never revealed.
- Reset: verifying a `reset` code atomically stores a random reset token (hash
  only, 10 minutes, single use). `/v1/auth/password/reset` updates
  `users.password_hash` by the verified phone and clears that phone's login lockout.
  Existing JWTs are not revoked (stateless tokens; they expire per `JWT_TTL`).

### Login throttling
- Moved from the in-memory `Map` to Postgres (`app.login_throttle`), so it holds
  across API instances and restarts. 5 failures for a phone within 15 minutes lock
  it for 15 minutes (`429`, `Retry-After`). A per-IP counter (50 failures / 15 min)
  caps credential stuffing across phones. Success clears the phone's counter.
- The client IP is Fastify's `req.ip`; behind a reverse proxy configure Fastify
  `trustProxy` so this is the real client address.

### Database security
- `app.otp_codes`, `app.password_resets`, `app.login_throttle` are pre-tenant,
  have no RLS and **no grants** to `orchard_app`; they are reachable only through
  `SECURITY DEFINER` functions owned by `orchard_owner` with `REVOKE ALL FROM
  PUBLIC` + `GRANT EXECUTE TO orchard_app` and a pinned `search_path`:
  `app.otp_issue`, `app.otp_consume`, `app.password_reset`,
  `app.login_retry_after`, `app.login_failed`, `app.login_succeeded`.
- `public.user_orchards` and `public.notification_prefs` are tenant tables
  (`tenant_id NOT NULL`, ENABLE + FORCE RLS, `tenant_isolation` policy, composite
  `(tenant_id, user_id) → users(tenant_id, id)` and
  `(tenant_id, orchard_id) → orchards(tenant_id, id)` foreign keys). The migration
  adds `UNIQUE (tenant_id, id)` on `users` (if absent) for those FKs, and
  `users.orchard_scope_changed_at`.
- The legacy `users.orchard_ids uuid[]` column is unused; `user_orchards` is the
  source of truth.

### Worker orchard scoping (sync)
- A **worker with ≥ 1 assignment** pulls only: their orchards; blocks, trap
  catches, expenses, alerts and weather of those orchards; block-linked rows
  (tree rows, sprays, nutrients, scouting, phenology, harvest) of those blocks;
  tasks in those orchards **or assigned to them**. `chemical_inventory` is shared.
- Pushes by such a worker that create, update or delete rows outside their
  orchards — or move a row into another orchard — are rejected per row with
  `orchard not assigned to you`. Their own tasks may be updated wherever they are.
- Workers without assignments, managers and owners are unaffected.
- When a worker's assignment set changes, the next incremental pull re-sends the
  full visible set (as `updated`) and lists every live row that left scope in
  `deleted`, so the device evicts it. This repeats for pulls whose checkpoint lies
  within the 10 s re-send overlap (`PULL_OVERLAP_MS`) after the change (idempotent).
- `app.ts` calls `pull(tx, lastPulledAt)` without the principal, so
  `routes/auth.ts` installs a root `onRoute` hook that runs the `GET /v1/sync`
  handler inside an `AsyncLocalStorage` carrying `req.principal`;
  `pull(tx, lastPulledAt, viewer?)` also accepts the viewer explicitly.

### Push + SMS fallback (`sendPending`)
- Per outbox message the alert type comes from `push_outbox.data.type` (or the
  linked alert), severity from the linked `infection_alerts.severity` (or
  `data.severity`), orchard from `data.orchardId`.
- Each active user is filtered by their preferences: alert type, minimum
  severity, and IST quiet hours (critical alerts bypass quiet hours). Workers with
  orchard assignments only get alerts of their orchards.
- Critical alerts reach users with `smsFallback` and **no push token** by SMS,
  after the outbox batch is committed (best effort; failures are logged). If the
  push sender fails, the batch stays pending and no SMS is sent.
- Signature is backward compatible: `sendPending(db, sender?, { sms?, now?, log? })`.

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `SMS_PROVIDER` | `log` | `log` (prints, keeps last code per phone in memory), `msg91`, `twilio` |
| `MSG91_AUTH_KEY` | – | MSG91 auth key (required for `msg91` in production) |
| `MSG91_TEMPLATE_ID` | – | DLT Flow template for OTP; variable `otp` |
| `MSG91_ALERT_TEMPLATE_ID` | – | Flow template for alert SMS fallback; variables `title`, `body` |
| `MSG91_BASE_URL` | `https://control.msg91.com` | API base |
| `TWILIO_SID`, `TWILIO_TOKEN`, `TWILIO_FROM` | – | Twilio account SID, auth token, sender number |
| `TWILIO_BASE_URL` | `https://api.twilio.com` | API base |
| `SMS_DEFAULT_COUNTRY_CODE` | `91` | prefixed to 10-digit national numbers |
| `OTP_PEPPER` | `JWT_SECRET` | secret for OTP / reset-token hashes |
| `OTP_TTL_SEC` | `300` | code lifetime |
| `OTP_MAX_ATTEMPTS` | `5` | wrong guesses before a code is burnt |
| `OTP_RESEND_COOLDOWN_SEC` | `30` | minimum gap between codes per phone |
| `OTP_PHONE_MAX` / `OTP_IP_MAX` / `OTP_WINDOW_SEC` | `5` / `30` / `3600` | request caps per window |
| `RESET_TOKEN_TTL_SEC` | `600` | reset token lifetime |
| `LOGIN_PHONE_MAX_FAILURES` / `LOGIN_IP_MAX_FAILURES` | `5` / `50` | failures before lockout |
| `LOGIN_LOCK_MINUTES` / `LOGIN_WINDOW_MINUTES` | `15` / `15` | lock duration / counting window |

With `NODE_ENV=production`, `msg91`/`twilio` refuse to start without their
credentials, and `log` prints a warning (codes would never be delivered).

## Clients
- Web: login page has "Log in with OTP" and "Forgot password?" flows
  (`pages/Auth.tsx`); Team page assigns orchards per worker (`pages/Team.tsx`);
  Settings has notification preferences (`pages/Settings.tsx`).
- Mobile: login screen has "Log in with SMS code" and "Forgot password?"
  (`screens/auth.tsx`); Settings has notification preferences (`screens/more.tsx`).
  Forgot-password signs in through `useAuth().login` with the new password.
  OTP login uses `useAuth().adoptSession(token, user)` when the auth provider
  exposes it; `state/auth.tsx` is outside this lane and does not yet, so the screen
  persists the session (SecureStore token + `auth.user` meta, the keys the provider
  reads on launch) and asks the user to reopen the app. Adding
  `adoptSession` to `state/auth.tsx` (set token, cache `/v1/me`, set state — same as
  `login` after the API call) makes OTP login seamless with no change here.
