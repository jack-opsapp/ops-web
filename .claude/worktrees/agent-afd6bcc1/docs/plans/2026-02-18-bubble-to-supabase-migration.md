# Bubble → Supabase Full Migration Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate ALL data from Bubble.io to Supabase so ops-web reads/writes exclusively from Supabase. Bubble stays untouched for iOS until iOS is converted later.

**Architecture:**
- 10 Bubble entities → 9 new Supabase tables (TeamMember merges into users)
- UUID primary keys with `bubble_id TEXT UNIQUE` for migration mapping
- Supabase Auth replaces Firebase + Bubble login/signup workflows
- Direct S3 presigned URLs via Next.js API route (replaces Bubble workflow)
- Direct Stripe integration via Next.js API routes (replaces Bubble workflows)
- Developer-only migration button imports all Bubble data in one batch

**Tech Stack:** PostgreSQL (Supabase), Next.js 15 API routes, Supabase Auth, AWS SDK v3 (S3), Stripe Node SDK

**User requirement:** All SQL must include concise grade-8 explanations.

---

## What You (the human) Must Do Outside of Code

These items require manual action in external dashboards:

### Supabase Dashboard
1. **Enable Supabase Auth** — go to Authentication → Providers → enable Email provider
2. **Enable Google OAuth** — Authentication → Providers → Google → add your `GOOGLE_GMAIL_CLIENT_ID` and secret
3. **Run each migration SQL** — go to SQL Editor, paste each migration, click Run
4. **Copy service role key** — Settings → API → `service_role` key → set as `SUPABASE_SERVICE_ROLE_KEY` in Vercel

### Vercel Environment Variables
After each phase, add any new env vars listed. Current required:
- `SUPABASE_SERVICE_ROLE_KEY` (already set from prior work)
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_BUCKET`, `AWS_REGION` (for direct S3)
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (for direct Stripe)

### Google Cloud Console
- Add `https://app.opsapp.co/api/auth/callback/google` as authorized redirect URI (for Supabase Auth Google login)

---

## Phase 1: Database Schema — Core Entity Tables

Create Supabase tables for all 10 Bubble entities. Each table has:
- `id UUID` primary key (auto-generated)
- `bubble_id TEXT UNIQUE` for migration mapping
- `company_id UUID` for RLS
- All fields from the software bible data architecture

### Task 1: Write migration SQL for companies table

**Files:**
- Create: `supabase/migrations/004_core_entities.sql`

**Step 1: Write the migration file (part 1 — companies)**

```sql
-- ═══════════════════════════════════════════════════════════════
-- Migration 004: Core Entity Tables (Bubble → Supabase)
--
-- Creates tables for all entities currently stored in Bubble.io:
--   companies, users, clients, sub_clients, projects,
--   project_tasks, calendar_events, task_types, ops_contacts
--
-- Each table has a `bubble_id` column so we can map old Bubble
-- records to new Supabase records during migration.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ─── COMPANIES ───────────────────────────────────────────────
-- This is the "organization" table. Every other table belongs
-- to a company. Think of it as the top-level folder everything
-- lives inside.

CREATE TABLE IF NOT EXISTS companies (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bubble_id               TEXT UNIQUE,              -- old Bubble ID for migration
  name                    TEXT NOT NULL,
  external_id             TEXT,                      -- Bubble's own "companyId" field
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
  industries              TEXT[] DEFAULT '{}',        -- was comma-separated string in Bubble
  company_size            TEXT,
  company_age             TEXT,
  referral_method         TEXT,
  account_holder_id       TEXT,                      -- will become UUID FK after users table exists
  admin_ids               TEXT[] DEFAULT '{}',        -- user IDs who are admins
  seated_employee_ids     TEXT[] DEFAULT '{}',        -- user IDs with active seats
  max_seats               INT DEFAULT 10,

  -- Subscription (Stripe data)
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
  subscription_ids_json   TEXT,                      -- JSON array of subscription objects

  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW(),
  deleted_at              TIMESTAMPTZ
);

-- "Make it so only users in this company can see this company's row"
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company_isolation" ON companies
  FOR ALL USING (id = (SELECT private.get_user_company_id()));
```

**What this SQL does (grade 8):**
- Creates a `companies` table — like a spreadsheet where each row is one company.
- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()` — every row gets a unique random ID automatically.
- `bubble_id TEXT UNIQUE` — stores the old Bubble ID so we know which Bubble company maps to which Supabase company.
- `TEXT[] DEFAULT '{}'` — an array (list) column, like a cell that can hold multiple values.
- `CHECK (...)` — a rule that only allows specific values (like a dropdown in a spreadsheet).
- `ROW LEVEL SECURITY` — a lock that makes each company only see their own data.
- The `company_isolation` policy says: "you can only access rows where the company ID matches YOUR company ID from your login token."

**Step 2: Continue the migration — users table**

```sql
-- ─── USERS ───────────────────────────────────────────────────
-- Every person who can log in. Has a role (Admin, Office Crew,
-- or Field Crew) and belongs to a company.
-- TeamMember from Bubble is NOT a separate table — it's just
-- a lightweight view of this same users table.

CREATE TABLE IF NOT EXISTS users (
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
  client_id                   TEXT,                   -- if user is also a client
  is_active                   BOOLEAN DEFAULT TRUE,
  stripe_customer_id          TEXT,
  device_token                TEXT,

  -- Supabase Auth link
  auth_id                     UUID UNIQUE,            -- links to auth.users(id)

  created_at                  TIMESTAMPTZ DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ DEFAULT NOW(),
  deleted_at                  TIMESTAMPTZ
);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company_isolation" ON users
  FOR ALL USING (company_id = (SELECT private.get_user_company_id()));

CREATE INDEX idx_users_company ON users(company_id);
CREATE INDEX idx_users_auth ON users(auth_id);
CREATE INDEX idx_users_email ON users(email);
```

**What this SQL does (grade 8):**
- Creates a `users` table — one row per person who uses the app.
- `REFERENCES companies(id)` — this is a "foreign key." It means `company_id` MUST match an actual company's `id`. Like a rule saying "you can't assign someone to a company that doesn't exist."
- `ON DELETE SET NULL` — if a company gets deleted, the user's `company_id` becomes empty (NULL) instead of deleting the user too.
- `auth_id UUID UNIQUE` — connects this user row to Supabase Auth (the login system). Each user gets exactly one login.
- `CREATE INDEX` — makes searching faster, like adding tabs to a binder so you can flip to the right section quickly.

**Step 3: Continue — clients and sub_clients**

```sql
-- ─── CLIENTS ─────────────────────────────────────────────────
-- Customers that a company works for. A client can have
-- multiple sub-clients (additional contacts like a site
-- manager or billing person).

CREATE TABLE IF NOT EXISTS clients (
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

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company_isolation" ON clients
  FOR ALL USING (company_id = (SELECT private.get_user_company_id()));
CREATE INDEX idx_clients_company ON clients(company_id);

-- ─── SUB-CLIENTS ─────────────────────────────────────────────
-- Extra contacts under a client. Like if a homeowner also has
-- a property manager — the manager is a sub-client.

CREATE TABLE IF NOT EXISTS sub_clients (
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

ALTER TABLE sub_clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company_isolation" ON sub_clients
  FOR ALL USING (company_id = (SELECT private.get_user_company_id()));
CREATE INDEX idx_sub_clients_client ON sub_clients(client_id);
```

**What this SQL does (grade 8):**
- `clients` — your customers. Each belongs to a company.
- `sub_clients` — extra people attached to a client (like a site foreman).
- `ON DELETE CASCADE` — if you delete a client, all their sub-clients get deleted too. Like removing a folder deletes everything inside it.
- The sub_clients table has BOTH `client_id` (which client they belong to) AND `company_id` (for the security rule).

**Step 4: Continue — task_types**

```sql
-- ─── TASK TYPES ──────────────────────────────────────────────
-- Reusable categories like "Framing", "Inspection", "Painting".
-- Each has a color and icon for visual identity.

CREATE TABLE IF NOT EXISTS task_types (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bubble_id       TEXT UNIQUE,
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  display         TEXT NOT NULL,
  color           TEXT NOT NULL DEFAULT '#417394',
  icon            TEXT,
  is_default      BOOLEAN DEFAULT FALSE,
  display_order   INT DEFAULT 0,

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

ALTER TABLE task_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company_isolation" ON task_types
  FOR ALL USING (company_id = (SELECT private.get_user_company_id()));
CREATE INDEX idx_task_types_company ON task_types(company_id);
```

**Step 5: Continue — projects**

```sql
-- ─── PROJECTS ────────────────────────────────────────────────
-- A job/project for a client. Has tasks, a status, and a
-- location. Dates are computed from tasks (not stored directly).

CREATE TABLE IF NOT EXISTS projects (
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
  project_images      TEXT[] DEFAULT '{}',          -- S3 URLs (was comma-separated string)
  team_member_ids     TEXT[] DEFAULT '{}',          -- computed from tasks, stored for quick access
  opportunity_id      TEXT,                          -- links to pipeline opportunity

  -- Legacy date fields (kept for migration, but computed from tasks in practice)
  start_date          TIMESTAMPTZ,
  end_date            TIMESTAMPTZ,
  duration            INT,

  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company_isolation" ON projects
  FOR ALL USING (company_id = (SELECT private.get_user_company_id()));
CREATE INDEX idx_projects_company ON projects(company_id);
CREATE INDEX idx_projects_client ON projects(client_id);
CREATE INDEX idx_projects_status ON projects(company_id, status);
```

**What this SQL does (grade 8):**
- `projects` — each row is a job. "Smith Deck Build", "Johnson Fence Repair", etc.
- `status CHECK (...)` — the job can only be in one of these stages, like a Kanban board.
- `TEXT[] DEFAULT '{}'` — arrays replace the old comma-separated strings from Bubble. Arrays are proper lists that PostgreSQL understands natively.
- `team_member_ids` — stored for quick reads, but the "real" team is computed from which users are assigned to the project's tasks.

**Step 6: Continue — calendar_events and project_tasks**

```sql
-- ─── CALENDAR EVENTS ─────────────────────────────────────────
-- Every scheduled block on the calendar. Since Nov 2025, all
-- events must link to a task (no standalone project events).

CREATE TABLE IF NOT EXISTS calendar_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bubble_id           TEXT UNIQUE,
  company_id          UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id          UUID REFERENCES projects(id) ON DELETE CASCADE,
  task_id             TEXT,                          -- will become FK after project_tasks exists
  title               TEXT NOT NULL,
  color               TEXT DEFAULT '#417394',
  start_date          TIMESTAMPTZ,
  end_date            TIMESTAMPTZ,
  duration            INT DEFAULT 1,                -- days
  team_member_ids     TEXT[] DEFAULT '{}',

  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);

ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company_isolation" ON calendar_events
  FOR ALL USING (company_id = (SELECT private.get_user_company_id()));
CREATE INDEX idx_calendar_events_company ON calendar_events(company_id);
CREATE INDEX idx_calendar_events_project ON calendar_events(project_id);
CREATE INDEX idx_calendar_events_dates ON calendar_events(company_id, start_date, end_date);

-- ─── PROJECT TASKS ───────────────────────────────────────────
-- A task within a project. Linked to a calendar event for
-- scheduling and a task type for categorization.

CREATE TABLE IF NOT EXISTS project_tasks (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bubble_id           TEXT UNIQUE,
  company_id          UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_type_id        UUID REFERENCES task_types(id) ON DELETE SET NULL,
  calendar_event_id   UUID REFERENCES calendar_events(id) ON DELETE SET NULL,
  custom_title        TEXT,
  task_notes          TEXT,
  status              TEXT NOT NULL DEFAULT 'Booked'
                        CHECK (status IN ('Booked','In Progress','Completed','Cancelled')),
  task_color          TEXT DEFAULT '#417394',
  display_order       INT DEFAULT 0,
  team_member_ids     TEXT[] DEFAULT '{}',

  -- Source tracking (from estimate line items)
  source_line_item_id TEXT,
  source_estimate_id  TEXT,

  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);

ALTER TABLE project_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company_isolation" ON project_tasks
  FOR ALL USING (company_id = (SELECT private.get_user_company_id()));
CREATE INDEX idx_project_tasks_project ON project_tasks(project_id);
CREATE INDEX idx_project_tasks_company ON project_tasks(company_id);
CREATE INDEX idx_project_tasks_status ON project_tasks(project_id, status);

-- Now add the FK from calendar_events.task_id to project_tasks
-- (We couldn't do this earlier because project_tasks didn't exist yet)
-- "task_id" is TEXT because it might hold a Bubble ID during migration.
-- After migration completes, this could be converted to UUID FK.
```

**What this SQL does (grade 8):**
- `calendar_events` — blocks on the calendar. Every scheduled task shows up here.
- `project_tasks` — the actual work items inside a project. "Pour footings", "Install railing", etc.
- Each task points to a calendar event (for when it's scheduled) and a task type (for what kind of work it is).
- `ON DELETE CASCADE` on project_id means: delete the project → all its tasks get deleted too.
- `ON DELETE SET NULL` on task_type_id means: delete a task type → tasks keep existing, they just lose their type label.

**Step 7: Continue — ops_contacts + updated_at triggers + commit**

```sql
-- ─── OPS CONTACTS ────────────────────────────────────────────
-- Support contacts from OPS (the company that makes this app).
-- Small lookup table, not company-scoped.

CREATE TABLE IF NOT EXISTS ops_contacts (
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

-- No RLS on ops_contacts — all users can read support contacts.

-- ─── UPDATED_AT TRIGGERS ─────────────────────────────────────
-- Automatically set `updated_at` to "right now" whenever a row
-- is changed. This way we never forget to update the timestamp.

CREATE TRIGGER update_companies_timestamp
  BEFORE UPDATE ON companies FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER update_users_timestamp
  BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER update_clients_timestamp
  BEFORE UPDATE ON clients FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER update_sub_clients_timestamp
  BEFORE UPDATE ON sub_clients FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER update_task_types_timestamp
  BEFORE UPDATE ON task_types FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER update_projects_timestamp
  BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER update_calendar_events_timestamp
  BEFORE UPDATE ON calendar_events FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER update_project_tasks_timestamp
  BEFORE UPDATE ON project_tasks FOR EACH ROW EXECUTE FUNCTION update_timestamp();

COMMIT;
```

**What this SQL does (grade 8):**
- `ops_contacts` — a small table of OPS support staff (Jack, priority support, etc.). No RLS because everyone needs to see these.
- `CREATE TRIGGER` — like setting up an automatic rule: "whenever someone edits a row, stamp the current time into `updated_at`." This happens automatically — the code never needs to set `updated_at` manually.
- `COMMIT` — saves everything. If any part of the migration failed, nothing would have been saved (that's what `BEGIN` at the top does — it's an all-or-nothing deal).

**Step 8: Run the migration**

Run in Supabase SQL Editor. Verify: go to Table Editor and confirm all 9 tables exist with correct columns.

**Step 9: Commit**

```bash
git add supabase/migrations/004_core_entities.sql
git commit -m "feat: add core entity tables for Bubble → Supabase migration"
```

---

### Task 2: Update existing pipeline tables to reference new entity tables

**Files:**
- Create: `supabase/migrations/005_update_pipeline_references.sql`

**Step 1: Write the migration**

```sql
-- ═══════════════════════════════════════════════════════════════
-- Migration 005: Update Pipeline References
--
-- The pipeline tables (opportunities, estimates, invoices) were
-- created before we had client/project tables in Supabase.
-- Now we add proper foreign key columns that point to the new
-- tables, keeping the old columns for backward compatibility.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- Add new UUID FK columns alongside existing ones.
-- We keep old columns (client_id uuid, project_id uuid) until
-- migration is verified, then drop them in a later cleanup migration.

-- Opportunities: add references to new tables
ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS client_ref UUID REFERENCES clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS project_ref UUID REFERENCES projects(id) ON DELETE SET NULL;

-- Estimates: add client reference (project_id is already TEXT from 002)
ALTER TABLE estimates
  ADD COLUMN IF NOT EXISTS client_ref UUID REFERENCES clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS project_ref UUID REFERENCES projects(id) ON DELETE SET NULL;

-- Invoices: already have project_id, add client reference
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS client_ref UUID REFERENCES clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS project_ref UUID REFERENCES projects(id) ON DELETE SET NULL;

-- Line items: task_type reference
ALTER TABLE line_items
  ADD COLUMN IF NOT EXISTS task_type_ref UUID REFERENCES task_types(id) ON DELETE SET NULL;

-- Task templates: task_type reference
ALTER TABLE task_templates
  ADD COLUMN IF NOT EXISTS task_type_ref UUID REFERENCES task_types(id) ON DELETE SET NULL;

-- Products: task_type reference
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS task_type_ref UUID REFERENCES task_types(id) ON DELETE SET NULL;

-- Site visits: client reference
ALTER TABLE site_visits
  ADD COLUMN IF NOT EXISTS client_ref UUID REFERENCES clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS project_ref UUID REFERENCES projects(id) ON DELETE SET NULL;

-- Indexes for new FK columns
CREATE INDEX IF NOT EXISTS idx_opportunities_client_ref ON opportunities(client_ref);
CREATE INDEX IF NOT EXISTS idx_opportunities_project_ref ON opportunities(project_ref);
CREATE INDEX IF NOT EXISTS idx_estimates_client_ref ON estimates(client_ref);
CREATE INDEX IF NOT EXISTS idx_estimates_project_ref ON estimates(project_ref);

COMMIT;
```

**What this SQL does (grade 8):**
- The pipeline tables (deals, estimates, invoices) already exist but they reference clients and projects by old Bubble IDs.
- We add NEW columns (`client_ref`, `project_ref`) that properly point to the new Supabase tables.
- `REFERENCES clients(id)` — tells the database "this column must contain a valid client ID from the clients table."
- We keep the old columns for now — after migration is verified, we'll swap them in a cleanup step.
- Indexes make lookups by these new columns fast.

**Step 2: Run migration and verify**

**Step 3: Commit**

```bash
git add supabase/migrations/005_update_pipeline_references.sql
git commit -m "feat: add FK references from pipeline tables to new entity tables"
```

---

## Phase 2: Migration Endpoint + Developer Settings

Build the "Import from Bubble" button that reads ALL Bubble data and inserts into Supabase.

### Task 3: Create the migration API route

**Files:**
- Create: `src/app/api/admin/migrate-bubble/route.ts`

This is the core migration logic. It:
1. Checks `devPermission` on the calling user
2. Calls every Bubble GET endpoint to fetch all data
3. Bulk-inserts into the new Supabase tables
4. Maps Bubble IDs to Supabase UUIDs
5. Updates pipeline table FK references

**Step 1: Write the migration route**

The route should:
- Accept POST with `{ companyId: string }` (or `"all"` for all companies)
- Use the service-role Supabase client (bypasses RLS)
- Use the existing BubbleClient to fetch from Bubble API
- Return progress status and any errors

```typescript
// Structure (NOT complete code — too large for plan, will be written during implementation):
//
// 1. Fetch ALL companies from Bubble (/obj/company)
// 2. For each company:
//    a. Insert into Supabase companies table, get UUID
//    b. Fetch users → insert into users table with company FK
//    c. Fetch clients → insert into clients table
//    d. Fetch sub-clients → insert into sub_clients table
//    e. Fetch task types → insert into task_types table
//    f. Fetch projects → insert into projects table with client FK
//    g. Fetch calendar events → insert into calendar_events table
//    h. Fetch tasks → insert into project_tasks table with all FKs
//    i. Update pipeline tables: match client_id/project_id TEXT → client_ref/project_ref UUID
// 3. Fetch ops_contacts → insert into ops_contacts table
// 4. Return { success: true, stats: { companies: N, users: N, ... } }
```

Key mapping logic:
- Build a `Map<string, string>` of `bubbleId → supabaseUuid` for each entity type
- When inserting a project that references a client, look up the client's Supabase UUID from the map
- When updating pipeline tables, match `client_id TEXT` (Bubble ID) → look up `clients.bubble_id` → get `clients.id` (UUID) → set `client_ref`

**Step 2: Write the failing test** (manual verification — hit endpoint with curl/Postman)

**Step 3: Commit**

```bash
git add src/app/api/admin/migrate-bubble/route.ts
git commit -m "feat: add Bubble → Supabase migration API endpoint"
```

### Task 4: Create the Developer Settings tab

**Files:**
- Create: `src/components/settings/developer-tab.tsx`
- Modify: `src/app/(dashboard)/settings/page.tsx`

**Step 1: Write the developer tab component**

Only visible when user has `devPermission === true`. Contains:
- "Migrate Bubble → Supabase" button with confirmation dialog
- Progress indicator showing entities being migrated
- Results summary after completion
- "Data Source" indicator showing whether reading from Bubble or Supabase

**Step 2: Wire into settings page**

Add `developer` to the `SettingsTab` type and tab list. Conditionally show based on `currentUser.devPermission`.

**Step 3: Commit**

```bash
git add src/components/settings/developer-tab.tsx src/app/\(dashboard\)/settings/page.tsx
git commit -m "feat: add developer settings tab with Bubble migration button"
```

---

## Phase 3: Service Layer Rewrites

Rewrite each Bubble-backed service to read/write from Supabase. Order: simplest → most complex.

### Task 5: Rewrite task-type-service.ts

**Files:**
- Modify: `src/lib/api/services/task-type-service.ts`

Currently: 6 functions calling Bubble `/obj/tasktype`
After: 6 functions calling Supabase `task_types` table

**Step 1: Rewrite service**

Replace all BubbleClient calls with Supabase `requireSupabase()` calls. Pattern:
```typescript
// Before (Bubble):
const response = await BubbleClient.get('/obj/tasktype', { constraints: [...] });
return response.results.map(mapTaskTypeFromBubble);

// After (Supabase):
const supabase = requireSupabase();
const { data, error } = await supabase
  .from('task_types')
  .select('*')
  .eq('company_id', companyId)
  .is('deleted_at', null)
  .order('display_order');
return (data ?? []).map(mapFromDb);
```

**Step 2: Update the DTO/mapper** — remove Bubble field name mapping, use Supabase snake_case → camelCase.

**Step 3: Verify** — run `npx tsc --noEmit`, check 0 errors.

**Step 4: Commit**

### Task 6: Rewrite client-service.ts

**Files:**
- Modify: `src/lib/api/services/client-service.ts`

Currently: 11 functions calling Bubble `/obj/client` and `/obj/subclient`
After: Same functions calling Supabase `clients` and `sub_clients` tables

Same pattern as Task 5. Key differences:
- Sub-client operations need to also set `company_id` (Bubble got it from the parent client automatically)
- Search/filter by name uses Supabase `.ilike('name', `%${search}%`)`

**Step 1-4: Same pattern as Task 5**

### Task 7: Rewrite project-service.ts

**Files:**
- Modify: `src/lib/api/services/project-service.ts`

Currently: 8 functions calling Bubble `/obj/project`
After: Same functions calling Supabase `projects` table

Key differences:
- `fetchUserProjects` needs to use `team_member_ids @> ARRAY[userId]` (array contains) instead of Bubble's "contains" constraint
- `createProject` must convert client Bubble ID → Supabase UUID using `clients.bubble_id` lookup (or pass UUID directly if client is already migrated)

### Task 8: Rewrite calendar-service.ts

**Files:**
- Modify: `src/lib/api/services/calendar-service.ts`

Currently: 7 functions calling Bubble `/obj/calendarevent`
After: Same functions calling Supabase `calendar_events` table

Key: date range queries use `.gte('start_date', from).lte('start_date', to)` instead of Bubble constraints.

### Task 9: Rewrite task-service.ts

**Files:**
- Modify: `src/lib/api/services/task-service.ts`

Currently: 11 functions calling Bubble `/obj/task`
After: Same functions calling Supabase `project_tasks` table

Key:
- `createTaskWithEvent` becomes a Supabase transaction (insert calendar_event, then insert project_task with the event ID)
- `createTasksFromProposals` becomes a bulk insert
- Status "Scheduled" → "Booked" backward compat still needed for data imported from Bubble

### Task 10: Rewrite company-service.ts

**Files:**
- Modify: `src/lib/api/services/company-service.ts`

Currently: 14 functions mixing `/obj/company` and `/wf/` workflows
After: Supabase `companies` table for data, Next.js API routes for Stripe

This is the most complex rewrite because it includes:
- Simple CRUD → Supabase (straightforward)
- Subscription workflows → moved to Phase 5 (Stripe direct)
- Presigned URL generation → moved to Phase 4 (S3 direct)
- Seated employee management → array operations in Supabase

For now: rewrite CRUD operations only. Mark Stripe/S3 functions as TODO.

### Task 11: Rewrite user-service.ts (data only, NOT auth)

**Files:**
- Modify: `src/lib/api/services/user-service.ts`

Currently: 14 functions mixing `/obj/user` and `/wf/` workflows
After: Supabase `users` table for data queries, auth functions stay as-is temporarily

Split:
- `fetchUsers`, `fetchUser`, `fetchAllUsers`, `updateUser`, `updateUserRole`, `updateDeviceToken`, `markTutorialCompleted` → Supabase
- `login`, `signup`, `resetPassword`, `loginWithGoogle`, `loginWithToken`, `joinCompany`, `sendInvite` → keep calling Bubble workflows temporarily (rewritten in Phase 6)

### Task 12: Rewrite image-service.ts

**Files:**
- Modify: `src/lib/api/services/image-service.ts`
- Create: `src/app/api/upload/presign/route.ts`

Currently: Gets presigned URL from Bubble workflow, uploads to S3
After: Gets presigned URL from Next.js API route (using AWS SDK), uploads to S3

**Step 1: Create the presign API route**

```typescript
// POST /api/upload/presign
// Body: { fileName, contentType, folder }
// Returns: { url, key }
// Uses AWS SDK v3 @aws-sdk/s3-request-presigner
```

**Step 2: Update image-service.ts** to call `/api/upload/presign` instead of Bubble workflow.

### Task 13: Update hooks and types

**Files:**
- Modify: `src/lib/types/models.ts` — update interfaces to match new Supabase columns (add `bubbleId`, change ID types)
- Modify: `src/lib/hooks/` — any hooks that need updated query keys or service call signatures

### Task 14: Remove BubbleClient dependency

**Files:**
- Modify: `src/lib/api/bubble-client.ts` — keep for now but mark deprecated
- Modify: `src/app/api/bubble/[...path]/route.ts` — keep proxy for iOS, mark deprecated for web

**Step 1: Verify no web-facing code imports BubbleClient**

**Step 2: Commit**

---

## Phase 4: Auth Migration (Supabase Auth)

Replace Firebase + Bubble login/signup with Supabase Auth.

### Task 15: Set up Supabase Auth integration

**Files:**
- Create: `src/lib/supabase/auth.ts` — Supabase Auth client helpers
- Modify: `src/lib/store/auth-store.ts` — switch from Bubble token to Supabase session
- Modify: `src/middleware.ts` — check Supabase session instead of cookie token

**Step 1: Create auth helpers**

```typescript
// signIn(email, password) → Supabase Auth
// signUp(email, password) → Supabase Auth + create users row
// signOut() → clear session
// getSession() → current session
// onAuthStateChange() → listener
```

**Step 2: Update auth store** to use Supabase sessions.

**Step 3: Update middleware** to validate Supabase JWT.

### Task 16: Create auth API routes

**Files:**
- Create: `src/app/api/auth/callback/route.ts` — OAuth callback handler
- Modify: `src/app/(auth)/login/page.tsx` — use Supabase Auth
- Modify: `src/app/(auth)/register/page.tsx` — use Supabase Auth

### Task 17: Migrate existing users to Supabase Auth

**Files:**
- Add to: `src/app/api/admin/migrate-bubble/route.ts`

After importing users into the `users` table, also create corresponding Supabase Auth accounts:
```typescript
// For each user with an email:
//   1. supabase.auth.admin.createUser({ email, password: tempPassword })
//   2. Store auth_id in users.auth_id
//   3. Set app_metadata.company_id for RLS
```

Users will need to reset their passwords on first login (since we can't migrate passwords from Bubble).

### Task 18: Update RLS policies

**Files:**
- Create: `supabase/migrations/006_update_rls_for_auth.sql`

Update the `private.get_user_company_id()` function to read from Supabase Auth JWT instead of Firebase JWT. Or add a new function that reads from the `users` table:

```sql
-- Instead of reading company_id from JWT metadata,
-- look it up from the users table using the logged-in user's auth ID.
CREATE OR REPLACE FUNCTION private.get_user_company_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = '' AS $$
  SELECT company_id FROM public.users
  WHERE auth_id = auth.uid()
  LIMIT 1
$$;
```

**What this SQL does (grade 8):**
- Replaces the old function that read the company ID from the login token.
- Now it looks up the company ID from the users table: "find the user whose login ID matches whoever is making this request, and return their company."
- This is more reliable because the company ID is always in sync with the users table.

---

## Phase 5: Direct Stripe Integration

Replace Bubble Stripe workflows with direct Stripe API calls.

### Task 19: Create Stripe service

**Files:**
- Create: `src/lib/api/services/stripe-service.ts`
- Create: `src/app/api/stripe/webhook/route.ts`
- Create: `src/app/api/stripe/create-checkout/route.ts`
- Create: `src/app/api/stripe/create-portal/route.ts`

**Step 1: Install Stripe SDK**

```bash
npm install stripe
```

**Step 2: Create webhook handler** — receives Stripe events, updates `companies` table subscription fields.

**Step 3: Create checkout session** — replaces `create_subscription_with_payment` Bubble workflow.

**Step 4: Create customer portal** — replaces `cancel_subscription` Bubble workflow.

**Step 5: Update company-service.ts** — replace Stripe workflow calls with direct Stripe API route calls.

### Task 20: Update subscription UI

**Files:**
- Modify: `src/components/settings/subscription-tab.tsx`
- Modify: `src/components/settings/billing-tab.tsx`

Update to call new Stripe API routes instead of Bubble workflows.

---

## Phase 6: Cleanup

### Task 21: Remove Bubble dependencies from web

**Files:**
- Delete or gut: `src/lib/api/bubble-client.ts`
- Delete or gut: `src/app/api/bubble/[...path]/route.ts`
- Remove: `NEXT_PUBLIC_BUBBLE_API_URL` and `NEXT_PUBLIC_BUBBLE_API_TOKEN` from env
- Audit: grep for any remaining Bubble imports

**Step 1: Search for remaining Bubble references**

```bash
grep -r "BubbleClient\|bubble-client\|BUBBLE_API" src/ --include="*.ts" --include="*.tsx"
```

**Step 2: Remove all references**

**Step 3: Final build verification**

```bash
npx tsc --noEmit && npx next build
```

**Step 4: Commit**

```bash
git commit -m "chore: remove all Bubble.io dependencies from web app"
```

### Task 22: Final cleanup migration

**Files:**
- Create: `supabase/migrations/007_cleanup_references.sql`

After verifying everything works:
```sql
-- Drop the old TEXT-based client_id/project_id columns
-- from pipeline tables, rename _ref columns to replace them.
-- Only run this AFTER full verification.
```

### Task 23: Update documentation

**Files:**
- Modify: `.env.example`, `.env.local.example` — remove Bubble vars, add any new ones
- Create: `MIGRATION_RUNBOOK.md` — step-by-step instructions for running the migration

---

## Dependency Order

```
Phase 1 (Schema)
  └─► Phase 2 (Migration endpoint + Dev tab)
        └─► Phase 3 (Service rewrites — can be done one service at a time)
              ├─► Phase 4 (Auth migration)
              └─► Phase 5 (Stripe direct)
                    └─► Phase 6 (Cleanup)
```

Phases 4 and 5 are independent of each other but both depend on Phase 3.

---

## Verification Checklist

After each phase:

**Phase 1:** All 9 new tables visible in Supabase Table Editor with correct columns.

**Phase 2:** Hit migration endpoint → all Bubble data appears in Supabase tables. `bubble_id` columns populated. Pipeline `_ref` columns populated with correct UUIDs.

**Phase 3:** Each service rewrite verified individually:
- Create, read, update, soft-delete all work via Supabase
- No Bubble API calls from that service
- `npx tsc --noEmit` passes
- UI still works (navigate to relevant page, perform CRUD)

**Phase 4:** Login/signup works via Supabase Auth. Existing users can reset password and log in. RLS policies work with new auth.

**Phase 5:** Subscription purchase, cancellation, and webhook updates all work. Billing page shows correct data.

**Phase 6:** `npx next build` succeeds. Zero references to Bubble in web source. All pages load and function correctly.

---

## Risk Register

| Risk | Impact | Mitigation |
|---|---|---|
| Migration misses data | High | Verify row counts: Bubble total vs Supabase total per entity |
| Pipeline FK references break | High | Keep old columns, use _ref columns in parallel until verified |
| Auth migration locks users out | Medium | Dev-only for now; only one user (you) affected |
| Stripe webhook stops working | High | Test in Stripe test mode first; keep Bubble Stripe as fallback |
| Image uploads break | Medium | S3 bucket/credentials are the same; only the presign source changes |
| iOS app breaks | None | iOS continues reading Bubble unchanged — zero impact |
