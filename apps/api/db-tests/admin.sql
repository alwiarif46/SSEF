-- pgTAP: platform admin tables are reachable only through SECURITY DEFINER functions. Run: scripts/db-test.sh
BEGIN;
SELECT plan(42);

-- 1. Ownership, privileges, function hygiene.
SELECT is((SELECT tableowner::text FROM pg_tables WHERE schemaname = 'public' AND tablename = 'platform_admins'), 'orchard_owner', 'platform_admins owned by orchard_owner');
SELECT is((SELECT tableowner::text FROM pg_tables WHERE schemaname = 'public' AND tablename = 'admin_audit_log'), 'orchard_owner', 'admin_audit_log owned by orchard_owner');
SELECT is((SELECT tableowner::text FROM pg_tables WHERE schemaname = 'public' AND tablename = 'worker_runs'), 'orchard_owner', 'worker_runs owned by orchard_owner');
SELECT ok(NOT has_table_privilege('orchard_app', 'public.platform_admins', 'SELECT,INSERT,UPDATE,DELETE'), 'app has no privileges on platform_admins');
SELECT ok(NOT has_table_privilege('orchard_app', 'public.admin_audit_log', 'SELECT,INSERT,UPDATE,DELETE'), 'app has no privileges on admin_audit_log');
SELECT ok(NOT has_table_privilege('orchard_app', 'public.worker_runs', 'SELECT,INSERT,UPDATE,DELETE'), 'app has no privileges on worker_runs');
SELECT is(
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'app' AND p.proname IN ('admin_lookup','admin_get','admin_record_audit','admin_list_audit','worker_run_start','worker_run_finish',
     'admin_list_worker_runs','admin_list_tenants','admin_set_tenant_plan','admin_store_reference')
     AND p.prosecdef AND pg_get_userbyid(p.proowner) = 'orchard_owner'
     AND EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%')),
  10, 'all 10 admin entry points are SECURITY DEFINER, owned by orchard_owner, with a pinned search_path');
SELECT is(
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'app' AND p.proname LIKE ANY (ARRAY['admin\_%', 'worker\_run\_%'])
     AND has_function_privilege('public', p.oid, 'EXECUTE')),
  0, 'no admin function is executable by PUBLIC');

-- Fixtures (as owner/superuser).
CREATE TEMP TABLE fx AS
  SELECT (SELECT tenant_id FROM app.create_tenant_with_owner('Admin Test A', 'Owner A', '9000000101', 'x', 'Shopian')) AS a,
         (SELECT tenant_id FROM app.create_tenant_with_owner('Admin Test B', 'Owner B', '9000000102', 'x')) AS b;
INSERT INTO public.orchards (id, tenant_id, name, notes) VALUES ('orch-adm-0001', (SELECT a FROM fx), 'A orchard', 'private note');
INSERT INTO public.blocks (id, tenant_id, orchard_id, name, system_type) VALUES ('blk-adm-00001', (SELECT a FROM fx), 'orch-adm-0001', 'Block 1', 'hdp');
INSERT INTO public.spray_events (id, tenant_id, block_id, sprayed_on, products)
  VALUES ('spr-adm-00001', (SELECT a FROM fx), 'blk-adm-00001', make_date(extract(year FROM (now() AT TIME ZONE 'Asia/Kolkata'))::int, 4, 1), '[]');
INSERT INTO public.platform_admins (email, name, password_hash) VALUES ('pgtap@seborchard.in', 'pgTAP Admin', 'scrypt$x$y');
GRANT SELECT ON fx TO orchard_app;

SET LOCAL ROLE orchard_app;

-- 2. Direct access is denied.
SELECT throws_ok($$SELECT * FROM public.platform_admins$$, '42501', NULL, 'app cannot SELECT platform_admins');
SELECT throws_ok($$SELECT * FROM public.worker_runs$$, '42501', NULL, 'app cannot SELECT worker_runs');
SELECT throws_ok($$SELECT * FROM public.admin_audit_log$$, '42501', NULL, 'app cannot SELECT admin_audit_log');
SELECT throws_ok($$INSERT INTO public.platform_admins (email, name, password_hash) VALUES ('evil@x.in', 'Evil', 'x')$$, '42501', NULL, 'app cannot create admins');
SELECT throws_ok($$INSERT INTO public.worker_runs (provider) VALUES ('forged')$$, '42501', NULL, 'app cannot insert worker_runs directly');
SELECT throws_ok($$UPDATE public.reference_bundles SET status = 'draft'$$, '42501', NULL, 'app still cannot write reference_bundles directly');

-- 3. The functions work.
SELECT is((SELECT name FROM app.admin_lookup('PGTAP@seborchard.in')), 'pgTAP Admin', 'admin_lookup is case-insensitive');
SELECT is((SELECT count(*)::int FROM app.admin_lookup('nobody@seborchard.in')), 0, 'admin_lookup: unknown email → no row');
SELECT ok((SELECT active FROM app.admin_get((SELECT id FROM app.admin_lookup('pgtap@seborchard.in')))), 'admin_get returns active flag');
SELECT ok(app.admin_record_audit((SELECT id FROM app.admin_lookup('pgtap@seborchard.in')), 'test.action', 'target-1', '{"k":1}') > 0, 'admin_record_audit inserts');
SELECT is((SELECT action FROM app.admin_list_audit(1)), 'test.action', 'admin_list_audit returns latest entry');
SELECT throws_ok($$SELECT app.admin_record_audit(NULL, 'Bad Action!', NULL, '{}')$$, '23514', NULL, 'audit action must be a slug');

CREATE TEMP TABLE run AS SELECT app.worker_run_start('pgtap') AS id;
SELECT ok(app.worker_run_finish((SELECT id FROM run), 1, 24, 2, 1, 0, '[{"orchardId":"o1","error":"boom"}]'), 'worker_run_finish records totals');
SELECT ok(NOT app.worker_run_finish((SELECT id FROM run), 9, 9, 9, 9, 9, '[]'), 'a finished run cannot be rewritten');
SELECT is((SELECT errors->0->>'error' FROM app.admin_list_worker_runs(1)), 'boom', 'admin_list_worker_runs returns errors per orchard');

SELECT is(
  (SELECT row(users, orchards, blocks, sprays_this_season)::text FROM app.admin_list_tenants() WHERE id = (SELECT a FROM fx)),
  '(1,1,1,1)', 'admin_list_tenants aggregates across tenants without a tenant context');
SELECT ok((SELECT last_activity_at IS NOT NULL FROM app.admin_list_tenants() WHERE id = (SELECT a FROM fx)), 'admin_list_tenants reports last activity');
SELECT is((SELECT plan || '/' || billing_status || ' was ' || previous_plan FROM app.admin_set_tenant_plan((SELECT b FROM fx), 'pro', 'active')), 'pro/active was pilot', 'admin_set_tenant_plan updates and reports previous value');
SELECT is((SELECT count(*)::int FROM app.admin_set_tenant_plan(gen_random_uuid(), 'pro', NULL)), 0, 'admin_set_tenant_plan: unknown tenant → no row');
SELECT throws_ok($$SELECT * FROM app.admin_set_tenant_plan((SELECT b FROM fx), NULL, 'free-forever')$$, '23514', NULL, 'billing status constraint still applies');

-- Reference store invariants.
SELECT throws_ok(
  $$SELECT * FROM app.admin_store_reference('x-2030', 2030, 'published', '{"version":{"id":"x-2030","season":2030,"status":"published"}}', '0123456789abcdef0123456789abcdef')$$,
  '23514', NULL, 'admin_store_reference refuses published without verifiedBy');
SELECT is(
  (SELECT status FROM app.admin_store_reference('x-2030', 2030, 'draft', '{"version":{"id":"x-2030","season":2030,"status":"draft"},"stages":[],"recommendations":[],"chemicals":[]}', '0123456789abcdef0123456789abcdef')),
  'draft', 'admin_store_reference stores a draft');

-- A stored version is never demoted; seasons and sign-off cannot be bypassed.
SELECT is((SELECT status FROM app.admin_store_reference('x-2031', 2031, 'published', '{"version":{"id":"x-2031","season":2031,"status":"published","verifiedBy":"Dr. Test","verifiedAt":"2031-01-01T00:00:00Z"}}', '0123456789abcdef0123456789abcdef')),
  'published', 'admin_store_reference publishes a signed bundle');
SELECT throws_ok($$SELECT * FROM app.admin_store_reference('x-2031', 2031, 'draft', '{"version":{"id":"x-2031","season":2031,"status":"draft"}}', '0123456789abcdef0123456789abcdef')$$,
  '23514', NULL, 'a draft cannot clobber a published version');
SELECT throws_ok($$SELECT * FROM app.admin_store_reference('x-2031', 2031, 'under_review', '{"version":{"id":"x-2031","season":2031,"status":"under_review"}}', '0123456789abcdef0123456789abcdef')$$,
  '23514', NULL, 'under_review cannot clobber a published version');
SELECT is((SELECT bundle->'version'->>'verifiedBy' FROM public.reference_bundles WHERE version_id = 'x-2031'), 'Dr. Test', 'the published row is untouched');
SELECT throws_ok($$SELECT * FROM app.admin_store_reference('x-2029', 2029, 'published', '{"version":{"id":"x-2029","season":2029,"status":"published","verifiedBy":"Dr. Test","verifiedAt":"2031-01-01T00:00:00Z"}}', '0123456789abcdef0123456789abcdef')$$,
  '23514', NULL, 'a season older than the published one cannot be published');
SELECT throws_ok($$SELECT * FROM app.admin_store_reference('x-2032', 2032, 'under_review', '{"version":{"id":"x-2032","season":2032,"status":"under_review"}}', '0123456789abcdef0123456789abcdef')$$,
  '23514', NULL, 'an unsigned under_review bundle cannot outrank the published season');
SELECT is((SELECT status FROM app.admin_store_reference('x-2031-rc', 2031, 'under_review', '{"version":{"id":"x-2031-rc","season":2031,"status":"under_review"}}', '0123456789abcdef0123456789abcdef')),
  'under_review', 'under_review is allowed for the published season');
SELECT throws_ok($$SELECT * FROM app.admin_store_reference('x-2031-rc', 2031, 'draft', '{"version":{"id":"x-2031-rc","season":2031,"status":"draft"}}', '0123456789abcdef0123456789abcdef')$$,
  '23514', NULL, 'a draft cannot clobber an under_review version');
SELECT is((SELECT superseded FROM app.admin_store_reference('x-2032', 2032, 'published', '{"version":{"id":"x-2032","season":2032,"status":"published","verifiedBy":"Dr. Test","verifiedAt":"2031-01-01T00:00:00Z"}}', '0123456789abcdef0123456789abcdef')),
  ARRAY['x-2031'], 'publishing a newer season supersedes the previous published version');
SELECT throws_ok($$SELECT * FROM app.admin_store_reference('x-2031', 2031, 'draft', '{"version":{"id":"x-2031","season":2031,"status":"draft"}}', '0123456789abcdef0123456789abcdef')$$,
  '23514', NULL, 'a draft cannot clobber a superseded version');
SELECT is((SELECT count(*)::int FROM public.reference_bundles WHERE status = 'published'), 1, 'at most one published version');

RESET ROLE;
SELECT throws_ok($$UPDATE public.admin_audit_log SET action = 'tampered'$$, '23514', NULL, 'audit log is append-only even for the owner');
SELECT * FROM finish();
ROLLBACK;
