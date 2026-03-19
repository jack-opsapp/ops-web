-- ─── Migration 039: Email Templates ─────────────────────────────────────────
-- Company-scoped email templates for the compose modal.
-- Categories: follow_up, scheduling, estimate, invoice, introduction, general
-- Body stored as markdown. Merge fields: {{client_name}}, {{project_title}}, {{company_name}}

-- ─── Table ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS email_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  subject     TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL DEFAULT '',
  category    TEXT NOT NULL DEFAULT 'general'
    CHECK (category IN ('follow_up', 'scheduling', 'estimate', 'invoice', 'introduction', 'general')),
  sort_order  INT NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Indexes ────────────────────────────────────────────────────────────────

CREATE INDEX idx_email_templates_company
  ON email_templates (company_id, category, sort_order)
  WHERE is_active = true;

-- ─── RLS ────────────────────────────────────────────────────────────────────

ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;

-- Users can read templates belonging to their company
CREATE POLICY "email_templates_select"
  ON email_templates FOR SELECT
  USING (
    company_id IN (
      SELECT company_id FROM users WHERE id = auth.uid()
    )
  );

-- Users can insert templates for their company
CREATE POLICY "email_templates_insert"
  ON email_templates FOR INSERT
  WITH CHECK (
    company_id IN (
      SELECT company_id FROM users WHERE id = auth.uid()
    )
  );

-- Users can update templates belonging to their company
CREATE POLICY "email_templates_update"
  ON email_templates FOR UPDATE
  USING (
    company_id IN (
      SELECT company_id FROM users WHERE id = auth.uid()
    )
  );

-- Users can delete templates belonging to their company
CREATE POLICY "email_templates_delete"
  ON email_templates FOR DELETE
  USING (
    company_id IN (
      SELECT company_id FROM users WHERE id = auth.uid()
    )
  );

-- ─── Updated-at trigger ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_email_templates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_email_templates_updated_at
  BEFORE UPDATE ON email_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_email_templates_updated_at();
