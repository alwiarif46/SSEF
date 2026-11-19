-- 005_media: stored photos and documents (media & documents lane).
-- Binary content lives in object storage (local disk or S3/R2); this table is the tenant-scoped index.

-- Composite key target so media.uploaded_by can never point at another tenant's user.
CREATE UNIQUE INDEX IF NOT EXISTS users_tenant_id_id_media_uq ON public.users (tenant_id, id);

CREATE TABLE IF NOT EXISTS public.media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('photo','document')),
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg','image/png','image/webp','application/pdf')),
  bytes integer NOT NULL CHECK (bytes > 0 AND bytes <= 10485760),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  storage_key text NOT NULL CHECK (length(storage_key) BETWEEN 10 AND 300),
  entity_table text CHECK (entity_table IN ('scouting_observations','chemical_inventory','spray_events','harvest_records','orchards','blocks','tasks')),
  entity_id text CHECK (entity_id IS NULL OR length(entity_id) BETWEEN 8 AND 64),
  uploaded_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (storage_key),
  CHECK ((entity_table IS NULL) = (entity_id IS NULL)),
  -- The storage key always starts with the owning tenant's id.
  CHECK (storage_key LIKE tenant_id::text || '/%'),
  FOREIGN KEY (tenant_id, uploaded_by) REFERENCES public.users (tenant_id, id)
);
ALTER TABLE public.media OWNER TO orchard_owner;
CREATE INDEX IF NOT EXISTS media_entity_idx ON public.media (tenant_id, entity_table, entity_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS media_sha_idx ON public.media (tenant_id, sha256) WHERE deleted_at IS NULL;
ALTER TABLE public.media ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.media;
CREATE POLICY tenant_isolation ON public.media USING (tenant_id = app.current_tenant()) WITH CHECK (tenant_id = app.current_tenant());
-- No DELETE grant: removal is a soft delete (deleted_at) so the audit trail survives.
GRANT SELECT, INSERT, UPDATE ON public.media TO orchard_app;
DROP TRIGGER IF EXISTS media_guard_tenant ON public.media;
CREATE TRIGGER media_guard_tenant BEFORE UPDATE ON public.media FOR EACH ROW EXECUTE FUNCTION app.guard_tenant();

-- Content is immutable once stored: only the soft-delete marker may change.
CREATE OR REPLACE FUNCTION app.guard_media_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'deleted_at') IS DISTINCT FROM (to_jsonb(OLD) - 'deleted_at') THEN
    RAISE EXCEPTION 'media % is immutable; only deleted_at may change', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
    RAISE EXCEPTION 'deleted media % cannot be restored', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS media_guard_immutable ON public.media;
CREATE TRIGGER media_guard_immutable BEFORE UPDATE ON public.media FOR EACH ROW EXECUTE FUNCTION app.guard_media_immutable();
