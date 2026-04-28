-- 102_email_template_versions.sql
-- Append-only table tracking every template version that has shipped.
-- Build-time script writes to this; the admin UI reads from this.

CREATE TABLE IF NOT EXISTS public.email_template_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id text NOT NULL,
  version text NOT NULL,
  content_hash text NOT NULL,
  rendered_sample_html text,
  preview_props jsonb,
  notes text,
  created_by_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT email_template_versions_uq_id_version UNIQUE (template_id, version)
);

CREATE INDEX IF NOT EXISTS idx_email_template_versions_template_id
  ON public.email_template_versions (template_id, created_at DESC);

REVOKE UPDATE, DELETE ON public.email_template_versions FROM anon, authenticated;

COMMENT ON TABLE public.email_template_versions IS
  'Append-only record of every template version. Build-time script syncs from source comments + sha256 hash. Hash mismatch within an existing version causes the build to fail.';
COMMENT ON COLUMN public.email_template_versions.content_hash IS
  'sha256 over the template TSX source. Identifies whether the rendered output of a given version is byte-stable.';
COMMENT ON COLUMN public.email_template_versions.rendered_sample_html IS
  'Optional snapshot of the email rendered with previewProps at sync time. Powers the Versions timeline.';
