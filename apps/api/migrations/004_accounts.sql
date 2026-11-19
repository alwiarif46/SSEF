-- 004_accounts: SMS OTP login + password reset, Postgres-backed login throttling,
-- worker orchard assignment, per-user notification preferences.
--
-- Pre-tenant state (OTP codes, reset tokens, login throttle) lives in the `app`
-- schema with NO table grants to orchard_app: it is reachable only through the
-- narrow SECURITY DEFINER functions below. Tenant state (user_orchards,
-- notification_prefs) is RLS-forced like every other tenant table.

-- ── Users: composite key target + assignment change marker ───────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = 'public.users'::regclass AND c.contype IN ('u', 'p')
      AND (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM unnest(c.conkey) k JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k)
          = ARRAY['id', 'tenant_id']
  ) THEN
    ALTER TABLE public.users ADD CONSTRAINT users_tenant_id_id_key UNIQUE (tenant_id, id);
  END IF;
END $$;

-- Bumped whenever a user's orchard assignment set changes; sync pull uses it to
-- re-send the user's full visible data set (and evict rows that left scope).
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS orchard_scope_changed_at timestamptz;

-- ── OTP codes (pre-tenant, definer-only) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.otp_codes (
  id bigserial PRIMARY KEY,
  phone text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('login', 'reset')),
  -- NULL when the phone has no active account (row kept for rate limiting only).
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 5,
  request_ip text,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS otp_codes_phone_idx ON app.otp_codes (phone, purpose, created_at DESC);
CREATE INDEX IF NOT EXISTS otp_codes_ip_idx ON app.otp_codes (request_ip, created_at DESC);
CREATE INDEX IF NOT EXISTS otp_codes_created_idx ON app.otp_codes (created_at);
ALTER TABLE app.otp_codes OWNER TO orchard_owner;
REVOKE ALL ON app.otp_codes FROM PUBLIC;

-- Short-lived single-use password reset tokens (hash only).
CREATE TABLE IF NOT EXISTS app.password_resets (
  token_hash text PRIMARY KEY,
  phone text NOT NULL,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS password_resets_created_idx ON app.password_resets (created_at);
ALTER TABLE app.password_resets OWNER TO orchard_owner;
REVOKE ALL ON app.password_resets FROM PUBLIC;

-- Login failure counters, per phone and per client IP.
CREATE TABLE IF NOT EXISTS app.login_throttle (
  scope text NOT NULL CHECK (scope IN ('phone', 'ip')),
  key text NOT NULL,
  failures int NOT NULL DEFAULT 0,
  first_failure_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  PRIMARY KEY (scope, key)
);
ALTER TABLE app.login_throttle OWNER TO orchard_owner;
REVOKE ALL ON app.login_throttle FROM PUBLIC;

-- ── OTP entry points ─────────────────────────────────────────────────────────

-- Issue a code. The caller hashes the code (HMAC with a server pepper) and only
-- delivers it by SMS when the result is 'sent'. Returns:
--   sent         code stored for an active account
--   unknown      no active account (row stored for rate limiting; never deliver)
--   cooldown     a code was issued for this phone less than p_cooldown_sec ago
--   rate_limited per-phone or per-IP window limit reached
-- Known and unknown phones are rate-limited identically (no enumeration).
CREATE OR REPLACE FUNCTION app.otp_issue(
  p_phone text, p_purpose text, p_code_hash text, p_ip text,
  p_ttl_sec int DEFAULT 300, p_max_attempts int DEFAULT 5, p_cooldown_sec int DEFAULT 30,
  p_phone_max int DEFAULT 5, p_ip_max int DEFAULT 30, p_window_sec int DEFAULT 3600
) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_user uuid;
  v_last timestamptz;
  v_n int;
BEGIN
  IF p_purpose NOT IN ('login', 'reset') THEN RAISE EXCEPTION 'bad purpose' USING ERRCODE = '22023'; END IF;
  IF p_phone IS NULL OR length(p_phone) > 20 OR p_code_hash IS NULL OR length(p_code_hash) < 32 THEN
    RAISE EXCEPTION 'bad arguments' USING ERRCODE = '22023';
  END IF;
  -- Serialize concurrent requests for the same phone so limits hold.
  PERFORM pg_advisory_xact_lock(hashtextextended('otp:' || p_phone, 0));
  -- Housekeeping: forget codes older than a day.
  DELETE FROM app.otp_codes WHERE created_at < now() - interval '1 day';

  SELECT max(created_at), count(*) FILTER (WHERE created_at > now() - make_interval(secs => p_window_sec))
    INTO v_last, v_n FROM app.otp_codes WHERE phone = p_phone;
  IF v_last IS NOT NULL AND v_last > now() - make_interval(secs => p_cooldown_sec) THEN RETURN 'cooldown'; END IF;
  IF v_n >= p_phone_max THEN RETURN 'rate_limited'; END IF;
  IF p_ip IS NOT NULL AND (SELECT count(*) FROM app.otp_codes WHERE request_ip = p_ip AND created_at > now() - make_interval(secs => p_window_sec)) >= p_ip_max THEN
    RETURN 'rate_limited';
  END IF;

  SELECT u.id INTO v_user FROM public.users u WHERE u.phone = p_phone AND u.active;
  -- A new code supersedes any outstanding one for the same phone + purpose.
  UPDATE app.otp_codes SET consumed_at = now() WHERE phone = p_phone AND purpose = p_purpose AND consumed_at IS NULL;
  INSERT INTO app.otp_codes (phone, purpose, user_id, code_hash, max_attempts, request_ip, expires_at)
  VALUES (p_phone, p_purpose, v_user, p_code_hash, p_max_attempts, p_ip, now() + make_interval(secs => p_ttl_sec));
  RETURN CASE WHEN v_user IS NULL THEN 'unknown' ELSE 'sent' END;
END $$;

-- Verify a code. Single use; every wrong guess counts; the code is burnt after
-- max_attempts. For purpose 'reset' a successful check also stores the reset
-- token hash supplied by the caller (atomically — no reset token without OTP).
-- status: ok | invalid | expired | locked
CREATE OR REPLACE FUNCTION app.otp_consume(
  p_phone text, p_purpose text, p_code_hash text,
  p_reset_token_hash text DEFAULT NULL, p_reset_ttl_sec int DEFAULT 600
) RETURNS TABLE (status text, user_id uuid, tenant_id uuid, name text, role text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c app.otp_codes%ROWTYPE;
  u public.users%ROWTYPE;
BEGIN
  IF p_purpose NOT IN ('login', 'reset') THEN RAISE EXCEPTION 'bad purpose' USING ERRCODE = '22023'; END IF;
  IF p_purpose = 'reset' AND (p_reset_token_hash IS NULL OR length(p_reset_token_hash) < 32) THEN
    RAISE EXCEPTION 'reset token hash required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO c FROM app.otp_codes o
   WHERE o.phone = p_phone AND o.purpose = p_purpose AND o.consumed_at IS NULL
   ORDER BY o.created_at DESC, o.id DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT 'invalid'::text, NULL::uuid, NULL::uuid, NULL::text, NULL::text; RETURN; END IF;
  IF c.expires_at <= now() THEN
    UPDATE app.otp_codes SET consumed_at = now() WHERE id = c.id;
    RETURN QUERY SELECT 'expired'::text, NULL::uuid, NULL::uuid, NULL::text, NULL::text; RETURN;
  END IF;
  IF c.attempts >= c.max_attempts THEN
    UPDATE app.otp_codes SET consumed_at = now() WHERE id = c.id;
    RETURN QUERY SELECT 'locked'::text, NULL::uuid, NULL::uuid, NULL::text, NULL::text; RETURN;
  END IF;
  IF c.code_hash IS DISTINCT FROM p_code_hash OR c.user_id IS NULL THEN
    UPDATE app.otp_codes SET attempts = attempts + 1,
      consumed_at = CASE WHEN attempts + 1 >= max_attempts THEN now() END
     WHERE id = c.id;
    RETURN QUERY SELECT CASE WHEN c.attempts + 1 >= c.max_attempts THEN 'locked' ELSE 'invalid' END::text, NULL::uuid, NULL::uuid, NULL::text, NULL::text;
    RETURN;
  END IF;
  SELECT * INTO u FROM public.users x WHERE x.id = c.user_id AND x.phone = p_phone AND x.active;
  UPDATE app.otp_codes SET consumed_at = now(), attempts = attempts + 1 WHERE id = c.id;
  IF u.id IS NULL THEN RETURN QUERY SELECT 'invalid'::text, NULL::uuid, NULL::uuid, NULL::text, NULL::text; RETURN; END IF;
  IF p_purpose = 'reset' THEN
    DELETE FROM app.password_resets WHERE created_at < now() - interval '1 day';
    UPDATE app.password_resets SET used_at = now() WHERE phone = p_phone AND used_at IS NULL;
    INSERT INTO app.password_resets (token_hash, phone, user_id, expires_at)
    VALUES (p_reset_token_hash, p_phone, u.id, now() + make_interval(secs => p_reset_ttl_sec));
  END IF;
  RETURN QUERY SELECT 'ok'::text, u.id, u.tenant_id, u.name, u.role;
END $$;

-- Set a new password with a reset token from otp_consume('reset'). Single use.
-- Updates users.password_hash by the phone the OTP was verified for and clears
-- that phone's login lockout. Returns the user id, or NULL if the token is bad.
CREATE OR REPLACE FUNCTION app.password_reset(p_token_hash text, p_password_hash text)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r app.password_resets%ROWTYPE;
  v_user uuid;
BEGIN
  IF p_password_hash IS NULL OR p_password_hash NOT LIKE 'scrypt$%' THEN RAISE EXCEPTION 'bad password hash' USING ERRCODE = '22023'; END IF;
  SELECT * INTO r FROM app.password_resets WHERE token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND OR r.used_at IS NOT NULL OR r.expires_at <= now() THEN RETURN NULL; END IF;
  UPDATE app.password_resets SET used_at = now() WHERE token_hash = p_token_hash;
  UPDATE public.users SET password_hash = p_password_hash WHERE phone = r.phone AND id = r.user_id AND active RETURNING id INTO v_user;
  IF v_user IS NOT NULL THEN
    DELETE FROM app.login_throttle WHERE scope = 'phone' AND key = r.phone;
  END IF;
  RETURN v_user;
END $$;

-- ── Login throttle entry points ──────────────────────────────────────────────

-- Seconds until the phone or IP may try again (0 = allowed).
CREATE OR REPLACE FUNCTION app.login_retry_after(p_phone text, p_ip text) RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(ceil(extract(epoch FROM max(locked_until) - now()))::int, 0)
  FROM app.login_throttle
  WHERE locked_until > now() AND ((scope = 'phone' AND key = p_phone) OR (scope = 'ip' AND key = p_ip))
$$;

-- Record a failed attempt; locks the key for p_lock_min minutes once it reaches
-- its limit inside the window. Returns true when the phone or IP is now locked.
CREATE OR REPLACE FUNCTION app.login_failed(
  p_phone text, p_ip text, p_phone_max int DEFAULT 5, p_ip_max int DEFAULT 50, p_lock_min int DEFAULT 15, p_window_min int DEFAULT 15
) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  k record;
  v_locked boolean := false;
  v_max int;
  v_n int;
BEGIN
  FOR k IN SELECT * FROM (VALUES ('phone'::text, p_phone), ('ip'::text, p_ip)) AS t(scope, key) WHERE t.key IS NOT NULL LOOP
    v_max := CASE WHEN k.scope = 'phone' THEN p_phone_max ELSE p_ip_max END;
    INSERT INTO app.login_throttle AS lt (scope, key, failures, first_failure_at)
    VALUES (k.scope, k.key, 1, now())
    ON CONFLICT (scope, key) DO UPDATE SET
      failures = CASE WHEN lt.locked_until <= now() OR lt.first_failure_at < now() - make_interval(mins => p_window_min) THEN 1 ELSE lt.failures + 1 END,
      first_failure_at = CASE WHEN lt.locked_until <= now() OR lt.first_failure_at < now() - make_interval(mins => p_window_min) THEN now() ELSE lt.first_failure_at END,
      locked_until = CASE WHEN lt.locked_until <= now() THEN NULL ELSE lt.locked_until END
    RETURNING failures INTO v_n;
    IF v_n >= v_max THEN
      UPDATE app.login_throttle SET locked_until = now() + make_interval(mins => p_lock_min) WHERE scope = k.scope AND key = k.key;
      v_locked := true;
    END IF;
  END LOOP;
  DELETE FROM app.login_throttle WHERE first_failure_at < now() - interval '1 day' AND (locked_until IS NULL OR locked_until < now());
  RETURN v_locked;
END $$;

-- Successful login clears the phone's counter (the IP counter decays by window).
CREATE OR REPLACE FUNCTION app.login_succeeded(p_phone text) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  DELETE FROM app.login_throttle WHERE scope = 'phone' AND key = p_phone
$$;

ALTER FUNCTION app.otp_issue(text, text, text, text, int, int, int, int, int, int) OWNER TO orchard_owner;
ALTER FUNCTION app.otp_consume(text, text, text, text, int) OWNER TO orchard_owner;
ALTER FUNCTION app.password_reset(text, text) OWNER TO orchard_owner;
ALTER FUNCTION app.login_retry_after(text, text) OWNER TO orchard_owner;
ALTER FUNCTION app.login_failed(text, text, int, int, int, int) OWNER TO orchard_owner;
ALTER FUNCTION app.login_succeeded(text) OWNER TO orchard_owner;
REVOKE ALL ON FUNCTION app.otp_issue(text, text, text, text, int, int, int, int, int, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.otp_consume(text, text, text, text, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.password_reset(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.login_retry_after(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.login_failed(text, text, int, int, int, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.login_succeeded(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  app.otp_issue(text, text, text, text, int, int, int, int, int, int),
  app.otp_consume(text, text, text, text, int),
  app.password_reset(text, text),
  app.login_retry_after(text, text),
  app.login_failed(text, text, int, int, int, int),
  app.login_succeeded(text)
TO orchard_app;

-- ── Worker orchard assignment (tenant table) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_orchards (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  orchard_id text NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id, orchard_id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES public.users(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, orchard_id) REFERENCES public.orchards(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS user_orchards_orchard_idx ON public.user_orchards (tenant_id, orchard_id);
ALTER TABLE public.user_orchards OWNER TO orchard_owner;
ALTER TABLE public.user_orchards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_orchards FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.user_orchards;
CREATE POLICY tenant_isolation ON public.user_orchards USING (tenant_id = app.current_tenant()) WITH CHECK (tenant_id = app.current_tenant());
GRANT SELECT, INSERT, DELETE ON public.user_orchards TO orchard_app;

-- ── Notification preferences (tenant table) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notification_prefs (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  -- NULL = every alert type.
  alert_types text[],
  min_severity text NOT NULL DEFAULT 'low' CHECK (min_severity IN ('low', 'medium', 'high', 'critical')),
  -- Local (IST) wall-clock window; both NULL = no quiet hours. May wrap midnight.
  quiet_hours_start time,
  quiet_hours_end time,
  sms_fallback boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES public.users(tenant_id, id) ON DELETE CASCADE,
  CHECK ((quiet_hours_start IS NULL) = (quiet_hours_end IS NULL)),
  CHECK (alert_types IS NULL OR cardinality(alert_types) <= 32)
);
ALTER TABLE public.notification_prefs OWNER TO orchard_owner;
ALTER TABLE public.notification_prefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_prefs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.notification_prefs;
CREATE POLICY tenant_isolation ON public.notification_prefs USING (tenant_id = app.current_tenant()) WITH CHECK (tenant_id = app.current_tenant());
GRANT SELECT, INSERT, UPDATE ON public.notification_prefs TO orchard_app;
DROP TRIGGER IF EXISTS notification_prefs_guard_tenant ON public.notification_prefs;
CREATE TRIGGER notification_prefs_guard_tenant BEFORE UPDATE ON public.notification_prefs FOR EACH ROW EXECUTE FUNCTION app.guard_tenant();
