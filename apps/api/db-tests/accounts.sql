-- pgTAP: accounts lane (OTP, password reset, login throttle, orchard assignment,
-- notification preferences). Run: scripts/db-test.sh
BEGIN;
SELECT plan(53);

-- 1. Pre-tenant tables are definer-only: the app role has no table privileges.
SELECT has_table('app', 'otp_codes', 'app.otp_codes exists');
SELECT has_table('app', 'password_resets', 'app.password_resets exists');
SELECT has_table('app', 'login_throttle', 'app.login_throttle exists');
SELECT ok(NOT has_table_privilege('orchard_app', 'app.otp_codes', 'SELECT, INSERT, UPDATE, DELETE'), 'orchard_app has no privileges on otp_codes');
SELECT ok(NOT has_table_privilege('orchard_app', 'app.password_resets', 'SELECT, INSERT, UPDATE, DELETE'), 'orchard_app has no privileges on password_resets');
SELECT ok(NOT has_table_privilege('orchard_app', 'app.login_throttle', 'SELECT, INSERT, UPDATE, DELETE'), 'orchard_app has no privileges on login_throttle');
SELECT is((SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'app' AND c.relname IN ('otp_codes', 'password_resets', 'login_throttle') AND pg_get_userbyid(c.relowner) <> 'orchard_owner'), 0,
  'pre-tenant tables are owned by orchard_owner');

-- 2. Entry points: SECURITY DEFINER, owned by orchard_owner, no PUBLIC execute, executable by the app.
CREATE TEMP TABLE fns AS
  SELECT p.oid, p.proname, p.prosecdef, pg_get_userbyid(p.proowner) AS owner, p.proacl FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'app' AND p.proname IN ('otp_issue', 'otp_consume', 'password_reset', 'login_retry_after', 'login_failed', 'login_succeeded');
SELECT is((SELECT count(*)::int FROM fns), 6, 'six accounts entry points exist');
SELECT is((SELECT count(*)::int FROM fns WHERE NOT prosecdef), 0, 'all entry points are SECURITY DEFINER');
SELECT is((SELECT count(*)::int FROM fns WHERE owner <> 'orchard_owner'), 0, 'all entry points are owned by orchard_owner');
SELECT is((SELECT count(*)::int FROM fns WHERE proacl IS NULL OR EXISTS (SELECT 1 FROM aclexplode(proacl) a WHERE a.grantee = 0)), 0, 'no entry point is executable by PUBLIC');
SELECT is((SELECT count(*)::int FROM fns WHERE NOT has_function_privilege('orchard_app', oid, 'EXECUTE')), 0, 'orchard_app may execute every entry point');
SELECT is((SELECT count(*)::int FROM fns f WHERE NOT EXISTS (SELECT 1 FROM unnest((SELECT proconfig FROM pg_proc WHERE oid = f.oid)) c WHERE c LIKE 'search_path=%')), 0, 'every entry point pins search_path');

-- 3. Tenant tables are RLS-forced with a tenant policy.
SELECT ok((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.user_orchards'::regclass), 'user_orchards is RLS-forced');
SELECT ok((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.notification_prefs'::regclass), 'notification_prefs is RLS-forced');
SELECT policies_are('public', 'user_orchards', ARRAY['tenant_isolation'], 'user_orchards has the tenant policy');
SELECT policies_are('public', 'notification_prefs', ARRAY['tenant_isolation'], 'notification_prefs has the tenant policy');
SELECT col_not_null('public', 'user_orchards', 'tenant_id', 'user_orchards.tenant_id NOT NULL');
SELECT col_not_null('public', 'notification_prefs', 'tenant_id', 'notification_prefs.tenant_id NOT NULL');

-- Fixtures.
CREATE TEMP TABLE fx AS
  SELECT (SELECT tenant_id FROM app.create_tenant_with_owner('Acc A', 'Owner A', '9100000001', 'scrypt$a$b')) AS a,
         (SELECT tenant_id FROM app.create_tenant_with_owner('Acc B', 'Owner B', '9100000002', 'scrypt$a$b')) AS b;
INSERT INTO public.users (tenant_id, name, phone, role, password_hash) SELECT a, 'Worker A', '9100000003', 'worker', 'scrypt$old$hash' FROM fx;
ALTER TABLE fx ADD COLUMN wa uuid, ADD COLUMN ob uuid;
UPDATE fx SET wa = (SELECT id FROM public.users WHERE phone = '9100000003'), ob = (SELECT id FROM public.users WHERE phone = '9100000002');
GRANT SELECT ON fx TO orchard_app;
CREATE TEMP TABLE h (k text PRIMARY KEY, v text);
INSERT INTO h VALUES ('good', repeat('a', 64)), ('bad', repeat('b', 64)), ('reset', repeat('c', 64)), ('rtok', repeat('d', 64));
GRANT SELECT ON h TO orchard_app;

SET LOCAL ROLE orchard_app;

-- 4. OTP issue / consume.
SELECT is(app.otp_issue('9100000003', 'login', (SELECT v FROM h WHERE k = 'good'), '10.0.0.1', 300, 5, 0), 'sent', 'issue for an active account');
SELECT is(app.otp_issue('9100009999', 'login', (SELECT v FROM h WHERE k = 'good'), '10.0.0.1', 300, 5, 0), 'unknown', 'issue for an unknown phone is recorded but not deliverable');
SELECT is(app.otp_issue('9100000003', 'login', (SELECT v FROM h WHERE k = 'good'), '10.0.0.1', 300, 5, 30), 'cooldown', 'resend cooldown');
SELECT is(app.otp_issue('9100000004', 'login', (SELECT v FROM h WHERE k = 'good'), '10.0.0.1', 300, 5, 0, 5, 2), 'rate_limited', 'per-IP limit');
SELECT throws_ok($$SELECT app.otp_issue('9100000003', 'admin', repeat('a', 64), NULL)$$, '22023', NULL, 'purpose is validated');
SELECT is((SELECT status FROM app.otp_consume('9100009999', 'login', (SELECT v FROM h WHERE k = 'good'))), 'invalid', 'unknown phone never verifies, even with the right hash');
SELECT is((SELECT status FROM app.otp_consume('9100000003', 'reset', (SELECT v FROM h WHERE k = 'good'), (SELECT v FROM h WHERE k = 'rtok'))), 'invalid', 'login code does not work for reset');
SELECT is((SELECT status FROM app.otp_consume('9100000003', 'login', (SELECT v FROM h WHERE k = 'bad'))), 'invalid', 'wrong code 1');
SELECT is((SELECT status FROM app.otp_consume('9100000003', 'login', (SELECT v FROM h WHERE k = 'bad'))), 'invalid', 'wrong code 2');
SELECT is((SELECT status FROM app.otp_consume('9100000003', 'login', (SELECT v FROM h WHERE k = 'bad'))), 'invalid', 'wrong code 3');
SELECT is((SELECT status FROM app.otp_consume('9100000003', 'login', (SELECT v FROM h WHERE k = 'bad'))), 'invalid', 'wrong code 4');
SELECT is((SELECT status FROM app.otp_consume('9100000003', 'login', (SELECT v FROM h WHERE k = 'bad'))), 'locked', 'fifth wrong code burns it');
SELECT is((SELECT status FROM app.otp_consume('9100000003', 'login', (SELECT v FROM h WHERE k = 'good'))), 'invalid', 'burnt code cannot be used');
SELECT is(app.otp_issue('9100000003', 'login', (SELECT v FROM h WHERE k = 'good'), '10.0.0.2', 300, 5, 0), 'sent', 'new code');
SELECT is((SELECT user_id FROM app.otp_consume('9100000003', 'login', (SELECT v FROM h WHERE k = 'good'))), (SELECT wa FROM fx), 'right code returns the user');
SELECT is((SELECT status FROM app.otp_consume('9100000003', 'login', (SELECT v FROM h WHERE k = 'good'))), 'invalid', 'codes are single use');
SELECT is(app.otp_issue('9100000003', 'login', (SELECT v FROM h WHERE k = 'good'), '10.0.0.3', 0, 5, 0), 'sent', 'zero-ttl code');
SELECT is((SELECT status FROM app.otp_consume('9100000003', 'login', (SELECT v FROM h WHERE k = 'good'))), 'expired', 'expired code is rejected');

-- 5. Password reset by phone after OTP.
SELECT is(app.otp_issue('9100000003', 'reset', (SELECT v FROM h WHERE k = 'reset'), '10.0.0.4', 300, 5, 0), 'sent', 'reset code');
SELECT is((SELECT status FROM app.otp_consume('9100000003', 'reset', (SELECT v FROM h WHERE k = 'reset'), (SELECT v FROM h WHERE k = 'rtok'))), 'ok', 'reset code verifies and stores the reset token');
SELECT is(app.password_reset((SELECT v FROM h WHERE k = 'rtok'), 'scrypt$new$hash'), (SELECT wa FROM fx), 'reset token changes the password');
SELECT ok(app.password_reset((SELECT v FROM h WHERE k = 'rtok'), 'scrypt$again$hash') IS NULL, 'reset token is single use');
SELECT ok(app.password_reset((SELECT v FROM h WHERE k = 'bad'), 'scrypt$x$y') IS NULL, 'unknown reset token is rejected');

-- 6. Login throttle.
SELECT is((SELECT bool_or(app.login_failed('9100000003', '10.0.0.9')) FROM generate_series(1, 4)), false, 'four failures do not lock');
SELECT is(app.login_failed('9100000003', '10.0.0.9'), true, 'fifth failure locks the phone');
SELECT ok(app.login_retry_after('9100000003', '10.9.9.9') > 14 * 60, 'locked for ~15 minutes');
SELECT lives_ok($$SELECT app.login_succeeded('9100000003')$$, 'success clears the phone counter');
SELECT is(app.login_retry_after('9100000003', '10.9.9.9'), 0, 'phone no longer locked');

-- 7. Tenant isolation of the new tenant tables.
SELECT set_config('app.current_tenant', (SELECT a::text FROM fx), true);
INSERT INTO public.orchards (id, tenant_id, name) SELECT 'acc-orch-a1', a, 'A1' FROM fx;
SELECT lives_ok($$INSERT INTO public.user_orchards (tenant_id, user_id, orchard_id) SELECT a, wa, 'acc-orch-a1' FROM fx$$, 'tenant A assigns its worker');
SELECT lives_ok($$INSERT INTO public.notification_prefs (tenant_id, user_id, min_severity) SELECT a, wa, 'high' FROM fx$$, 'tenant A stores prefs');
SELECT throws_ok($$INSERT INTO public.notification_prefs (tenant_id, user_id, quiet_hours_start) SELECT a, (SELECT id FROM public.users WHERE phone = '9100000001'), '22:00' FROM fx$$, '23514', NULL, 'quiet hours need both ends');
SELECT set_config('app.current_tenant', (SELECT b::text FROM fx), true);
SELECT is((SELECT count(*)::int FROM public.user_orchards) + (SELECT count(*)::int FROM public.notification_prefs), 0, 'tenant B sees no assignments or prefs of A');
SELECT throws_ok($$INSERT INTO public.user_orchards (tenant_id, user_id, orchard_id) SELECT b, wa, 'acc-orch-a1' FROM fx$$, '23503', NULL, 'composite FK blocks assigning another tenant user/orchard');
SELECT throws_ok($$INSERT INTO public.notification_prefs (tenant_id, user_id) SELECT a, wa FROM fx$$, '42501', NULL, 'cannot write prefs for another tenant');

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
