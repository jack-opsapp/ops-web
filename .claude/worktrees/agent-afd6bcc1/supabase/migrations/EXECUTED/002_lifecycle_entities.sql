-- OPS Web — Migration 002: Job Lifecycle Entities
-- Adds project linkage, site visits, photos, Gmail OAuth, company settings,
-- task templates, and activity threading to support the full job lifecycle.

-- ─── 1. Alter existing tables ─────────────────────────────────────────────────

-- estimates: add project linkage
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS project_id TEXT;
COMMENT ON COLUMN estimates.project_id IS 'Bubble.io Project ID — which project this estimate belongs to';

-- line_items: add type + task linkage
ALTER TABLE line_items ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'LABOR'
  CHECK (type IN ('LABOR', 'MATERIAL', 'OTHER'));
ALTER TABLE line_items ADD COLUMN IF NOT EXISTS task_type_id TEXT;
ALTER TABLE line_items ADD COLUMN IF NOT EXISTS estimated_hours NUMERIC(6,2);
COMMENT ON COLUMN line_items.task_type_id IS 'Bubble.io TaskType ID — only set for LABOR items';

-- products: add type + task type linkage
ALTER TABLE products ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'LABOR'
  CHECK (type IN ('LABOR', 'MATERIAL', 'OTHER'));
ALTER TABLE products ADD COLUMN IF NOT EXISTS task_type_id TEXT;

-- opportunities: add Gmail source reference
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS source_email_id TEXT;

-- activities: drop old CHECK constraint, add new columns, recreate with expanded types
ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_type_check;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS attachments TEXT[] DEFAULT '{}';
ALTER TABLE activities ADD COLUMN IF NOT EXISTS email_thread_id TEXT;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS email_message_id TEXT;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS is_read BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS site_visit_id UUID;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS project_id TEXT;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS from_email TEXT;
ALTER TABLE activities ADD CONSTRAINT activities_type_check
  CHECK (type IN (
    'note','email','call','meeting',
    'estimate_sent','estimate_accepted','estimate_declined',
    'invoice_sent','payment_received','stage_change',
    'created','won','lost','system',
    'site_visit','site_visit_scheduled'
  ));

-- ─── 2. New tables ────────────────────────────────────────────────────────────

-- task_templates: sub-tasks proposed per TaskType when estimate approved
CREATE TABLE IF NOT EXISTS task_templates (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              TEXT NOT NULL,
  task_type_id            TEXT NOT NULL,
  title                   TEXT NOT NULL,
  description             TEXT,
  estimated_hours         NUMERIC(6,2),
  display_order           INT NOT NULL DEFAULT 0,
  default_team_member_ids TEXT[] DEFAULT '{}',
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW(),
  deleted_at              TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_task_templates_company_task_type
  ON task_templates(company_id, task_type_id);

-- activity_comments: threaded comments on any activity entry
CREATE TABLE IF NOT EXISTS activity_comments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        TEXT NOT NULL,
  activity_id       UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  user_id           TEXT NOT NULL,
  content           TEXT NOT NULL,
  is_client_visible BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ,
  deleted_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_activity_comments_activity
  ON activity_comments(activity_id);

-- site_visit_status enum
DO $$ BEGIN
  CREATE TYPE site_visit_status AS ENUM ('scheduled', 'in_progress', 'completed', 'cancelled');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- site_visits: schedulable job site visits with photo/note capture
CREATE TABLE IF NOT EXISTS site_visits (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        TEXT NOT NULL,
  opportunity_id    UUID REFERENCES opportunities(id) ON DELETE SET NULL,
  project_id        TEXT,
  client_id         TEXT,
  scheduled_at      TIMESTAMPTZ NOT NULL,
  duration_minutes  INT NOT NULL DEFAULT 60,
  assignee_ids      TEXT[] DEFAULT '{}',
  status            site_visit_status NOT NULL DEFAULT 'scheduled',
  completed_at      TIMESTAMPTZ,
  notes             TEXT,
  internal_notes    TEXT,
  measurements      TEXT,
  photos            TEXT[] DEFAULT '{}',
  activity_id       UUID REFERENCES activities(id) ON DELETE SET NULL,
  calendar_event_id TEXT,
  created_by        TEXT NOT NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_site_visits_company
  ON site_visits(company_id);
CREATE INDEX IF NOT EXISTS idx_site_visits_opportunity
  ON site_visits(opportunity_id);

-- photo_source enum
DO $$ BEGIN
  CREATE TYPE photo_source AS ENUM ('site_visit', 'in_progress', 'completion', 'other');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- project_photos: structured photo gallery replacing projectImages string
CREATE TABLE IF NOT EXISTS project_photos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     TEXT NOT NULL,
  company_id     TEXT NOT NULL,
  url            TEXT NOT NULL,
  thumbnail_url  TEXT,
  source         photo_source NOT NULL DEFAULT 'other',
  site_visit_id  UUID REFERENCES site_visits(id) ON DELETE SET NULL,
  uploaded_by    TEXT NOT NULL,
  taken_at       TIMESTAMPTZ,
  caption        TEXT,
  deleted_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_project_photos_project
  ON project_photos(project_id, company_id);

-- gmail_connection_type enum
DO $$ BEGIN
  CREATE TYPE gmail_connection_type AS ENUM ('company', 'individual');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- gmail_connections: OAuth tokens for Gmail auto-logging
CREATE TABLE IF NOT EXISTS gmail_connections (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     TEXT NOT NULL,
  type           gmail_connection_type NOT NULL DEFAULT 'company',
  user_id        TEXT,
  email          TEXT NOT NULL,
  access_token   TEXT NOT NULL,
  refresh_token  TEXT NOT NULL,
  expires_at     TIMESTAMPTZ NOT NULL,
  history_id     TEXT,
  sync_enabled   BOOLEAN NOT NULL DEFAULT TRUE,
  last_synced_at TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_gmail_connections_company_email
  ON gmail_connections(company_id, email);

-- company_settings: per-company feature configuration
CREATE TABLE IF NOT EXISTS company_settings (
  company_id                  TEXT PRIMARY KEY,
  auto_generate_tasks         BOOLEAN NOT NULL DEFAULT FALSE,
  follow_up_reminder_days     INT NOT NULL DEFAULT 3,
  gmail_auto_log_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at                  TIMESTAMPTZ DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ DEFAULT NOW()
);

-- ─── 3. RLS Policies ──────────────────────────────────────────────────────────

ALTER TABLE task_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE gmail_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_settings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'task_templates' AND policyname = 'company_isolation'
  ) THEN
    CREATE POLICY "company_isolation" ON task_templates
      FOR ALL USING (company_id = (SELECT private.get_user_company_id())::text);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'activity_comments' AND policyname = 'company_isolation'
  ) THEN
    CREATE POLICY "company_isolation" ON activity_comments
      FOR ALL USING (company_id = (SELECT private.get_user_company_id())::text);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'site_visits' AND policyname = 'company_isolation'
  ) THEN
    CREATE POLICY "company_isolation" ON site_visits
      FOR ALL USING (company_id = (SELECT private.get_user_company_id())::text);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'project_photos' AND policyname = 'company_isolation'
  ) THEN
    CREATE POLICY "company_isolation" ON project_photos
      FOR ALL USING (company_id = (SELECT private.get_user_company_id())::text);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'gmail_connections' AND policyname = 'company_isolation'
  ) THEN
    CREATE POLICY "company_isolation" ON gmail_connections
      FOR ALL USING (company_id = (SELECT private.get_user_company_id())::text);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'company_settings' AND policyname = 'company_isolation'
  ) THEN
    CREATE POLICY "company_isolation" ON company_settings
      FOR ALL USING (company_id = (SELECT private.get_user_company_id())::text);
  END IF;
END $$;

-- ─── 4. updated_at triggers for new tables ────────────────────────────────────

CREATE TRIGGER update_task_templates_timestamp
  BEFORE UPDATE ON task_templates
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER update_site_visits_timestamp
  BEFORE UPDATE ON site_visits
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER update_gmail_connections_timestamp
  BEFORE UPDATE ON gmail_connections
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER update_company_settings_timestamp
  BEFORE UPDATE ON company_settings
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER update_activity_comments_timestamp
  BEFORE UPDATE ON activity_comments
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

-- ─── 5. FK from activities to site_visits (deferred — site_visits created above) ──

ALTER TABLE activities ADD CONSTRAINT fk_activities_site_visit
  FOREIGN KEY (site_visit_id) REFERENCES site_visits(id) ON DELETE SET NULL;
