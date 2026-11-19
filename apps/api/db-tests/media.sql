-- pgTAP: media index (005_media). Run: scripts/db-test.sh
BEGIN;
SELECT plan(20);

SELECT has_table('public', 'media', 'media table exists');
SELECT ok((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.media'::regclass), 'media has ENABLE + FORCE ROW LEVEL SECURITY');
SELECT is((SELECT tableowner::text FROM pg_tables WHERE schemaname = 'public' AND tablename = 'media'), 'orchard_owner', 'media is owned by orchard_owner');
SELECT is((SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public' AND tablename = 'media' AND policyname = 'tenant_isolation'), 1, 'media has the tenant_isolation policy');
SELECT ok(NOT has_table_privilege('orchard_app', 'public.media', 'DELETE'), 'app role cannot hard-delete media (soft delete only)');
SELECT ok(has_table_privilege('orchard_app', 'public.media', 'SELECT,INSERT,UPDATE'), 'app role can read, insert and soft-delete media');
SELECT col_not_null('public', 'media', 'tenant_id', 'media.tenant_id is NOT NULL');

CREATE TEMP TABLE mfx AS
  SELECT a.tenant_id AS a, a.user_id AS ua, b.tenant_id AS b, b.user_id AS ub
  FROM app.create_tenant_with_owner('Media Tenant A', 'Owner A', '9000000101', 'x') a,
       app.create_tenant_with_owner('Media Tenant B', 'Owner B', '9000000102', 'x') b;
GRANT SELECT ON mfx TO orchard_app;

SET LOCAL ROLE orchard_app;

SELECT is((SELECT count(*)::int FROM public.media), 0, 'no tenant context: nothing visible');

SELECT set_config('app.current_tenant', (SELECT a::text FROM mfx), true);
SELECT lives_ok(
  $$INSERT INTO public.media (id, tenant_id, kind, content_type, bytes, sha256, storage_key, uploaded_by)
    SELECT '11111111-1111-4111-8111-111111111111', a, 'photo', 'image/jpeg', 1024, repeat('a', 64), a::text || '/2026/05/11111111-1111-4111-8111-111111111111.jpg', ua FROM mfx$$,
  'tenant A stores a photo');
SELECT throws_ok(
  $$INSERT INTO public.media (tenant_id, kind, content_type, bytes, sha256, storage_key, uploaded_by)
    SELECT b, 'photo', 'image/jpeg', 1024, repeat('b', 64), b::text || '/2026/05/22222222-2222-4222-8222-222222222222.jpg', ub FROM mfx$$,
  '42501', NULL, 'cannot insert media for another tenant (WITH CHECK)');
SELECT throws_ok(
  $$INSERT INTO public.media (tenant_id, kind, content_type, bytes, sha256, storage_key, uploaded_by)
    SELECT a, 'photo', 'image/jpeg', 1024, repeat('c', 64), a::text || '/2026/05/33333333-3333-4333-8333-333333333333.jpg', ub FROM mfx$$,
  '23503', NULL, 'uploaded_by must be a user of the same tenant (composite FK)');
SELECT throws_ok(
  $$INSERT INTO public.media (tenant_id, kind, content_type, bytes, sha256, storage_key, uploaded_by)
    SELECT a, 'photo', 'image/jpeg', 1024, repeat('d', 64), b::text || '/2026/05/44444444-4444-4444-8444-444444444444.jpg', ua FROM mfx$$,
  '23514', NULL, 'storage key must live under the owning tenant prefix');
SELECT throws_ok(
  $$INSERT INTO public.media (tenant_id, kind, content_type, bytes, sha256, storage_key, uploaded_by)
    SELECT a, 'photo', 'image/gif', 1024, repeat('e', 64), a::text || '/2026/05/55555555-5555-4555-8555-555555555555.jpg', ua FROM mfx$$,
  '23514', NULL, 'only allowed content types');
SELECT throws_ok(
  $$INSERT INTO public.media (tenant_id, kind, content_type, bytes, sha256, storage_key, uploaded_by)
    SELECT a, 'photo', 'image/jpeg', 10485761, repeat('f', 64), a::text || '/2026/05/66666666-6666-4666-8666-666666666666.jpg', ua FROM mfx$$,
  '23514', NULL, 'size cap of 10 MB');
SELECT throws_ok(
  $$UPDATE public.media SET storage_key = (SELECT a::text FROM mfx) || '/2026/05/77777777-7777-4777-8777-777777777777.jpg' WHERE id = '11111111-1111-4111-8111-111111111111'$$,
  '23514', NULL, 'stored media is immutable');

SELECT set_config('app.current_tenant', (SELECT b::text FROM mfx), true);
SELECT is((SELECT count(*)::int FROM public.media), 0, 'tenant B cannot see tenant A media');
UPDATE public.media SET deleted_at = now() WHERE id = '11111111-1111-4111-8111-111111111111';

SELECT set_config('app.current_tenant', (SELECT a::text FROM mfx), true);
SELECT is((SELECT count(*)::int FROM public.media WHERE deleted_at IS NULL), 1, 'tenant B soft-delete affected nothing');
SELECT lives_ok($$UPDATE public.media SET deleted_at = now() WHERE id = '11111111-1111-4111-8111-111111111111'$$, 'owner tenant can soft-delete');
SELECT throws_ok($$UPDATE public.media SET deleted_at = NULL WHERE id = '11111111-1111-4111-8111-111111111111'$$, '23514', NULL, 'deleted media cannot be restored');
SELECT throws_ok($$UPDATE public.media SET tenant_id = (SELECT b FROM mfx) WHERE id = '11111111-1111-4111-8111-111111111111'$$, NULL, NULL, 'tenant_id cannot change');

SELECT * FROM finish();
ROLLBACK;
