# Project Workspace Modal — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Each task is bite-sized; do not batch. Verify against the design handoff at `~/Downloads/design_handoff_project_modal/` for any visual ambiguity.

**Goal:** Replace every existing project surface in OPS-Web (`project-detail-modal`, `project-detail-sheet`, `create-project-modal`, `edit-project-modal`, `project-detail-popover`, the `[id]` route page) with a single mode-aware `ProjectWorkspace` floating window that ships viewing, editing, and creating modes complete on day one — including a real Mapbox GL JS hero, real activity timeline wired to the `activities` table, real accounting pipeline computed from `estimates` / `invoices` / `payments` / `expenses`, real crew assignments, real Open-Meteo weather, and real notifications dispatched on every action.

**Architecture:** A new `ProjectWorkspaceWindow` mounts inside the existing `useWindowStore` system. It owns drag/resize behavior (8 handles), traffic-light controls, mode-aware footer, and persists position/size to `localStorage`. Body delegates to `ProjectViewingBody` (dossier — Map → ScheduleStrip → Activity/Details/Accounting tabs, plus an always-on right sidebar with Health/Client/Location/Team/Dates/Weather/Linked) or `ProjectEditCreateBody` (Identity/Schedule — 2 tabs only; team is computed from task assignments and is not directly edited). The Activity tab reads from `project_notes` (the iOS-canonical timeline table); system events are written there too with a new nullable `event_kind` column for web-side type rendering. All data flows through new TanStack Query hooks; the existing `<NoteComposer>` and notes hooks are reused for the timeline composer. Mapbox is wrapped in a single `ProjectMap` primitive with a one-time geocoding backfill for legacy projects. Weather is a cached Open-Meteo fetch. Old surfaces are deleted, every caller migrated.

**Critical iOS sync constraint:** OPS iOS shares this Supabase. Schema changes between iOS App Store releases must be **additive only** (nullable column, new table). No renames, drops, or breaking constraints — users on the prior iOS would lose sync until Apple approves the next update. This drives the `project_notes`-as-canonical-timeline decision: inverting the consolidation direction (instead of migrating notes into `activities`) keeps iOS untouched.

**Tech Stack:** Next.js 14 App Router · TypeScript · Tailwind · Supabase (Postgres + RLS) · TanStack Query · Zustand (`useWindowStore`) · Framer Motion · Lucide React · Mapbox GL JS (new — `mapbox-gl` 3.x + `react-map-gl` 7.x) · Open-Meteo API (free, no key)

**Design System:** `OPS-Web/.interface-design/system.md` (canonical). Status hexes from the design handoff `status-data.js` (Thermal Map palette) are sacred — they bleed into chrome, schedule strip, pin glow, and active-task highlight.

**Required Skills:** `interface-design` · `frontend-design` · `elite-animations` · `audit-design-system` · `ops-copywriter` · `supabase` · `claude-md-management`

**Cost Disclosure (from CLAUDE.md root rules):**
- **Mapbox GL JS** — free up to 50,000 map loads/month, then $0.50/1k. Geocoding API: free up to 100k requests/month, then $0.75/1k. **Action: add `NEXT_PUBLIC_MAPBOX_TOKEN` env var; ask the user to provision.**
- **Open-Meteo** — completely free, no key, no rate limit for non-commercial. We're commercial — they ask for a courtesy attribution line in docs. **Action: add attribution to weather card tooltip.**
- **Supabase storage** — photo attachments increment per-row Storage usage. Free tier covers 1GB; we're already on Pro ($25/mo, 100GB included).

---

## Pre-flight

> **Already done before this plan kicked off:**
> - `NEXT_PUBLIC_MAPBOX_TOKEN` set in Vercel for Production, Preview, and Development
> - `.env.local` pulled with the token
> - Vercel CLI installed and `OPS-Web` linked to project `prj_hglAp4p8MWheqpQn0UDTygVwlziU` on team `jacksons-projects-f76fa6e8`
> - `app.opsapp.co` is the production domain (not `ops.opsapp.co`)
> - Token has no URL allowlist — flagged but accepted by user
>
> **Skip the worktree step entirely.** Work directly on a feature branch in the OPS-Web directory.

### Task 0.1: Create feature branch + install Mapbox dependencies

**Files:** N/A (workspace setup)

**Step 1: Create feature branch**

```bash
cd /Users/jacksonsweet/Projects/OPS/OPS-Web
git checkout -b feature/project-workspace-modal
```

**Step 2: Verify clean state**

```bash
git status
```

Expected: clean working tree on new branch (or only `.env.local` showing untracked — that's fine, it's gitignored).

**Step 3: Install Mapbox + react-map-gl**

```bash
npm install mapbox-gl@^3.9.0 react-map-gl@^7.1.7
npm install -D @types/mapbox-gl
```

**Step 4: Commit dependency add**

```bash
git add package.json package-lock.json
git commit -m "chore: add mapbox-gl + react-map-gl for project workspace map"
```

### Task 0.2: Document NEXT_PUBLIC_MAPBOX_TOKEN in OPS-Web/CLAUDE.md

**Files:** Modify `OPS-Web/CLAUDE.md`

**Step 1:** Add a row under the env vars table (or create the table if missing):

```markdown
| `NEXT_PUBLIC_MAPBOX_TOKEN` | Mapbox GL JS public access token. Required for the project workspace map (compact + expanded states) and address autocomplete. Free tier covers 50k map loads + 100k geocoding requests per month. URL allowlist recommended at `account.mapbox.com/access-tokens/` — currently unrestricted (accepted risk). |
```

**Step 2:** Commit

```bash
git add OPS-Web/CLAUDE.md
git commit -m "docs: document NEXT_PUBLIC_MAPBOX_TOKEN env var"
```

---

## PHASE 1 — Database Migrations

> **Skills:** Use `supabase` for all migrations. Use `mcp__plugin_supabase_supabase__list_tables` to verify before each migration. Use `mcp__plugin_supabase_supabase__apply_migration` to apply.

### Task 1.1: Add `visibility` to projects (revised — site metadata cut)

> **Decision (2026-05-06):** Site metadata fields were dropped after design review. Status drives all chrome (no `color`); buffer days are derived from task scheduling, not stored; `description` covers what `scope` was supposed to. Gate code, parking, pets, power, hazards, site_notes, site_conditions JSONB — all dropped. The SITE card is removed from the Details tab. Edit/Create flow drops to 3 tabs (IDENTITY / SCHEDULE / PEOPLE). Only `visibility` survives because it gates portal exposure (a distinct concern from chrome).

**Files:**
- Create: `OPS-Web/supabase/migrations/20260506120000_project_visibility.sql`

**Migration SQL:**

```sql
-- Add visibility flag to projects. Gates portal exposure.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS visibility TEXT DEFAULT 'all'
    CHECK (visibility IN ('all', 'office', 'private'));

COMMENT ON COLUMN projects.visibility IS 'all | office | private. Drives portal exposure — private projects do not appear in the client portal.';

CREATE INDEX IF NOT EXISTS idx_projects_visibility ON projects(visibility) WHERE visibility != 'all';
```

**Step 1:** Apply via `mcp__plugin_supabase_supabase__apply_migration name="project_visibility"`.

**Step 2:** Verify with `mcp__plugin_supabase_supabase__list_tables schemas=["public"]`.

**Step 3:** Commit.

### Task 1.2: ~~Project tags~~ — REMOVED

Tags dropped from MVP scope. Filtering/grouping is a future need; the workspace itself doesn't require tags. Re-add when filter/saved-view features actually demand it.

If `project_tags` and `project_tag_assignments` were already created in a prior Phase 1 run, the rollback migration in Task 1.7 drops them.

### Task 1.3: Add lat/lng to clients & opportunities

**Files:**
- Create: `OPS-Web/supabase/migrations/20260506120200_geocode_clients_opportunities.sql`

**Migration SQL:**

```sql
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS latitude  DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;

ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS latitude  DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;

COMMENT ON COLUMN clients.latitude  IS 'Geocoded lat for map display. Populated by Mapbox Geocoding on address change.';
COMMENT ON COLUMN clients.longitude IS 'Geocoded lng for map display. Populated by Mapbox Geocoding on address change.';

CREATE INDEX IF NOT EXISTS idx_clients_geo
  ON clients (latitude, longitude)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_opportunities_geo
  ON opportunities (latitude, longitude)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;
```

Apply, verify, commit.

### Task 1.4: Add attachment_ids array to activities

**Files:**
- Create: `OPS-Web/supabase/migrations/20260506120300_activity_attachments.sql`

**Migration SQL:**

```sql
ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS attachment_ids UUID[] DEFAULT ARRAY[]::UUID[];

COMMENT ON COLUMN activities.attachment_ids IS 'References to project_photos.id for activity entries with photo attachments.';

CREATE INDEX IF NOT EXISTS idx_activities_attachments
  ON activities USING GIN (attachment_ids)
  WHERE array_length(attachment_ids, 1) > 0;
```

Apply, verify, commit.

### Task 1.5: Add weather_forecasts cache table

**Files:**
- Create: `OPS-Web/supabase/migrations/20260506120400_weather_forecasts.sql`

**Migration SQL:**

```sql
CREATE TABLE IF NOT EXISTS weather_forecasts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  forecast_date   DATE NOT NULL,
  temp_high_c     NUMERIC(4,1),
  temp_low_c      NUMERIC(4,1),
  temp_current_c  NUMERIC(4,1),
  precipitation_mm NUMERIC(5,2),
  precipitation_probability SMALLINT CHECK (precipitation_probability BETWEEN 0 AND 100),
  wind_speed_kmh  NUMERIC(5,1),
  conditions      TEXT,
  retrieved_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source          TEXT NOT NULL DEFAULT 'open-meteo',
  UNIQUE (project_id, forecast_date)
);

CREATE INDEX idx_weather_project_date ON weather_forecasts(project_id, forecast_date);
CREATE INDEX idx_weather_retrieved_at ON weather_forecasts(retrieved_at);

ALTER TABLE weather_forecasts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "weather readable by company members"
  ON weather_forecasts FOR SELECT
  USING (company_id = (SELECT company_id FROM users WHERE id = auth.uid()));

CREATE POLICY "weather writable by service role"
  ON weather_forecasts FOR ALL
  USING (auth.role() = 'service_role');
```

Apply, verify, commit.

### Task 1.6: Update OPS Software Bible

**Files:**
- Modify: `ops-software-bible/03_DATA_ARCHITECTURE.md` — document the schema additions that DID survive: `visibility` on projects, `lat/lng` on clients & opportunities, `attachment_ids` on activities, `weather_forecasts` table. **Do NOT document** the dropped fields (scope/site_notes/gate_code/site_conditions/color/buffer_days) or project_tags. Place each addition under section 2 (data model) in the appropriate alphabetical position.

**Step 1:** Read the relevant section of the bible.

```bash
grep -n "^### " ops-software-bible/03_DATA_ARCHITECTURE.md | head -40
```

**Step 2:** Update each section with the surviving schema only. Use the final migration SQL (post-rollback) as the source of truth.

**Step 3:** Commit

```bash
git add ops-software-bible/03_DATA_ARCHITECTURE.md
git commit -m "docs(bible): document project workspace schema additions"
```

### Task 1.7: Rollback migration — drop fields cut after design review

**Files:**
- Create: `OPS-Web/supabase/migrations/20260506140000_rollback_unused_project_fields.sql`

**Migration SQL:**

```sql
-- Rollback fields cut from project workspace scope after design review (2026-05-06).
-- Surviving: visibility (still on projects). Dropped below.

ALTER TABLE projects
  DROP COLUMN IF EXISTS scope,
  DROP COLUMN IF EXISTS site_notes,
  DROP COLUMN IF EXISTS gate_code,
  DROP COLUMN IF EXISTS site_conditions,
  DROP COLUMN IF EXISTS color,
  DROP COLUMN IF EXISTS buffer_days;

DROP TABLE IF EXISTS project_tag_assignments;
DROP TABLE IF EXISTS project_tags;
```

**Step 1:** Apply via `mcp__plugin_supabase_supabase__apply_migration name="rollback_unused_project_fields"`.

**Step 2:** Verify the columns are gone:

```
mcp__plugin_supabase_supabase__list_tables schemas=["public"]
```

Confirm `projects` has `visibility` but NOT `scope`/`site_notes`/`gate_code`/`site_conditions`/`color`/`buffer_days`. Confirm `project_tags` and `project_tag_assignments` no longer exist.

**Step 3:** Commit.

```bash
git add OPS-Web/supabase/migrations/20260506140000_rollback_unused_project_fields.sql
git commit -m "feat(db): rollback project fields cut after design review"
```

### Task 1.8: Add `event_kind` to `project_notes` (unified timeline)

> **Why this exists:** The workspace's Activity tab is the unified timeline. iOS-canonical `project_notes` becomes the source of truth (instead of `activities`) so iOS keeps syncing while we ship web changes. System events (status changes, estimate sent, payment received, photo uploaded, etc.) get written as `project_notes` rows. The `event_kind` column lets web render them with proper styling (icons, colors, dot timeline). iOS sees them as plain notes — slightly weird visually for now, fixed in the next iOS release.

**iOS compatibility:** Column is `NULLABLE`, no `CHECK` constraint, default `NULL`. Existing rows unchanged. iOS's Codable types decode unknown columns gracefully. New rows from web with `event_kind` set render as notes on iOS (until iOS update).

**Files:**
- Create: `OPS-Web/supabase/migrations/20260507130000_project_notes_event_kind.sql`

**Migration SQL:**

```sql
-- Add nullable event_kind to project_notes for unified timeline rendering on web.
-- iOS-additive: existing rows untouched, no CHECK, default NULL.
-- Refactor cleanly after next iOS release.

ALTER TABLE project_notes
  ADD COLUMN IF NOT EXISTS event_kind TEXT;

COMMENT ON COLUMN project_notes.event_kind IS
  'Web-side type discriminator for the unified Activity timeline. NULL = user-authored note (default, iOS-compatible). Non-null values: status_change, estimate_sent, estimate_approved, estimate_declined, invoice_sent, payment_received, expense_logged, photo_uploaded, project_created, project_archived, task_completed. iOS ignores until next release.';

CREATE INDEX IF NOT EXISTS idx_project_notes_event_kind
  ON project_notes(project_id, event_kind, created_at DESC)
  WHERE event_kind IS NOT NULL;
```

**Step 1:** Apply via `mcp__plugin_supabase_supabase__apply_migration name="project_notes_event_kind"`.

**Step 2:** Verify the column exists with `list_tables`. Confirm no existing rows have non-null `event_kind` (`SELECT COUNT(*) FROM project_notes WHERE event_kind IS NOT NULL` should return 0).

**Step 3:** Update bible `03_DATA_ARCHITECTURE.md` — document the column under `project_notes`, note it's the timeline-discriminator pattern with iOS-additive rationale.

**Step 4:** Commit.

```bash
git add OPS-Web/supabase/migrations/20260507130000_project_notes_event_kind.sql ops-software-bible/03_DATA_ARCHITECTURE.md
git commit -m "feat(db): add event_kind to project_notes for unified timeline"
```

### Task 1.9: Geocode existing projects (Mapbox backfill script)

> **Why this exists:** 141 active projects have `address` populated but no `latitude`/`longitude`. The workspace map can't render without coords. Phase 1 added the columns; this task populates them. One-shot Node script run before merging the workspace PR. Cost: 141 forward-geocode calls — well under Mapbox's 100k/mo free tier.

**Files:**
- Create: `OPS-Web/scripts/backfill-project-geocoding.ts`
- Modify: `OPS-Web/package.json` — add npm script `"backfill:geocoding": "tsx scripts/backfill-project-geocoding.ts"`

**Script outline:**

```typescript
// scripts/backfill-project-geocoding.ts
//
// One-shot: geocode every project where address is set but lat/lng is null.
// Run before the workspace ships. Idempotent — re-running skips already-geocoded.
//
// Usage:
//   MAPBOX_SERVER_TOKEN=sk.<token> SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     npm run backfill:geocoding
//
// Notes:
//   - Uses a SECRET token (sk.) for server-side geocoding so the URL allowlist
//     on the public token stays untouched.
//   - Mapbox forward geocoding v6 endpoint, 600 req/min rate limit.
//   - Same backfill applies to clients and opportunities (separate runs).

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const MAPBOX_SERVER_TOKEN = process.env.MAPBOX_SERVER_TOKEN!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !MAPBOX_SERVER_TOKEN) {
  console.error("Missing required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MAPBOX_SERVER_TOKEN");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function geocode(address: string): Promise<{ lat: number; lng: number } | null> {
  const url = `https://api.mapbox.com/search/geocode/v6/forward?q=${encodeURIComponent(address)}&access_token=${MAPBOX_SERVER_TOKEN}&limit=1`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const feat = data.features?.[0];
  if (!feat) return null;
  const [lng, lat] = feat.geometry.coordinates;
  return { lat, lng };
}

async function backfillTable(table: "projects" | "clients" | "opportunities") {
  console.log(`\n[${table}] Querying rows needing geocoding…`);
  const { data, error } = await supabase
    .from(table)
    .select("id, address")
    .not("address", "is", null)
    .is("latitude", null)
    .is("deleted_at", null);
  if (error) throw error;
  if (!data?.length) {
    console.log(`[${table}] Nothing to geocode.`);
    return;
  }
  console.log(`[${table}] ${data.length} rows queued.`);

  let ok = 0, fail = 0;
  for (const row of data) {
    if (!row.address) continue;
    const r = await geocode(row.address);
    if (!r) {
      console.log(`[${table}] miss: ${row.id} "${row.address}"`);
      fail++;
      continue;
    }
    const { error: upErr } = await supabase
      .from(table)
      .update({ latitude: r.lat, longitude: r.lng })
      .eq("id", row.id);
    if (upErr) {
      console.error(`[${table}] update failed: ${row.id}`, upErr);
      fail++;
      continue;
    }
    ok++;
    if (ok % 25 === 0) console.log(`[${table}]   ${ok} done…`);
    // Rate limit: 600/min; sleep ~120ms keeps us at ~500/min.
    await new Promise(r => setTimeout(r, 120));
  }
  console.log(`[${table}] complete: ${ok} ok, ${fail} fail`);
}

(async () => {
  await backfillTable("projects");
  await backfillTable("clients");
  await backfillTable("opportunities");
  console.log("\nBackfill complete.");
  process.exit(0);
})();
```

**Step 1:** Add npm script to `package.json`:

```json
"scripts": {
  ...
  "backfill:geocoding": "tsx scripts/backfill-project-geocoding.ts"
}
```

**Step 2:** Add `tsx` as a devDependency if not already present (`npm i -D tsx`).

**Step 3:** Provision the secret server-side Mapbox token. From `account.mapbox.com/access-tokens/`, create a new token named `ops-web-server-geocoding` with scope `vision:read` only. Add to Vercel env (production only, NOT NEXT_PUBLIC_):

```bash
echo "sk.<token>" | vercel env add MAPBOX_SERVER_TOKEN production --yes
```

**Step 4:** Run the backfill against the live database (production secret + service-role key required):

```bash
MAPBOX_SERVER_TOKEN=sk.... \
SUPABASE_URL=https://....supabase.co \
SUPABASE_SERVICE_ROLE_KEY=.... \
npm run backfill:geocoding
```

Expected: ~141 projects geocoded; some clients/opportunities also picked up. Misses (un-geocodable addresses) logged to console for manual review.

**Step 5:** Spot-check a project in the DB has lat/lng populated.

**Step 6:** Commit the script + package.json change.

```bash
git add scripts/backfill-project-geocoding.ts package.json package-lock.json
git commit -m "feat(scripts): geocoding backfill for projects/clients/opportunities"
```

> **Note on Task 1.4 (`activity_attachments`):** That migration added `attachment_ids UUID[]` to the `activities` table. Now that `project_notes` is the canonical timeline (per Task 1.8), `activities.attachment_ids` is unused for new writes. The column is **kept** for compatibility — rolling it back is iOS-safe (additive removal of an iOS-unused column) but unnecessary churn. Leave it.

---

## PHASE 2 — Type Definitions

### Task 2.1: Extend Project type with `visibility`

**Files:**
- Modify: `OPS-Web/src/lib/types/models.ts` — add only `visibility` to `Project`

**Step 1:** Add to the `Project` interface (preserve existing fields):

```typescript
interface Project {
  // ... existing fields ...
  visibility: 'all' | 'office' | 'private';
}
```

**Step 2:** Run `npm run type-check`. Expected: no errors.

**Step 3:** Commit.

```bash
git add OPS-Web/src/lib/types/models.ts
git commit -m "types: add visibility to Project"
```

### Task 2.2: Add Client lat/lng

**Files:**
- Modify: `OPS-Web/src/lib/types/models.ts`

```typescript
interface Client {
  // ... existing ...
  latitude: number | null;
  longitude: number | null;
}
```

Run type-check, commit.

### Task 2.3: Add WeatherForecast type

**Files:**
- Create: `OPS-Web/src/lib/types/weather.ts`

```typescript
export interface WeatherForecast {
  id: string;
  projectId: string;
  companyId: string;
  forecastDate: string; // YYYY-MM-DD
  tempHighC: number | null;
  tempLowC: number | null;
  tempCurrentC: number | null;
  precipitationMm: number | null;
  precipitationProbability: number | null;
  windSpeedKmh: number | null;
  conditions: string | null;
  retrievedAt: string;
  source: 'open-meteo';
}

export interface WeatherSummary {
  current: WeatherForecast | null;
  forecast: WeatherForecast[]; // next 5 days
  attribution: 'Weather data by Open-Meteo.com';
}
```

Commit.

### Task 2.4: ~~Add ProjectTag type~~ — REMOVED

Tags cut from MVP scope. Skip.

### Task 2.5: Generate Supabase types

**Step 1:** Run

```bash
mcp__plugin_supabase_supabase__generate_typescript_types
```

**Step 2:** Replace `OPS-Web/src/lib/types/database.types.ts` with the output.

**Step 3:** Run `npm run type-check`. Fix any conflicts.

**Step 4:** Commit.

```bash
git add OPS-Web/src/lib/types/database.types.ts
git commit -m "types: regenerate database types after project schema changes"
```

### Task 2.6: Add lat/lng to Opportunity domain type (Phase 2 addendum)

> **Why this exists:** Phase 1 migration `20260506120200` added latitude/longitude to BOTH clients and opportunities tables (for the workspace map's address fallback chain: project → opportunity → client). Generated `database.types.ts` reflects both. The hand-written `Opportunity` interface in `src/lib/types/pipeline.ts` does not. Closing the schema-type drift now so it doesn't have to be reached back to from Phase 5/6.

**Files:**
- Modify: `OPS-Web/src/lib/types/pipeline.ts` (around line 366) — add `latitude: number | null` and `longitude: number | null` to the `Opportunity` interface.
- Modify: any service that round-trips Opportunity to/from the DB — `mapOpportunityFromDb` and `mapOpportunityToDb` (likely in `src/lib/api/services/opportunity-service.ts` or `pipeline-service.ts`). Read both `latitude` and `longitude` on the from-DB path; write both on the to-DB path. Pass through unchanged.

**Step 1:** Add the two fields to the `Opportunity` interface.

**Step 2:** Update the from-DB / to-DB mappers to round-trip them.

**Step 3:** Run `npm run type-check` — clean.

**Step 4:** Commit.

```bash
git add src/lib/types/pipeline.ts <opportunity-service file>
git commit -m "types: add lat/lng to Opportunity (schema-type parity)"
```

---

## PHASE 3 — Query Hooks

> **Skills:** `supabase`. Every hook follows the existing TanStack Query pattern in `src/lib/hooks/use-projects.ts`.

### Task 3.1: use-project-activity (revised — reads from `project_notes`)

> **Decision (2026-05-07):** The previous Phase 3 implementation read from `activities`. That's wrong. `project_notes` is iOS-canonical and becomes the unified timeline source. System events get inserted into `project_notes` with `event_kind` set; user notes have `event_kind = NULL`. `activities` table stops being a primary read source. This task **reworks the existing commit** — see Task 3.1b for the rework instructions.

**Files:**
- Modify: `OPS-Web/src/lib/hooks/use-project-activity.ts`
- Modify: `OPS-Web/tests/unit/hooks/use-project-activity.test.ts`

**`ProjectActivityEntry` shape:**

```typescript
export type ProjectActivityKind =
  | 'note'                  // event_kind IS NULL (user-authored)
  | 'status_change'
  | 'estimate_sent'
  | 'estimate_approved'
  | 'estimate_declined'
  | 'invoice_sent'
  | 'payment_received'
  | 'expense_logged'
  | 'photo_uploaded'
  | 'project_created'
  | 'project_archived'
  | 'task_completed';

export interface ProjectActivityEntry {
  id: string;
  kind: ProjectActivityKind;
  content: string;
  createdAt: string;
  author: { id: string; name: string; avatarColor: string } | null;
  attachments: NoteAttachment[];           // existing type from project_notes
  mentionedUserIds: string[];              // existing field on project_notes
  /** Structured event payload for system events. NULL for user notes.
   *  Examples:
   *    status_change → { from: 'Accepted', to: 'In Progress' }
   *    payment_received → { paymentId, amount, method }
   *    estimate_sent → { estimateId, estimateNumber, total } */
  eventPayload: Record<string, unknown> | null;
}
```

**Step 1:** Write failing tests asserting the new shape:

```typescript
describe('useProjectActivity (project_notes-backed)', () => {
  it('returns project_notes rows sorted by created_at desc, default limit 25', async () => {
    // mock project_notes with mixed event_kind values + user notes
    // assert all returned, sorted desc
  });

  it('maps NULL event_kind to kind="note"', async () => {
    // mock one row with event_kind = null
    // assert returned entry has kind === 'note'
  });

  it('parses event_payload from notes content_metadata column or content prefix', async () => {
    // mock event_kind='status_change' row with structured payload
    // assert eventPayload contains { from, to }
  });

  it('hydrates author from users table via author_id join', async () => {
    // mock with author_id, expect { id, name, avatarColor } populated
  });

  it('does NOT read from activities table', async () => {
    // mock supabase: spy on .from('activities') — assert never called
    // mock supabase: spy on .from('project_notes') — assert called
  });
});
```

**Step 2:** Run tests — FAIL.

**Step 3:** Implement against `project_notes`. Reuse the existing `project_notes` schema (the existing `useProjectNotes` hook can serve as a reference — same table, simpler shape). The new hook joins `users` for author info, adds `event_kind` mapping, and parses `event_payload` (see note below).

```typescript
// src/lib/hooks/use-project-activity.ts
import { useQuery } from '@tanstack/react-query';
import { requireSupabase } from '@/lib/api/supabase-client';
import { projectActivityKey } from '@/lib/api/query-client';
import type { NoteAttachment } from '@/lib/types/pipeline';

export type ProjectActivityKind =
  | 'note' | 'status_change' | 'estimate_sent' | 'estimate_approved'
  | 'estimate_declined' | 'invoice_sent' | 'payment_received'
  | 'expense_logged' | 'photo_uploaded' | 'project_created'
  | 'project_archived' | 'task_completed';

export interface ProjectActivityEntry {
  id: string;
  kind: ProjectActivityKind;
  content: string;
  createdAt: string;
  author: { id: string; name: string; avatarColor: string } | null;
  attachments: NoteAttachment[];
  mentionedUserIds: string[];
  eventPayload: Record<string, unknown> | null;
}

export function useProjectActivity(projectId: string | null, limit = 25) {
  return useQuery({
    queryKey: projectActivityKey(projectId, limit),
    queryFn: async (): Promise<ProjectActivityEntry[]> => {
      if (!projectId) return [];
      const supabase = requireSupabase();
      const { data, error } = await supabase
        .from('project_notes')
        .select(`
          id, content, content_metadata, event_kind, created_at,
          attachments, mentioned_user_ids, author_id
        `)
        .eq('project_id', projectId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;

      // Hydrate authors in a single follow-up query
      const authorIds = Array.from(new Set((data ?? []).map(r => r.author_id).filter(Boolean)));
      const authors = authorIds.length > 0
        ? await supabase.from('users').select('id, first_name, last_name, user_color').in('id', authorIds)
            .then(r => r.data ?? [])
        : [];

      return (data ?? []).map(row => ({
        id: row.id as string,
        kind: (row.event_kind as ProjectActivityKind | null) ?? 'note',
        content: row.content as string,
        createdAt: row.created_at as string,
        author: (() => {
          const u = authors.find(a => a.id === row.author_id);
          if (!u) return null;
          return {
            id: u.id as string,
            name: `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() || 'Unknown',
            avatarColor: (u.user_color as string) ?? '#6F94B0',
          };
        })(),
        attachments: (row.attachments as NoteAttachment[]) ?? [],
        mentionedUserIds: (row.mentioned_user_ids as string[]) ?? [],
        eventPayload: (row.content_metadata as Record<string, unknown> | null) ?? null,
      }));
    },
    enabled: !!projectId,
    staleTime: 30_000,
  });
}
```

> **`content_metadata` column:** `project_notes` should already have a JSONB column for structured note metadata (verify against the live schema during implementation). If it doesn't, **either** (a) add it as another iOS-additive nullable column in the same Task 1.8 migration, **or** (b) encode `event_payload` into the existing `attachments` JSONB structure. Verify before implementation; if (a) is needed, update the Task 1.8 migration to add both `event_kind` and `content_metadata JSONB` together.

**Step 4:** Tests pass.

**Step 5:** Commit as a rework — see Task 3.1b for the explicit revert+reimplement instructions.

### Task 3.1b: Rework existing `useProjectActivity` commit

The Phase 3 commit `d0943de1 feat(hooks): add useProjectActivity for workspace timeline` reads from `activities`. Replace with the `project_notes`-backed implementation from Task 3.1.

**Step 1:** Identify what currently uses `useProjectActivity`. Likely just internal tests so far (Phase 4-7 hasn't run yet).

**Step 2:** Replace the implementation file end-to-end with the Task 3.1 version. Replace tests likewise. Do NOT preserve the old activities-based code — clean cut.

**Step 3:** Run `npm test -- use-project-activity` — green.

**Step 4:** Commit as a `refactor(hooks)` (not a revert — keep linear history):

```bash
git add src/lib/hooks/use-project-activity.ts tests/unit/hooks/use-project-activity.test.ts
git commit -m "refactor(hooks): useProjectActivity reads project_notes (iOS-canonical timeline)"
```

### Task 3.2: use-project-pipeline

Computes the 4-cell accounting pipeline (QUOTED / INVOICED / RECEIVED / OUTSTANDING) for a project.

**Files:**
- Create: `OPS-Web/src/lib/hooks/use-project-pipeline.ts`
- Test: `OPS-Web/tests/unit/hooks/use-project-pipeline.test.ts`

**Step 1:** Write failing test asserting:
- `quoted` = SUM of approved estimates' total
- `invoiced` = SUM of all non-void invoices' total + change orders
- `received` = SUM of payments where voided_at IS NULL
- `outstanding` = invoiced − received
- Each cell carries the latest record ID for the sub-detail line

**Step 2:** Implement using a single Postgres RPC `project_pipeline_summary(p_project_id UUID)` that returns one row with all four sums.

Add migration `20260506130000_project_pipeline_rpc.sql`:

```sql
CREATE OR REPLACE FUNCTION project_pipeline_summary(p_project_id UUID)
RETURNS TABLE(
  quoted_total      NUMERIC, quoted_record_id   TEXT,
  invoiced_total    NUMERIC, invoiced_record_id TEXT, change_orders_count INT,
  received_total    NUMERIC, received_record_id TEXT, deposit_pct INT,
  outstanding_total NUMERIC, outstanding_due_date DATE, days_aged INT
) AS $$
  WITH e AS (
    SELECT COALESCE(SUM(total), 0) AS total,
           (SELECT estimate_number FROM estimates
              WHERE project_id = p_project_id AND status = 'approved'
              ORDER BY created_at DESC LIMIT 1) AS rec
    FROM estimates WHERE project_id = p_project_id AND status = 'approved'
  ),
  i AS (
    SELECT COALESCE(SUM(total), 0) AS total,
           (SELECT invoice_number FROM invoices
              WHERE project_id = p_project_id AND status NOT IN ('void','draft')
              ORDER BY created_at DESC LIMIT 1) AS rec,
           COUNT(*) FILTER (WHERE estimate_id IS NOT NULL AND created_at > (
             SELECT MIN(created_at) FROM invoices WHERE project_id = p_project_id
           ))::INT AS co_count
    FROM invoices WHERE project_id = p_project_id AND status NOT IN ('void','draft')
  ),
  p AS (
    SELECT COALESCE(SUM(amount), 0) AS total,
           (SELECT 'PAY-' || LPAD(seq::TEXT, 5, '0') FROM payments
              JOIN invoices ON invoices.id = payments.invoice_id
              WHERE invoices.project_id = p_project_id AND payments.voided_at IS NULL
              ORDER BY payment_date DESC LIMIT 1) AS rec
    FROM payments JOIN invoices ON invoices.id = payments.invoice_id
    WHERE invoices.project_id = p_project_id AND payments.voided_at IS NULL
  )
  SELECT
    e.total, e.rec,
    i.total, i.rec, i.co_count,
    p.total, p.rec, ROUND((p.total / NULLIF(i.total, 0)) * 100)::INT,
    GREATEST(i.total - p.total, 0),
    (SELECT MIN(due_date) FROM invoices WHERE project_id = p_project_id AND status NOT IN ('void','paid','draft')),
    (SELECT EXTRACT(DAY FROM NOW() - MIN(due_date))::INT FROM invoices WHERE project_id = p_project_id AND status = 'past_due')
  FROM e, i, p;
$$ LANGUAGE SQL STABLE;
```

**Step 3:** Apply migration, generate types, implement hook calling `supabase.rpc('project_pipeline_summary', { p_project_id })`.

**Step 4:** Test passes.

**Step 5:** Commit.

### Task 3.3: use-project-ledger

Returns the unified ledger: estimates + invoices + payments + expenses, joined and sorted by date desc.

**Files:**
- Create: `OPS-Web/src/lib/hooks/use-project-ledger.ts`
- Test: `OPS-Web/tests/unit/hooks/use-project-ledger.test.ts`

**Step 1:** Write failing test for unified ledger schema:

```typescript
interface LedgerRow {
  recordId: string;     // EST-00128, INV-00284, PAY-00193, EXP-00112, CO-00041
  description: string;
  status: string;
  statusTone: 'neutral' | 'olive' | 'tan' | 'rose' | 'accent';
  date: string;         // YYYY-MM-DD
  amount: number;       // positive = billed/quoted, negative = payment received or expense
  amountTone: 'text' | 'olive' | 'rose';
  source: 'estimate' | 'invoice' | 'change_order' | 'payment' | 'expense';
}
```

**Step 2:** Implement via parallel `Promise.all` of 4 queries, then merge + sort. Map each source to the unified row shape.

**Step 3:** Test passes (assert sorted descending by date, correct tone mappings).

**Step 4:** Commit.

### Task 3.4: use-project-tasks-grouped

Returns project tasks with task type joined for the colored chip, grouped by completion status.

**Files:**
- Create: `OPS-Web/src/lib/hooks/use-project-tasks-grouped.ts`
- Test: `OPS-Web/tests/unit/hooks/use-project-tasks-grouped.test.ts`

**Step 1:** Test asserts shape `{ done: ProjectTask[], active: ProjectTask[], upcoming: ProjectTask[], totals: { done, total } }` and that the `active` task is the one whose `start_date <= today AND end_date >= today AND status = 'InProgress'`.

**Step 2:** Implement.

**Step 3:** Commit.

### Task 3.5: use-project-team (revised — flat list with task-type assignments)

> **Decision (2026-05-07):** OPS has no PM and no subcontractor concepts. Team is flat. Each member's "role label" on a project is the set of **task types** they're assigned to (e.g., "Roofing · Framing"). This pattern is already implemented in the existing detail page sidebar at `[id]/page.tsx:389-403` and `:619-641` — reuse the approach, don't reinvent it. The hook gets renamed from `useProjectCrew` to `useProjectTeam` for accuracy.

**Files:**
- Modify: `OPS-Web/src/lib/hooks/use-project-crew.ts` → rename to `use-project-team.ts`
- Modify: `OPS-Web/tests/unit/hooks/use-project-crew.test.ts` → rename + rewrite
- Update: any imports of `useProjectCrew` → `useProjectTeam`

**Shape:**

```typescript
export interface ProjectTeamMember {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  avatarColor: string;
  profileImageURL: string | null;
  /** Task type display names this member is assigned to on this project.
   *  Empty array if they're on team_member_ids but assigned to no task. */
  taskTypeNames: string[];
}

export interface UseProjectTeamResult {
  members: ProjectTeamMember[];
}
```

**Step 1:** Tests assert:
- Returns flat `members` array — no `pm`, `crew`, `subcontractor` keys
- Each member's `taskTypeNames` is computed from joining `tasks.team_member_ids` (which contains this user) → `tasks.task_type_id` → `task_types_v2.display`
- Members on `project.team_member_ids` who have NO task assignments still appear with `taskTypeNames: []`
- Order: alphabetical by name

**Step 2:** Implement using existing hooks where possible:

```typescript
import { useMemo } from 'react';
import { useTeamMembers } from '@/lib/hooks/use-users';
import { useProjectTasks } from '@/lib/hooks/use-tasks';
import { useTaskTypes } from '@/lib/hooks/use-task-types';
import { useProject } from '@/lib/hooks/use-projects';

export function useProjectTeam(projectId: string | null): UseProjectTeamResult {
  const { data: project } = useProject(projectId ?? undefined);
  const { data: teamData } = useTeamMembers();
  const { data: tasks = [] } = useProjectTasks(projectId ?? undefined);
  const { data: taskTypes = [] } = useTaskTypes();

  return useMemo(() => {
    if (!project || !teamData) return { members: [] };

    const taskTypeMap = new Map(taskTypes.map(t => [t.id, t.display]));
    const memberAssignments = new Map<string, Set<string>>();
    for (const task of tasks) {
      if (task.deletedAt) continue;
      const typeName = taskTypeMap.get(task.taskTypeId);
      if (!typeName) continue;
      for (const memberId of task.teamMemberIds) {
        if (!memberAssignments.has(memberId)) memberAssignments.set(memberId, new Set());
        memberAssignments.get(memberId)!.add(typeName);
      }
    }

    const users = teamData.users ?? [];
    const members = project.teamMemberIds
      .map(id => users.find(u => u.id === id))
      .filter(Boolean)
      .map(u => ({
        id: u!.id,
        name: `${u!.firstName} ${u!.lastName}`.trim() || 'Unknown',
        email: u!.email,
        phone: u!.phone,
        avatarColor: u!.userColor ?? '#6F94B0',
        profileImageURL: u!.profileImageURL,
        taskTypeNames: Array.from(memberAssignments.get(u!.id) ?? []),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return { members };
  }, [project, teamData, tasks, taskTypes]);
}
```

This is a derived/memo hook, not a TanStack Query call — it composes existing queries. That makes it sync-fast (no extra round trip) and reactive to upstream cache invalidation.

**Step 3:** Tests pass.

**Step 4:** Commit as a `refactor(hooks)` rework of the existing Phase 3 commit `d13a9e40`:

```bash
git mv src/lib/hooks/use-project-crew.ts src/lib/hooks/use-project-team.ts
git mv tests/unit/hooks/use-project-crew.test.ts tests/unit/hooks/use-project-team.test.ts
# ...edit files...
git add ...
git commit -m "refactor(hooks): useProjectTeam (flat list, task-type assignments) replaces useProjectCrew"
```

### ~~Task 3.5b: Add `role` column to `project_team_members`~~ — REMOVED

The `project_team_members` table was misidentified as a primary store. It's empty/derivative. No `role` migration is needed because **there are no roles** in OPS — team is flat. The agent's prior plan-edit added this task; it should not have. Skip entirely.

If `20260507120000_project_team_members_role.sql` was already applied during Phase 3 (verify via `list_tables`): leave the column. The new `useProjectTeam` doesn't read it. A future cleanup migration can drop both the column and the stale table after the iOS sync window closes.

### Task 3.6: ~~use-project-tags~~ — REMOVED

Tags cut from MVP scope. Skip.

### Task 3.7: use-weather

Fetches Open-Meteo and caches to `weather_forecasts` if last fetch >12h ago. Returns `WeatherSummary`.

**Files:**
- Create: `OPS-Web/src/lib/hooks/use-weather.ts`
- Create: `OPS-Web/src/lib/api/services/weather-service.ts`
- Create: `OPS-Web/src/app/api/projects/[id]/weather/route.ts` — required because `weather_forecasts` RLS allows writes only to service-role. Browser cannot upsert directly. The route handler reads project lat/lng (RLS-checked), calls Open-Meteo, upserts the cache, returns the `WeatherSummary` payload.
- Test: `OPS-Web/tests/unit/hooks/use-weather.test.ts`
- Test: `OPS-Web/tests/integration/api-projects-weather.test.ts`

**Step 1:** Test: given a project with `latitude=49.7016, longitude=-123.1558` (Squamish), the hook returns current + 5-day forecast in `WeatherSummary` shape, with `tempCurrentC`, `precipitationProbability`, `windSpeedKmh`, `conditions` populated.

**Step 2:** Implement service:

```typescript
// src/lib/api/services/weather-service.ts
const OPEN_METEO_BASE = 'https://api.open-meteo.com/v1/forecast';

export async function fetchOpenMeteo(lat: number, lng: number) {
  const params = new URLSearchParams({
    latitude: lat.toString(),
    longitude: lng.toString(),
    current: 'temperature_2m,weather_code,wind_speed_10m,precipitation_probability',
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code',
    timezone: 'auto',
    forecast_days: '6',
  });
  const r = await fetch(`${OPEN_METEO_BASE}?${params}`);
  if (!r.ok) throw new Error(`Open-Meteo: ${r.status}`);
  return r.json();
}

export const WMO_CODES: Record<number, string> = {
  0: 'Clear', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Depositing rime fog',
  51: 'Light drizzle', 53: 'Moderate drizzle', 55: 'Dense drizzle',
  61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain',
  71: 'Slight snow', 73: 'Moderate snow', 75: 'Heavy snow',
  80: 'Rain showers', 81: 'Heavy rain showers', 82: 'Violent rain showers',
  95: 'Thunderstorm', 96: 'Thunderstorm w/ hail', 99: 'Heavy thunderstorm',
};
```

**Step 3:** Implement hook: query cache table first, if `MAX(retrieved_at) < NOW() - INTERVAL '12 hours'`, call Open-Meteo, upsert results, return.

**Step 4:** Commit.

### Task 3.8: use-project-mutations (revised — flat routing, reuses existing services)

> **Decision (2026-05-07):** Don't dispatch PM-specific notifications (no PM exists). Don't insert into `activities` for new writes (timeline is `project_notes`-canonical). Don't reimplement what existing services already do. Use:
> - `ProjectService` for project CRUD (already exists)
> - `useCreateProjectNote` for posting notes (already exists, handles attachments + mentions + dedupe)
> - `dispatchProjectAssignment` for new-member notifications (already exists)
> - `ProjectLifecycleService.onProjectStageChange` for status transitions (already wired by `updateProjectStatus`)
> - `NotificationService.create` for archive/restore notifications
>
> The `useProjectMutations` hook becomes a thin coordinator — wiring these into the workspace's UI flow with optimistic updates and `event_kind`-tagged `project_notes` rows for the timeline.

**Files:**
- Modify: `OPS-Web/src/lib/hooks/use-project-mutations.ts`
- Modify: `OPS-Web/tests/unit/hooks/use-project-mutations.test.ts`

**Shape (mutations exposed):**

```typescript
export function useProjectMutations(projectId: string | null) {
  return {
    saveProject,           // for editing mode (uses ProjectService.updateProject + dispatchProjectAssignment for added members)
    createProject,         // for creating mode (ProjectService.createProject + dispatchProjectAssignment + project_notes row with event_kind='project_created')
    archiveProject,        // sets status=Archived + project_notes event_kind='project_archived' + notifies all team
    deleteProject,         // soft delete via ProjectService.deleteProject
    postNote,              // wraps useCreateProjectNote for the activity composer
    uploadPhoto,           // uploads + writes project_notes row with event_kind='photo_uploaded'
  };
}
```

**Status changes** are NOT exposed here — the existing `useUpdateProjectStatus` hook already does the right thing (calls `ProjectLifecycleService.onProjectStageChange` fire-and-forget). The workspace uses that existing hook directly. After a status change, the lifecycle service should ALSO insert a `project_notes` row with `event_kind='status_change'` and `content_metadata={ from, to }` so the timeline reflects it. Audit `ProjectLifecycleService` during implementation — if it doesn't already write to `project_notes`, add that.

**Step 1:** Tests assert:
- `createProject` calls `ProjectService.createProject` + `dispatchProjectAssignment(team_member_ids)` + inserts a `project_notes` row with `event_kind='project_created'`
- `saveProject` with team change calls `ProjectService.updateProject` + `dispatchProjectAssignment(newly_added_only)`
- `saveProject` with team change also inserts a `project_notes` row with `event_kind='note'` for non-event-style change descriptions, OR no row at all for trivial saves (decide during implementation per OPS conventions)
- `archiveProject` calls `ProjectService.updateProject({ status: Archived })` + dispatches notification to all `team_member_ids` + inserts `project_notes` row `event_kind='project_archived'`
- `postNote` delegates to `useCreateProjectNote` unchanged
- `uploadPhoto` writes the storage object then inserts `project_notes` row with `event_kind='photo_uploaded'`, `content_metadata={ photoId, url }`, attachments includes the photo
- **Does NOT** call `dispatchTaskCompleted`, `dispatchScheduleChange`, etc. — those belong to task mutations, not project mutations

**Step 2:** Implement. Reuse existing services — no parallel CRUD. Each mutation invalidates relevant query keys (project, activity, team).

**Step 3:** Audit `ProjectLifecycleService.onProjectStageChange`. If it doesn't currently write a `project_notes` row for the status transition, add that as part of this rework (one additional file modified). The status-change activity entry MUST appear in the timeline; lifecycle service is the right place to write it.

**Step 4:** Tests pass.

**Step 5:** Commit as a rework of the existing Phase 3 commit `baf4cae0`:

```bash
git add src/lib/hooks/use-project-mutations.ts tests/unit/hooks/use-project-mutations.test.ts \
  src/lib/api/services/project-lifecycle-service.ts # (if status_change write was added)
git commit -m "refactor(hooks): useProjectMutations delegates to existing services, drops PM routing"
```

---

## PHASE 4 — Mapbox Primitives

> **Skills:** `frontend-design`, `interface-design`. Use `.interface-design/system.md` map-controls z-index = 5000 for fullscreen, otherwise mounts inside the workspace at z-index window+1.

### Task 4.1: ProjectMap component

**Files:**
- Create: `OPS-Web/src/components/ops/projects/workspace/map/project-map.tsx`
- Test: `OPS-Web/tests/unit/components/project-map.test.tsx`

**Skills:** `frontend-design`

**Design tokens:**
- Map container background: `#0a0d10` (matches handoff)
- Map style URL: `mapbox://styles/mapbox/dark-v11` (custom OPS style is a follow-up)
- Pin glow: status hex with `box-shadow: 0 0 20px {hex}`

**Step 1:** Write failing test:

```typescript
it('renders Mapbox container with expected center, zoom, and pin', () => {
  const { container } = render(
    <ProjectMap
      latitude={49.7016}
      longitude={-123.1558}
      pinColor="#D99A3E"
      expanded={false}
    />
  );
  expect(container.querySelector('.mapboxgl-canvas-container')).toBeInTheDocument();
  // pin element marked with data-testid="project-pin"
  expect(container.querySelector('[data-testid="project-pin"]')).toBeInTheDocument();
});
```

**Step 2:** Run test — FAIL.

**Step 3:** Implement using `react-map-gl`:

```typescript
"use client";
import Map, { Marker, NavigationControl } from 'react-map-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useReducedMotion } from 'framer-motion';

interface Props {
  latitude: number;
  longitude: number;
  pinColor: string;
  expanded: boolean;
  otherPins?: Array<{ id: string; latitude: number; longitude: number; color: string; label: string }>;
  onClick?: () => void;
}

export function ProjectMap({ latitude, longitude, pinColor, expanded, otherPins = [], onClick }: Props) {
  const reducedMotion = useReducedMotion();
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) {
    return <MapTokenMissing />;
  }
  return (
    <div onClick={!expanded ? onClick : undefined} className={`relative h-full w-full ${!expanded ? 'cursor-zoom-in' : ''}`} style={{ background: '#0a0d10' }}>
      <Map
        mapboxAccessToken={token}
        initialViewState={{ latitude, longitude, zoom: expanded ? 13 : 14 }}
        mapStyle="mapbox://styles/mapbox/dark-v11"
        attributionControl={expanded}
        interactive={expanded}
        dragPan={expanded}
        scrollZoom={expanded}
        doubleClickZoom={expanded}
        reuseMaps
      >
        {expanded && <NavigationControl position="top-left" showCompass={false} />}
        <Marker latitude={latitude} longitude={longitude} anchor="center">
          <ProjectPin color={pinColor} animate={!reducedMotion} />
        </Marker>
        {expanded && otherPins.map(p => (
          <Marker key={p.id} latitude={p.latitude} longitude={p.longitude} anchor="center">
            <OtherProjectPin color={p.color} label={p.label} />
          </Marker>
        ))}
      </Map>
    </div>
  );
}

function ProjectPin({ color, animate }: { color: string; animate: boolean }) {
  return (
    <div data-testid="project-pin" className="relative">
      <div
        className={animate ? 'animate-pin-pulse' : ''}
        style={{
          width: 28, height: 28, borderRadius: '50%',
          background: `radial-gradient(circle, ${color}55 0%, ${color}00 70%)`,
          position: 'absolute', top: -14, left: -14,
        }}
      />
      <div style={{
        width: 14, height: 14, borderRadius: '50%',
        background: color,
        boxShadow: `0 0 12px ${color}`,
        border: '2px solid rgba(0,0,0,0.5)',
        position: 'absolute', top: -7, left: -7,
      }} />
      <div style={{
        width: 4, height: 4, borderRadius: '50%',
        background: '#fff',
        position: 'absolute', top: -2, left: -2,
      }} />
    </div>
  );
}

function MapTokenMissing() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-[#0a0d10] text-text-3 font-mono text-[11px] uppercase tracking-wider">
      <span>// MAP UNAVAILABLE — NEXT_PUBLIC_MAPBOX_TOKEN MISSING</span>
    </div>
  );
}
```

**Step 4:** Add keyframes to `globals.css`:

```css
@keyframes pin-pulse {
  0%, 100% { opacity: 0.5; transform: scale(1); }
  50%      { opacity: 0.8; transform: scale(1.1); }
}
.animate-pin-pulse {
  animation: pin-pulse 2.4s cubic-bezier(0.22, 1, 0.36, 1) infinite;
}
@media (prefers-reduced-motion: reduce) {
  .animate-pin-pulse { animation: none; }
}
```

**Step 5:** Run test, PASS.

**Step 6:** Commit.

### Task 4.2: MapHero (compact + expanded states)

**Files:**
- Create: `OPS-Web/src/components/ops/projects/workspace/map/map-hero.tsx`

**Skills:** `frontend-design`, `elite-animations` (for the expand/collapse transition)

**Design tokens:**
- Compact height: 220px
- Expanded height: 100% of body
- Bottom fade: `linear-gradient(180deg, transparent 0%, transparent 55%, rgba(20,20,20,0.55) 80%, rgba(20,20,20,0.95) 100%)`
- Address pill: `rgba(0,0,0,0.65)` bg, `backdrop-blur(8px)`, `1px solid rgba(255,255,255,0.10)`, `5px` radius
- Status pill: status soft-bg + line-border, glowing 6px dot
- All overlays positioned at 14px inset

**Step 1:** Compose `ProjectMap` + overlays + collapse transition. Use Framer Motion `LayoutGroup` for the height transition, `EASE_SMOOTH` 260ms.

**Step 2:** Add `MapAddressPill`, `MapStatusPill`, `MapExpandHint`, `MapCollapseButton`, `MapToolbar`, `MapLegend` as sub-components.

**Step 3:** Test the expanded state shows toolbar (zoom in/out, crew, layers, recenter) and legend; compact state hides them.

**Step 4:** Commit.

### Task 4.3: AddressAutocomplete (Mapbox Geocoding)

**Files:**
- Create: `OPS-Web/src/components/ops/projects/workspace/inputs/address-autocomplete.tsx`
- Create: `OPS-Web/src/lib/api/services/geocoding-service.ts`
- Test: `OPS-Web/tests/unit/components/address-autocomplete.test.tsx`

**Step 1:** Write failing test: typing in the input fires Mapbox Geocoding after 300ms debounce, renders dropdown of results, selecting one calls `onChange({ address, latitude, longitude })`.

**Step 2:** Implement with Mapbox Geocoding API v6 (`https://api.mapbox.com/search/geocode/v6/forward`). Cache responses in TanStack Query (5-min stale).

**Step 3:** Test passes.

**Step 4:** Commit.

---

## PHASE 5 — Atoms (project-modal-specific)

> **Skills:** `interface-design`, `audit-design-system`. Every atom traces to `.interface-design/system.md`. Reuse OPS-Web shared components where they exist; create new only when the handoff demands a primitive that doesn't exist.

> **Mapping rule:** Where the handoff uses inline-style atoms (Mono, Cake, Body, Btn, Chip, etc.), build TypeScript versions in `src/components/ops/projects/workspace/atoms/`. Each atom gets explicit prop types. Never inline `WT.*` literals — always use Tailwind tokens that map to the existing design system. The atom internals may use CSS variables (`var(--ops-accent)` etc.) where Tailwind doesn't reach.

### Task 5.1: Atom inventory + audit

**Files:**
- Create: `OPS-Web/docs/plans/2026-05-06-project-workspace-atom-mapping.md`

**Step 1:** For each handoff atom, document the OPS-Web equivalent or "NEW":

| Handoff | OPS-Web Equivalent | Decision |
|---------|-------------------|----------|
| `Mono` | `<span className="font-mono uppercase tracking-[0.18em] text-text-3">` | NEW atom `<Mono size, color>` thin wrapper |
| `Cake` | `<span className="font-cakemono font-light uppercase">` | NEW atom `<Cake size, weight, color>` |
| `Body` | Plain text in Mohave | NEW atom `<Body size, color>` |
| `Btn primary/secondary/ghost/destructive` | `<Button variant>` from `src/components/ui/button` | NEW workspace-Btn matches handoff (footer-specific styling) |
| `IconBtn` | None — small 26px icon button | NEW atom |
| `Lucide` | `lucide-react` package | Use `lucide-react` directly |
| `Avatar` | `UserAvatar` from `src/components/ops/user-avatar` | EXTEND to accept `color` prop, use existing |
| `Chip` (neutral/olive/tan/rose/accent) | `WidgetStatusBadge` close but not exact | NEW atom matching handoff colors |
| `Section` (`// TITLE` + dashed border) | `Slash` prefix exists in `system.md` | NEW Section atom |
| `Stack`, `Inline`, `Hairline` | None standardized | NEW atoms |
| `Field`, `FieldRow` | Existing `<Label>` + `<Input>` from `src/components/ui/` | NEW Field wraps existing inputs with handoff label voice |
| `TextInput`, `TextArea` | `<Input>`, `<Textarea>` from `src/components/ui/` | Wrap existing in workspace-Field |
| `Select` (custom dropdown) | `<Select>` from `src/components/ui/select` | Reuse Radix Select, restyle to match handoff |
| `Segmented` | None | NEW atom |
| ~~`ColorSwatchPicker`~~ | — | **REMOVED** — projects use status hex, no user-picked colors |
| ~~`ReadGrid`, `ReadField`~~ | — | **REMOVED** — SITE card is gone; ReadField/ReadGrid not needed |
| `ROText`, `ROPerson` | `UserAvatar` + text | NEW atoms |

**Step 2:** Save the mapping doc.

**Step 3:** Commit.

### Task 5.2 — 5.18: Atom implementations

For each atom in the mapping table, follow this pattern:

**Files:**
- Create: `OPS-Web/src/components/ops/projects/workspace/atoms/<atom>.tsx`
- Test: `OPS-Web/tests/unit/components/projects-workspace/<atom>.test.tsx`

**Skills:** `interface-design`

**Design tokens:** Specified per atom — must trace to `.interface-design/system.md`.

**Pattern:**

1. Write a failing test asserting the atom renders with the expected font-family, size, color, padding, border (use `getComputedStyle` or `toHaveClass` matchers).
2. Run test, expect FAIL.
3. Implement atom using Tailwind tokens. Forbidden: hex literals, hardcoded spacing, font-family strings outside the design system.
4. Run test, PASS.
5. Commit.

Do this in order: `Mono`, `Cake`, `Body`, `Stack`, `Inline`, `Hairline`, `Btn`, `IconBtn`, `Chip`, `Section`, `Field`, `FieldRow`, `TextInput`, `TextArea`, `Select`, `Segmented`. (Tasks 5.2 through 5.17.) `ColorSwatchPicker`, `ReadField`, `ReadGrid` removed from inventory after design review.

**Each atom ≤ 80 lines of implementation. Atoms compose; never duplicate.**

After all atoms: run `interface-design:audit` skill via the plugin command to validate.

```bash
# After all atoms committed:
# Invoke audit-design-system skill on src/components/ops/projects/workspace/atoms/
```

---

## PHASE 6 — Window Shell (ProjectWorkspaceWindow)

> **Skills:** `frontend-design`, `elite-animations`. The shell IS the most-touched surface — drag, resize, traffic lights, mode pill animation, all need craft.

### Task 6.1: Extend useWindowStore types

**Files:**
- Modify: `OPS-Web/src/stores/window-store.ts`

**Step 1:** Add new window types to the union:

```typescript
export type WindowType =
  | 'create-project'   // legacy — will be removed in PHASE 10
  | 'create-client'
  | 'create-task'
  | 'create-estimate'
  | 'create-lead'
  | 'compose-email'
  | 'project-workspace';  // NEW

export interface ProjectWorkspaceWindowMeta {
  projectId: string | null;       // null = create mode
  initialMode: 'viewing' | 'editing' | 'creating';
}

export interface FloatingWindowState {
  id: string;
  title: string;
  type: WindowType;
  meta?: ProjectWorkspaceWindowMeta;  // NEW
  // ... existing fields ...
}
```

**Step 2:** Add helper `openProjectWindow(opts: { projectId?: string | null; mode?: 'viewing'|'editing'|'creating' })`.

**Step 3:** Type-check, commit.

### Task 6.2: WindowTitleBar component

**Files:**
- Create: `OPS-Web/src/components/ops/projects/workspace/shell/window-title-bar.tsx`
- Test: `OPS-Web/tests/unit/components/window-title-bar.test.tsx`

**Skills:** `frontend-design`

**Design tokens:**
- Padding: `9px 14px 10px`
- Bottom border: `1px solid rgba(255,255,255,0.10)`
- Background: `linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.01))`
- Cursor: `grab`

**Step 1:** Test renders: traffic lights, separator, crumb (`// PROJECT`), id, status chip, mode pill, header action slot, title row (Cake 20px), subtitle (Mono 10px). User-select disabled. Drag handler fires on pointer-down.

**Step 2:** Implement.

**Step 3:** Commit.

### Task 6.3: TrafficLight component

**Files:**
- Create: `OPS-Web/src/components/ops/projects/workspace/shell/traffic-light.tsx`
- Test: `OPS-Web/tests/unit/components/traffic-light.test.tsx`

**Design tokens:**
- Size 11×11, radius 50%
- Rest: `rgba(255,255,255,0.18)` bg, `0.5px solid rgba(255,255,255,0.10)` border
- Hover: tone-tinted bg (#FF5F57 / #FEBC2E / #28C840), 0.5px solid rgba(0,0,0,0.30) border, glyph visible
- Transition: `background 120ms ease, border-color 120ms ease`

Implement, test, commit.

### Task 6.4: ModePill component (with pulse animation)

**Files:**
- Create: `OPS-Web/src/components/ops/projects/workspace/shell/mode-pill.tsx`
- Test: `OPS-Web/tests/unit/components/mode-pill.test.tsx`

**Skills:** `elite-animations`

**Design tokens:**
- VIEWING: `rgba(255,255,255,0.05)` bg, `text-text-2` text, `text-text-3` dot — no animation
- EDITING: `var(--tan-soft)` bg, `var(--tan)` text + dot, **pulse 1.6s ease-in-out infinite, opacity 1→0.45→1**
- CREATING: `rgba(111,148,176,0.10)` bg, `var(--ops-accent)` text + dot, pulse same as editing
- Padding 2/7/2/8, radius `--r-chip` (4px), font-mono 9.5px, tracking 0.16em uppercase

**Step 1:** Test: each mode renders the right colors and either has or lacks the pulse animation. Reduced-motion suppresses pulse.

**Step 2:** Implement using Framer Motion `animate` prop with `useReducedMotion` guard:

```typescript
const reducedMotion = useReducedMotion();
const shouldPulse = (mode === 'editing' || mode === 'creating') && !reducedMotion;
```

**Step 3:** Commit.

### Task 6.5: ModeFooter component

**Files:**
- Create: `OPS-Web/src/components/ops/projects/workspace/shell/mode-footer.tsx`
- Test: `OPS-Web/tests/unit/components/mode-footer.test.tsx`

**Design tokens:**
- Padding: `10px 18px`
- Top border: `1px solid var(--line)`
- Background: `rgba(0,0,0,0.42)` + `backdrop-blur(12px)`
- Slot order: destructive | meta | spacer | secondary[] | ghost | primary

**Step 1:** Test: each mode (viewing/editing/creating) renders the right buttons in the right order from a config object. Only ONE primary per footer (assertion).

**Step 2:** Implement. Use the workspace `Btn` atom from PHASE 5.

**Step 3:** Commit.

### Task 6.6: ModalTabs component (for editing/creating)

**Files:**
- Create: `OPS-Web/src/components/ops/projects/workspace/shell/modal-tabs.tsx`
- Test: `OPS-Web/tests/unit/components/modal-tabs.test.tsx`

**Design tokens:** Per handoff — Mono 10.5px tracking 0.16em, padding `11px 14px`, active `text-text` + 1px bottom border in `text-text`, inactive `text-text-3` + transparent border. Background `rgba(0,0,0,0.20)`, bottom border `var(--line)`.

Implement, test, commit.

### Task 6.7: Drag handler

**Files:**
- Create: `OPS-Web/src/components/ops/projects/workspace/shell/use-window-drag.ts`
- Test: `OPS-Web/tests/unit/hooks/use-window-drag.test.ts`

**Step 1:** Test: pointer-down on header → pointermove updates position via callback, clamped to bounds; pointer-up cleans up listeners. Buttons/inputs inside header (`[data-no-drag]`) prevent drag start.

**Step 2:** Implement following the handoff's `startDrag` logic with proper cleanup.

**Step 3:** Commit.

### Task 6.8: Resize handler (8 directions)

**Files:**
- Create: `OPS-Web/src/components/ops/projects/workspace/shell/use-window-resize.ts`
- Create: `OPS-Web/src/components/ops/projects/workspace/shell/resize-handle.tsx`
- Test: `OPS-Web/tests/unit/hooks/use-window-resize.test.ts`

**Step 1:** Test each of n/s/e/w/ne/nw/se/sw resize directions correctly mutates pos+size while respecting min size 480×360.

**Step 2:** Implement.

**Step 3:** Commit.

### Task 6.9: localStorage persistence

**Files:**
- Create: `OPS-Web/src/components/ops/projects/workspace/shell/use-window-persistence.ts`
- Test: `OPS-Web/tests/unit/hooks/use-window-persistence.test.ts`

**Step 1:** Test: `useWindowPersistence("project-J-4821")` reads from `localStorage["opsWin:project-J-4821"]` on mount, writes on every position/size change (debounced 200ms), skips initial mount write.

**Step 2:** Implement.

**Step 3:** Commit.

### Task 6.10: ProjectWorkspaceWindow shell (composes all the above)

**Files:**
- Create: `OPS-Web/src/components/ops/projects/workspace/shell/project-workspace-window.tsx`
- Test: `OPS-Web/tests/unit/components/project-workspace-window.test.tsx`

**Skills:** `frontend-design`, `elite-animations`

**Design tokens:**
- Background: `var(--glass-dense)` (rgba(18,18,20,0.78))
- Backdrop filter: `blur(28px) saturate(1.3)`
- Border: `1px solid var(--glass-border)` (rgba(255,255,255,0.09))
- Border radius: `var(--r-modal)` (12px) — match OPS-Web v2, NOT handoff 10px
- Box shadow: `0 24px 64px rgba(0,0,0,0.65), 0 0 0 0.5px rgba(255,255,255,0.04)`
- Default size: 1080×760 for project workspace
- Min size: 480×360

**Step 1:** Test:
- Renders title bar, optional tabs, body, optional right rail, mode-aware footer
- Drag header moves the window
- Resize handles fire correctly
- Traffic-light close calls onClose
- localStorage round-trips position+size
- Z-index from useWindowStore is applied
- Click anywhere brings the window to front (focus)

**Step 2:** Implement, composing all the pieces.

**Step 3:** Commit.

---

## PHASE 7 — Viewing Mode Body

### Task 7.1: ProjectViewingBody composer

**Files:**
- Create: `OPS-Web/src/components/ops/projects/workspace/viewing/project-viewing-body.tsx`
- Test: `OPS-Web/tests/unit/components/project-viewing-body.test.tsx`

**Step 1:** Test: in compact-map state, renders MapHero (220px) → ScheduleStrip (overlapping fade, margin-top -34px) → ProjectViewingTabs → tab content. In expanded-map state, renders only MapHero (full body), hides everything else.

**Step 2:** Implement.

**Step 3:** Commit.

### Task 7.2: ScheduleStrip wired to real dates

**Files:**
- Create: `OPS-Web/src/components/ops/projects/workspace/viewing/schedule-strip.tsx`
- Test: `OPS-Web/tests/unit/components/schedule-strip.test.tsx`

**Skills:** `elite-animations` (for the today-tick glow)

**Design tokens:**
- Day grid: `grid-template-columns: repeat(N, 1fr)`, gap 3px
- Bar: 6px tall, radius 1.5px
- Today: status hex, `box-shadow: 0 0 12px {hex}80`
- Past: `#8FA577` (Accepted hex) full opacity
- Future: `var(--line)` 45% opacity
- Blocked: `var(--rose)`

**Step 1:** Test: given startDate=2026-04-22, endDate=2026-04-24, today=2026-04-23, blockedDates=[], renders 3 cells with correct colors.

**Step 2:** Implement. **No buffer days** — the strip renders only actual project days from start to end. Buffer logic was cut; if it returns later it will be derived from task scheduling, not stored on projects.

**Step 3:** Commit.

### Task 7.3: ProjectViewingTabs

**Files:**
- Create: `OPS-Web/src/components/ops/projects/workspace/viewing/project-viewing-tabs.tsx`
- Test

Per handoff design, with active underline using `var(--ops-accent)`. Real counts pulled from hooks.

Commit.

### Task 7.4: Activity Tab — unified `project_notes` timeline

> **Decision (2026-05-07):** The Activity tab renders the unified `project_notes` timeline (notes + system events). Each row's visual treatment depends on `event_kind`: `null` → user note (existing `<NotesList>` row treatment), non-null → system event (compact row, status-tinted dot, parsed content_metadata). Reuse the existing notes infrastructure where possible — `useProjectNotes` already hits the right table.

**Files:**
- Create: `OPS-Web/src/components/ops/projects/workspace/viewing/activity-tab.tsx`
- Create: `OPS-Web/src/components/ops/projects/workspace/viewing/activity-entry.tsx` — renders a single timeline entry, dispatching on `event_kind`
- Create: `OPS-Web/src/components/ops/projects/workspace/viewing/system-event-renderers.tsx` — one renderer per event_kind that parses content_metadata into the right copy + icon
- Test: `OPS-Web/tests/integration/activity-tab.test.tsx`

**Skills:** `elite-animations` (entry stagger), `ops-copywriter` (empty state + system-event copy templates)

**Design tokens:** Per handoff README §Activity Tab — but applied to the unified timeline.

**Step 1:** Tests:
- Renders entries sorted by created_at desc, paginated 25
- User note (event_kind=NULL): Avatar + name + timestamp + content + attachments + mentions, identical to existing `<NotesList>` styling
- Status change (event_kind='status_change'): system author dot in status hex, content "Project marked **In Progress**" derived from `content_metadata.to`, status-tinted glowing dot (`box-shadow: 0 0 8px {hex}80`)
- Estimate sent: dot in `--ops-accent`, content "Sent estimate **EST-00128** · **$5,840**" from content_metadata
- Payment received: dot in `--olive`, content "Payment received · **$3,270.40** · 50% deposit"
- Photo uploaded (event_kind='photo_uploaded'): renders 64×64 photo grid from attachments, no separate "add" button
- Empty state — `// NO ACTIVITY YET — POST THE FIRST UPDATE` (mono 9px tracked-uppercase per voice rules)
- Stagger entrance per `elite-animations`: 50ms per item, 300ms total, EASE_SMOOTH, reduced-motion = instant

**Step 2:** Implement. Compose `useProjectActivity` (Task 3.1) for data, `<ActivityEntry>` per row, `<NoteComposer>` (existing) at the bottom.

**Step 3:** Run all tests, all green.

**Step 4:** Commit.

### Task 7.5: Activity composer — REUSE existing `<NoteComposer>`

> **Decision (2026-05-07):** Don't build a new ActivityComposer. The existing `<NoteComposer>` at `src/components/ops/note-composer.tsx` already does everything required: textarea, @mention picker (with team users), photo attachment with markup, mention notification dispatch via `NotificationService.createMentionNotifications` + `dispatchMentionPush`. It already calls `useCreateProjectNote` which writes to `project_notes` — exactly the table we want.
>
> The handoff's tag icon (task type picker) is **out of MVP scope** — there's no current OPS pattern of tagging notes with task types, and adding it requires a schema decision (where does the tag live?). Drop the tag icon from the composer for this PR.

**Files:**
- Modify: `OPS-Web/src/components/ops/projects/workspace/viewing/activity-tab.tsx` — render `<NoteComposer>` at the bottom, identical to how `[id]/page.tsx:840-854` does today.

**Step 1:** Verify `<NoteComposer>` accepts the props this surface needs: `onSubmit`, `users` (for @mention), `isSubmitting`, `initialContent`/`initialAttachments` (for edit, not used here).

**Step 2:** No new component needed. The Activity Tab renders `<NoteComposer>` directly with the relevant project's id, company id, and the team users list (from `useTeamMembers`).

**Step 3:** Visual styling: if the existing `<NoteComposer>` doesn't match the workspace voice exactly (it lives inside the dossier modal, not the route page), apply token overrides via wrapper div — don't fork the component. Specifically:
- Background: `rgba(255,255,255,0.025)` (matches handoff §ActivityComposer)
- Border: `1px solid var(--line)`
- Radius: `var(--r-btn)` (5px)
- Place inside a `marginTop: 12` container to separate from the timeline above

**Step 4:** No new commit — folded into Task 7.4's commit since it's purely composition.

### Task 7.6: Details Tab — flat team, no PM hierarchy

> **Decision (2026-05-07):** Drop the "PM big card + crew row" structure entirely. Replace with a single flat "Team" section using the same pattern as the existing detail page sidebar (`[id]/page.tsx:616-646`): each member shows avatar + name + the task-type names they're assigned to. No MESSAGE button (no PM concept; the Client section in the sidebar handles client comms via mailto/tel).
>
> Details tab structure: **Scope (= `project.description`) → Team → Tasks**.

**Files:**
- Create: `OPS-Web/src/components/ops/projects/workspace/viewing/details-tab.tsx`
- Create: `OPS-Web/src/components/ops/projects/workspace/viewing/scope-card.tsx`
- Create: `OPS-Web/src/components/ops/projects/workspace/viewing/team-card.tsx`
- Create: `OPS-Web/src/components/ops/projects/workspace/viewing/task-list.tsx`
- Test for each.

**Design tokens:** Per handoff README §Details Tab — but with single Team section in place of "PM card + crew row".

**Step 1:** Tests:
- **ScopeCard**: reads `project.description`. `rgba(255,255,255,0.02)` bg, `var(--line)` border, mohave 13.5 `text-text-2`. Empty state when description is null: `// NO SCOPE WRITTEN — ADD FROM EDIT` mono 9px text-text-mute.
- **TeamCard**: header `// TEAM · {N} ASSIGNED`. Each member: 26px avatar (color from `member.avatarColor`) + name in mohave 13 + task-type names joined by ` · ` in mono 10 text-3 (e.g., "ROOFING · FRAMING"). If `taskTypeNames` is empty for a member, show `(no tasks)` in text-mute. Sort alphabetical. Uses `useProjectTeam` from Task 3.5. **No PM separation. No MESSAGE button.**
- **TaskList**: header `Tasks · {done} of {total} complete`. Grid rows 20px/1fr/auto/90px/70px. Active row tan-tinted bg+border. Done row 55% opacity. Trade chips colored from `task_types_v2.color`. Uses `useProjectTasksGrouped`.

**Step 2:** Implement. Reuse `<UserAvatar>` from `src/components/ops/user-avatar.tsx`.

**Step 3:** Commit each as a separate atomic commit.

### Task 7.7: Accounting Tab — real pipeline + ledger

**Files:**
- Create: `OPS-Web/src/components/ops/projects/workspace/viewing/accounting-tab.tsx`
- Create: `OPS-Web/src/components/ops/projects/workspace/viewing/pipeline-row.tsx`
- Create: `OPS-Web/src/components/ops/projects/workspace/viewing/ledger-table.tsx`
- Test for each.

**Design tokens:** Per handoff README §Accounting Tab.

**Step 1:** Test:
- Pipeline: 4 cells in a row, separated by 14×14 chevron circles. QUOTED / INVOICED / RECEIVED (olive) / OUTSTANDING (tan). Sub-detail per cell.
- Ledger: header row Mono 9px tracking 0.18em, 5-col grid (100px/1fr/110px/110px/100px). Data rows 9px 12px padding, hover row. Totals footer with NET MARGIN.
- All numbers tabular-nums, right-aligned in amount column.

**Step 2:** Implement using `use-project-pipeline` and `use-project-ledger`.

**Step 3:** Commit.

### Task 7.8: Always-on sidebar (replaces handoff's toggleable right rail)

> **Decision (2026-05-07):** The handoff's toggleable right rail with QUICK ACTIONS button is dropped. The existing detail page (`[id]/page.tsx`) already has a sidebar pattern that is better UX: always-on, glanceable, sections include inline-editable Client and Location plus computed Health metrics. The workspace adopts that pattern verbatim and adds two new sections (Weather, Linked Records). The QUICK ACTIONS content (new estimate, new invoice, etc.) is dropped — the FAB already handles those actions globally.

**Files:**
- Create: `OPS-Web/src/components/ops/projects/workspace/viewing/project-sidebar.tsx` — orchestrator
- Create: `OPS-Web/src/components/ops/projects/workspace/viewing/sidebar-sections/health-section.tsx` — progress bar + 4 metric tiles
- Create: `OPS-Web/src/components/ops/projects/workspace/viewing/sidebar-sections/client-section.tsx` — inline-editable client picker (mirror `[id]/page.tsx:483-555`)
- Create: `OPS-Web/src/components/ops/projects/workspace/viewing/sidebar-sections/location-section.tsx` — inline-editable address (mirror `[id]/page.tsx:557-613`)
- Create: `OPS-Web/src/components/ops/projects/workspace/viewing/sidebar-sections/team-section.tsx` — uses `useProjectTeam`, mirror `[id]/page.tsx:616-646`
- Create: `OPS-Web/src/components/ops/projects/workspace/viewing/sidebar-sections/dates-section.tsx` — start/end + duration days
- Create: `OPS-Web/src/components/ops/projects/workspace/viewing/sidebar-sections/weather-section.tsx` — current + 5-day grid (uses `useWeather`)
- Create: `OPS-Web/src/components/ops/projects/workspace/viewing/sidebar-sections/linked-records-section.tsx` — Client / RFQ / EST / INV / PAY rows
- Test for each section.

**Skills:** `frontend-design`, `interface-design`. Sections compose `<Surface>` and `WidgetStatusBadge` where appropriate.

**Design tokens:**
- Sidebar width: `300px` (matches handoff's `300px`, slightly wider than `[id]/page.tsx`'s `280px` because the workspace needs more room for Weather)
- Border-left: `1px solid var(--line)`
- Background: `rgba(0,0,0,0.20)`
- Padding: `18px 16px`
- Section gap: 20px
- Section header: `// TITLE` in mono 9px tracking 0.16em uppercase text-text-3

**Step 1:** Tests for each section:
- **Health**: progress bar fills based on `completedTasks.length / activeTasks.length`. 4 metric tiles: Tasks (`{done}/{total}`), Overdue (red if >0), Invoiced (financial-revenue color, gated by `invoices.view` permission), Outstanding (financial-receivables color, gated). Permission-gated tiles render nothing when permission absent (don't show empty cells).
- **Client**: shows name + email (mailto:) + phone (tel:). Edit button reveals search picker (debounced) listing all company clients; selecting one calls `useUpdateProject({ clientId })`. "Remove client" option clears `clientId` to null.
- **Location**: shows address + "OPEN MAPS" link to Google Maps with encoded query. Edit button reveals input with Save/Cancel buttons; Save calls `useUpdateProject({ address })` and triggers Mapbox geocoding to update lat/lng (use `<AddressAutocomplete>` from Task 4.3 with the same shape so the field gets coords on save).
- **Team**: identical to Task 7.6's TeamCard but in sidebar layout (more vertical, less horizontal). 28px avatars instead of 26px.
- **Dates**: start → end with duration days underneath. Editable inline (calls `useUpdateProject({ startDate, endDate })` on save).
- **Weather**: current card with 28px Cake temp (e.g., "14°") + mono 10 condition + wind/precip line. 5-day grid below — rain-risk days (precipitation_probability >= 50%) tinted tan with "RAIN" label. Shows Open-Meteo attribution in tooltip per cost-disclosure.
- **Linked Records**: 5 rows (CLIENT / RFQ / EST / INV / PAY). Each row: mono 9 label + mono 11 value, clickable (opens the relevant entity's workspace or routes). Uses a new `useProjectLinkedRecords(projectId)` hook (lightweight join across opportunities, latest estimate, latest invoice, latest payment).

**Step 2:** Implement. Reuse `<UserAvatar>`, `<StatusBadge>` where applicable. Inline-editing state lives in each section's local state; mutations use `useUpdateProject` (existing).

**Step 3:** Mount the sidebar inside `ProjectViewingBody` to the right of the tab content area, taking `300px` of width — non-toggleable. Window minimum width must stay `≥780px` so map + tabs + sidebar all fit comfortably (current handoff min is `480×360`; bump min width to `780` for the workspace specifically).

**Step 4:** Commit each section + the orchestrator as separate atomic commits.

---

## PHASE 8 — Editing/Creating Mode Body

> **Decision (2026-05-07):** Edit/Create flow drops from 3 tabs to **2 tabs: IDENTITY / SCHEDULE**. PeopleTab is removed entirely — team is computed from task assignments and shown read-only in the sidebar. To add/remove team members on a project, the user assigns them to a task in the Tasks tab (existing `<TaskList>` flow). This matches OPS architecture (`team_member_ids` is a denormalized cache of task assignments). PersonPicker isn't built either — no PeopleTab needs it.

### Task 8.1: ProjectEditCreateBody composer

**Files:**
- Create: `OPS-Web/src/components/ops/projects/workspace/edit-create/project-edit-create-body.tsx`
- Test

**Step 1:** Dispatch on `tab` prop to render the right form section: **identity / schedule**. (No people, no context.)

**Step 2:** Manage form state via `react-hook-form` (already in OPS-Web stack). Use `useProjectMutations.saveProject` (Task 3.8) or `createProject` based on mode.

**Step 3:** Commit.

### Task 8.2: IdentityTab

**Files:**
- Create: `OPS-Web/src/components/ops/projects/workspace/edit-create/identity-tab.tsx`
- Test

Fields:
- Project name (TextInput, required) → maps to `projects.title`
- Client (PersonPicker, required) + Trade (Select: Roofing/HVAC/Plumbing) → `projects.client_id` + `projects.trade`
- Site address (AddressAutocomplete with pin icon) → `projects.address` + `projects.latitude` + `projects.longitude`
- Description (TextArea, 3 rows, hint "WHAT WILL BE DONE") → `projects.description` (existing column — no new `scope` field)

Commit.

### Task 8.3: ScheduleTab

**Files:**
- Create: `OPS-Web/src/components/ops/projects/workspace/edit-create/schedule-tab.tsx`
- Test

Fields:
- Start / End / Duration (3-col grid, mono inputs) → `projects.start_date` / `projects.end_date` / derived
- Visibility (Segmented: ALL / OFFICE / PRIVATE) → `projects.visibility`

**No color picker. No buffer days.** Status drives all chrome; buffer is a future derived value from task scheduling.

Commit.

### Task 8.4: ~~PeopleTab~~ — REMOVED

Tab dropped. Team is computed from task assignments — managed via the Tasks tab in viewing mode. Editing the team directly on a project would create a desync between `team_member_ids` and `tasks.team_member_ids[]`. Architecturally cleaner to not allow it.

### Task 8.5: ~~ContextTab~~ — REMOVED

Tab dropped. Description moved to IdentityTab (uses existing `projects.description`). Site notes / gate code / tags all cut from MVP scope.

### Task 8.6: ~~PersonPicker~~ — REMOVED

No tab needs it (PeopleTab dropped). The Client picker in IdentityTab is a separate component (mirrors the existing inline client picker pattern from `[id]/page.tsx:483-555`); team is not edited here.

### Task 8.7: ~~ColorSwatchPicker~~ — REMOVED

Status drives chrome; no user-picked colors. Skip.

---

## PHASE 9 — Wiring Integration Points

### Task 9.1: FAB action update

**Files:**
- Modify: `OPS-Web/src/lib/constants/fab-actions.ts`

Change `target: "create-project"` to `target: "project-workspace"` and add `meta: { initialMode: 'creating' }`.

Commit.

### Task 9.2: quick-actions-drawer dispatch

**Files:**
- Modify: `OPS-Web/src/components/layouts/quick-actions-drawer.tsx`

When `action.target === 'project-workspace'`, call `openProjectWindow({ projectId: null, mode: 'creating' })`.

Commit.

### Task 9.3: FloatingWindows renderer

**Files:**
- Modify: `OPS-Web/src/components/layouts/dashboard-layout.tsx` (the `FloatingWindows()` function)

Add case for `win.type === 'project-workspace'`:

```tsx
{wins.filter(w => w.type === 'project-workspace').map(win => (
  <ProjectWorkspaceWindow
    key={win.id}
    windowId={win.id}
    projectId={win.meta?.projectId ?? null}
    initialMode={win.meta?.initialMode ?? 'viewing'}
    onClose={() => closeWindow(win.id)}
  />
))}
```

Commit.

### Task 9.4: project-spreadsheet row click → workspace

**Files:**
- Modify: `OPS-Web/src/app/(dashboard)/projects/_components/project-spreadsheet.tsx`

Replace `openPopover(...)` with `openProjectWindow({ projectId: project.id, mode: 'viewing' })`.

Commit.

### Task 9.5: project canvas card click → workspace

**Files:**
- Modify: `OPS-Web/src/app/(dashboard)/projects/page.tsx` (canvas view)

Replace popover open with `openProjectWindow({ projectId: project.id, mode: 'viewing' })`.

Commit.

### Task 9.6: dashboard widget callers

**Files:**
- Search: `grep -r "openPopover\|ProjectDetailModal\|ProjectDetailSheet\|EditProjectModal\|CreateProjectModal" src/components/dashboard/`
- For each result, modify to call `openProjectWindow(...)`.

Commit each widget separately.

### Task 9.7: notification deep-link handler

**Files:**
- Modify: `OPS-Web/src/components/layouts/dashboard-layout.tsx`
- Modify: `OPS-Web/src/lib/api/services/notification-dispatch.ts`

**Step 1:** Add a useEffect to dashboard-layout that parses `?openProject=<id>&mode=view|edit` query params and triggers `openProjectWindow(...)`. Strip the params after open.

**Step 2:** Update notification dispatch helpers to use these query params for `actionUrl`:

```typescript
actionUrl: `/?openProject=${projectId}&mode=view`
```

**Step 3:** Commit.

### Task 9.8: route-based fallback

**Files:**
- Modify: `OPS-Web/src/app/(dashboard)/projects/[id]/page.tsx`

The route is kept for SEO + sharing + iOS Smart App Banner. It now renders the same ProjectViewingBody but **without window chrome** (no drag/resize/title bar) — full-page mode. EditProjectModal is removed; clicking "Edit" routes to `/projects?openProject={id}&mode=edit` to open the workspace.

This keeps `/projects/[id]` valid as a deep link target.

Commit.

---

## PHASE 10 — Delete Superseded Code

### Task 10.1: Delete project-detail-modal.tsx

```bash
rm OPS-Web/src/components/ops/project-detail-modal.tsx
grep -r "from.*project-detail-modal\|ProjectDetailModal" src/ --include="*.tsx" --include="*.ts"
```

If any imports remain, delete them and replace with `openProjectWindow` calls.

Commit.

### Task 10.2: Delete project-detail-sheet.tsx

Same pattern.

### Task 10.3: Delete create-project-modal.tsx

Same pattern. Confirm `CreateProjectForm` was either replaced by IdentityTab+ScheduleTab+PeopleTab or extracted into the workspace.

### Task 10.4: Delete edit-project-modal.tsx

Same pattern.

### Task 10.5: Delete project-detail-popover + store

```bash
rm OPS-Web/src/app/\(dashboard\)/projects/_components/project-detail-popover.tsx
rm OPS-Web/src/app/\(dashboard\)/projects/_components/project-detail-popover-store.ts
```

Verify no imports remain.

### Task 10.6: Cleanup useWindowStore legacy types

**Files:**
- Modify: `OPS-Web/src/stores/window-store.ts`

Remove `'create-project'` from the `WindowType` union (now handled by `project-workspace`). Adjust `FloatingWindows` switch.

### Task 10.7: Type-check + lint + test

```bash
npm run type-check
npm run lint
npm test
```

All must pass clean. Fix any cascaded breakage.

Commit.

---

## PHASE 11 — Notifications & Timeline Wiring

> **Decision (2026-05-07):** No PM-specific routing. Notifications go to the whole team or to mentioned users only. Use existing `dispatch*` functions and `NotificationService` — don't reimplement. Activity timeline writes go to `project_notes` (NOT `activities`) with `event_kind` set per event type.

### Task 11.1: Lifecycle service writes timeline rows + notifies team

**Files:**
- Modify: `OPS-Web/src/lib/api/services/project-lifecycle-service.ts`

For each project status transition the lifecycle service handles:

1. **Insert a `project_notes` row** with:
   - `event_kind = 'status_change'`
   - `content` = human-readable e.g., "Status changed to In Progress"
   - `content_metadata = { from, to, changedBy }`
   - `author_id` = the user who triggered the change (from auth context, may be null for cron-driven transitions)
   - No mentions, no attachments
2. **Dispatch a team notification** via existing `dispatch*` infrastructure — notify all `team_member_ids` of the status change. Use a generic dispatch call (no PM-specific routing). If a suitable dispatcher doesn't exist, add `dispatchProjectStatusChange` alongside `dispatchProjectAssignment` in `notification-dispatch.ts` following the same pattern.

Audit the lifecycle service first — it may already do the notification side. Don't duplicate. The new work is the `project_notes` insertion for the timeline.

Test with `tests/integration/project-lifecycle-timeline.test.ts`: simulate a status transition, assert one `project_notes` row inserted with the right event_kind/payload, and the notification dispatch was called with team_member_ids.

Commit.

### Task 11.2: Project create / save notifications + timeline

**Files:**
- Modify: `OPS-Web/src/lib/hooks/use-project-mutations.ts` (already covered in Task 3.8 — this task is the integration test layer)

Already covered architecturally in Task 3.8. This task is the integration test:

- `tests/integration/project-create-flow.test.ts` — creating a project: asserts (a) project row created, (b) `project_notes` row with `event_kind='project_created'`, (c) `dispatchProjectAssignment` called with `team_member_ids`
- `tests/integration/project-save-flow.test.ts` — editing a project: assert team-member additions trigger `dispatchProjectAssignment` for newly-added only; trivial saves (e.g., description change) do NOT spam team notifications

Commit.

### Task 11.3: Note posting + @mention notifications

Already wired in the existing `useCreateProjectNote` flow (`NotificationService.createMentionNotifications` + `dispatchMentionPush`). The workspace's Activity tab reuses `<NoteComposer>` (Task 7.5), which already calls these. **No new code.** Just verify integration:

- `tests/integration/workspace-note-mention.test.ts` — post a note from the workspace's Activity tab with @mentions, assert in-app notifications inserted + push dispatched

Commit.

### Task 11.4: Photo upload — timeline write, no notification

When a photo is uploaded via `<NoteComposer>`'s photo attachment flow OR a dedicated upload action:

- Insert `project_notes` row with `event_kind='photo_uploaded'` and `content_metadata={ photoId, url, thumbnailUrl }`
- The photo also gets cross-posted to the gallery (existing `useCreateProjectPhoto` pattern from `[id]/page.tsx:749-761`)
- **No team notification** — would be too noisy (operators upload photos constantly)

Test: `tests/integration/workspace-photo-upload.test.ts` — assert timeline row exists and no notification fired.

Commit.

### Task 11.5: Archive flow — confirm modal + timeline + team notification

When user clicks ARCHIVE in the footer (viewing mode):

1. Open ConfirmModal (build per handoff §ConfirmModal — destructive variant with rose accent stripe, optional typed-confirmation if needed)
2. On confirm: `useProjectMutations.archiveProject(projectId)` → sets `status=Archived` → inserts `project_notes` row with `event_kind='project_archived'` → dispatches notification to all `team_member_ids`

Test: `tests/integration/workspace-archive-flow.test.ts`.

Commit.

---

## PHASE 12 — Animations & Polish

> **Skills:** `animation-architect` first (always), then `web-animations`. All easing = `cubic-bezier(0.22, 1, 0.36, 1)`. Reduced-motion fallbacks mandatory.

### Task 12.1: Mode pill pulse (already in 6.4)

Confirm the pulse animation is implemented and reduced-motion-safe. Skip if done.

### Task 12.2: Map expand/collapse transition

**Files:**
- Modify: `OPS-Web/src/components/ops/projects/workspace/map/map-hero.tsx`

Use Framer Motion to animate height + body padding + footer visibility over 280ms EASE_SMOOTH. Coordinate via shared layoutId for the map container itself.

Test: visual regression via Playwright snapshot at compact and expanded.

Commit.

### Task 12.3: Mode transition (viewing ↔ editing ↔ creating)

**Files:**
- Modify: `OPS-Web/src/components/ops/projects/workspace/shell/project-workspace-window.tsx`

Body cross-fades 200ms on mode change. Tab bar animates in/out. Footer buttons re-arrange via FLIP layout animation.

Commit.

### Task 12.4: Tab underline slide

**Files:**
- Modify: `OPS-Web/src/components/ops/projects/workspace/viewing/project-viewing-tabs.tsx`
- Modify: `OPS-Web/src/components/ops/projects/workspace/shell/modal-tabs.tsx`

Use a shared layoutId on the underline so it slides between tabs over 220ms EASE_SMOOTH.

Commit.

### Task 12.5: Activity entry stagger

**Files:**
- Modify: `OPS-Web/src/components/ops/projects/workspace/viewing/activity-tab.tsx`

Items enter with stagger 50ms / item, 300ms total, EASE_SMOOTH. Reduced-motion: instant.

Commit.

### Task 12.6: Today-tick glow pulse

**Files:**
- Modify: `OPS-Web/src/components/ops/projects/workspace/viewing/schedule-strip.tsx`

The today-tick has a gentle glow pulse — only when status is `InProgress` and only when reduced-motion is off.

**Spec amendment 2026-05-08 (Phase 12.6 audit):** original spec called for `3s ease-in-out infinite, box-shadow alpha 0.5 ↔ 0.9`. The shipped Phase 7.2 implementation uses **1.6s EASE_SMOOTH infinite, opacity 1 → 0.5 → 1** on a status-tinted blurred radial halo (a small `motion.span` with `filter: blur(4px)` and 33%-alpha status background). Ratified for two reasons:

1. **Compositor-only.** Opacity animations stay on the GPU; box-shadow alpha cycling triggers paint every frame. The 1.6s opacity pulse is meaningfully cheaper.
2. **Cadence consistency.** The ModePill (editing/creating) also pulses 1.6s opacity 1 → 0.45 → 1. Keeping the today-tick on the same cadence means the workspace breathes as a single coherent system signal, not two competing rhythms.

The visual result — a soft, status-tinted glow that breathes — matches the original emotional beat. WCAG 2.3.3 is satisfied either way (gated behind `useReducedMotion`).

Commit.

### Task 12.7: Hover transitions sweep

**Files:**
- Audit every interactive element in the workspace tree. Confirm hover transitions use 150ms EASE_SMOOTH per design system.

Commit any fixes.

---

## PHASE 13 — Copy & i18n

> **Skills:** `ops-copywriter` (mandatory for every user-facing string).

### Task 13.1: Create project dictionary

**Files:**
- Create: `OPS-Web/src/i18n/dictionaries/en/project-workspace.json`
- Create: `OPS-Web/src/i18n/dictionaries/es/project-workspace.json`

**Step 1:** Run `ops-copywriter` skill against the full handoff doc to extract every label and write OPS-voice copy:

- Crumb: `PROJECT`
- Mode pills: `VIEWING`, `EDITING`, `CREATING`
- Footer buttons: `EDIT`, `SAVE`, `DISCARD CHANGES`, `ARCHIVE`, `CANCEL`, `SAVE DRAFT`, `CREATE PROJECT`, `ADD NOTE`
- Activity composer placeholder: `Note · @ to mention · drop photos to attach`
- Activity composer post hint: `⌘ ENTER · POST`
- Tab labels: `ACTIVITY`, `DETAILS`, `ACCOUNTING`, `IDENTITY`, `SCHEDULE`, `PEOPLE`
- Sidebar section headers: `// HEALTH`, `// CLIENT`, `// LOCATION`, `// TEAM`, `// DATES`, `// SITE WEATHER`, `// LINKED`
- Other section headers: `// SCHEDULE` (schedule strip), `// VISIBLE ON MAP` (expanded map legend)
- Empty states: `// NO ACTIVITY YET — POST THE FIRST UPDATE`, `NO TASKS · ADD ONE`, `NO LEDGER ENTRIES YET`
- Confirmation copies for ARCHIVE: `THIS WILL · Move J-{id} to archive · Hide from active boards · Preserve all records for audit`
- Etc.

**Step 2:** Save dictionaries.

**Step 3:** Replace every hardcoded string in workspace components with `useDictionary("project-workspace").t("key")`.

**Step 4:** Run `npm run type-check` (i18n keys are typed).

**Step 5:** Commit.

### Task 13.2: Spanish translations

**Files:**
- Modify: `OPS-Web/src/i18n/dictionaries/es/project-workspace.json`

Translate all strings. The OPS Spanish voice uses the same uppercase + // prefix pattern.

Commit.

---

## PHASE 14 — Tests

### Task 14.1: Unit test sweep

Confirm every PHASE 3 hook, every PHASE 5 atom, every PHASE 6 shell component has a passing unit test.

```bash
npm test
```

All green. If any are skipped (`it.skip` / `describe.skip`), un-skip and fix.

### Task 14.2: Integration tests

**Files:**
- Create: `OPS-Web/tests/integration/project-workspace-viewing.test.tsx`
- Create: `OPS-Web/tests/integration/project-workspace-editing.test.tsx`
- Create: `OPS-Web/tests/integration/project-workspace-creating.test.tsx`
- Create: `OPS-Web/tests/integration/project-workspace-mode-flow.test.tsx`

Each test seeds a real test Supabase instance with a project + activities + tasks + estimates + invoices + payments + crew, mounts the workspace, exercises the full flow.

Commit.

### Task 14.3: E2E test (Playwright)

**Files:**
- Create: `OPS-Web/tests/e2e/project-workspace.spec.ts`

E2E flow:
1. Sign in as a manager
2. Click FAB → New Project → workspace opens in CREATING mode
3. Fill all required fields, click CREATE PROJECT → workspace flips to VIEWING
4. Verify activity feed shows "Project created"
5. Click EDIT → flips to EDITING
6. Change scope, click SAVE → flips to VIEWING, activity entry inserted
7. Click EXPAND MAP → map fills body, footer hides
8. Click COLLAPSE → returns
9. Verify sidebar always-on with Health/Client/Location/Team/Dates/Weather/Linked sections rendered
10. Inline-edit Client in sidebar → save → activity entry appears in timeline
11. Close window via traffic light → workspace removed from DOM
12. Re-open from spreadsheet → previous position+size restored

Commit.

### Task 14.4: Visual regression

**Files:**
- Create: `OPS-Web/tests/visual/project-workspace.spec.ts`

Playwright screenshots of: viewing dossier, viewing with rail, viewing with expanded map, editing identity, editing schedule, creating identity, archive confirm modal.

Compare against baseline. Update baselines after first run.

Commit.

---

## PHASE 15 — Bible & Docs

### Task 15.1: Update bible 03_DATA_ARCHITECTURE.md

Already done in Task 1.6 if the migration sections were added. Verify.

### Task 15.2: Update bible 05_DESIGN_SYSTEM.md

**Files:**
- Modify: `ops-software-bible/05_DESIGN_SYSTEM.md`

Add new section: `## Project Workspace Window`. Document:
- Location: `src/components/ops/projects/workspace/`
- Mode-aware footer pattern
- Window persistence keys (`opsWin:project-{id}`)
- Status temperature drives chrome (status hex bleeds into pin glow + today-tick)
- Map integration (Mapbox GL JS, dark-v11 style)
- Reference: `OPS-Web/.interface-design/system.md`

Commit.

### Task 15.3: Update OPS-Web/CLAUDE.md

**Files:**
- Modify: `OPS-Web/CLAUDE.md`

Add under "Key Architecture Patterns":

```markdown
### Project Workspace Window

Single mode-aware floating window for all project interactions (`src/components/ops/projects/workspace/`).

- Modes: `viewing` (dossier with map + tabs) / `editing` (form tabs) / `creating` (form tabs, no project yet)
- Open via: `useWindowStore.openProjectWindow({ projectId, mode })`
- Mounts inside `FloatingWindows` in dashboard layout
- Position + size persist to `localStorage` keyed by `opsWin:project-{projectId}`
- Status hex from `PROJECT_STATUSES` drives map pin glow, schedule today-tick, active task highlight
- Map: Mapbox GL JS via `<ProjectMap>`. Token: `NEXT_PUBLIC_MAPBOX_TOKEN`
- Weather: Open-Meteo via `useWeather`, cached to `weather_forecasts` table (12h TTL)
```

Commit.

### Task 15.4: Update bible 07_SPECIALIZED_FEATURES.md

Add section on the project workspace pattern as a reusable template for future entity workspaces (client workspace, estimate workspace, invoice workspace).

Commit.

---

## PHASE 16 — Verification & Ship

### Task 16.1: Full type-check + lint + test

```bash
npm run type-check
npm run lint
npm test
npm run test:e2e
```

All clean.

### Task 16.2: Dev server visual verification

```bash
npm run dev
```

In a real browser:
- Sign in
- Open a project → verify viewing mode matches handoff
- Click EDIT → verify all tabs render
- Click CREATE NEW → verify creating flow
- Test drag, resize, traffic lights
- Test reduced-motion (browser settings → reduce motion)
- Test on a smaller viewport (1280×800) — window should still fit
- Test with no internet (Mapbox should show offline state, weather should fall back to cached)

### Task 16.3: Commit + push + PR

```bash
git push -u origin feature/project-workspace-modal
gh pr create --title "feat: unified project workspace modal" --body "$(cat <<'EOF'
## Summary
- Single mode-aware ProjectWorkspace replaces 5 legacy surfaces (project-detail-modal, project-detail-sheet, create-project-modal, edit-project-modal, project-detail-popover)
- Real Mapbox GL JS hero with compact + expanded states
- Real activity timeline wired to `activities` table with composer (note + photo + mention)
- Real accounting pipeline + ledger from estimates/invoices/payments/expenses
- Real Open-Meteo weather (12h cache)
- Notifications dispatched on every action

## Database changes
- 5 new migrations: project site metadata, project_tags, lat/lng on clients & opportunities, activity attachments, weather_forecasts cache, project_pipeline_summary RPC

## Test plan
- [ ] Open project from spreadsheet — workspace matches handoff
- [ ] Create new project end-to-end → verify activity entry
- [ ] Edit project → verify SAVE dispatches notification
- [ ] Map expand/collapse
- [ ] Quick actions rail
- [ ] Drag + resize + position persistence
- [ ] Reduced-motion fallbacks
- [ ] i18n EN + ES
- [ ] All unit + integration + E2E green
EOF
)"
```

### Task 16.4: Save patterns to design system

Run `interface-design`'s save-patterns flow if any new reusable atoms were created (Cake atom variants, Mode pill, traffic-light pattern, mode-aware footer pattern). Update `OPS-Web/.interface-design/system.md` with:

```markdown
### Project Workspace Patterns

- Mode pill: VIEWING (quiet) / EDITING (tan + pulse) / CREATING (accent + pulse). Pulse = 1.6s opacity 1↔0.45.
- Mode-aware footer: { destructive | meta | spacer | secondary[] | ghost | primary }. Only one primary per footer.
- Floating window shell: 8-direction resize, traffic lights, draggable header. Position+size persist to `opsWin:{key}`.
- Status temperature drives chrome: pin glow, schedule strip today-tick, active task highlight.
```

Commit.

---

## In Scope — Ships Complete

Per OPS perfection standard, every feature listed below ships in this PR:
- ✅ All 3 modes (viewing / editing / creating)
- ✅ Real Mapbox in both compact + expanded states
- ✅ Real lat/lng backfill for all 141 existing projects via geocoding script
- ✅ Unified `project_notes` timeline (notes + system events via `event_kind`) — Activity tab
- ✅ Real accounting pipeline + ledger from estimates/invoices/payments/expenses
- ✅ Flat team display with task-type assignment labels (Team section in sidebar + Details tab)
- ✅ Real Open-Meteo weather (12h cache via `weather_forecasts` table)
- ✅ Real notifications dispatched on project create/save/archive + status change + @mention
- ✅ Photo upload + attachments (via existing `<NoteComposer>` + cross-post to gallery)
- ✅ Visibility (portal exposure flag)
- ✅ Always-on sidebar: Health · Client · Location · Team · Dates · Weather · Linked Records
- ✅ Inline editing in sidebar (Client, Location, Dates) matching existing detail-page UX
- ✅ All deletions of legacy surfaces (`project-detail-modal`, `project-detail-sheet`, `create-project-modal`, `edit-project-modal`, `project-detail-popover`, `[id]/page.tsx` content)
- ✅ Notification deep-linking (`?openProject={id}&mode=view`)
- ✅ Spanish translations via `project-workspace.json` dictionary
- ✅ Bible updates (`03_DATA_ARCHITECTURE.md`, `05_DESIGN_SYSTEM.md`, `OPS-Web/CLAUDE.md`)
- ✅ Full test coverage (unit + integration + E2E + visual)
- ✅ Reduced-motion fallbacks for every animation
- ✅ Mode pill pulse + map expand transition + tab underline slide + timeline stagger + today-tick glow + hover transitions
- ✅ iOS sync compatibility — every schema change is additive (nullable column, new table)
- ✅ Permission gating throughout (mode transitions, financial tab, archive, delete) via `usePermissionStore`
- ✅ Feature flag passthrough (Phase C Suggest Tasks etc.) preserved

## Cut from MVP Scope

Dropped during design + architecture review (2026-05-06 / 2026-05-07). These were in the handoff but don't fit OPS:

**From the original site-metadata cut (2026-05-06):**
- ❌ User-picked project color — status hex drives all chrome
- ❌ Per-project `scope` field — use existing `description`
- ❌ Gate code, parking, pets, power, hazards (site_conditions JSONB)
- ❌ `site_notes` field
- ❌ Buffer days (would be derived from task scheduling, not stored)
- ❌ Project tags + tag assignments
- ❌ SITE card on the Details tab — address already shown on map + title bar
- ❌ ColorSwatchPicker atom + ReadGrid/ReadField atoms

**From the architecture review (2026-05-07):**
- ❌ Project Manager (PM) concept — OPS has no PM role; team is flat
- ❌ Subcontractor concept — OPS has no `subcontractor` user_type
- ❌ `project_team_members.role` migration — table is empty/derivative; team is computed from tasks
- ❌ "PM big card + crew row" structure on Details tab — replaced with single flat Team section
- ❌ PeopleTab in editing/creating — team is computed from task assignments, edited via Tasks tab
- ❌ ContextTab — already cut; description lives on Identity tab
- ❌ PersonPicker component — no PeopleTab needs it
- ❌ Toggleable right rail with QUICK ACTIONS button — replaced with always-on sidebar; FAB handles those actions
- ❌ Quick Actions section content (new estimate, new invoice, etc.) — duplicates FAB
- ❌ Dedicated Activity table consolidation — `project_notes` is iOS-canonical and stays primary; `activities` table writes from new code stop, table preserved for historical/audit until next iOS release
- ❌ Tag icon in note composer — out of scope, requires schema decision

**Edit/Create tab count:** 4 (handoff) → 3 (after first cut) → **2** (after architecture review). Final: IDENTITY · SCHEDULE.

---

## Plan complete

Save as: `docs/plans/2026-05-06-project-workspace-modal-implementation.md`

**Execution: subagent-driven from this session.** Each task block becomes one subagent dispatch with TDD discipline and code review between tasks.
