-- 007_portal_schema.sql
-- Client Portal: magic link auth, branding, line-item questions, messaging

-- ─── Portal Tokens (magic link auth) ─────────────────────────────────────────

CREATE TABLE portal_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  email TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '7 days',
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

CREATE INDEX idx_portal_tokens_token ON portal_tokens(token);
CREATE INDEX idx_portal_tokens_client ON portal_tokens(client_id, company_id);

-- ─── Portal Sessions ─────────────────────────────────────────────────────────

CREATE TABLE portal_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_token_id UUID NOT NULL REFERENCES portal_tokens(id),
  session_token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  email TEXT NOT NULL,
  company_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '30 days',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_portal_sessions_token ON portal_sessions(session_token);

-- ─── Portal Branding ─────────────────────────────────────────────────────────

CREATE TABLE portal_branding (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL UNIQUE,
  logo_url TEXT,
  accent_color TEXT NOT NULL DEFAULT '#417394',
  template TEXT NOT NULL DEFAULT 'modern' CHECK (template IN ('modern', 'classic', 'bold')),
  theme_mode TEXT NOT NULL DEFAULT 'dark' CHECK (theme_mode IN ('light', 'dark')),
  font_combo TEXT NOT NULL DEFAULT 'modern' CHECK (font_combo IN ('modern', 'classic', 'bold')),
  welcome_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Line Item Questions ─────────────────────────────────────────────────────

CREATE TABLE line_item_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL,
  estimate_id UUID NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  line_item_id UUID NOT NULL REFERENCES line_items(id) ON DELETE CASCADE,
  question_text TEXT NOT NULL,
  answer_type TEXT NOT NULL DEFAULT 'text' CHECK (answer_type IN ('text', 'select', 'multiselect', 'color', 'number')),
  options JSONB DEFAULT '[]',
  is_required BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_liq_estimate ON line_item_questions(estimate_id);
CREATE INDEX idx_liq_line_item ON line_item_questions(line_item_id);

-- ─── Line Item Answers ───────────────────────────────────────────────────────

CREATE TABLE line_item_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID NOT NULL REFERENCES line_item_questions(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  answer_value TEXT NOT NULL,
  answered_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_lia_question ON line_item_answers(question_id);

-- ─── Portal Messages ─────────────────────────────────────────────────────────

CREATE TABLE portal_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  project_id TEXT,
  estimate_id UUID REFERENCES estimates(id),
  invoice_id UUID REFERENCES invoices(id),
  sender_type TEXT NOT NULL CHECK (sender_type IN ('client', 'company')),
  sender_name TEXT NOT NULL,
  content TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pm_client_company ON portal_messages(client_id, company_id);
CREATE INDEX idx_pm_created ON portal_messages(created_at DESC);

-- ─── Row Level Security ──────────────────────────────────────────────────────

ALTER TABLE portal_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_branding ENABLE ROW LEVEL SECURITY;
ALTER TABLE line_item_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE line_item_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_messages ENABLE ROW LEVEL SECURITY;

-- RLS policies: authenticated OPS users (Firebase JWT) get full company access
CREATE POLICY "company_access" ON portal_branding FOR ALL
  USING (company_id = (current_setting('request.jwt.claims', true)::jsonb->>'company_id'));

CREATE POLICY "company_access" ON line_item_questions FOR ALL
  USING (company_id = (current_setting('request.jwt.claims', true)::jsonb->>'company_id'));

CREATE POLICY "company_access" ON line_item_answers FOR ALL
  USING (
    question_id IN (
      SELECT id FROM line_item_questions
      WHERE company_id = (current_setting('request.jwt.claims', true)::jsonb->>'company_id')
    )
  );

CREATE POLICY "company_access" ON portal_messages FOR ALL
  USING (company_id = (current_setting('request.jwt.claims', true)::jsonb->>'company_id'));

-- Portal tokens and sessions are managed exclusively via service role key
-- (no direct client access through RLS)
