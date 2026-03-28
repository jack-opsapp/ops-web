-- 021_email_crm_integration.sql
-- Email CRM integration: import jobs, filter presets, matching columns

-- ── gmail_connections: sync config ────────────────────────────────
ALTER TABLE gmail_connections
  ADD COLUMN IF NOT EXISTS sync_interval_minutes INTEGER NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS sync_filters JSONB NOT NULL DEFAULT '{
    "labelIds": ["INBOX", "SENT"],
    "excludeDomains": [],
    "excludeAddresses": [],
    "excludeSubjectKeywords": [],
    "includeSentMail": true,
    "usePresetBlocklist": true
  }'::jsonb;

-- ── activities: matching metadata ────────────────────────────────
ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS match_confidence TEXT,
  ADD COLUMN IF NOT EXISTS match_needs_review BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS suggested_client_id UUID;

CREATE INDEX IF NOT EXISTS idx_activities_needs_review
  ON activities(company_id) WHERE match_needs_review = true;

CREATE INDEX IF NOT EXISTS idx_activities_email_thread
  ON activities(email_thread_id) WHERE email_thread_id IS NOT NULL;

-- ── gmail_import_jobs ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gmail_import_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL,
  connection_id UUID NOT NULL REFERENCES gmail_connections(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  import_after DATE NOT NULL,
  total_emails INTEGER NOT NULL DEFAULT 0,
  processed INTEGER NOT NULL DEFAULT 0,
  matched INTEGER NOT NULL DEFAULT 0,
  unmatched INTEGER NOT NULL DEFAULT 0,
  needs_review INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT gmail_import_jobs_valid_status
    CHECK (status IN ('pending', 'running', 'completed', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_import_jobs_company
  ON gmail_import_jobs(company_id);
CREATE INDEX IF NOT EXISTS idx_import_jobs_running
  ON gmail_import_jobs(status) WHERE status = 'running';

-- ── email_filter_presets (pre-seeded noise domains) ──────────────
CREATE TABLE IF NOT EXISTS email_filter_presets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,
  value TEXT NOT NULL,
  category TEXT NOT NULL,
  CONSTRAINT email_filter_presets_valid_type
    CHECK (type IN ('domain', 'keyword')),
  CONSTRAINT email_filter_presets_unique
    UNIQUE (type, value)
);

-- Seed: Newsletter/Marketing platforms
INSERT INTO email_filter_presets (type, value, category) VALUES
  ('domain', 'mailchimp.com', 'newsletter'),
  ('domain', 'constantcontact.com', 'newsletter'),
  ('domain', 'sendgrid.net', 'newsletter'),
  ('domain', 'mailgun.org', 'newsletter'),
  ('domain', 'campaignmonitor.com', 'newsletter'),
  ('domain', 'hubspot.com', 'newsletter'),
  ('domain', 'klaviyo.com', 'newsletter'),
  ('domain', 'drip.com', 'newsletter'),
  ('domain', 'convertkit.com', 'newsletter'),
  ('domain', 'activecampaign.com', 'newsletter'),
  ('domain', 'sendinblue.com', 'newsletter'),
  ('domain', 'aweber.com', 'newsletter'),
  ('domain', 'getresponse.com', 'newsletter'),
  ('domain', 'moosend.com', 'newsletter'),
  ('domain', 'beehiiv.com', 'newsletter'),
  ('domain', 'substack.com', 'newsletter'),
  ('domain', 'buttondown.email', 'newsletter'),
  ('domain', 'mailerlite.com', 'newsletter'),
  ('domain', 'omnisend.com', 'newsletter'),
  ('domain', 'benchmarkemail.com', 'newsletter')
ON CONFLICT (type, value) DO NOTHING;

-- Seed: No-reply / System
INSERT INTO email_filter_presets (type, value, category) VALUES
  ('domain', 'noreply.com', 'noreply'),
  ('domain', 'no-reply.com', 'noreply'),
  ('domain', 'mailer-daemon.com', 'noreply'),
  ('domain', 'postmaster.com', 'noreply'),
  ('domain', 'bounce.com', 'noreply')
ON CONFLICT (type, value) DO NOTHING;

-- Seed: Social media
INSERT INTO email_filter_presets (type, value, category) VALUES
  ('domain', 'facebookmail.com', 'social'),
  ('domain', 'linkedin.com', 'social'),
  ('domain', 'twitter.com', 'social'),
  ('domain', 'instagram.com', 'social'),
  ('domain', 'tiktok.com', 'social'),
  ('domain', 'pinterest.com', 'social'),
  ('domain', 'nextdoor.com', 'social'),
  ('domain', 'reddit.com', 'social')
ON CONFLICT (type, value) DO NOTHING;

-- Seed: SaaS notifications
INSERT INTO email_filter_presets (type, value, category) VALUES
  ('domain', 'github.com', 'saas'),
  ('domain', 'atlassian.com', 'saas'),
  ('domain', 'slack.com', 'saas'),
  ('domain', 'notion.so', 'saas'),
  ('domain', 'asana.com', 'saas'),
  ('domain', 'trello.com', 'saas'),
  ('domain', 'monday.com', 'saas'),
  ('domain', 'zoom.us', 'saas'),
  ('domain', 'calendly.com', 'saas'),
  ('domain', 'docusign.com', 'saas'),
  ('domain', 'dropbox.com', 'saas'),
  ('domain', 'vercel.com', 'saas'),
  ('domain', 'heroku.com', 'saas'),
  ('domain', 'figma.com', 'saas')
ON CONFLICT (type, value) DO NOTHING;

-- Seed: Financial / Billing
INSERT INTO email_filter_presets (type, value, category) VALUES
  ('domain', 'paypal.com', 'financial'),
  ('domain', 'stripe.com', 'financial'),
  ('domain', 'square.com', 'financial'),
  ('domain', 'intuit.com', 'financial'),
  ('domain', 'xero.com', 'financial'),
  ('domain', 'wave.com', 'financial'),
  ('domain', 'venmo.com', 'financial')
ON CONFLICT (type, value) DO NOTHING;

-- Seed: Shipping
INSERT INTO email_filter_presets (type, value, category) VALUES
  ('domain', 'ups.com', 'shipping'),
  ('domain', 'fedex.com', 'shipping'),
  ('domain', 'usps.com', 'shipping'),
  ('domain', 'amazonses.com', 'shipping'),
  ('domain', 'amazon.com', 'shipping'),
  ('domain', 'dhl.com', 'shipping')
ON CONFLICT (type, value) DO NOTHING;

-- Seed: Subject keyword exclusions
INSERT INTO email_filter_presets (type, value, category) VALUES
  ('keyword', 'unsubscribe', 'auto-reply'),
  ('keyword', 'out of office', 'auto-reply'),
  ('keyword', 'auto-reply', 'auto-reply'),
  ('keyword', 'automatic reply', 'auto-reply'),
  ('keyword', 'delivery status notification', 'auto-reply'),
  ('keyword', 'mailer-daemon', 'auto-reply'),
  ('keyword', 'do not reply', 'auto-reply')
ON CONFLICT (type, value) DO NOTHING;

-- ── RLS ──────────────────────────────────────────────────────────
ALTER TABLE gmail_import_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gmail_import_jobs_company_isolation" ON gmail_import_jobs
  USING (company_id = current_setting('app.company_id', true));

ALTER TABLE email_filter_presets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "email_filter_presets_read_all" ON email_filter_presets
  FOR SELECT USING (true);
