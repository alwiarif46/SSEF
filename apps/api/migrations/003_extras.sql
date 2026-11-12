-- 003: constraints and functions that depend on sync tables.
CREATE UNIQUE INDEX IF NOT EXISTS infection_alerts_dedupe_uq ON public.infection_alerts (tenant_id, dedupe_key);
CREATE UNIQUE INDEX IF NOT EXISTS weather_daily_day_uq ON public.weather_daily (tenant_id, orchard_id, day);
ALTER TABLE public.blocks DROP CONSTRAINT IF EXISTS blocks_system_type_chk;
ALTER TABLE public.blocks ADD CONSTRAINT blocks_system_type_chk CHECK (system_type IN ('traditional','hdp','medium_density'));
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_status_chk;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_status_chk CHECK (status IN ('open','in_progress','done','cancelled'));
ALTER TABLE public.orchards DROP CONSTRAINT IF EXISTS orchards_geo_chk;
-- Kashmir valley + Ladakh bounding box sanity check.
ALTER TABLE public.orchards ADD CONSTRAINT orchards_geo_chk CHECK ((lat IS NULL OR lat BETWEEN 32 AND 36.5) AND (lng IS NULL OR lng BETWEEN 73 AND 80));

-- Weather worker: enumerate orchards across tenants (coordinates only).
CREATE OR REPLACE FUNCTION app.weather_targets()
RETURNS TABLE (tenant_id uuid, orchard_id text, lat double precision, lng double precision, elevation_m double precision, district text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT o.tenant_id, o.id, o.lat, o.lng, o.elevation_m, o.district
  FROM public.orchards o JOIN public.tenants t ON t.id = o.tenant_id
  WHERE o.deleted_at IS NULL AND o.lat IS NOT NULL AND o.lng IS NOT NULL AND t.billing_status IN ('trial','active','past_due')
$$;
ALTER FUNCTION app.weather_targets() OWNER TO orchard_owner;
REVOKE ALL ON FUNCTION app.weather_targets() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.weather_targets() TO orchard_app;

-- Tenants with pending pushes (ids only).
CREATE OR REPLACE FUNCTION app.tenants_with_pending_push() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT DISTINCT tenant_id FROM public.push_outbox WHERE status = 'pending'
$$;
ALTER FUNCTION app.tenants_with_pending_push() OWNER TO orchard_owner;
REVOKE ALL ON FUNCTION app.tenants_with_pending_push() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.tenants_with_pending_push() TO orchard_app;

CREATE TABLE IF NOT EXISTS public.schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
