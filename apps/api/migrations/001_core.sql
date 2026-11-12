-- 001_core: roles, tenancy, users, reference data, weather store, helper functions.
-- Run as a superuser. Application connects as orchard_app (no BYPASSRLS).

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'orchard_owner') THEN
    CREATE ROLE orchard_owner NOLOGIN BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'orchard_app') THEN
    CREATE ROLE orchard_app LOGIN PASSWORD 'orchard_app' NOBYPASSRLS;
  END IF;
END $$;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS app AUTHORIZATION orchard_owner;
GRANT USAGE ON SCHEMA app TO orchard_app;
GRANT USAGE ON SCHEMA public TO orchard_app;

-- Current tenant from the transaction-scoped setting (NULL when unset → policies match nothing).
CREATE OR REPLACE FUNCTION app.current_tenant() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.current_tenant', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app.touch_server_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.server_updated_at := clock_timestamp();
  RETURN NEW;
END $$;

-- Append-only guard: a locked row may only receive a soft-delete marker change.
CREATE OR REPLACE FUNCTION app.guard_locked() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.locked IS TRUE THEN
    IF (to_jsonb(NEW) - 'server_updated_at' - 'deleted_at') IS DISTINCT FROM (to_jsonb(OLD) - 'server_updated_at' - 'deleted_at') THEN
      RAISE EXCEPTION 'record % is locked (append-only); create a correction', OLD.id USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- Tenant id can never change on update.
CREATE OR REPLACE FUNCTION app.guard_tenant() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'tenant_id is immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TABLE IF NOT EXISTS public.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  plan text NOT NULL DEFAULT 'pilot',
  billing_status text NOT NULL DEFAULT 'trial' CHECK (billing_status IN ('trial','active','past_due','cancelled')),
  district text,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- The tenant row itself is tenant-scoped: id = current tenant.
ALTER TABLE public.tenants OWNER TO orchard_owner;
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.tenants;
CREATE POLICY tenant_isolation ON public.tenants USING (id = app.current_tenant()) WITH CHECK (id = app.current_tenant());
GRANT SELECT, UPDATE ON public.tenants TO orchard_app;

CREATE TABLE IF NOT EXISTS public.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  phone text NOT NULL UNIQUE,
  role text NOT NULL CHECK (role IN ('owner','manager','worker')),
  password_hash text NOT NULL,
  language text NOT NULL DEFAULT 'en',
  active boolean NOT NULL DEFAULT true,
  orchard_ids uuid[] ,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS users_tenant_idx ON public.users (tenant_id);
ALTER TABLE public.users OWNER TO orchard_owner;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.users;
CREATE POLICY tenant_isolation ON public.users USING (tenant_id = app.current_tenant()) WITH CHECK (tenant_id = app.current_tenant());
GRANT SELECT, INSERT, UPDATE ON public.users TO orchard_app;
DROP TRIGGER IF EXISTS users_guard_tenant ON public.users;
CREATE TRIGGER users_guard_tenant BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION app.guard_tenant();

CREATE TABLE IF NOT EXISTS public.push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token text NOT NULL,
  platform text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, token)
);
ALTER TABLE public.push_tokens OWNER TO orchard_owner;
ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_tokens FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.push_tokens;
CREATE POLICY tenant_isolation ON public.push_tokens USING (tenant_id = app.current_tenant()) WITH CHECK (tenant_id = app.current_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_tokens TO orchard_app;

-- Global, season-versioned reference data. Read-only to the application role.
CREATE TABLE IF NOT EXISTS public.reference_bundles (
  version_id text PRIMARY KEY,
  season int NOT NULL,
  status text NOT NULL CHECK (status IN ('draft','under_review','published','superseded')),
  bundle jsonb NOT NULL,
  etag text NOT NULL,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.reference_bundles OWNER TO orchard_owner;
GRANT SELECT ON public.reference_bundles TO orchard_app;

-- Hourly weather cache, server-written (pull-only to clients via weather_daily).
CREATE TABLE IF NOT EXISTS public.weather_hourly (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  orchard_id text NOT NULL,
  time timestamptz NOT NULL,
  temp_c real NOT NULL,
  rh real NOT NULL,
  precip_mm real NOT NULL DEFAULT 0,
  dew_point_c real,
  wind_kph real,
  weather_code smallint,
  is_forecast boolean NOT NULL DEFAULT false,
  source text NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, orchard_id, time)
);
ALTER TABLE public.weather_hourly OWNER TO orchard_owner;
ALTER TABLE public.weather_hourly ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weather_hourly FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.weather_hourly;
CREATE POLICY tenant_isolation ON public.weather_hourly USING (tenant_id = app.current_tenant()) WITH CHECK (tenant_id = app.current_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.weather_hourly TO orchard_app;

-- Push outbox (worker → sender).
CREATE TABLE IF NOT EXISTS public.push_outbox (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  alert_id text,
  title text NOT NULL,
  body text NOT NULL,
  data jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  attempts int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
ALTER TABLE public.push_outbox OWNER TO orchard_owner;
ALTER TABLE public.push_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_outbox FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.push_outbox;
CREATE POLICY tenant_isolation ON public.push_outbox USING (tenant_id = app.current_tenant()) WITH CHECK (tenant_id = app.current_tenant());
GRANT SELECT, INSERT, UPDATE ON public.push_outbox TO orchard_app;
GRANT USAGE ON SEQUENCE public.push_outbox_id_seq TO orchard_app;

-- ── Narrow SECURITY DEFINER entry points (the only cross-tenant paths) ──────────

-- Login: resolve a phone number to its user (and tenant) before a tenant context exists.
CREATE OR REPLACE FUNCTION app.auth_lookup(p_phone text)
RETURNS TABLE (id uuid, tenant_id uuid, name text, role text, password_hash text, active boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.id, u.tenant_id, u.name, u.role, u.password_hash, u.active FROM public.users u WHERE u.phone = p_phone
$$;

-- Signup: create a tenant and its owner atomically.
CREATE OR REPLACE FUNCTION app.create_tenant_with_owner(p_tenant_name text, p_name text, p_phone text, p_password_hash text, p_district text DEFAULT NULL)
RETURNS TABLE (tenant_id uuid, user_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE t uuid; u uuid;
BEGIN
  INSERT INTO public.tenants (name, district) VALUES (p_tenant_name, p_district) RETURNING id INTO t;
  INSERT INTO public.users (tenant_id, name, phone, role, password_hash) VALUES (t, p_name, p_phone, 'owner', p_password_hash) RETURNING id INTO u;
  RETURN QUERY SELECT t, u;
END $$;

-- Phone uniqueness check across tenants (no data leaked beyond a boolean).
CREATE OR REPLACE FUNCTION app.phone_taken(p_phone text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.users WHERE phone = p_phone)
$$;

ALTER FUNCTION app.auth_lookup(text) OWNER TO orchard_owner;
ALTER FUNCTION app.create_tenant_with_owner(text, text, text, text, text) OWNER TO orchard_owner;
ALTER FUNCTION app.phone_taken(text) OWNER TO orchard_owner;
REVOKE ALL ON FUNCTION app.auth_lookup(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.create_tenant_with_owner(text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.phone_taken(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.auth_lookup(text), app.create_tenant_with_owner(text, text, text, text, text), app.phone_taken(text) TO orchard_app;
GRANT EXECUTE ON FUNCTION app.current_tenant() TO orchard_app;
