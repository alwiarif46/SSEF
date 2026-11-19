-- 006_admin: platform administration. Platform admins are NOT tenant users.
-- These tables are global (no tenant_id). orchard_app gets NO table privileges on them;
-- every read/write goes through a narrow SECURITY DEFINER function owned by orchard_owner.

CREATE TABLE IF NOT EXISTS public.platform_admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE CHECK (email = lower(email) AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  password_hash text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.platform_admins OWNER TO orchard_owner;
REVOKE ALL ON public.platform_admins FROM PUBLIC;

-- Append-only audit trail of admin actions. admin_id NULL = system / CLI action.
CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id bigserial PRIMARY KEY,
  admin_id uuid REFERENCES public.platform_admins(id),
  action text NOT NULL CHECK (action ~ '^[a-z][a-z0-9_.-]{1,63}$'),
  target text CHECK (length(target) <= 200),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_audit_log_created_idx ON public.admin_audit_log (created_at DESC, id DESC);
ALTER TABLE public.admin_audit_log OWNER TO orchard_owner;
REVOKE ALL ON public.admin_audit_log FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.admin_audit_log_id_seq FROM PUBLIC;

CREATE OR REPLACE FUNCTION app.guard_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END $$;
ALTER FUNCTION app.guard_append_only() OWNER TO orchard_owner;
DROP TRIGGER IF EXISTS admin_audit_log_append_only ON public.admin_audit_log;
CREATE TRIGGER admin_audit_log_append_only BEFORE UPDATE OR DELETE ON public.admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION app.guard_append_only();

-- One row per weather-worker cycle.
CREATE TABLE IF NOT EXISTS public.worker_runs (
  id bigserial PRIMARY KEY,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  orchards int,
  hours int,
  alerts int,
  new_alerts int,
  pushed int,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(errors) = 'array'),
  provider text NOT NULL
);
CREATE INDEX IF NOT EXISTS worker_runs_started_idx ON public.worker_runs (started_at DESC, id DESC);
ALTER TABLE public.worker_runs OWNER TO orchard_owner;
REVOKE ALL ON public.worker_runs FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.worker_runs_id_seq FROM PUBLIC;

-- ── Admin authentication ────────────────────────────────────────────────────────

-- Login: resolve an admin by email (case-insensitive).
CREATE OR REPLACE FUNCTION app.admin_lookup(p_email text)
RETURNS TABLE (id uuid, email text, name text, password_hash text, active boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT a.id, a.email, a.name, a.password_hash, a.active FROM public.platform_admins a WHERE a.email = lower(p_email)
$$;

-- Token check: is this admin still active? (never returns the password hash)
CREATE OR REPLACE FUNCTION app.admin_get(p_id uuid)
RETURNS TABLE (id uuid, email text, name text, active boolean, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT a.id, a.email, a.name, a.active, a.created_at FROM public.platform_admins a WHERE a.id = p_id
$$;

-- ── Audit log ───────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION app.admin_record_audit(p_admin_id uuid, p_action text, p_target text, p_detail jsonb DEFAULT '{}'::jsonb)
RETURNS bigint
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO public.admin_audit_log (admin_id, action, target, detail)
  VALUES (p_admin_id, p_action, p_target, coalesce(p_detail, '{}'::jsonb))
  RETURNING id
$$;

CREATE OR REPLACE FUNCTION app.admin_list_audit(p_limit int DEFAULT 100, p_before bigint DEFAULT NULL)
RETURNS TABLE (id bigint, admin_id uuid, admin_email text, admin_name text, action text, target text, detail jsonb, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT l.id, l.admin_id, a.email, a.name, l.action, l.target, l.detail, l.created_at
  FROM public.admin_audit_log l LEFT JOIN public.platform_admins a ON a.id = l.admin_id
  WHERE p_before IS NULL OR l.id < p_before
  ORDER BY l.id DESC
  LIMIT least(greatest(coalesce(p_limit, 100), 1), 500)
$$;

-- ── Worker run log ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION app.worker_run_start(p_provider text)
RETURNS bigint
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO public.worker_runs (provider) VALUES (left(coalesce(p_provider, 'unknown'), 60)) RETURNING id
$$;

-- Finishing is one-shot: a finished run can never be rewritten.
CREATE OR REPLACE FUNCTION app.worker_run_finish(p_id bigint, p_orchards int, p_hours int, p_alerts int, p_new_alerts int, p_pushed int, p_errors jsonb)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_errors IS NOT NULL AND jsonb_typeof(p_errors) <> 'array' THEN
    RAISE EXCEPTION 'errors must be a JSON array' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE public.worker_runs SET finished_at = clock_timestamp(), orchards = p_orchards, hours = p_hours, alerts = p_alerts,
    new_alerts = p_new_alerts, pushed = p_pushed, errors = coalesce(p_errors, '[]'::jsonb)
  WHERE id = p_id AND finished_at IS NULL;
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION app.admin_list_worker_runs(p_limit int DEFAULT 50)
RETURNS TABLE (id bigint, started_at timestamptz, finished_at timestamptz, orchards int, hours int, alerts int, new_alerts int, pushed int, errors jsonb, provider text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT w.id, w.started_at, w.finished_at, w.orchards, w.hours, w.alerts, w.new_alerts, w.pushed, w.errors, w.provider
  FROM public.worker_runs w ORDER BY w.started_at DESC, w.id DESC
  LIMIT least(greatest(coalesce(p_limit, 50), 1), 500)
$$;

-- ── Tenants (aggregates only — never tenant row contents) ───────────────────────

CREATE OR REPLACE FUNCTION app.admin_list_tenants()
RETURNS TABLE (id uuid, name text, plan text, billing_status text, district text, created_at timestamptz,
               users int, orchards int, blocks int, sprays_this_season int, last_activity_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH season AS (SELECT extract(year FROM (now() AT TIME ZONE 'Asia/Kolkata'))::int AS y)
  SELECT t.id, t.name, t.plan, t.billing_status, t.district, t.created_at,
    (SELECT count(*) FROM public.users u WHERE u.tenant_id = t.id AND u.active)::int,
    (SELECT count(*) FROM public.orchards o WHERE o.tenant_id = t.id AND o.deleted_at IS NULL)::int,
    (SELECT count(*) FROM public.blocks b WHERE b.tenant_id = t.id AND b.deleted_at IS NULL)::int,
    (SELECT count(*) FROM public.spray_events s, season WHERE s.tenant_id = t.id AND s.deleted_at IS NULL AND s.corrects_id IS NULL
       AND s.sprayed_on >= make_date(season.y, 1, 1) AND s.sprayed_on < make_date(season.y + 1, 1, 1))::int,
    greatest(
      (SELECT max(x.server_updated_at) FROM public.orchards x WHERE x.tenant_id = t.id),
      (SELECT max(x.server_updated_at) FROM public.blocks x WHERE x.tenant_id = t.id),
      (SELECT max(x.server_updated_at) FROM public.spray_events x WHERE x.tenant_id = t.id),
      (SELECT max(x.server_updated_at) FROM public.scouting_observations x WHERE x.tenant_id = t.id),
      (SELECT max(x.server_updated_at) FROM public.phenology_observations x WHERE x.tenant_id = t.id),
      (SELECT max(x.server_updated_at) FROM public.tasks x WHERE x.tenant_id = t.id),
      (SELECT max(x.server_updated_at) FROM public.harvest_records x WHERE x.tenant_id = t.id),
      (SELECT max(x.server_updated_at) FROM public.chemical_inventory x WHERE x.tenant_id = t.id),
      (SELECT max(x.server_updated_at) FROM public.expenses x WHERE x.tenant_id = t.id)
    )
  FROM public.tenants t
  ORDER BY t.created_at DESC
$$;

-- Change a tenant's plan and/or billing status. NULL keeps the current value.
-- Returns the new and previous values (for the audit trail); no row = tenant not found.
CREATE OR REPLACE FUNCTION app.admin_set_tenant_plan(p_tenant_id uuid, p_plan text, p_billing_status text)
RETURNS TABLE (id uuid, name text, plan text, billing_status text, previous_plan text, previous_billing_status text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE old_plan text; old_billing text;
BEGIN
  IF p_plan IS NOT NULL AND p_plan !~ '^[a-z][a-z0-9_-]{1,31}$' THEN
    RAISE EXCEPTION 'invalid plan' USING ERRCODE = 'check_violation';
  END IF;
  SELECT t.plan, t.billing_status INTO old_plan, old_billing FROM public.tenants t WHERE t.id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  RETURN QUERY
    UPDATE public.tenants t SET plan = coalesce(p_plan, t.plan), billing_status = coalesce(p_billing_status, t.billing_status)
    WHERE t.id = p_tenant_id
    RETURNING t.id, t.name, t.plan, t.billing_status, old_plan, old_billing;
END $$;

-- ── Reference data publishing ───────────────────────────────────────────────────
-- Content validation happens in the API (validateBundle); this function enforces the invariants
-- that must hold whoever calls it (API, CLI, or a direct orchard_app connection):
--  * consistent ids, an allowed status, agronomist sign-off (verifiedBy + verifiedAt) for 'published';
--  * a stored version is never demoted: a 'published' or 'superseded' row can only be overwritten by
--    'published', and an 'under_review' row (servable) cannot be overwritten by a 'draft'.
--    A draft revision of a live bundle needs a new version id;
--  * a season older than the newest published season cannot be published;
--  * an unsigned 'under_review' bundle can never outrank the signed published one
--    (currentReference serves by season DESC): under_review is refused for a season newer than
--    the newest published season;
--  * at most one published version: publishing supersedes every other published row, and any
--    under_review row for a newer season (left over from before anything was published).
CREATE OR REPLACE FUNCTION app.admin_store_reference(p_version_id text, p_season int, p_status text, p_bundle jsonb, p_etag text)
RETURNS TABLE (version_id text, season int, status text, etag text, published_at timestamptz, superseded text[])
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  sup text[] := '{}';
  existing text;
  newest_published int;
BEGIN
  IF p_status NOT IN ('draft','under_review','published') THEN
    RAISE EXCEPTION 'status must be draft, under_review or published' USING ERRCODE = 'check_violation';
  END IF;
  IF p_version_id !~ '^[a-z0-9][a-z0-9._-]{2,63}$' THEN
    RAISE EXCEPTION 'invalid version id' USING ERRCODE = 'check_violation';
  END IF;
  IF p_season NOT BETWEEN 2020 AND 2100 THEN
    RAISE EXCEPTION 'invalid season' USING ERRCODE = 'check_violation';
  END IF;
  IF p_bundle->'version'->>'id' IS DISTINCT FROM p_version_id
     OR (p_bundle->'version'->>'season')::int IS DISTINCT FROM p_season
     OR p_bundle->'version'->>'status' IS DISTINCT FROM p_status THEN
    RAISE EXCEPTION 'bundle.version does not match version id / season / status' USING ERRCODE = 'check_violation';
  END IF;
  IF p_status = 'published' AND (coalesce(btrim(p_bundle->'version'->>'verifiedBy'), '') = ''
                                 OR coalesce(btrim(p_bundle->'version'->>'verifiedAt'), '') = '') THEN
    RAISE EXCEPTION 'publishing requires version.verifiedBy and version.verifiedAt (agronomist sign-off)' USING ERRCODE = 'check_violation';
  END IF;
  IF p_etag !~ '^[0-9a-f]{16,64}$' THEN
    RAISE EXCEPTION 'invalid etag' USING ERRCODE = 'check_violation';
  END IF;

  -- Serialize reference writes so the invariants below are checked against a stable view.
  LOCK TABLE public.reference_bundles IN SHARE ROW EXCLUSIVE MODE;

  SELECT r.status INTO existing FROM public.reference_bundles r WHERE r.version_id = p_version_id;
  IF existing IN ('published', 'superseded') AND p_status <> 'published' THEN
    RAISE EXCEPTION 'version % is %; use a new version id for a % revision', p_version_id, existing, p_status
      USING ERRCODE = 'check_violation';
  END IF;
  IF existing = 'under_review' AND p_status = 'draft' THEN
    RAISE EXCEPTION 'version % is under review (served to growers); use a new version id for a draft', p_version_id
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT max(r.season) INTO newest_published FROM public.reference_bundles r
  WHERE r.status = 'published' AND r.version_id <> p_version_id;
  IF p_status = 'published' AND newest_published > p_season THEN
    RAISE EXCEPTION 'season % is older than the published season %', p_season, newest_published USING ERRCODE = 'check_violation';
  END IF;
  IF p_status = 'under_review' AND newest_published < p_season THEN
    RAISE EXCEPTION 'an unverified under_review bundle for season % would be served ahead of the published season %; publish it with sign-off instead',
      p_season, newest_published USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.reference_bundles AS r (version_id, season, status, bundle, etag, published_at)
  VALUES (p_version_id, p_season, p_status, p_bundle, p_etag, CASE WHEN p_status IN ('published','under_review') THEN now() END)
  ON CONFLICT ON CONSTRAINT reference_bundles_pkey DO UPDATE
    SET season = EXCLUDED.season, status = EXCLUDED.status, bundle = EXCLUDED.bundle, etag = EXCLUDED.etag,
        published_at = CASE WHEN EXCLUDED.status = 'published' THEN now()
                            WHEN EXCLUDED.status = 'under_review' THEN coalesce(r.published_at, now())
                            ELSE r.published_at END;

  IF p_status = 'published' THEN
    WITH s AS (
      UPDATE public.reference_bundles r SET status = 'superseded',
        bundle = jsonb_set(r.bundle, '{version,status}', '"superseded"')
      WHERE r.version_id <> p_version_id
        AND (r.status = 'published' OR (r.status = 'under_review' AND r.season > p_season))
      RETURNING r.version_id
    ) SELECT coalesce(array_agg(s.version_id ORDER BY s.version_id), '{}') INTO sup FROM s;
  END IF;

  RETURN QUERY SELECT r.version_id, r.season, r.status, r.etag, r.published_at, sup FROM public.reference_bundles r WHERE r.version_id = p_version_id;
END $$;

-- ── Ownership and grants ────────────────────────────────────────────────────────
ALTER FUNCTION app.admin_lookup(text) OWNER TO orchard_owner;
ALTER FUNCTION app.admin_get(uuid) OWNER TO orchard_owner;
ALTER FUNCTION app.admin_record_audit(uuid, text, text, jsonb) OWNER TO orchard_owner;
ALTER FUNCTION app.admin_list_audit(int, bigint) OWNER TO orchard_owner;
ALTER FUNCTION app.worker_run_start(text) OWNER TO orchard_owner;
ALTER FUNCTION app.worker_run_finish(bigint, int, int, int, int, int, jsonb) OWNER TO orchard_owner;
ALTER FUNCTION app.admin_list_worker_runs(int) OWNER TO orchard_owner;
ALTER FUNCTION app.admin_list_tenants() OWNER TO orchard_owner;
ALTER FUNCTION app.admin_set_tenant_plan(uuid, text, text) OWNER TO orchard_owner;
ALTER FUNCTION app.admin_store_reference(text, int, text, jsonb, text) OWNER TO orchard_owner;

REVOKE ALL ON FUNCTION app.admin_lookup(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.admin_get(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.admin_record_audit(uuid, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.admin_list_audit(int, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.worker_run_start(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.worker_run_finish(bigint, int, int, int, int, int, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.admin_list_worker_runs(int) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.admin_list_tenants() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.admin_set_tenant_plan(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.admin_store_reference(text, int, text, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.guard_append_only() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  app.admin_lookup(text), app.admin_get(uuid), app.admin_record_audit(uuid, text, text, jsonb), app.admin_list_audit(int, bigint),
  app.worker_run_start(text), app.worker_run_finish(bigint, int, int, int, int, int, jsonb), app.admin_list_worker_runs(int),
  app.admin_list_tenants(), app.admin_set_tenant_plan(uuid, text, text), app.admin_store_reference(text, int, text, jsonb, text)
TO orchard_app;
