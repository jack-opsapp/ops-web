-- ═══════════════════════════════════════════════════════════════
-- Migration 004: Core Entity Tables (Bubble → Supabase)
--
-- Creates tables for all entities currently stored in Bubble.io:
--   companies, users, clients, sub_clients, projects,
--   project_tasks, calendar_events, task_types, ops_contacts
--
-- Each table has a `bubble_id` column so we can map old Bubble
-- records to new Supabase records during migration.
--
-- GRADE-8 SUMMARY:
-- This creates 9 new spreadsheets (tables) in the database.
-- Each row in each table is one record (one company, one user, etc).
-- Every table has an automatic unique ID, a slot for the old Bubble ID,
-- and security rules so companies can only see their own data.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ─── CLEAN SLATE ───────────────────────────────────────────────
-- Drop any pre-existing versions of these tables (e.g. from a
-- prior manual attempt with TEXT columns). CASCADE removes
-- dependent FKs, policies, and indexes. Safe because these
-- tables have no production data yet.

DROP TABLE IF EXISTS ops_contacts CASCADE;
DROP TABLE IF EXISTS project_tasks CASCADE;
DROP TABLE IF EXISTS calendar_events CASCADE;
DROP TABLE IF EXISTS projects CASCADE;
DROP TABLE IF EXISTS task_types_v2 CASCADE;
DROP TABLE IF EXISTS sub_clients CASCADE;
DROP TABLE IF EXISTS clients CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS companies CASCADE;

-- ─── COMPANIES ───────────────────────────────────────────────
-- The "organization" table. Every other table belongs to a
-- company. Think of it as the top-level folder everything
-- lives inside.
--
-- GRADE-8: Each row = one company. Has name, address, logo,
-- subscription info, and which users are admins.

CREATE TABLE companies (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bubble_id               TEXT UNIQUE,
  name                    TEXT NOT NULL,
  external_id             TEXT,
  description             TEXT,
  website                 TEXT,
  phone                   TEXT,
  email                   TEXT,
  address                 TEXT,
  latitude                DOUBLE PRECISION,
  longitude               DOUBLE PRECISION,
  open_hour               TEXT,
  close_hour              TEXT,
  logo_url                TEXT,
  default_project_color   TEXT DEFAULT '#9CA3AF',
  industries              TEXT[] DEFAULT '{}',
  company_size            TEXT,
  company_age             TEXT,
  referral_method         TEXT,
  account_holder_id       TEXT,
  admin_ids               TEXT[] DEFAULT '{}',
  seated_employee_ids     TEXT[] DEFAULT '{}',
  max_seats               INT DEFAULT 10,

  -- Subscription (Stripe)
  subscription_status     TEXT CHECK (subscription_status IN (
                            'trial','active','grace','expired','cancelled'
                          )),
  subscription_plan       TEXT CHECK (subscription_plan IN (
                            'trial','starter','team','business'
                          )),
  subscription_end        TIMESTAMPTZ,
  subscription_period     TEXT CHECK (subscription_period IN ('Monthly','Annual')),
  trial_start_date        TIMESTAMPTZ,
  trial_end_date          TIMESTAMPTZ,
  seat_grace_start_date   TIMESTAMPTZ,
  has_priority_support    BOOLEAN DEFAULT FALSE,
  data_setup_purchased    BOOLEAN DEFAULT FALSE,
  data_setup_completed    BOOLEAN DEFAULT FALSE,
  data_setup_scheduled    TIMESTAMPTZ,
  stripe_customer_id      TEXT,
  subscription_ids_json   TEXT,

  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW(),
  deleted_at              TIMESTAMPTZ
);

-- GRADE-8: "Only let users see their own company's row."
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company_self_access" ON companies
  FOR ALL USING (id = (SELECT private.get_user_company_id()));


-- ─── USERS ───────────────────────────────────────────────────
-- Every person who can log in. Has a role and belongs to a company.
-- TeamMember from Bubble is NOT separate — it's just a view of users.
--
-- GRADE-8: Each row = one person. Name, email, role, which
-- company they work for, and a link to their login account.

CREATE TABLE users (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bubble_id                   TEXT UNIQUE,
  company_id                  UUID REFERENCES companies(id) ON DELETE SET NULL,
  first_name                  TEXT NOT NULL,
  last_name                   TEXT NOT NULL,
  email                       TEXT,
  phone                       TEXT,
  home_address                TEXT,
  profile_image_url           TEXT,
  user_color                  TEXT,
  role                        TEXT DEFAULT 'Field Crew'
                                CHECK (role IN ('Admin','Office Crew','Field Crew')),
  user_type                   TEXT CHECK (user_type IN ('Employee','Company','Client','Admin')),
  is_company_admin            BOOLEAN DEFAULT FALSE,
  has_completed_onboarding    BOOLEAN DEFAULT FALSE,
  has_completed_tutorial      BOOLEAN DEFAULT FALSE,
  dev_permission              BOOLEAN DEFAULT FALSE,
  latitude                    DOUBLE PRECISION,
  longitude                   DOUBLE PRECISION,
  location_name               TEXT,
  client_id                   TEXT,
  is_active                   BOOLEAN DEFAULT TRUE,
  stripe_customer_id          TEXT,
  device_token                TEXT,

  -- Links to Supabase Auth login (filled during auth migration)
  auth_id                     UUID UNIQUE,

  created_at                  TIMESTAMPTZ DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ DEFAULT NOW(),
  deleted_at                  TIMESTAMPTZ
);

-- GRADE-8: "Users can only see other users in their same company."
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company_isolation" ON users
  FOR ALL USING (company_id = (SELECT private.get_user_company_id()));

CREATE INDEX idx_users_company ON users(company_id);
CREATE INDEX idx_users_auth ON users(auth_id);
CREATE INDEX idx_users_email ON users(email);


-- ─── CLIENTS ─────────────────────────────────────────────────
-- Customers that a company works for. Can have sub-clients
-- (extra contacts like a site manager or billing person).
--
-- GRADE-8: Each row = one customer. Name, contact info, address.

CREATE TABLE clients (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bubble_id           TEXT UNIQUE,
  company_id          UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  email               TEXT,
  phone_number        TEXT,
  notes               TEXT,
  address             TEXT,
  latitude            DOUBLE PRECISION,
  longitude           DOUBLE PRECISION,
  profile_image_url   TEXT,

  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);

-- GRADE-8: "Each company only sees their own clients."
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company_isolation" ON clients
  FOR ALL USING (company_id = (SELECT private.get_user_company_id()));

CREATE INDEX idx_clients_company ON clients(company_id);
CREATE INDEX idx_clients_name ON clients(company_id, name);


-- ─── SUB-CLIENTS ─────────────────────────────────────────────
-- Extra contacts under a client. Like if a homeowner also has
-- a property manager — the manager is a sub-client.
--
-- GRADE-8: Each row = one extra contact person under a customer.

CREATE TABLE sub_clients (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bubble_id       TEXT UNIQUE,
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  title           TEXT,
  email           TEXT,
  phone_number    TEXT,
  address         TEXT,

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

-- GRADE-8: "Delete the client, delete their sub-clients too (CASCADE)."
ALTER TABLE sub_clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company_isolation" ON sub_clients
  FOR ALL USING (company_id = (SELECT private.get_user_company_id()));

CREATE INDEX idx_sub_clients_client ON sub_clients(client_id);


-- ─── TASK TYPES ──────────────────────────────────────────────
-- Reusable categories like "Framing", "Inspection", "Painting".
-- Each has a color and icon for visual identity on the calendar.
--
-- GRADE-8: Each row = one type of work. Has a name and a color.

CREATE TABLE task_types_v2 (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bubble_id       TEXT UNIQUE,
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  display         TEXT NOT NULL,
  color           TEXT NOT NULL DEFAULT '#417394',
  icon            TEXT,
  is_default      BOOLEAN DEFAULT FALSE,
  display_order   INT DEFAULT 0,
  default_team_member_ids TEXT[] DEFAULT '{}',

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

-- GRADE-8: "Each company only sees their own task types."
ALTER TABLE task_types_v2 ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company_isolation" ON task_types_v2
  FOR ALL USING (company_id = (SELECT private.get_user_company_id()));

CREATE INDEX idx_task_types_v2_company ON task_types_v2(company_id);


-- ─── PROJECTS ────────────────────────────────────────────────
-- A job/project for a client. Has tasks, a status, and a
-- location. Dates are computed from tasks (not stored directly).
--
-- GRADE-8: Each row = one job. "Smith Deck Build", etc.
-- Status tracks where the job is (RFQ → Estimated → In Progress → Completed).

CREATE TABLE projects (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bubble_id           TEXT UNIQUE,
  company_id          UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  client_id           UUID REFERENCES clients(id) ON DELETE SET NULL,
  title               TEXT NOT NULL,
  address             TEXT,
  latitude            DOUBLE PRECISION,
  longitude           DOUBLE PRECISION,
  status              TEXT NOT NULL DEFAULT 'RFQ'
                        CHECK (status IN (
                          'RFQ','Estimated','Accepted','In Progress',
                          'Completed','Closed','Archived'
                        )),
  notes               TEXT,
  description         TEXT,
  all_day             BOOLEAN DEFAULT FALSE,
  project_images      TEXT[] DEFAULT '{}',
  team_member_ids     TEXT[] DEFAULT '{}',
  opportunity_id      TEXT,

  -- Legacy date fields (computed from tasks in practice)
  start_date          TIMESTAMPTZ,
  end_date            TIMESTAMPTZ,
  duration            INT,

  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);

-- GRADE-8: "Each company only sees their own projects."
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company_isolation" ON projects
  FOR ALL USING (company_id = (SELECT private.get_user_company_id()));

CREATE INDEX idx_projects_company ON projects(company_id);
CREATE INDEX idx_projects_client ON projects(client_id);
CREATE INDEX idx_projects_status ON projects(company_id, status);


-- ─── CALENDAR EVENTS ─────────────────────────────────────────
-- Every scheduled block on the calendar. Since Nov 2025, all
-- events must link to a task (no standalone project events).
--
-- GRADE-8: Each row = one block on the calendar showing when
-- a task is scheduled.

CREATE TABLE calendar_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bubble_id           TEXT UNIQUE,
  company_id          UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id          UUID REFERENCES projects(id) ON DELETE CASCADE,
  title               TEXT NOT NULL,
  color               TEXT DEFAULT '#417394',
  start_date          TIMESTAMPTZ,
  end_date            TIMESTAMPTZ,
  duration            INT DEFAULT 1,
  team_member_ids     TEXT[] DEFAULT '{}',

  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);

-- GRADE-8: "Delete a project, delete its calendar events too."
ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company_isolation" ON calendar_events
  FOR ALL USING (company_id = (SELECT private.get_user_company_id()));

CREATE INDEX idx_calendar_events_company ON calendar_events(company_id);
CREATE INDEX idx_calendar_events_project ON calendar_events(project_id);
CREATE INDEX idx_calendar_events_dates ON calendar_events(company_id, start_date, end_date);


-- ─── PROJECT TASKS ───────────────────────────────────────────
-- A task within a project. Linked to a calendar event for
-- scheduling and a task type for categorization.
--
-- GRADE-8: Each row = one piece of work inside a project.
-- "Pour footings", "Install railing", etc. Points to a
-- calendar event (when) and a task type (what kind).

CREATE TABLE project_tasks (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bubble_id           TEXT UNIQUE,
  company_id          UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_type_id        UUID REFERENCES task_types_v2(id) ON DELETE SET NULL,
  calendar_event_id   UUID REFERENCES calendar_events(id) ON DELETE SET NULL,
  custom_title        TEXT,
  task_notes          TEXT,
  status              TEXT NOT NULL DEFAULT 'Booked'
                        CHECK (status IN ('Booked','In Progress','Completed','Cancelled')),
  task_color          TEXT DEFAULT '#417394',
  display_order       INT DEFAULT 0,
  team_member_ids     TEXT[] DEFAULT '{}',

  -- Source tracking (generated from estimate line items)
  source_line_item_id TEXT,
  source_estimate_id  TEXT,

  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);

-- GRADE-8: "Delete a project, delete all its tasks too."
ALTER TABLE project_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company_isolation" ON project_tasks
  FOR ALL USING (company_id = (SELECT private.get_user_company_id()));

CREATE INDEX idx_project_tasks_project ON project_tasks(project_id);
CREATE INDEX idx_project_tasks_company ON project_tasks(company_id);
CREATE INDEX idx_project_tasks_status ON project_tasks(project_id, status);


-- ─── OPS CONTACTS ────────────────────────────────────────────
-- Support contacts from OPS (the company that makes this app).
-- Small lookup table, NOT company-scoped — everyone sees these.
--
-- GRADE-8: A short list of OPS support people (Jack, etc.)
-- that shows up in the help section. No security needed.

CREATE TABLE ops_contacts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bubble_id   TEXT UNIQUE,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL,
  phone       TEXT,
  display     TEXT,
  role        TEXT NOT NULL,

  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);


-- ─── UPDATED_AT TRIGGERS ─────────────────────────────────────
-- GRADE-8: Whenever any row is edited, automatically stamp
-- the current time into the updated_at column. Like a
-- "last modified" timestamp on a Google Doc.

CREATE TRIGGER update_companies_timestamp
  BEFORE UPDATE ON companies FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER update_users_timestamp
  BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER update_clients_timestamp
  BEFORE UPDATE ON clients FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER update_sub_clients_timestamp
  BEFORE UPDATE ON sub_clients FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER update_task_types_v2_timestamp
  BEFORE UPDATE ON task_types_v2 FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER update_projects_timestamp
  BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER update_calendar_events_timestamp
  BEFORE UPDATE ON calendar_events FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER update_project_tasks_timestamp
  BEFORE UPDATE ON project_tasks FOR EACH ROW EXECUTE FUNCTION update_timestamp();

COMMIT;
