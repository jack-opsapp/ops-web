-- 095_email_audience_templates.sql
-- Saved audience filters. Operators build a filter in the Audience Builder,
-- click "Save as template", and reuse it across campaigns.

CREATE TABLE IF NOT EXISTS public.email_audience_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text NULL,
  filter jsonb NOT NULL,
  last_used_count int NOT NULL DEFAULT 0,
  last_resolved_at timestamptz NULL,
  created_by_user_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_audience_templates_created_at
  ON public.email_audience_templates (created_at DESC);

DROP TRIGGER IF EXISTS trg_email_audience_templates_updated_at ON public.email_audience_templates;
CREATE TRIGGER trg_email_audience_templates_updated_at
  BEFORE UPDATE ON public.email_audience_templates
  FOR EACH ROW EXECUTE FUNCTION public.fn_email_campaigns_set_updated_at();

-- Backfill the FK on email_campaigns now that the target table exists.
ALTER TABLE public.email_campaigns
  ADD CONSTRAINT fk_email_campaigns_audience_template
    FOREIGN KEY (audience_template_id)
    REFERENCES public.email_audience_templates (id)
    ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.increment_audience_template_usage(
  p_template_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.email_audience_templates
  SET last_used_count = last_used_count + 1, last_resolved_at = now()
  WHERE id = p_template_id;
END $$;

GRANT EXECUTE ON FUNCTION public.increment_audience_template_usage(uuid) TO service_role;

COMMENT ON TABLE public.email_audience_templates IS
  'Reusable audience filter definitions. Filter shape is documented in src/lib/admin/types.ts (AudienceFilterNode).';
COMMENT ON COLUMN public.email_audience_templates.filter IS
  'JSONB filter: {and|or: [...]} or leaf {field, op, value}. See email_audience_filter() function for full grammar.';
