-- pgTAP: tenant isolation is release-blocking. Run: scripts/db-test.sh
BEGIN;
SELECT plan(24);

-- 1. Every tenant-owned table has RLS enabled AND forced, and a policy.
SELECT is(
  (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r'
     AND EXISTS (SELECT 1 FROM information_schema.columns k WHERE k.table_schema = 'public' AND k.table_name = c.relname AND k.column_name = 'tenant_id')
     AND NOT (c.relrowsecurity AND c.relforcerowsecurity)),
  0, 'every table with tenant_id has ENABLE + FORCE ROW LEVEL SECURITY');
SELECT is(
  (SELECT count(*)::int FROM information_schema.columns k
   WHERE k.table_schema = 'public' AND k.column_name = 'tenant_id'
     AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = k.table_name)),
  0, 'every table with tenant_id has a policy');
SELECT ok((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.tenants'::regclass), 'tenants table is RLS-forced');
SELECT ok(NOT (SELECT rolbypassrls FROM pg_roles WHERE rolname = 'orchard_app'), 'app role cannot bypass RLS');
SELECT ok(NOT (SELECT rolsuper FROM pg_roles WHERE rolname = 'orchard_app'), 'app role is not superuser');
SELECT is((SELECT count(*)::int FROM pg_tables WHERE schemaname = 'public' AND tableowner = 'orchard_app'), 0, 'app role owns no tables');

-- Fixtures: two tenants.
CREATE TEMP TABLE fx AS
  SELECT (SELECT tenant_id FROM app.create_tenant_with_owner('Tenant A', 'Owner A', '9000000001', 'x')) AS a,
         (SELECT tenant_id FROM app.create_tenant_with_owner('Tenant B', 'Owner B', '9000000002', 'x')) AS b;
GRANT SELECT ON fx TO orchard_app;

SET LOCAL ROLE orchard_app;

-- 2. No tenant context → nothing visible.
SELECT is((SELECT count(*)::int FROM public.users), 0, 'no context: users invisible');
SELECT is((SELECT count(*)::int FROM public.tenants), 0, 'no context: tenants invisible');

-- 3. Tenant A writes.
SELECT set_config('app.current_tenant', (SELECT a::text FROM fx), true);
SELECT lives_ok($$INSERT INTO public.orchards (id, tenant_id, name, lat, lng) VALUES ('orch-a-0001', (SELECT a FROM fx), 'A Shopian', 33.72, 74.83)$$, 'tenant A inserts own orchard');
SELECT lives_ok($$INSERT INTO public.blocks (id, tenant_id, orchard_id, name, system_type) VALUES ('blk-a-00001', (SELECT a FROM fx), 'orch-a-0001', 'Block 1', 'hdp')$$, 'tenant A inserts own block');
SELECT lives_ok($$INSERT INTO public.spray_events (id, tenant_id, block_id, sprayed_on, products, locked) VALUES ('spr-a-00001', (SELECT a FROM fx), 'blk-a-00001', '2026-04-01', '[{"chemicalId":"captan-50wp"}]', true)$$, 'tenant A records spray');
SELECT throws_ok($$INSERT INTO public.orchards (id, tenant_id, name) VALUES ('orch-x-0001', (SELECT b FROM fx), 'Forged')$$, '42501', NULL, 'cannot insert a row for another tenant (WITH CHECK)');
SELECT is((SELECT count(*)::int FROM public.tenants), 1, 'tenant A sees exactly its own tenant row');
SELECT is((SELECT count(*)::int FROM public.users), 1, 'tenant A sees only its own users');

-- 4. Switch to tenant B (same transaction, new transaction-local value).
SELECT set_config('app.current_tenant', (SELECT b::text FROM fx), true);
SELECT is((SELECT count(*)::int FROM public.orchards), 0, 'tenant B cannot read A orchards');
SELECT is((SELECT count(*)::int FROM public.spray_events), 0, 'tenant B cannot read A sprays');
SELECT is((SELECT count(*)::int FROM public.weather_hourly), 0, 'tenant B cannot read A weather');
UPDATE public.orchards SET name = 'pwned' WHERE id = 'orch-a-0001';
DELETE FROM public.push_tokens;
SELECT throws_ok($$INSERT INTO public.blocks (id, tenant_id, orchard_id, name, system_type) VALUES ('blk-b-00001', (SELECT b FROM fx), 'orch-a-0001', 'Sneaky', 'hdp')$$, '23503', NULL, 'composite FK blocks referencing another tenant orchard');

-- 5. Back to A: data unchanged, guards hold.
SELECT set_config('app.current_tenant', (SELECT a::text FROM fx), true);
SELECT is((SELECT name FROM public.orchards WHERE id = 'orch-a-0001'), 'A Shopian', 'tenant B update affected nothing');
SELECT throws_ok($$UPDATE public.spray_events SET notes = 'edited' WHERE id = 'spr-a-00001'$$, '23514', NULL, 'locked spray events are append-only');
SELECT lives_ok($$UPDATE public.spray_events SET deleted_at = now() WHERE id = 'spr-a-00001'$$, 'soft-delete marker allowed by guard (API forbids it separately)');
SELECT throws_ok($$UPDATE public.orchards SET tenant_id = (SELECT b FROM fx) WHERE id = 'orch-a-0001'$$, NULL, NULL, 'tenant_id cannot be changed');
SELECT throws_ok($$SELECT * FROM public.reference_bundles FOR UPDATE$$, '42501', NULL, 'reference data is read-only to the app');
SELECT ok((SELECT count(*) FROM app.weather_targets()) >= 1, 'weather worker entry point enumerates orchards');

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
