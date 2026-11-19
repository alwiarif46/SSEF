-- 007: cross-lane integration.
-- A role change alters what a user may sync (accounts lane: workers with assignments are scoped),
-- so it must invalidate the device's sync scope exactly like an orchard reassignment does.
CREATE OR REPLACE FUNCTION app.bump_scope_on_role_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    NEW.orchard_scope_changed_at := now();
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS users_role_scope ON public.users;
CREATE TRIGGER users_role_scope BEFORE UPDATE OF role ON public.users FOR EACH ROW EXECUTE FUNCTION app.bump_scope_on_role_change();
