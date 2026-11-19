-- pgTAP: cross-lane integration (007).
BEGIN;
SELECT plan(2);
CREATE TEMP TABLE fx AS SELECT * FROM app.create_tenant_with_owner('Int Co', 'Owner', '9000000901', 'x');
INSERT INTO public.users (tenant_id, name, phone, role, password_hash) SELECT tenant_id, 'W', '9000000902', 'worker', 'x' FROM fx;
SELECT is((SELECT orchard_scope_changed_at FROM public.users WHERE phone = '9000000902'), NULL, 'new worker has no scope change');
UPDATE public.users SET role = 'manager' WHERE phone = '9000000902';
SELECT isnt((SELECT orchard_scope_changed_at FROM public.users WHERE phone = '9000000902'), NULL, 'role change bumps sync scope');
SELECT * FROM finish();
ROLLBACK;
