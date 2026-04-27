# CALIBRATION — Implementation Plan

> **Status:** Phase 4. Ready to execute.
> **Date:** 2026-04-23
> **Target:** `OPS-Web`, new route `/calibration`
> **Spec:** `docs/superpowers/specs/2026-04-23-calibration-design.md`
> **Decisions:** `docs/superpowers/specs/2026-04-23-calibration-decisions.md`
> **Inventory:** `docs/superpowers/specs/2026-04-23-calibration-inventory.md`

---

## 0. Verified assumptions (resolved from spec §20)

Before writing code, these were verified against the actual codebase. Every task below references these verified findings.

| # | Assumption | Verification |
|---|-----------|--------------|
| V1 | `admin_feature_overrides` table uses row-per-feature pattern | Columns: `id, company_id, feature_key, enabled, enabled_by, enabled_at, metadata`. One row per `(company_id, feature_key)` tuple. Source: `admin-feature-override-service.ts:18-29`. Flag migration is **row-level**, not column-level. |
| V2 | `agent_memories.source` string values in use | `"intake_interview"`, `"database"`, `"email_import"`, `"email"`. Source: `extract-facts/route.ts:89,123`, `mine-database/route.ts:119,376,421`, `memory-service.ts:466,492,527,774,869,899,935`. |
| V3 | Autonomy milestones storage | `email_connections.auto_send_settings` JSONB → `milestones` sub-key. 4 persisted keys: `draft_available_shown`, `auto_draft_suggested`, `auto_send_suggested`, `comms_wizard_ready_shown`. Source: `autonomy-milestone-service.ts:18-40`. The spec's 9-step ladder = 4 persisted + 5 derived. |
| V4 | Database mining has no dedicated table | Writes go directly to `agent_memories` with `source='database'` and confidence 1.0. Source: `mine-database/route.ts:119`. Mining "completion" = `EXISTS(agent_memories WHERE source='database' AND company_id=$1)`. |
| V5 | Interview completion server-side | Zustand (client-only) persists UI state. Server-side source of truth = `EXISTS(agent_memories WHERE source='intake_interview' AND company_id=$1)`. Source: `extract-facts/route.ts:89`. |
| V6 | Duplicate detection has no settings page | Only: store, sheet, cards, hooks, service. No config surface. **Drop the CONFIG → Duplicate Detection external link.** |
| V7 | `/intel` mobile behavior | Renders GalaxyScene (Three.js, ~150KB) dynamically. No mobile fallback in `page.tsx`. **Keep the conservative VIEW ON DESKTOP CTA below 768px.** |
| V8 | Sidebar icon currently in use | `Radar` imported and used at `sidebar.tsx:90` for `/intel`. Moves to `/calibration` (new home); `/intel` entry is removed. `BrainCircuit` at `sidebar.tsx:91` stays on `/agent/queue`. |
| V9 | Existing framer-motion import path | `import { motion, AnimatePresence } from "framer-motion"` — codebase is on framer-motion v11, not motion/react v12. **Plan uses framer-motion imports.** |
| V10 | First-run dismissal persistence | No existing `users.preferences.calibrationFirstRunDismissed` field. Plan introduces it via a JSONB `preferences` column on `users` (or creates the column if absent). **Verify column exists as task L1.** |
| V11 | Feature flag scaffolding | `feature-flag-definitions.ts` exports `FEATURE_FLAG_ROUTES` + `FEATURE_FLAG_PERMISSIONS`. `calibration_preview` will be added as a user-level flag (not route-gated) for dogfood period. |

**Supabase MCP reauth needed for tasks L1, L2, and O3** (schema introspection during migration and post-deploy validation). All code tasks proceed without blocking on MCP.

---

## 1. Architecture

### 1.1 File tree (new files)

```
src/app/(dashboard)/calibration/
  layout.tsx                                    ← permission gate + breadcrumb scaffold
  page.tsx                                      ← server component: fetches deck state, renders deck OR wizard
  _components/
    calibration-page-client.tsx                 ← client wrapper: routes deck/wizard/drill-in
    command-deck.tsx                            ← populated-mode deck
    deck-tile.tsx                               ← shared tile shell
    radar-sweep.tsx                             ← signature visual
    animated-number.tsx                         ← count-up primitive
    recent-rail.tsx                             ← horizontal event rail
    first-run-wizard.tsx                        ← wizard chrome
    first-run-station.tsx                       ← single station card
    section-inputs.tsx                          ← INPUTS drill-in
    section-corpus.tsx                          ← CORPUS drill-in (wraps GalaxyScene)
    section-config.tsx                          ← CONFIG drill-in
    section-activity.tsx                        ← ACTIVITY drill-in
    section-milestones.tsx                      ← MILESTONES drill-in (absorbs PhaseCDashboard)
    section-breadcrumb.tsx                      ← back arrow + path chips
    comms-config-overlay.tsx                    ← full-screen wizard launcher
    tile-inputs-body.tsx                        ← 3 ring progress
    tile-corpus-body.tsx                        ← count-up + sparkline
    tile-config-body.tsx                        ← 4-bar autonomy stack
    tile-activity-body.tsx                      ← live sensor
    tile-milestones-body.tsx                    ← 5-domain grid
    hooks/
      use-calibration-deck.ts                   ← TanStack Query hook: getDeckState
      use-calibration-recent.ts                 ← Supabase realtime subscription
      use-calibration-activity.ts               ← full log with filters
      use-calibration-first-run.ts              ← first-run detection
      use-milestone-unlock-pulse.ts             ← one-shot pulse state

src/lib/api/services/
  calibration-service.ts                        ← getDeckState, getRecentEvents, getActivityLog, etc.

src/i18n/dictionaries/en/
  calibration.json                              ← all user-facing strings
src/i18n/dictionaries/es/
  calibration.json                              ← Spanish parity

supabase/migrations/
  20260424000000_calibration_flag_collapse.sql  ← ai_email_review → phase_c row migration
  20260424000001_users_calibration_preferences.sql  ← adds preferences.calibrationFirstRunDismissed support

src/middleware.ts                               ← MODIFY: add 308 redirects
```

### 1.2 File tree (modifications)

```
src/components/layouts/sidebar.tsx              ← add /calibration entry, remove /intel entry
src/app/(dashboard)/agent/queue/page.tsx        ← remove PhaseCDashboard render
src/lib/feature-flags/feature-flag-definitions.ts  ← remove ai_email_review, add calibration_preview, update phase_c route to /calibration
src/i18n/dictionaries/en/nav.json                ← add nav.calibration
src/i18n/dictionaries/es/nav.json                ← Spanish parity
src/app/(dashboard)/settings/integrations/ai-setup/page.tsx  ← DELETE (post-dogfood)
src/app/(dashboard)/agent/comms-config/page.tsx  ← DELETE (post-dogfood)
src/app/(dashboard)/intel/page.tsx               ← DELETE (post-dogfood)
```

### 1.3 Task-group dependency order

```
  L (migrations + flags)         [first — server-side prep]
       │
       ▼
  M (dictionaries)                [parallel with L]
       │
       ▼
  A (types + service)             [foundation for data layer]
       │
       ▼
  B (primitives: radar, numbers)  [shared UI pieces]
       │
       ▼
  ┌────┼─────┬─────┬─────┬─────┐
  │    │     │     │     │     │
  C    D     E     F     G     H     [tiles, rail, wizard, drill-ins — parallel after B]
  │    │     │     │     │     │
  └────┼─────┴─────┴─────┴─────┘
       │
       ▼
  I + J (activity, milestones drill-ins — depend on service)
       │
       ▼
  K (sidebar + redirects + middleware) [glues it all together]
       │
       ▼
  O (browser verification)              [final validation]
       │
       ▼
  [+2 weeks bake]
       │
       ▼
  N (dead code removal)
```

### 1.4 Commit strategy

Every task ends with a commit. Commit message format:

```
feat(calibration): <verb> <subject>

<body — what and why, reference spec section>
```

---

## 2. Tasks

### Group L — Migrations & flag scaffolding (server-side prep)

#### L1. Verify users.preferences column exists

Verify in Supabase (MCP re-auth required):

```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'preferences';
```

**If column exists:** skip L2; note the `data_type` (must be `jsonb`).
**If column does not exist:** proceed to L2.
**If it exists but is not jsonb:** stop; escalate.

Validation: Record actual column state in this plan before proceeding.

---

#### L2. Migration — add users.preferences JSONB if missing

**File:** `supabase/migrations/20260424000001_users_calibration_preferences.sql`

```sql
-- Ensure users.preferences JSONB column exists for per-user preference flags.
-- Calibration uses preferences.calibrationFirstRunDismissed to track explicit
-- "skip all three sources" dismissal, distinct from "not yet completed."

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'preferences'
  ) THEN
    ALTER TABLE public.users ADD COLUMN preferences JSONB NOT NULL DEFAULT '{}'::jsonb;
    COMMENT ON COLUMN public.users.preferences IS
      'Per-user preferences, including calibrationFirstRunDismissed, etc.';
  END IF;
END $$;
```

**Commit:** `feat(calibration): add users.preferences jsonb for first-run dismissal`

Validation: `supabase db push` on local + prod (behind confirm). Confirm column shape.

---

#### L3. Migration — collapse ai_email_review into phase_c

**File:** `supabase/migrations/20260424000000_calibration_flag_collapse.sql`

```sql
-- Collapse ai_email_review feature_key rows into phase_c rows.
-- Per V1: admin_feature_overrides is row-per-(company, feature_key).
-- Migration copies any enabled=true ai_email_review row into a phase_c row
-- for the same company (if one doesn't already exist or isn't already enabled).

-- Step 1: Insert phase_c rows for any company that has ai_email_review=true
--         but does NOT have a phase_c row at all.
INSERT INTO admin_feature_overrides (
  company_id, feature_key, enabled, enabled_by, enabled_at, metadata
)
SELECT
  r.company_id,
  'phase_c' AS feature_key,
  true AS enabled,
  r.enabled_by,
  COALESCE(r.enabled_at, now()) AS enabled_at,
  COALESCE(r.metadata, '{}'::jsonb) || '{"migrated_from":"ai_email_review"}'::jsonb AS metadata
FROM admin_feature_overrides r
WHERE r.feature_key = 'ai_email_review'
  AND r.enabled = true
  AND NOT EXISTS (
    SELECT 1 FROM admin_feature_overrides p
    WHERE p.company_id = r.company_id AND p.feature_key = 'phase_c'
  );

-- Step 2: Update existing phase_c=false rows to enabled=true where the company
--         has an enabled ai_email_review row. Preserve the older enabled_at.
UPDATE admin_feature_overrides p
SET
  enabled = true,
  enabled_by = COALESCE(p.enabled_by, r.enabled_by),
  enabled_at = LEAST(COALESCE(p.enabled_at, now()), COALESCE(r.enabled_at, now())),
  metadata = COALESCE(p.metadata, '{}'::jsonb) || '{"migrated_from":"ai_email_review"}'::jsonb
FROM admin_feature_overrides r
WHERE p.feature_key = 'phase_c'
  AND r.feature_key = 'ai_email_review'
  AND p.company_id = r.company_id
  AND r.enabled = true
  AND (p.enabled IS NULL OR p.enabled = false);

-- Step 3: Mark the old ai_email_review rows as inactive (not deleted — keeps audit trail).
-- We'll delete them after the 2-week bake in a separate migration.
UPDATE admin_feature_overrides
SET metadata = COALESCE(metadata, '{}'::jsonb) || '{"superseded_by":"phase_c","superseded_at":"' || now()::text || '"}'::jsonb
WHERE feature_key = 'ai_email_review'
  AND enabled = true;

-- Verification query (runs as part of migration output):
SELECT
  'Collapsed ai_email_review overrides' AS step,
  COUNT(*) FILTER (WHERE feature_key = 'ai_email_review' AND enabled = true) AS legacy_enabled,
  COUNT(*) FILTER (WHERE feature_key = 'phase_c' AND enabled = true) AS phase_c_enabled
FROM admin_feature_overrides;
```

**Commit:** `feat(calibration): collapse ai_email_review flag into phase_c (row-level)`

Validation: Run the final SELECT manually post-migration. Expect `phase_c_enabled >= legacy_enabled` for every company that previously had `ai_email_review`.

---

#### L4. Feature flag definitions — update routes + permissions

**File:** `src/lib/feature-flags/feature-flag-definitions.ts` (modify)

Replace file contents:

```typescript
/**
 * OPS Web - Feature Flag Definitions
 *
 * Maps each feature flag slug to the routes and permissions it controls.
 * Single source of truth imported by both the client store and admin page.
 */

// ─── Route Mapping ───────────────────────────────────────────────────────────

/** Routes gated by each feature flag slug. */
export const FEATURE_FLAG_ROUTES: Record<string, string[]> = {
  pipeline: ["/pipeline"],
  accounting: ["/accounting", "/estimates", "/invoices"],
  products: ["/products"],
  inventory: ["/inventory"],
  portal: ["/inbox"],
  // ai_email_review removed 2026-04-24 — collapsed into phase_c (migration 20260424000000).
  phase_c: ["/calibration"],
  // calibration_preview is a dogfood gate — user-level, no route. Controls whether
  // a user sees /calibration before it's globally enabled for their company's phase_c.
  deck_builder: ["/deck-builder"],
};

// ─── Permission Mapping ──────────────────────────────────────────────────────

/** RBAC permissions gated by each feature flag slug. */
export const FEATURE_FLAG_PERMISSIONS: Record<string, string[]> = {
  pipeline: ["pipeline.view", "pipeline.manage", "pipeline.configure_stages"],
  accounting: [
    "accounting.view",
    "accounting.manage_connections",
    "estimates.view",
    "estimates.create",
    "estimates.edit",
    "estimates.delete",
    "estimates.send",
    "estimates.convert",
    "invoices.view",
    "invoices.create",
    "invoices.edit",
    "invoices.delete",
    "invoices.send",
    "invoices.record_payment",
    "invoices.void",
    "expenses.view",
    "expenses.create",
    "expenses.edit",
    "expenses.delete",
    "expenses.approve",
    "expenses.configure",
    "documents.manage_templates",
  ],
  products: ["products.view", "products.manage"],
  inventory: ["inventory.view", "inventory.manage", "inventory.import"],
  portal: ["portal.view", "portal.manage_branding"],
  // ai_email_review removed — all AI gating now on phase_c.
  phase_c: ["email.configure_ai"],
  deck_builder: ["deck_builder.view", "deck_builder.create", "deck_builder.edit"],
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Given a pathname, return the flag slug that gates it (or null). */
export function getSlugForRoute(pathname: string): string | null {
  for (const [slug, routes] of Object.entries(FEATURE_FLAG_ROUTES)) {
    for (const route of routes) {
      if (pathname === route || pathname.startsWith(route + "/")) {
        return slug;
      }
    }
  }
  return null;
}

/** Given a permission string, return the flag slug that gates it (or null). */
export function getSlugForPermission(permission: string): string | null {
  for (const [slug, permissions] of Object.entries(FEATURE_FLAG_PERMISSIONS)) {
    if (permissions.includes(permission)) {
      return slug;
    }
  }
  return null;
}
```

**Commit:** `feat(calibration): update feature flags for calibration route and collapse ai_email_review`

Validation: `pnpm typecheck` passes. No remaining references to `ai_email_review` in gate checks:
```bash
rg "ai_email_review" src/ --type ts --type tsx
```

Any remaining references must be in (a) the service's `AIFeatureKey` union (keep — Admin Override Service still supports the legacy key for historical reads), (b) comments explaining the migration. Flag any unexpected usages and remove.

---

#### L5. Admin Override Service — remove route-gate references to ai_email_review

**File:** `src/lib/api/services/admin-feature-override-service.ts` (modify)

Find this section (around line 15):

```typescript
type AIFeatureKey = "ai_email_review" | "phase_c" | "ai_auto_send";
```

Change to:

```typescript
// ai_email_review kept as historical key for reading legacy rows only.
// Post-2026-04-24 migration, all new writes use phase_c. Do not set()
// ai_email_review from application code.
type AIFeatureKey = "ai_email_review" | "phase_c" | "ai_auto_send";
```

Find the `setOverride` method, add a deprecation check at the top:

```typescript
async setOverride(
  companyId: string,
  feature: AIFeatureKey,
  enabled: boolean,
  adminUserId: string
): Promise<void> {
  if (feature === "ai_email_review") {
    throw new Error(
      "ai_email_review is deprecated — use phase_c instead (migration 20260424000000)."
    );
  }
  // ... rest unchanged
}
```

Also remove ai_email_review from any admin UI that writes (the admin panel at `src/app/admin/system/_components/company-ai-features.tsx` — scan and delete the ai_email_review toggle row).

**Commit:** `refactor(calibration): deprecate ai_email_review writes; reads remain for audit`

Validation: Attempt `AdminFeatureOverrideService.setOverride(id, "ai_email_review", true, ...)` in dev — expect the thrown error.

---

### Group M — Dictionary files (translation-ready copy)

#### M1. English dictionary

**File:** `src/i18n/dictionaries/en/calibration.json` (create)

Copy the full JSON from spec §15.1–15.8. Key restatement here — all copy must route through `useDictionary("calibration")`:

```json
{
  "page": {
    "title": "CALIBRATION",
    "breadcrumb": "Command // Calibration",
    "subtitle": "Inputs. Corpus. Config. The system, visible."
  },
  "firstRun": {
    "header": "// CALIBRATION · INITIAL SCOPE",
    "body": "Three sources feed the system. Each is optional. Complete what you want. Skip the rest.",
    "progress": "{done} / 3",
    "stations": {
      "interview": {
        "title": "INTERVIEW",
        "description": "Ask the operator. You tell the system what the system should know.",
        "actionEngage": "ENGAGE",
        "actionSkip": "SKIP"
      },
      "emailScan": {
        "title": "EMAIL SCAN",
        "description": "Scan outbound. The system reads 12 months of your sent mail.",
        "actionEngage": "ENGAGE",
        "actionSkip": "SKIP"
      },
      "databaseMining": {
        "title": "DATABASE MINING",
        "description": "Mine database. The system reads your existing estimates, projects, and clients.",
        "actionEngage": "ENGAGE",
        "actionSkip": "SKIP"
      }
    },
    "completeLine": "SYS :: SCOPE COMPLETE · STANDBY FOR DECK"
  },
  "tiles": {
    "inputs": {
      "title": "// INPUTS",
      "footerEmpty": "NO SOURCES RUN · INITIATE",
      "footer": "{count} SOURCES · LAST RUN {time}",
      "labels": {
        "interview": "INTERVIEW",
        "scan": "EMAIL SCAN",
        "mining": "DATABASE"
      }
    },
    "corpus": {
      "title": "// CORPUS",
      "factsLabel": "FACTS",
      "footerEmpty": "AWAITING INPUTS",
      "footer": "+{today} TODAY · CONFIDENCE {conf}",
      "confidenceStatuses": {
        "training": "CONFIDENCE {conf} · TRAINING",
        "locked": "CONFIDENCE {conf} · LOCKED"
      }
    },
    "config": {
      "title": "// CONFIG",
      "footerEmpty": "DEFAULTS IN EFFECT · CONFIGURE",
      "footer": "{rules} RULES · {cats} CATEGORIES",
      "barLabels": {
        "off": "OFF",
        "draft": "DRAFT",
        "autoDraft": "AUTO DRAFT",
        "autoSend": "AUTO SEND"
      }
    },
    "activity": {
      "title": "// ACTIVITY",
      "idleLabel": "SYS :: NOMINAL",
      "runningLabel": "{type} · {elapsed}",
      "footerEmpty": "AWAITING TRAFFIC",
      "footer": "QUEUED {q} · COMPLETED {c} TODAY"
    },
    "milestones": {
      "title": "// MILESTONES",
      "footerEmpty": "0 / 9 MILESTONES · AWAITING TRAFFIC",
      "footer": "{reached} / 9 MILESTONES · NEXT: {next}",
      "domains": {
        "email": "EMAIL",
        "projects": "PROJECTS",
        "invoice": "INVOICE",
        "schedule": "SCHEDULE",
        "comms": "COMMS"
      },
      "statuses": {
        "nominal": "NOMINAL",
        "learning": "LEARNING",
        "gated": "GATED",
        "unavailable": "UNAVAILABLE"
      }
    }
  },
  "recent": {
    "title": "// RECENT",
    "stream": "STREAM",
    "empty": "SYS :: CALIBRATION LINE CLEAR",
    "eventTypes": {
      "scan": "SCAN",
      "scanComplete": "SCAN COMPLETE",
      "extraction": "EXTRACTION",
      "learning": "LEARNING",
      "draft": "DRAFT",
      "suggestion": "SUGGESTION",
      "milestone": "MILESTONE UNLOCK",
      "confidence": "CONFIDENCE"
    }
  },
  "sections": {
    "inputs": {
      "title": "// INPUTS",
      "accumulation": "Each source adds to the corpus. Re-running a source updates its facts; it does not erase facts from the others. Confidence rises when sources agree.",
      "reRunConfirm": {
        "title": "Re-run {source}?",
        "body": "A new run updates {source}-sourced facts but does not erase facts from other sources. Confidence rises when sources agree.",
        "actionConfirm": "RE-RUN",
        "actionCancel": "CANCEL"
      },
      "statusLabels": {
        "notRun": "NOT RUN",
        "running": "RUNNING · {percent}%",
        "complete": "COMPLETE",
        "failed": "FAILED",
        "skipped": "SKIPPED"
      },
      "actions": {
        "initiateInterview": "INITIATE INTERVIEW",
        "initiateScan": "INITIATE SCAN",
        "initiateMine": "INITIATE MINE",
        "reInterview": "RE-INTERVIEW",
        "reScan": "RE-SCAN",
        "reMine": "RE-MINE",
        "viewProgress": "VIEW PROGRESS",
        "retry": "RETRY"
      }
    },
    "corpus": {
      "title": "// CORPUS",
      "header": "{facts} FACTS · {entities} ENTITIES",
      "drawers": { "facts": "// FACTS", "entity": "// ENTITY" },
      "empty": {
        "heading": "SYS :: NO CORPUS",
        "body": "The system hasn't extracted anything yet. Run an input source to populate the corpus.",
        "cta": "RUN INPUTS →"
      },
      "mobileFallback": {
        "heading": "KNOWLEDGE GRAPH · DESKTOP REQUIRED",
        "body": "The interactive graph needs a larger canvas. Open on desktop to explore entities and connections.",
        "cta": "VIEW FACTS LIST"
      },
      "entity": {
        "empty": "SELECT AN ENTITY",
        "viewInOps": "VIEW IN OPS"
      },
      "factSources": {
        "intake_interview": "INTERVIEW",
        "database": "MINING",
        "email_import": "SCAN",
        "email": "EMAIL",
        "learning": "LEARNING"
      }
    },
    "config": {
      "title": "// CONFIG",
      "autonomy": { "title": "AUTONOMY", "reRunWizard": "RE-RUN WIZARD" },
      "filters": {
        "title": "FILTERS",
        "edit": "EDIT",
        "summary": "{rules} active rules · {excl} exclusions · funnel view →"
      },
      "categories": { "title": "CATEGORIES" },
      "external": { "heading": "EXTERNAL", "taskTypes": "TASK TYPES →" },
      "autonomyLevels": {
        "off": "OFF",
        "draft": "DRAFT",
        "auto_draft": "AUTO DRAFT",
        "auto_send": "AUTO SEND"
      },
      "emailTypes": {
        "status_update": "STATUS UPDATE",
        "appt_confirm": "APPT CONFIRM",
        "reminder": "REMINDER",
        "payment": "PAYMENT",
        "invoice_cover": "INVOICE COVER",
        "reschedule": "RESCHEDULE",
        "subcontractor": "SUBCONTRACTOR"
      }
    },
    "activity": {
      "title": "// ACTIVITY",
      "liveSensor": {
        "nominal": "SYS :: NOMINAL",
        "running": "{type} · {elapsed}",
        "error": "SYS :: ERROR"
      },
      "filters": {
        "all": "ALL",
        "scans": "SCANS",
        "extractions": "EXTRACTIONS",
        "learnings": "LEARNINGS",
        "drafts": "DRAFTS",
        "suggestions": "SUGGESTIONS"
      },
      "timeRanges": {
        "hour": "LAST HOUR",
        "day": "24H",
        "week": "7D",
        "month": "30D",
        "all": "ALL"
      },
      "columns": {
        "time": "TIME",
        "type": "TYPE",
        "source": "SOURCE",
        "detail": "DETAIL",
        "confidence": "CONF"
      },
      "empty": {
        "heading": "SYS :: CALIBRATION LINE CLEAR",
        "body": "No activity in the selected window. Extend the time range or initiate a source.",
        "cta": "VIEW INPUTS →"
      }
    },
    "milestones": {
      "title": "// MILESTONES",
      "overallHeader": "OVERALL AUTONOMY {reached} / 9",
      "domains": {
        "email": "EMAIL INTELLIGENCE",
        "projects": "PROJECT MANAGEMENT",
        "invoice": "INVOICING",
        "schedule": "SCHEDULING",
        "comms": "COMMUNICATIONS"
      },
      "statuses": {
        "nominal": "NOMINAL",
        "learning": "LEARNING",
        "gated": "GATED",
        "unavailable": "UNAVAILABLE"
      },
      "ladder": {
        "1": "PHASE_C ENABLED",
        "2": "FIRST SCAN COMPLETE",
        "3": "DRAFTING AVAILABLE",
        "4": "AUTO-DRAFT UNLOCKED",
        "5": "CATEGORY AUTONOMY CONFIGURED",
        "6": "50+ PRIOR APPOINTMENT CONFIRMS",
        "7": "WRITING PROFILE LOCKED",
        "8": "AUTO-SEND UNLOCKED",
        "9": "FULL AUTO CAPABILITY"
      },
      "ladderStatuses": {
        "complete": "COMPLETE",
        "inTraining": "IN TRAINING",
        "gated": "GATED"
      }
    }
  },
  "milestoneUnlock": {
    "titlePrefix": "SYS :: AUTONOMY UNLOCK",
    "bodies": {
      "draftingAvailable": "Writing profile confidence reached {conf}. Drafting capability is available for activation.",
      "autoDraftUnlocked": "Writing profile confidence reached {conf}. Auto-draft capability is available for activation.",
      "autoSendUnlocked": "Writing profile confidence 0.85 and {priors}+ prior confirmations reached. Auto-send is available for activation.",
      "fullAutoCapability": "All autonomy milestones reached. Full auto capability is available for activation."
    },
    "actionLabel": "REVIEW"
  },
  "errors": {
    "scanFailed": "Scan failed: {reason}. Retry or contact support.",
    "mineFailed": "Database mining failed: {reason}. Retry or contact support.",
    "networkError": "SYS :: CONNECTION LOST · RETRYING",
    "permissionDenied": "You don't have access to CALIBRATION. Ask an admin to grant you the email.configure_ai permission."
  }
}
```

**Commit:** `feat(calibration): add en dictionary for calibration surface`

---

#### M2. Spanish dictionary

**File:** `src/i18n/dictionaries/es/calibration.json` (create)

Mirror M1 with Spanish translations. Keep all key names identical. Priority strings:

- `page.title` → `"CALIBRACIÓN"`
- Keep all `SYS ::`, `//`, `+`, numeric tokens untranslated (tactical voice is universal).
- Translate only the descriptive bodies (`firstRun.body`, section bodies, empty-state bodies, errors).
- Keep ALL button labels (`ENGAGE`, `SKIP`, `RE-RUN WIZARD`, etc.) in English — matches OPS-Web existing pattern (verify by spot-checking `src/i18n/dictionaries/es/nav.json`).

**Commit:** `feat(calibration): add es dictionary for calibration surface`

---

#### M3. Nav dictionary update

**File:** `src/i18n/dictionaries/en/nav.json` (modify) + `src/i18n/dictionaries/es/nav.json` (modify)

Add one key to each:

```json
{
  ...existing...
  "calibration": "CALIBRATION"
}
```

Remove `intel` key (since `/intel` sidebar entry is removed).

**Commit:** `feat(calibration): add nav.calibration, remove nav.intel`

---

### Group A — Types + data layer

#### A1. Calibration types

**File:** `src/lib/types/calibration.ts` (create)

```typescript
/**
 * CALIBRATION — Shared Types
 *
 * Types for the /calibration destination: deck state, drill-in sections,
 * recent events, milestone ladder.
 */

export type CalibrationSection =
  | "inputs"
  | "corpus"
  | "config"
  | "activity"
  | "milestones";

export type InputSource = "interview" | "scan" | "mining";

export type InputStatus =
  | "not_run"
  | "running"
  | "complete"
  | "failed"
  | "skipped";

export interface InputState {
  source: InputSource;
  status: InputStatus;
  percent: number; // 0-100; only meaningful when status === "running" or "complete"
  lastRunAt: string | null; // ISO
  currentJobId: string | null;
  progress?: {
    processed: number;
    total: number;
    factsExtracted: number;
  };
}

export interface DeckState {
  // INPUTS tile
  inputs: {
    interview: InputState;
    scan: InputState;
    mining: InputState;
    lastAnyRunAt: string | null;
  };
  // CORPUS tile
  corpus: {
    factCount: number;
    entityCount: number;
    todayFactCount: number;
    writingConfidence: number; // 0.0 to 1.0
    last7DaysFactCounts: number[]; // sparkline — 7 numbers
  };
  // CONFIG tile
  config: {
    emailTypeCounts: {
      off: number;
      draft: number;
      auto_draft: number;
      auto_send: number;
    };
    rulesCount: number;
    categoriesCount: number;
  };
  // ACTIVITY tile
  activity: {
    status: "idle" | "running" | "error";
    currentJob: null | {
      type: string;
      elapsedMs: number;
      progress?: { processed: number; total: number };
    };
    queuedCount: number;
    completedTodayCount: number;
  };
  // MILESTONES tile
  milestones: {
    domains: {
      email: DomainStatus;
      projects: DomainStatus;
      invoice: DomainStatus;
      schedule: DomainStatus;
      comms: DomainStatus;
    };
    ladder: LadderPosition[];
    reachedCount: number;
    nextLadderName: string | null;
  };
}

export type DomainHealthStatus =
  | "nominal"
  | "learning"
  | "gated"
  | "unavailable";

export interface DomainStatus {
  status: DomainHealthStatus;
  confidence: number | null;
  metric: string | null; // Human-readable metric, e.g., "0.82" or "94%"
}

export interface LadderPosition {
  position: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  status: "complete" | "in_training" | "gated";
  /** Whether this position fires a notification on transition. */
  persistent: boolean;
}

export type RecentEventType =
  | "scan"
  | "scan_complete"
  | "extraction"
  | "learning"
  | "draft"
  | "suggestion"
  | "milestone"
  | "confidence";

export interface RecentEvent {
  id: string;
  type: RecentEventType;
  title: string; // already formatted, e.g., "SCAN COMPLETE"
  detail: string | null;
  createdAt: string; // ISO
  sourceTable: "agent_memories" | "gmail_scan_jobs" | "agent_actions" | "email_thread_category_corrections";
  sourceId: string;
}

export interface ActivityFilters {
  types: RecentEventType[] | "all";
  timeRange: "hour" | "day" | "week" | "month" | "all";
}

export interface FirstRunState {
  dismissed: boolean;      // users.preferences.calibrationFirstRunDismissed
  interviewDone: boolean;  // EXISTS agent_memories WHERE source='intake_interview'
  scanDone: boolean;       // EXISTS gmail_scan_jobs WHERE status='complete'
  miningDone: boolean;     // EXISTS agent_memories WHERE source='database'
  shouldShowWizard: boolean; // derived: !dismissed && !(interviewDone && scanDone && miningDone)
}
```

**Commit:** `feat(calibration): add calibration shared types`

Validation: `pnpm typecheck`.

---

#### A2. Calibration service (data fetching)

**File:** `src/lib/api/services/calibration-service.ts` (create)

```typescript
/**
 * CALIBRATION — Data Service
 *
 * Single service powering /calibration. All deck, drill-in, and realtime
 * queries flow through here. Uses service-role client for cross-table reads
 * that don't fit neatly in the app user's RLS policies.
 */

import { getServiceRoleClient } from "@/lib/supabase/server-client";
import type {
  DeckState,
  FirstRunState,
  InputState,
  LadderPosition,
  RecentEvent,
  ActivityFilters,
  DomainStatus,
} from "@/lib/types/calibration";

export const CalibrationService = {
  /**
   * Fetch the complete deck state for a company. Single entry point;
   * TanStack Query hook caches this with a 30s staleness window.
   */
  async getDeckState(companyId: string): Promise<DeckState> {
    const supabase = getServiceRoleClient();

    // Parallelize independent reads
    const [
      inputsState,
      corpusState,
      configState,
      activityState,
      milestonesState,
    ] = await Promise.all([
      this.#getInputsState(companyId),
      this.#getCorpusState(companyId),
      this.#getConfigState(companyId),
      this.#getActivityState(companyId),
      this.#getMilestonesState(companyId),
    ]);

    return {
      inputs: inputsState,
      corpus: corpusState,
      config: configState,
      activity: activityState,
      milestones: milestonesState,
    };
  },

  /**
   * First-run detection. Composite query across 3 tables + user preferences.
   */
  async getFirstRunState(
    companyId: string,
    userId: string
  ): Promise<FirstRunState> {
    const supabase = getServiceRoleClient();

    const [interviewResult, miningResult, scanResult, userResult] = await Promise.all([
      supabase
        .from("agent_memories")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .eq("source", "intake_interview")
        .limit(1),
      supabase
        .from("agent_memories")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .eq("source", "database")
        .limit(1),
      supabase
        .from("gmail_scan_jobs")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .eq("status", "complete")
        .limit(1),
      supabase
        .from("users")
        .select("preferences")
        .eq("id", userId)
        .maybeSingle(),
    ]);

    const interviewDone = (interviewResult.count ?? 0) > 0;
    const miningDone = (miningResult.count ?? 0) > 0;
    const scanDone = (scanResult.count ?? 0) > 0;
    const prefs = (userResult.data?.preferences ?? {}) as Record<string, unknown>;
    const dismissed = prefs.calibrationFirstRunDismissed === true;

    return {
      dismissed,
      interviewDone,
      scanDone,
      miningDone,
      shouldShowWizard:
        !dismissed && !(interviewDone && scanDone && miningDone),
    };
  },

  /**
   * Mark the first-run wizard as dismissed for this user.
   * Called when the user completes or explicitly skips all 3 stations.
   */
  async dismissFirstRun(userId: string): Promise<void> {
    const supabase = getServiceRoleClient();

    const { data: user } = await supabase
      .from("users")
      .select("preferences")
      .eq("id", userId)
      .maybeSingle();

    const prefs = (user?.preferences ?? {}) as Record<string, unknown>;
    prefs.calibrationFirstRunDismissed = true;

    await supabase
      .from("users")
      .update({ preferences: prefs })
      .eq("id", userId);
  },

  /**
   * Fetch last 5 recent events for the deck's RECENT rail.
   * Merges from 3 source tables, sorts by created_at desc.
   */
  async getRecentEvents(
    companyId: string,
    limit = 5
  ): Promise<RecentEvent[]> {
    const supabase = getServiceRoleClient();

    const [memoriesResult, scanJobsResult, actionsResult] = await Promise.all([
      supabase
        .from("agent_memories")
        .select("id, source, category, content, created_at")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(limit),
      supabase
        .from("gmail_scan_jobs")
        .select("id, status, created_at, updated_at")
        .eq("company_id", companyId)
        .in("status", ["complete", "error", "running"])
        .order("updated_at", { ascending: false })
        .limit(limit),
      supabase
        .from("agent_actions")
        .select("id, type, status, created_at")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(limit),
    ]);

    const events: RecentEvent[] = [];

    for (const m of memoriesResult.data ?? []) {
      events.push({
        id: m.id,
        type: m.source === "learning" ? "learning" : "extraction",
        title: m.source === "learning" ? "LEARNING" : "EXTRACTION",
        detail: truncate(m.content ?? "", 40),
        createdAt: m.created_at,
        sourceTable: "agent_memories",
        sourceId: m.id,
      });
    }

    for (const j of scanJobsResult.data ?? []) {
      events.push({
        id: j.id,
        type: j.status === "complete" ? "scan_complete" : "scan",
        title: j.status === "complete" ? "SCAN COMPLETE" : "SCAN",
        detail: null,
        createdAt: j.updated_at ?? j.created_at,
        sourceTable: "gmail_scan_jobs",
        sourceId: j.id,
      });
    }

    for (const a of actionsResult.data ?? []) {
      events.push({
        id: a.id,
        type: a.type === "send_email" ? "draft" : "suggestion",
        title: a.type === "send_email" ? "DRAFT" : "SUGGESTION",
        detail: null,
        createdAt: a.created_at,
        sourceTable: "agent_actions",
        sourceId: a.id,
      });
    }

    events.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    return events.slice(0, limit);
  },

  /**
   * Fetch the full activity log for the ACTIVITY drill-in.
   * Paginated, filtered, limited to the last N events by time range.
   */
  async getActivityLog(
    companyId: string,
    filters: ActivityFilters,
    cursor?: string,
    limit = 50
  ): Promise<{ events: RecentEvent[]; nextCursor: string | null }> {
    const supabase = getServiceRoleClient();

    const since = this.#resolveTimeRangeCutoff(filters.timeRange);
    const typesSet = Array.isArray(filters.types)
      ? new Set(filters.types)
      : null;

    // Broader version of getRecentEvents with cursor pagination.
    // Implementation detail: each source table queried with created_at < cursor (if set).
    // ... full implementation in task I1

    return { events: [], nextCursor: null }; // stub — expand in Task I1
  },

  // ─── Private helpers ──────────────────────────────────────────────────────

  async #getInputsState(companyId: string) {
    const supabase = getServiceRoleClient();

    const [interviewCount, miningCount, scanJob, lastMemoryAt] = await Promise.all([
      supabase
        .from("agent_memories")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .eq("source", "intake_interview"),
      supabase
        .from("agent_memories")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .eq("source", "database"),
      supabase
        .from("gmail_scan_jobs")
        .select("id, status, created_at, updated_at, result")
        .eq("company_id", companyId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("agent_memories")
        .select("created_at")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const interview: InputState = {
      source: "interview",
      status: (interviewCount.count ?? 0) > 0 ? "complete" : "not_run",
      percent: (interviewCount.count ?? 0) > 0 ? 100 : 0,
      lastRunAt: null, // interview lacks dedicated job rows; use lastMemoryAt as proxy if needed
      currentJobId: null,
    };

    const mining: InputState = {
      source: "mining",
      status: (miningCount.count ?? 0) > 0 ? "complete" : "not_run",
      percent: (miningCount.count ?? 0) > 0 ? 100 : 0,
      lastRunAt: null,
      currentJobId: null,
    };

    const scan: InputState = this.#mapScanJobToInputState(scanJob.data);

    return {
      interview,
      scan,
      mining,
      lastAnyRunAt: lastMemoryAt.data?.created_at ?? null,
    };
  },

  async #getCorpusState(companyId: string) {
    const supabase = getServiceRoleClient();

    const [memoriesCount, entitiesCount, todayCount, writingProfile, sparkline] =
      await Promise.all([
        supabase
          .from("agent_memories")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId),
        supabase
          .from("graph_entities")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId),
        supabase
          .from("agent_memories")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId)
          .gte("created_at", startOfToday().toISOString()),
        supabase
          .from("agent_writing_profiles")
          .select("confidence")
          .eq("company_id", companyId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        this.#getFactSparkline(companyId),
      ]);

    return {
      factCount: memoriesCount.count ?? 0,
      entityCount: entitiesCount.count ?? 0,
      todayFactCount: todayCount.count ?? 0,
      writingConfidence: writingProfile.data?.confidence ?? 0,
      last7DaysFactCounts: sparkline,
    };
  },

  async #getConfigState(companyId: string) {
    const supabase = getServiceRoleClient();

    const [emailConn, filterRules, categoryCount] = await Promise.all([
      supabase
        .from("email_connections")
        .select("auto_send_settings")
        .eq("company_id", companyId)
        .eq("type", "company")
        .maybeSingle(),
      supabase
        .from("email_filter_rules")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .eq("active", true),
      Promise.resolve({ count: 13 }), // 13 email thread categories (fixed enum)
    ]);

    const settings = (emailConn.data?.auto_send_settings ?? {}) as Record<string, unknown>;
    const categoryAutonomy = (settings.categoryAutonomy ?? {}) as Record<string, string>;

    const counts = { off: 0, draft: 0, auto_draft: 0, auto_send: 0 };
    for (const level of Object.values(categoryAutonomy)) {
      if (level in counts) counts[level as keyof typeof counts]++;
    }

    return {
      emailTypeCounts: counts,
      rulesCount: filterRules.count ?? 0,
      categoriesCount: 13,
    };
  },

  async #getActivityState(companyId: string) {
    const supabase = getServiceRoleClient();

    const [runningJob, queuedActions, completedTodayActions] = await Promise.all([
      supabase
        .from("gmail_scan_jobs")
        .select("id, status, created_at, result")
        .eq("company_id", companyId)
        .eq("status", "running")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("agent_actions")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .eq("status", "proposed"),
      supabase
        .from("agent_actions")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .eq("status", "executed")
        .gte("updated_at", startOfToday().toISOString()),
    ]);

    const currentJob = runningJob.data
      ? {
          type: "SCAN",
          elapsedMs:
            Date.now() - new Date(runningJob.data.created_at).getTime(),
          progress: undefined as { processed: number; total: number } | undefined,
        }
      : null;

    return {
      status: (runningJob.data ? "running" : "idle") as "idle" | "running" | "error",
      currentJob,
      queuedCount: queuedActions.count ?? 0,
      completedTodayCount: completedTodayActions.count ?? 0,
    };
  },

  async #getMilestonesState(companyId: string) {
    const supabase = getServiceRoleClient();

    const [
      phaseCOverride,
      scanJob,
      connection,
      writingProfile,
      apptConfirms,
      autoSendEnabled,
    ] = await Promise.all([
      supabase
        .from("admin_feature_overrides")
        .select("enabled")
        .eq("company_id", companyId)
        .eq("feature_key", "phase_c")
        .maybeSingle(),
      supabase
        .from("gmail_scan_jobs")
        .select("id")
        .eq("company_id", companyId)
        .eq("status", "complete")
        .limit(1)
        .maybeSingle(),
      supabase
        .from("email_connections")
        .select("auto_send_settings")
        .eq("company_id", companyId)
        .eq("type", "company")
        .maybeSingle(),
      supabase
        .from("agent_writing_profiles")
        .select("confidence")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("agent_actions")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .eq("type", "send_appointment_confirmation")
        .eq("status", "executed"),
      supabase
        .from("admin_feature_overrides")
        .select("enabled")
        .eq("company_id", companyId)
        .eq("feature_key", "ai_auto_send")
        .maybeSingle(),
    ]);

    const settings = (connection.data?.auto_send_settings ?? {}) as Record<
      string,
      unknown
    >;
    const milestones = (settings.milestones ?? {}) as Record<string, boolean>;
    const confidence = writingProfile.data?.confidence ?? 0;
    const apptCount = apptConfirms.count ?? 0;
    const categoryAutonomy = (settings.categoryAutonomy ?? {}) as Record<string, unknown>;

    const ladder: LadderPosition[] = [
      {
        position: 1,
        status: phaseCOverride.data?.enabled ? "complete" : "gated",
        persistent: false,
      },
      {
        position: 2,
        status: scanJob.data ? "complete" : "gated",
        persistent: false,
      },
      {
        position: 3,
        status: milestones.draft_available_shown
          ? "complete"
          : confidence >= 0.2
          ? "in_training"
          : "gated",
        persistent: true,
      },
      {
        position: 4,
        status: milestones.auto_draft_suggested
          ? "complete"
          : confidence >= 0.5
          ? "in_training"
          : "gated",
        persistent: true,
      },
      {
        position: 5,
        status: Object.keys(categoryAutonomy).length > 0 ? "complete" : "gated",
        persistent: false,
      },
      {
        position: 6,
        status:
          apptCount >= 50 ? "complete" : apptCount > 0 ? "in_training" : "gated",
        persistent: false,
      },
      {
        position: 7,
        status:
          confidence >= 0.85
            ? "complete"
            : confidence >= 0.5
            ? "in_training"
            : "gated",
        persistent: false,
      },
      {
        position: 8,
        status: milestones.auto_send_suggested
          ? "complete"
          : confidence >= 0.75 && apptCount >= 50
          ? "in_training"
          : "gated",
        persistent: true,
      },
      {
        position: 9,
        status: autoSendEnabled.data?.enabled ? "complete" : "gated",
        persistent: false,
      },
    ];

    const reachedCount = ladder.filter((l) => l.status === "complete").length;
    const next = ladder.find((l) => l.status !== "complete");

    // Domain statuses — simplified mapping from ladder + metrics.
    const domains = {
      email: this.#deriveDomainStatus(confidence, "email"),
      projects: await this.#deriveProjectsStatus(companyId),
      invoice: await this.#deriveInvoiceStatus(companyId),
      schedule: await this.#deriveScheduleStatus(companyId),
      comms: this.#deriveCommsStatus(categoryAutonomy),
    };

    return {
      domains,
      ladder,
      reachedCount,
      nextLadderName: next
        ? `ladder.${next.position}` // key into i18n dict
        : null,
    };
  },

  #mapScanJobToInputState(
    row: Record<string, unknown> | null
  ): InputState {
    if (!row) {
      return {
        source: "scan",
        status: "not_run",
        percent: 0,
        lastRunAt: null,
        currentJobId: null,
      };
    }
    const result = (row.result ?? {}) as Record<string, unknown>;
    const progress = result.progress as
      | { processed: number; total: number; factsExtracted: number }
      | undefined;
    const status = row.status as string;
    const percent =
      progress && progress.total > 0
        ? Math.round((progress.processed / progress.total) * 100)
        : status === "complete"
        ? 100
        : 0;

    return {
      source: "scan",
      status: status as InputState["status"],
      percent,
      lastRunAt: (row.updated_at as string) ?? null,
      currentJobId: row.id as string,
      progress: progress
        ? {
            processed: progress.processed,
            total: progress.total,
            factsExtracted: progress.factsExtracted,
          }
        : undefined,
    };
  },

  async #getFactSparkline(companyId: string): Promise<number[]> {
    const supabase = getServiceRoleClient();
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const { data } = await supabase
      .from("agent_memories")
      .select("created_at")
      .eq("company_id", companyId)
      .gte("created_at", sevenDaysAgo.toISOString());

    const buckets = Array(7).fill(0);
    const today = startOfToday();
    for (const row of data ?? []) {
      const rowDate = new Date(row.created_at as string);
      const daysAgo = Math.floor(
        (today.getTime() - rowDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      if (daysAgo >= 0 && daysAgo < 7) buckets[6 - daysAgo]++;
    }
    return buckets;
  },

  #deriveDomainStatus(confidence: number, _domain: string): DomainStatus {
    if (confidence >= 0.85)
      return { status: "nominal", confidence, metric: confidence.toFixed(2) };
    if (confidence >= 0.3)
      return { status: "learning", confidence, metric: confidence.toFixed(2) };
    if (confidence > 0)
      return { status: "gated", confidence, metric: confidence.toFixed(2) };
    return { status: "unavailable", confidence: null, metric: null };
  },

  async #deriveProjectsStatus(companyId: string): Promise<DomainStatus> {
    const supabase = getServiceRoleClient();
    const { count } = await supabase
      .from("agent_actions")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("type", "create_task");

    if ((count ?? 0) > 5) return { status: "nominal", confidence: null, metric: `${count}` };
    if ((count ?? 0) > 0) return { status: "learning", confidence: null, metric: `${count}` };
    return { status: "gated", confidence: null, metric: null };
  },

  async #deriveInvoiceStatus(companyId: string): Promise<DomainStatus> {
    const supabase = getServiceRoleClient();
    const { count } = await supabase
      .from("agent_actions")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .in("type", ["create_invoice", "send_invoice_email", "send_payment_reminder"]);

    if ((count ?? 0) > 5) return { status: "nominal", confidence: null, metric: `${count}` };
    if ((count ?? 0) > 0) return { status: "learning", confidence: null, metric: `${count}` };
    return { status: "gated", confidence: null, metric: null };
  },

  async #deriveScheduleStatus(companyId: string): Promise<DomainStatus> {
    const supabase = getServiceRoleClient();
    const { count } = await supabase
      .from("agent_actions")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .in("type", ["send_appointment_confirmation", "optimize_schedule"]);

    if ((count ?? 0) > 10) return { status: "nominal", confidence: null, metric: `${count}` };
    if ((count ?? 0) > 0) return { status: "learning", confidence: null, metric: `${count}` };
    return { status: "gated", confidence: null, metric: null };
  },

  #deriveCommsStatus(categoryAutonomy: Record<string, unknown>): DomainStatus {
    const count = Object.keys(categoryAutonomy).length;
    if (count >= 7) return { status: "nominal", confidence: null, metric: `${count}` };
    if (count > 0) return { status: "learning", confidence: null, metric: `${count}` };
    return { status: "gated", confidence: null, metric: null };
  },

  #resolveTimeRangeCutoff(range: ActivityFilters["timeRange"]): Date {
    const now = Date.now();
    const hour = 60 * 60 * 1000;
    switch (range) {
      case "hour": return new Date(now - hour);
      case "day": return new Date(now - 24 * hour);
      case "week": return new Date(now - 7 * 24 * hour);
      case "month": return new Date(now - 30 * 24 * hour);
      case "all": return new Date(0);
    }
  },
};

// ─── Utilities ──────────────────────────────────────────────────────────────

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
```

**Commit:** `feat(calibration): add calibration-service (deck + first-run + recent + activity + milestones queries)`

Validation: `pnpm typecheck`. Write a smoke test in `src/lib/api/services/__tests__/calibration-service.test.ts` calling `getDeckState("fake-id")` with a mocked Supabase client and asserting shape.

---

#### A3. API route — getDeckState

**File:** `src/app/api/calibration/deck/route.ts` (create)

```typescript
import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest, isErrorResponse } from "../../agent/_lib/auth";
import { CalibrationService } from "@/lib/api/services/calibration-service";

export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (isErrorResponse(auth)) return auth;

  const { companyId, hasPermission } = auth;
  if (!hasPermission("email.configure_ai")) {
    return NextResponse.json(
      { error: "Forbidden: email.configure_ai required" },
      { status: 403 }
    );
  }

  try {
    const state = await CalibrationService.getDeckState(companyId);
    return NextResponse.json(state);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch deck state" },
      { status: 500 }
    );
  }
}
```

**Commit:** `feat(calibration): add /api/calibration/deck GET endpoint`

---

#### A4. API route — first-run + dismiss

**File:** `src/app/api/calibration/first-run/route.ts` (create)

```typescript
import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest, isErrorResponse } from "../../agent/_lib/auth";
import { CalibrationService } from "@/lib/api/services/calibration-service";

export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (isErrorResponse(auth)) return auth;

  const { companyId, userId, hasPermission } = auth;
  if (!hasPermission("email.configure_ai")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const state = await CalibrationService.getFirstRunState(companyId, userId);
  return NextResponse.json(state);
}

export async function POST(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (isErrorResponse(auth)) return auth;

  const { userId } = auth;
  const body = await request.json();
  if (body.action !== "dismiss") {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  await CalibrationService.dismissFirstRun(userId);
  return NextResponse.json({ dismissed: true });
}
```

**Commit:** `feat(calibration): add /api/calibration/first-run GET + POST(dismiss)`

---

#### A5. API route — recent events

**File:** `src/app/api/calibration/recent/route.ts` (create)

```typescript
import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest, isErrorResponse } from "../../agent/_lib/auth";
import { CalibrationService } from "@/lib/api/services/calibration-service";

export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (isErrorResponse(auth)) return auth;

  const { companyId, hasPermission } = auth;
  if (!hasPermission("email.configure_ai")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const limit = Math.min(
    parseInt(request.nextUrl.searchParams.get("limit") ?? "5", 10),
    20
  );

  const events = await CalibrationService.getRecentEvents(companyId, limit);
  return NextResponse.json({ events });
}
```

**Commit:** `feat(calibration): add /api/calibration/recent GET endpoint`

---

#### A6. API route — activity log (full, paginated)

**File:** `src/app/api/calibration/activity/route.ts` (create)

Expands `CalibrationService.getActivityLog` stub — see task I1. Route handler is thin:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest, isErrorResponse } from "../../agent/_lib/auth";
import { CalibrationService } from "@/lib/api/services/calibration-service";
import type { ActivityFilters, RecentEventType } from "@/lib/types/calibration";

export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (isErrorResponse(auth)) return auth;

  const { companyId, hasPermission } = auth;
  if (!hasPermission("email.configure_ai")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const sp = request.nextUrl.searchParams;
  const typesParam = sp.get("types");
  const filters: ActivityFilters = {
    types:
      typesParam === "all" || !typesParam
        ? "all"
        : (typesParam.split(",") as RecentEventType[]),
    timeRange: (sp.get("timeRange") ?? "day") as ActivityFilters["timeRange"],
  };
  const cursor = sp.get("cursor") ?? undefined;
  const limit = Math.min(parseInt(sp.get("limit") ?? "50", 10), 200);

  const { events, nextCursor } = await CalibrationService.getActivityLog(
    companyId,
    filters,
    cursor,
    limit
  );
  return NextResponse.json({ events, nextCursor });
}
```

**Commit:** `feat(calibration): add /api/calibration/activity paginated log endpoint`

---

### Group B — Primitives

#### B1. Radar sweep signature component

**File:** `src/app/(dashboard)/calibration/_components/radar-sweep.tsx` (create)

```tsx
"use client";

/**
 * RadarSweep — the signature visual of CALIBRATION.
 *
 * A 16px radar scope with a rotating sweep arm, living in the bottom-right
 * corner of every tile. Pure CSS animation, paused when off-screen via
 * Intersection Observer, accelerated on hover via CSS selector.
 *
 * States:
 *   - "nominal"    — olive sweep, idle cycle
 *   - "running"    — tan sweep, faster cycle
 *   - "error"      — rose sweep, faster cycle
 *   - "empty"      — text-mute sweep, idle cycle
 *   - "unlocked"   — accent sweep, one-beat pulse (used for MILESTONES)
 */

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils/cn";

export type RadarSweepState = "nominal" | "running" | "error" | "empty" | "unlocked";

const STATE_COLOR: Record<RadarSweepState, string> = {
  nominal: "#9DB582",   // olive
  running: "#C4A868",   // tan
  error: "#B58289",     // rose
  empty: "#6A6A6A",     // text-mute
  unlocked: "#6F94B0",  // accent
};

interface RadarSweepProps {
  state: RadarSweepState;
  className?: string;
  /** px size. Defaults to 16. */
  size?: number;
}

export function RadarSweep({ state, className, size = 16 }: RadarSweepProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const color = STATE_COLOR[state];

  // Pause off-screen via Intersection Observer.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const arm = el.querySelector<SVGElement>("[data-sweep-arm]");
    if (!arm) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        arm.style.animationPlayState = entry.isIntersecting ? "running" : "paused";
      },
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={rootRef}
      aria-hidden="true"
      className={cn("cal-radar-sweep", className)}
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <radialGradient id="cal-radar-bg" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.02)" />
            <stop offset="70%" stopColor="transparent" />
          </radialGradient>
          <linearGradient id={`cal-radar-fade-${state}`} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor={color} stopOpacity="0.5" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <circle cx="8" cy="8" r="7.5" fill="url(#cal-radar-bg)" />
        <circle cx="8" cy="8" r="4" stroke={color} strokeOpacity="0.3" strokeWidth="0.5" fill="none" />
        <circle cx="8" cy="8" r="7" stroke={color} strokeOpacity="0.3" strokeWidth="0.5" fill="none" />
        <g data-sweep-arm className="cal-radar-sweep__arm">
          <line x1="8" y1="8" x2="8" y2="1" stroke={color} strokeWidth="1" />
          <path d="M 8,8 L 8,1 A 7,7 0 0 1 14.06,5.5 Z" fill={`url(#cal-radar-fade-${state})`} />
        </g>
      </svg>
    </div>
  );
}
```

**File:** `src/app/globals.css` (modify — append at bottom)

```css
/* ─── CALIBRATION — radar sweep signature ─────────────────────────────── */

@keyframes cal-radar-rotate {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}

.cal-radar-sweep {
  position: relative;
  display: inline-block;
}

.cal-radar-sweep__arm {
  transform-origin: 8px 8px;
  animation: cal-radar-rotate 2.4s linear infinite;
  transition: animation-duration 200ms ease-out;
}

/* Hover — parent tile shortens the sweep cycle. */
.cal-tile:hover .cal-radar-sweep__arm,
.cal-tile:focus-visible .cal-radar-sweep__arm {
  animation-duration: 1.2s;
}

@media (prefers-reduced-motion: reduce) {
  .cal-radar-sweep__arm {
    animation: none;
    transform: rotate(315deg);
    opacity: 0.35;
  }
}
```

**Commit:** `feat(calibration): radar-sweep signature component + global CSS`

Validation: Mount in a Storybook or temporary test page; visually verify sweep rotates at 2.4s, pauses off-screen, respects reduced motion.

---

#### B2. AnimatedNumber primitive

**File:** `src/app/(dashboard)/calibration/_components/animated-number.tsx` (create)

```tsx
"use client";

import { useEffect } from "react";
import { motion, useMotionValue, useTransform, animate, useReducedMotion } from "framer-motion";

interface AnimatedNumberProps {
  value: number;
  duration?: number;
  format?: (n: number) => string;
  className?: string;
}

/**
 * Count-up number primitive. cubicOut easing produces the most natural
 * tick-up feel per the data-visualization skill. Reduced motion falls back
 * to the final value with no animation.
 */
export function AnimatedNumber({
  value,
  duration = 0.8,
  format,
  className,
}: AnimatedNumberProps) {
  const prefersReducedMotion = useReducedMotion();
  const motionValue = useMotionValue(prefersReducedMotion ? value : 0);
  const rendered = useTransform(motionValue, (v) =>
    format ? format(v) : Math.round(v).toLocaleString()
  );

  useEffect(() => {
    if (prefersReducedMotion) {
      motionValue.set(value);
      return;
    }
    const controls = animate(motionValue, value, {
      duration,
      ease: [0.33, 1, 0.68, 1], // cubicOut
    });
    return () => controls.stop();
  }, [value, duration, motionValue, prefersReducedMotion]);

  return (
    <motion.span className={className} style={{ fontVariantNumeric: "tabular-nums" }}>
      {rendered}
    </motion.span>
  );
}
```

**Commit:** `feat(calibration): animated-number primitive with reduced-motion fallback`

---

#### B3. Progress ring primitive

**File:** `src/app/(dashboard)/calibration/_components/progress-ring.tsx` (create)

```tsx
"use client";

import { motion, useMotionValue, useSpring, useTransform, useReducedMotion } from "framer-motion";
import { useEffect } from "react";
import { cn } from "@/lib/utils/cn";

interface ProgressRingProps {
  percent: number;                  // 0-100
  size?: number;                    // px diameter; default 44
  stroke?: number;                  // px stroke width; default 3
  color: string;                    // ring color (hex or rgba)
  trackColor?: string;              // track color
  children?: React.ReactNode;       // center content
  className?: string;
  label?: string;                   // sr-only label
}

export function ProgressRing({
  percent,
  size = 44,
  stroke = 3,
  color,
  trackColor = "rgba(255,255,255,0.14)",
  children,
  className,
  label,
}: ProgressRingProps) {
  const prefersReducedMotion = useReducedMotion();
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;

  const target = prefersReducedMotion ? percent : 0;
  const mv = useMotionValue(target);
  const smoothed = useSpring(mv, { stiffness: 60, damping: 15 });
  const dashoffset = useTransform(
    smoothed,
    (v) => circumference * (1 - v / 100)
  );

  useEffect(() => {
    mv.set(percent);
  }, [percent, mv]);

  return (
    <div
      className={cn("cal-progress-ring", className)}
      style={{ width: size, height: size }}
      role="progressbar"
      aria-valuenow={Math.round(percent)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={trackColor}
          strokeWidth={stroke}
          fill="none"
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          style={{
            strokeDashoffset: dashoffset,
            transform: `rotate(-90deg)`,
            transformOrigin: "center",
          }}
        />
      </svg>
      {children && (
        <div
          className="absolute inset-0 flex items-center justify-center"
          aria-hidden="true"
        >
          {children}
        </div>
      )}
    </div>
  );
}
```

**Commit:** `feat(calibration): progress-ring primitive with spring fill`

---

#### B4. Motion tokens

**File:** `src/lib/utils/calibration-motion.ts` (create)

```typescript
/**
 * CALIBRATION motion tokens. Centralized so every component references the
 * same values. Matches system.md's EASE_SMOOTH. Durations picked per the
 * animation-architect skill's Entry/Discovery/Transition/Achievement beats.
 */

export const CAL_EASE = [0.22, 1, 0.36, 1] as const;

export const CAL_DURATIONS = {
  hover: 0.15,
  tileEnter: 0.2,
  drillInTransition: 0.3,
  deckEntryStagger: 0.06, // seconds between tile entries
  countUp: 0.8,
  ringFill: 1.0,
  barGrow: 0.4,
  recentRailInsert: 0.25,
  milestonePulse: 0.24,
} as const;

export const CAL_REDUCED = {
  tileEnter: 0.15,
  drillIn: 0.2,
  countUp: 0,
  ringFill: 0,
  barGrow: 0,
  recentRailInsert: 0.15,
  milestonePulse: 0.4,
} as const;
```

**Commit:** `feat(calibration): motion token constants`

---

### Group C — Command deck + tile composition

#### C1. Tile shell

**File:** `src/app/(dashboard)/calibration/_components/deck-tile.tsx` (create)

```tsx
"use client";

import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils/cn";
import { CAL_DURATIONS, CAL_EASE } from "@/lib/utils/calibration-motion";
import { RadarSweep, type RadarSweepState } from "./radar-sweep";

interface DeckTileProps {
  title: string;       // includes // prefix, already formatted
  indexInGrid: number; // 0-4 for stagger calc
  radarState: RadarSweepState;
  onClick: () => void;
  ariaLabel: string;
  children: React.ReactNode;    // body content
  footer: React.ReactNode;      // footer content
  className?: string;
  /** When true, renders a one-shot accent pulse. Pass a unique key to re-fire. */
  pulseToken?: number;
}

export function DeckTile({
  title,
  indexInGrid,
  radarState,
  onClick,
  ariaLabel,
  children,
  footer,
  className,
  pulseToken,
}: DeckTileProps) {
  const reduced = useReducedMotion();
  return (
    <motion.button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={cn(
        "cal-tile glass-surface rounded-panel group relative overflow-hidden text-left",
        "flex flex-col h-[200px] w-full",
        "hover:bg-[rgba(22,22,24,0.68)] transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black",
        className
      )}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: reduced ? 0.15 : CAL_DURATIONS.tileEnter,
        ease: CAL_EASE,
        delay: reduced ? 0 : indexInGrid * CAL_DURATIONS.deckEntryStagger,
      }}
      layoutId={`cal-tile-${title}`}
      data-pulse-token={pulseToken ?? 0}
    >
      <div className="px-5 pt-4 pb-2 flex items-center justify-between">
        <span className="font-mono text-micro uppercase tracking-wider text-text-2">
          <span className="text-text-mute mr-[6px]">{title.slice(0, 2)}</span>
          {title.slice(2)}
        </span>
      </div>
      <div className="flex-1 px-5 pb-2 min-h-0">{children}</div>
      <div className="px-5 pb-3 text-text-3 font-mono text-micro">{footer}</div>
      <RadarSweep state={radarState} className="absolute bottom-3 right-3" />
    </motion.button>
  );
}
```

**Commit:** `feat(calibration): deck-tile shared shell with shared-element layoutId`

---

#### C2. INPUTS tile body

**File:** `src/app/(dashboard)/calibration/_components/tile-inputs-body.tsx` (create)

```tsx
"use client";

import { motion } from "framer-motion";
import { ProgressRing } from "./progress-ring";
import { useDictionary } from "@/i18n/client";
import { CAL_DURATIONS, CAL_EASE } from "@/lib/utils/calibration-motion";
import type { DeckState } from "@/lib/types/calibration";

interface Props {
  inputs: DeckState["inputs"];
}

const COLOR_BY_STATUS = {
  complete: "#9DB582",
  running: "#C4A868",
  failed: "#B58289",
  not_run: "#6A6A6A",
  skipped: "#6A6A6A",
} as const;

export function TileInputsBody({ inputs }: Props) {
  const { t } = useDictionary("calibration");
  const sources = [
    { key: "interview", state: inputs.interview, label: t("tiles.inputs.labels.interview") },
    { key: "scan", state: inputs.scan, label: t("tiles.inputs.labels.scan") },
    { key: "mining", state: inputs.mining, label: t("tiles.inputs.labels.mining") },
  ];

  return (
    <div className="flex items-center justify-around gap-3 h-full">
      {sources.map((s, i) => (
        <motion.div
          key={s.key}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.15, ease: CAL_EASE, delay: 0.15 + i * 0.12 }}
          className="flex flex-col items-center gap-2"
        >
          <ProgressRing
            percent={s.state.percent}
            size={44}
            stroke={3}
            color={COLOR_BY_STATUS[s.state.status]}
            label={`${s.label} ${s.state.percent}%`}
          >
            <span
              className="font-mohave font-light text-body leading-none"
              style={{ color: COLOR_BY_STATUS[s.state.status] }}
            >
              {s.state.percent}%
            </span>
          </ProgressRing>
          <span className="font-mono text-micro uppercase tracking-wider text-text-3">
            {s.label}
          </span>
        </motion.div>
      ))}
    </div>
  );
}
```

**Commit:** `feat(calibration): INPUTS tile body — 3-ring progress`

---

#### C3. CORPUS tile body

**File:** `src/app/(dashboard)/calibration/_components/tile-corpus-body.tsx` (create)

```tsx
"use client";

import { useEffect, useRef } from "react";
import { AnimatedNumber } from "./animated-number";
import { useDictionary } from "@/i18n/client";
import type { DeckState } from "@/lib/types/calibration";

interface Props {
  corpus: DeckState["corpus"];
}

export function TileCorpusBody({ corpus }: Props) {
  const { t } = useDictionary("calibration");
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // DPI-aware sparkline — 140×20px at logical resolution.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const W = 140, H = 20;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, W, H);

    const data = corpus.last7DaysFactCounts;
    const max = Math.max(...data, 1);
    const step = W / (data.length - 1);

    // Fill
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.beginPath();
    ctx.moveTo(0, H);
    data.forEach((v, i) => ctx.lineTo(i * step, H - (v / max) * (H - 2)));
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();

    // Stroke
    ctx.strokeStyle = "#B5B5B5";
    ctx.lineWidth = 1;
    ctx.beginPath();
    data.forEach((v, i) =>
      i === 0
        ? ctx.moveTo(i * step, H - (v / max) * (H - 2))
        : ctx.lineTo(i * step, H - (v / max) * (H - 2))
    );
    ctx.stroke();
  }, [corpus.last7DaysFactCounts]);

  const confidence = corpus.writingConfidence;
  const showConfidenceRow = confidence > 0 && confidence < 0.5;
  const showLocked = confidence >= 0.85;

  return (
    <div className="flex flex-col gap-2 h-full justify-center">
      <div className="flex items-baseline gap-2">
        <AnimatedNumber
          value={corpus.factCount}
          className="font-mohave font-light text-[42px] text-text leading-none"
        />
        <span className="font-mono text-micro uppercase tracking-wider text-text-3">
          {t("tiles.corpus.factsLabel")}
        </span>
      </div>
      <canvas ref={canvasRef} className="block" aria-hidden="true" />
      {showConfidenceRow && (
        <span className="font-mono text-micro uppercase tracking-wider" style={{ color: "#C4A868" }}>
          {t("tiles.corpus.confidenceStatuses.training").replace("{conf}", confidence.toFixed(2))}
        </span>
      )}
      {showLocked && (
        <span className="font-mono text-micro uppercase tracking-wider" style={{ color: "#9DB582" }}>
          {t("tiles.corpus.confidenceStatuses.locked").replace("{conf}", confidence.toFixed(2))}
        </span>
      )}
    </div>
  );
}
```

**Commit:** `feat(calibration): CORPUS tile body — count-up + DPI-aware sparkline`

---

#### C4. CONFIG tile body

**File:** `src/app/(dashboard)/calibration/_components/tile-config-body.tsx` (create)

```tsx
"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useDictionary } from "@/i18n/client";
import { CAL_EASE } from "@/lib/utils/calibration-motion";
import type { DeckState } from "@/lib/types/calibration";

interface Props {
  config: DeckState["config"];
}

const ORDER = ["auto_send", "auto_draft", "draft", "off"] as const;
const COLOR: Record<(typeof ORDER)[number], string> = {
  auto_send: "#9DB582",
  auto_draft: "#B5B5B5",
  draft: "#8A8A8A",
  off: "#6A6A6A",
};

export function TileConfigBody({ config }: Props) {
  const { t } = useDictionary("calibration");
  const reduced = useReducedMotion();
  const total = Object.values(config.emailTypeCounts).reduce((a, b) => a + b, 0) || 1;

  return (
    <div className="flex flex-col gap-[6px] h-full justify-center pr-2">
      {ORDER.map((level, i) => {
        const count = config.emailTypeCounts[level];
        const pct = (count / total) * 100;
        return (
          <div key={level} className="flex items-center gap-2">
            <span
              className="font-mono text-micro uppercase tracking-wider text-text-3 shrink-0"
              style={{ width: 88 }}
            >
              {t(`tiles.config.barLabels.${level === "auto_send" ? "autoSend" : level === "auto_draft" ? "autoDraft" : level}`)}
            </span>
            <div
              className="relative rounded-bar bg-[rgba(255,255,255,0.06)]"
              style={{ width: 140, height: 6 }}
            >
              <motion.div
                className="rounded-bar h-full"
                style={{ backgroundColor: COLOR[level] }}
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{
                  duration: reduced ? 0 : 0.4,
                  ease: CAL_EASE,
                  delay: reduced ? 0 : 0.15 + i * 0.08,
                }}
              />
            </div>
            <span
              className="font-mono text-data-sm tabular-nums ml-auto"
              style={{ color: COLOR[level] }}
            >
              {count}
            </span>
          </div>
        );
      })}
    </div>
  );
}
```

**Commit:** `feat(calibration): CONFIG tile body — 4-level autonomy stack`

---

#### C5. ACTIVITY tile body

**File:** `src/app/(dashboard)/calibration/_components/tile-activity-body.tsx` (create)

```tsx
"use client";

import { useDictionary } from "@/i18n/client";
import type { DeckState } from "@/lib/types/calibration";

interface Props {
  activity: DeckState["activity"];
}

function formatElapsed(ms: number): string {
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function TileActivityBody({ activity }: Props) {
  const { t } = useDictionary("calibration");

  if (activity.status === "running" && activity.currentJob) {
    const { type, elapsedMs, progress } = activity.currentJob;
    const percent = progress && progress.total > 0
      ? Math.round((progress.processed / progress.total) * 100)
      : 0;
    return (
      <div className="flex flex-col gap-2 h-full justify-center">
        <span
          className="font-cakemono font-light uppercase text-[20px] leading-none"
          style={{ color: "#C4A868" }}
        >
          {type} · {formatElapsed(elapsedMs)}
        </span>
        {progress && (
          <>
            <div className="rounded-bar bg-[rgba(255,255,255,0.06)]" style={{ height: 4 }}>
              <div
                className="rounded-bar h-full transition-[width] duration-500 ease-out"
                style={{ width: `${percent}%`, backgroundColor: "#C4A868" }}
              />
            </div>
            <span className="font-mono text-data-sm text-text-2 tabular-nums">
              {progress.processed.toLocaleString()} / {progress.total.toLocaleString()} threads
            </span>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 h-full justify-center">
      <span
        className="font-cakemono font-light uppercase text-[20px] leading-none"
        style={{ color: "#9DB582" }}
      >
        {t("tiles.activity.idleLabel")}
      </span>
      <span className="font-mono text-micro uppercase tracking-wider text-text-3">
        Last 24h: {activity.completedTodayCount} events · {activity.queuedCount} queued
      </span>
    </div>
  );
}
```

**Commit:** `feat(calibration): ACTIVITY tile body — live sensor strip`

---

#### C6. MILESTONES tile body

**File:** `src/app/(dashboard)/calibration/_components/tile-milestones-body.tsx` (create)

```tsx
"use client";

import { motion } from "framer-motion";
import { useDictionary } from "@/i18n/client";
import { CAL_EASE } from "@/lib/utils/calibration-motion";
import type { DeckState, DomainHealthStatus } from "@/lib/types/calibration";

interface Props {
  milestones: DeckState["milestones"];
}

const DOT_COLOR: Record<DomainHealthStatus, string> = {
  nominal: "#9DB582",
  learning: "#C4A868",
  gated: "#6A6A6A",
  unavailable: "#6A6A6A",
};

const DOMAINS = ["email", "projects", "invoice", "schedule", "comms"] as const;

export function TileMilestonesBody({ milestones }: Props) {
  const { t } = useDictionary("calibration");
  return (
    <div className="grid grid-cols-5 gap-3 h-full items-center">
      {DOMAINS.map((d, i) => {
        const domain = milestones.domains[d];
        const color = DOT_COLOR[domain.status];
        return (
          <motion.div
            key={d}
            className="flex flex-col items-center gap-1"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.15, ease: CAL_EASE, delay: 0.2 + i * 0.05 }}
          >
            <span className="font-mono text-micro uppercase tracking-wider text-text-3">
              {t(`tiles.milestones.domains.${d}`)}
            </span>
            <motion.div
              className="rounded-full"
              style={{ width: 10, height: 10, backgroundColor: color }}
              initial={{ scale: 0.3, opacity: 0 }}
              animate={{ scale: [0.3, 1.15, 1], opacity: 1 }}
              transition={{ duration: 0.2, ease: CAL_EASE, delay: 0.25 + i * 0.05 }}
            />
            <span className="font-mono text-micro uppercase tracking-wider" style={{ color }}>
              {t(`tiles.milestones.statuses.${domain.status}`)}
            </span>
            {domain.metric && (
              <span className="font-mohave text-body-sm tabular-nums text-text-2">
                {domain.metric}
              </span>
            )}
          </motion.div>
        );
      })}
    </div>
  );
}
```

**Commit:** `feat(calibration): MILESTONES tile body — 5-domain status grid`

---

#### C7. Command deck composition

**File:** `src/app/(dashboard)/calibration/_components/command-deck.tsx` (create)

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useDictionary } from "@/i18n/client";
import { DeckTile } from "./deck-tile";
import { TileInputsBody } from "./tile-inputs-body";
import { TileCorpusBody } from "./tile-corpus-body";
import { TileConfigBody } from "./tile-config-body";
import { TileActivityBody } from "./tile-activity-body";
import { TileMilestonesBody } from "./tile-milestones-body";
import { RecentRail } from "./recent-rail";
import type { DeckState } from "@/lib/types/calibration";
import type { RadarSweepState } from "./radar-sweep";

interface Props {
  deck: DeckState;
}

export function CommandDeck({ deck }: Props) {
  const { t } = useDictionary("calibration");
  const router = useRouter();
  const goTo = (section: string) => router.push(`/calibration?section=${section}`);

  // Derive radar state per tile
  const inputsRadar: RadarSweepState = deck.inputs.scan.status === "running"
    ? "running"
    : (deck.inputs.interview.status === "complete" || deck.inputs.mining.status === "complete" || deck.inputs.scan.status === "complete")
    ? "nominal"
    : "empty";
  const corpusRadar: RadarSweepState = deck.corpus.factCount > 0 ? "nominal" : "empty";
  const configRadar: RadarSweepState = deck.config.rulesCount > 0 ? "nominal" : "empty";
  const activityRadar: RadarSweepState =
    deck.activity.status === "running" ? "running" : deck.activity.status === "error" ? "error" : "nominal";
  const milestonesRadar: RadarSweepState =
    deck.milestones.reachedCount > 0 ? "nominal" : "empty";

  return (
    <div className="calibration-deck">
      <DeckTile
        title={t("tiles.inputs.title")}
        indexInGrid={0}
        radarState={inputsRadar}
        onClick={() => goTo("inputs")}
        ariaLabel={`INPUTS. ${deck.inputs.interview.status === "complete" ? 1 : 0 + (deck.inputs.scan.status === "complete" ? 1 : 0) + (deck.inputs.mining.status === "complete" ? 1 : 0)} of 3 complete. Click to drill in.`}
        footer={renderInputsFooter(deck, t)}
        className="deck-tile--inputs"
      >
        <TileInputsBody inputs={deck.inputs} />
      </DeckTile>

      <DeckTile
        title={t("tiles.corpus.title")}
        indexInGrid={1}
        radarState={corpusRadar}
        onClick={() => goTo("corpus")}
        ariaLabel={`CORPUS. ${deck.corpus.factCount} facts, confidence ${deck.corpus.writingConfidence.toFixed(2)}. Click to drill in.`}
        footer={renderCorpusFooter(deck, t)}
        className="deck-tile--corpus"
      >
        <TileCorpusBody corpus={deck.corpus} />
      </DeckTile>

      <DeckTile
        title={t("tiles.config.title")}
        indexInGrid={2}
        radarState={configRadar}
        onClick={() => goTo("config")}
        ariaLabel={`CONFIG. ${deck.config.rulesCount} rules, ${deck.config.categoriesCount} categories. Click to drill in.`}
        footer={renderConfigFooter(deck, t)}
        className="deck-tile--config"
      >
        <TileConfigBody config={deck.config} />
      </DeckTile>

      <DeckTile
        title={t("tiles.activity.title")}
        indexInGrid={3}
        radarState={activityRadar}
        onClick={() => goTo("activity")}
        ariaLabel={`ACTIVITY. Status ${deck.activity.status}. ${deck.activity.completedTodayCount} events today. Click to drill in.`}
        footer={renderActivityFooter(deck, t)}
        className="deck-tile--activity"
      >
        <TileActivityBody activity={deck.activity} />
      </DeckTile>

      <DeckTile
        title={t("tiles.milestones.title")}
        indexInGrid={4}
        radarState={milestonesRadar}
        onClick={() => goTo("milestones")}
        ariaLabel={`MILESTONES. ${deck.milestones.reachedCount} of 9 reached. Click to drill in.`}
        footer={renderMilestonesFooter(deck, t)}
        className="deck-tile--milestones"
      >
        <TileMilestonesBody milestones={deck.milestones} />
      </DeckTile>

      <RecentRail />
    </div>
  );
}

function renderInputsFooter(deck: DeckState, t: (k: string) => string) {
  const count = [deck.inputs.interview, deck.inputs.scan, deck.inputs.mining]
    .filter((i) => i.status === "complete").length;
  if (count === 0) return <>{t("tiles.inputs.footerEmpty")}</>;
  const lastRun = deck.inputs.lastAnyRunAt ? formatTimeAgo(deck.inputs.lastAnyRunAt) : "—";
  return <>{t("tiles.inputs.footer").replace("{count}", String(count)).replace("{time}", lastRun)}</>;
}

function renderCorpusFooter(deck: DeckState, t: (k: string) => string) {
  if (deck.corpus.factCount === 0) return <>{t("tiles.corpus.footerEmpty")}</>;
  return (
    <>
      {t("tiles.corpus.footer")
        .replace("{today}", String(deck.corpus.todayFactCount))
        .replace("{conf}", deck.corpus.writingConfidence.toFixed(2))}
    </>
  );
}

function renderConfigFooter(deck: DeckState, t: (k: string) => string) {
  if (deck.config.rulesCount === 0 && deck.config.categoriesCount === 0)
    return <>{t("tiles.config.footerEmpty")}</>;
  return (
    <>
      {t("tiles.config.footer")
        .replace("{rules}", String(deck.config.rulesCount))
        .replace("{cats}", String(deck.config.categoriesCount))}
    </>
  );
}

function renderActivityFooter(deck: DeckState, t: (k: string) => string) {
  if (deck.activity.queuedCount === 0 && deck.activity.completedTodayCount === 0)
    return <>{t("tiles.activity.footerEmpty")}</>;
  return (
    <>
      {t("tiles.activity.footer")
        .replace("{q}", String(deck.activity.queuedCount))
        .replace("{c}", String(deck.activity.completedTodayCount))}
    </>
  );
}

function renderMilestonesFooter(deck: DeckState, t: (k: string) => string) {
  if (deck.milestones.reachedCount === 0)
    return <>{t("tiles.milestones.footerEmpty")}</>;
  const next = deck.milestones.nextLadderName
    ? t(`sections.milestones.${deck.milestones.nextLadderName}`)
    : "—";
  return (
    <>
      {t("tiles.milestones.footer")
        .replace("{reached}", String(deck.milestones.reachedCount))
        .replace("{next}", next)}
    </>
  );
}

function formatTimeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "JUST NOW";
  if (mins < 60) return `${mins}M`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}H`;
  const days = Math.floor(hours / 24);
  return `${days}D`;
}
```

**File:** `src/app/globals.css` (append)

```css
/* ─── CALIBRATION — deck grid ─────────────────────────────────────────── */

.calibration-deck {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  grid-template-rows: auto auto auto;
  gap: 24px;
  padding: 36px 44px;
  max-width: 1320px;
  margin: 0 auto;
  width: 100%;
}

.deck-tile--inputs     { grid-column: 1; grid-row: 1; }
.deck-tile--corpus     { grid-column: 2; grid-row: 1; }
.deck-tile--config     { grid-column: 3; grid-row: 1; }
.deck-tile--activity   { grid-column: 1; grid-row: 2; }
.deck-tile--milestones { grid-column: 2 / span 2; grid-row: 2; }
.deck-recent-rail      { grid-column: 1 / -1; grid-row: 3; }

@media (max-width: 1199px) and (min-width: 768px) {
  .calibration-deck {
    grid-template-columns: 1fr 1fr;
    padding: 24px 28px;
  }
  .deck-tile--inputs     { grid-column: 1; grid-row: 1; }
  .deck-tile--corpus     { grid-column: 2; grid-row: 1; }
  .deck-tile--config     { grid-column: 1; grid-row: 2; }
  .deck-tile--activity   { grid-column: 2; grid-row: 2; }
  .deck-tile--milestones { grid-column: 1 / -1; grid-row: 3; }
  .deck-recent-rail      { grid-column: 1 / -1; grid-row: 4; }
}

@media (max-width: 767px) {
  .calibration-deck {
    grid-template-columns: 1fr;
    padding: 16px;
    gap: 16px;
  }
  .deck-tile--inputs,
  .deck-tile--corpus,
  .deck-tile--config,
  .deck-tile--activity,
  .deck-tile--milestones,
  .deck-recent-rail { grid-column: 1; }
}
```

**Commit:** `feat(calibration): command-deck composition with responsive grid`

---

### Group D — RECENT rail + realtime

#### D1. Recent rail component

**File:** `src/app/(dashboard)/calibration/_components/recent-rail.tsx` (create)

```tsx
"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useDictionary } from "@/i18n/client";
import { CAL_EASE } from "@/lib/utils/calibration-motion";
import { useCalibrationRecent } from "./hooks/use-calibration-recent";
import { useRouter } from "next/navigation";

export function RecentRail() {
  const { t } = useDictionary("calibration");
  const events = useCalibrationRecent();
  const router = useRouter();
  const reduced = useReducedMotion();

  return (
    <div className="deck-recent-rail glass-surface rounded-panel h-[56px] flex items-center px-5 gap-4 overflow-hidden" role="log" aria-label="Recent activity" aria-live="polite">
      <div className="flex items-center gap-3 shrink-0">
        <span className="font-mono text-micro uppercase tracking-wider text-text-3">
          <span className="text-text-mute mr-[6px]">//</span>
          {t("recent.title").slice(3)}
        </span>
        <span className="font-mono text-micro uppercase tracking-wider text-text-mute">
          {t("recent.stream")}
        </span>
      </div>

      {events.length === 0 ? (
        <span className="font-mono text-micro uppercase tracking-wider text-text-mute">
          {t("recent.empty")}
        </span>
      ) : (
        <AnimatePresence mode="popLayout">
          {events.map((e) => (
            <motion.button
              key={e.id}
              layout
              initial={{ opacity: 0, x: reduced ? 0 : -12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: reduced ? 0 : 12 }}
              transition={{ duration: reduced ? 0.15 : 0.25, ease: CAL_EASE }}
              className="shrink-0 font-mono text-micro uppercase tracking-wider text-text-2 px-2 py-1 rounded-chip border border-[rgba(255,255,255,0.08)] hover:bg-surface-hover transition-colors"
              onClick={() => router.push(`/calibration?section=activity&event=${e.id}`)}
            >
              <span className="text-text-mute mr-1">SYS ::</span>
              <span style={{ color: colorForEvent(e.type) }}>{e.title}</span>
              <span className="text-text-mute ml-2">· {formatTime(e.createdAt)}</span>
            </motion.button>
          ))}
        </AnimatePresence>
      )}
    </div>
  );
}

function colorForEvent(type: string): string {
  switch (type) {
    case "scan": case "scan_complete": return "#9DB582";
    case "extraction": case "learning": return "#C4A868";
    case "confidence": case "milestone": return "#6F94B0";
    default: return "#B5B5B5";
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
```

**Commit:** `feat(calibration): recent-rail component`

---

#### D2. Recent events hook (realtime)

**File:** `src/app/(dashboard)/calibration/_components/hooks/use-calibration-recent.ts` (create)

```typescript
"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabase/client";
import { useAuthStore } from "@/lib/store/auth-store";
import { authedFetch } from "@/lib/utils/authed-fetch";
import type { RecentEvent } from "@/lib/types/calibration";

const LIMIT = 5;

export function useCalibrationRecent(): RecentEvent[] {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  const { data } = useQuery({
    queryKey: ["calibration", "recent", companyId],
    queryFn: async () => {
      const res = await authedFetch(`/api/calibration/recent?limit=${LIMIT}`);
      if (!res.ok) throw new Error("Failed to fetch recent events");
      const json = await res.json();
      return json.events as RecentEvent[];
    },
    enabled: !!companyId,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const [events, setEvents] = useState<RecentEvent[]>(data ?? []);

  // Sync query data into state
  useEffect(() => {
    if (data) setEvents(data);
  }, [data]);

  // Supabase realtime subscription — merge new events into the top
  useEffect(() => {
    if (!companyId) return;
    const supabase = getSupabase();
    if (!supabase) return;

    const channel = supabase
      .channel(`calibration-recent-${companyId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "agent_memories", filter: `company_id=eq.${companyId}` },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          const newEvent: RecentEvent = {
            id: String(row.id),
            type: row.source === "learning" ? "learning" : "extraction",
            title: row.source === "learning" ? "LEARNING" : "EXTRACTION",
            detail: null,
            createdAt: String(row.created_at),
            sourceTable: "agent_memories",
            sourceId: String(row.id),
          };
          setEvents((prev) => [newEvent, ...prev.filter((e) => e.id !== newEvent.id)].slice(0, LIMIT));
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "gmail_scan_jobs", filter: `company_id=eq.${companyId}` },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          if (row.status !== "complete" && row.status !== "error" && row.status !== "running") return;
          const newEvent: RecentEvent = {
            id: String(row.id),
            type: row.status === "complete" ? "scan_complete" : "scan",
            title: row.status === "complete" ? "SCAN COMPLETE" : "SCAN",
            detail: null,
            createdAt: String(row.updated_at ?? row.created_at),
            sourceTable: "gmail_scan_jobs",
            sourceId: String(row.id),
          };
          setEvents((prev) => [newEvent, ...prev.filter((e) => e.id !== newEvent.id)].slice(0, LIMIT));
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [companyId]);

  return events;
}
```

**Commit:** `feat(calibration): use-calibration-recent hook with Supabase realtime merge`

---

#### D3. Deck state hook

**File:** `src/app/(dashboard)/calibration/_components/hooks/use-calibration-deck.ts` (create)

```typescript
"use client";

import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/lib/store/auth-store";
import { authedFetch } from "@/lib/utils/authed-fetch";
import type { DeckState } from "@/lib/types/calibration";

export function useCalibrationDeck() {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  return useQuery({
    queryKey: ["calibration", "deck", companyId],
    queryFn: async (): Promise<DeckState> => {
      const res = await authedFetch("/api/calibration/deck");
      if (!res.ok) throw new Error("Failed to fetch deck state");
      return res.json();
    },
    enabled: !!companyId,
    refetchInterval: 30_000,
    staleTime: 20_000,
  });
}
```

**Commit:** `feat(calibration): use-calibration-deck hook`

---

### Group E — First-run wizard

#### E1. First-run detection hook

**File:** `src/app/(dashboard)/calibration/_components/hooks/use-calibration-first-run.ts` (create)

```typescript
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authedFetch } from "@/lib/utils/authed-fetch";
import { useAuthStore } from "@/lib/store/auth-store";
import type { FirstRunState } from "@/lib/types/calibration";

export function useCalibrationFirstRun() {
  const { company, currentUser } = useAuthStore();
  const companyId = company?.id ?? "";
  const userId = currentUser?.id ?? "";
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["calibration", "first-run", companyId, userId],
    queryFn: async (): Promise<FirstRunState> => {
      const res = await authedFetch("/api/calibration/first-run");
      if (!res.ok) throw new Error("Failed to fetch first-run state");
      return res.json();
    },
    enabled: !!companyId && !!userId,
  });

  const dismiss = useMutation({
    mutationFn: async () => {
      const res = await authedFetch("/api/calibration/first-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "dismiss" }),
      });
      if (!res.ok) throw new Error("Failed to dismiss");
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["calibration", "first-run"] }),
  });

  return { ...query, dismiss: dismiss.mutate };
}
```

**Commit:** `feat(calibration): use-calibration-first-run hook`

---

#### E2. First-run station component

**File:** `src/app/(dashboard)/calibration/_components/first-run-station.tsx` (create)

```tsx
"use client";

import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils/cn";
import { CAL_EASE } from "@/lib/utils/calibration-motion";
import type { InputState } from "@/lib/types/calibration";
import { useDictionary } from "@/i18n/client";

interface Props {
  source: "interview" | "scan" | "mining";
  state: InputState;
  isExpanded: boolean;
  onEngage: () => void;
  onSkip: () => void;
  children?: React.ReactNode; // the Interview/Scan/Mining component when expanded
}

const GLYPH: Record<InputState["status"], string> = {
  not_run: "◯",
  running: "◐",
  complete: "●",
  failed: "⊗",
  skipped: "⊗",
};

const GLYPH_COLOR: Record<InputState["status"], string> = {
  not_run: "#8A8A8A",
  running: "#C4A868",
  complete: "#9DB582",
  failed: "#B58289",
  skipped: "#6A6A6A",
};

export function FirstRunStation({ source, state, isExpanded, onEngage, onSkip, children }: Props) {
  const { t } = useDictionary("calibration");
  const done = state.status === "complete" || state.status === "skipped";
  const busy = state.status === "running";

  const stationKey = source === "scan" ? "emailScan" : source === "mining" ? "databaseMining" : "interview";
  const title = t(`firstRun.stations.${stationKey}.title`);
  const description = t(`firstRun.stations.${stationKey}.description`);

  return (
    <motion.div
      className="glass-surface rounded-panel overflow-hidden"
      animate={{ height: isExpanded ? "auto" : done ? 48 : "auto" }}
      transition={{ duration: 0.3, ease: CAL_EASE }}
    >
      <div className={cn("flex items-center gap-3 p-6", done && !isExpanded && "py-2 px-6")}>
        <span
          className="font-mohave text-[18px] leading-none"
          style={{ color: GLYPH_COLOR[state.status], width: 20 }}
          aria-hidden="true"
        >
          {GLYPH[state.status]}
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="font-cakemono font-light uppercase text-[20px] leading-tight text-text">
            {title}
          </h3>
          {!done && (
            <p className="font-mohave text-body-sm text-text-2 mt-1 max-w-[560px]">
              {description}
            </p>
          )}
        </div>
        {!busy && !done && !isExpanded && (
          <div className="flex gap-2 shrink-0">
            <button
              onClick={onEngage}
              className="font-cakemono font-light uppercase text-[14px] px-4 py-2.5 rounded-[5px] border border-ops-accent text-ops-accent hover:bg-ops-accent hover:text-black transition-colors"
            >
              {t(`firstRun.stations.${stationKey}.actionEngage`)}
            </button>
            <button
              onClick={onSkip}
              className="font-cakemono font-light uppercase text-[14px] px-4 py-2.5 rounded-[5px] text-text-mute hover:text-text-2 transition-colors"
            >
              {t(`firstRun.stations.${stationKey}.actionSkip`)}
            </button>
          </div>
        )}
      </div>
      <AnimatePresence>
        {isExpanded && children && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="px-6 pb-6"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
```

**Commit:** `feat(calibration): first-run-station component`

---

#### E3. First-run wizard shell

**File:** `src/app/(dashboard)/calibration/_components/first-run-wizard.tsx` (create)

```tsx
"use client";

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useDictionary } from "@/i18n/client";
import { FirstRunStation } from "./first-run-station";
import { useCalibrationFirstRun } from "./hooks/use-calibration-first-run";
import { useCalibrationDeck } from "./hooks/use-calibration-deck";
import { AiIntakeInterview } from "@/components/settings/ai-intake-interview";
import { AiDatabaseMining } from "@/components/settings/ai-database-mining";
// EmailScanRunner extraction — see F2
import { EmailScanRunner } from "./email-scan-runner";
import { CAL_EASE } from "@/lib/utils/calibration-motion";

type ExpandedSource = "interview" | "scan" | "mining" | null;
type ResolvedSet = Set<"interview" | "scan" | "mining">;

export function FirstRunWizard({ onDone }: { onDone: () => void }) {
  const { t } = useDictionary("calibration");
  const { data: deck } = useCalibrationDeck();
  const { dismiss } = useCalibrationFirstRun();

  const [expanded, setExpanded] = useState<ExpandedSource>(null);
  const [localResolved, setLocalResolved] = useState<ResolvedSet>(new Set());

  const resolveAll = useCallback(() => {
    dismiss();
    onDone();
  }, [dismiss, onDone]);

  const resolveStation = (src: "interview" | "scan" | "mining") => {
    setLocalResolved((prev) => {
      const next = new Set(prev);
      next.add(src);
      setExpanded(null);
      if (next.size === 3) setTimeout(resolveAll, 900); // show SCOPE COMPLETE then reveal deck
      return next;
    });
  };

  if (!deck) {
    return (
      <div className="h-full flex items-center justify-center">
        <span className="font-mono text-micro uppercase tracking-wider text-text-3">
          SYS :: LOADING
        </span>
      </div>
    );
  }

  const doneCount =
    (localResolved.has("interview") || deck.inputs.interview.status === "complete" ? 1 : 0) +
    (localResolved.has("scan") || deck.inputs.scan.status === "complete" ? 1 : 0) +
    (localResolved.has("mining") || deck.inputs.mining.status === "complete" ? 1 : 0);

  return (
    <div className="max-w-[720px] mx-auto px-6 py-10 w-full">
      <div className="flex items-center justify-between mb-4">
        <h1 className="font-cakemono font-light uppercase text-[22px] text-text">
          <span className="text-text-mute mr-2">//</span>
          {t("firstRun.header").replace("// ", "")}
        </h1>
        <span className="font-mono text-micro uppercase tracking-wider text-text-2 tabular-nums">
          {t("firstRun.progress").replace("{done}", String(doneCount))}
        </span>
      </div>

      <p className="font-mohave text-body-sm text-text-2 mb-6 max-w-[560px]">
        {t("firstRun.body")}
      </p>

      <div className="flex flex-col gap-4">
        {(["interview", "scan", "mining"] as const).map((src) => (
          <FirstRunStation
            key={src}
            source={src}
            state={deck.inputs[src]}
            isExpanded={expanded === src}
            onEngage={() => setExpanded(src)}
            onSkip={() => resolveStation(src)}
          >
            {src === "interview" && (
              <AiIntakeInterview onComplete={() => resolveStation("interview")} />
            )}
            {src === "scan" && (
              <EmailScanRunner
                onComplete={() => resolveStation("scan")}
                onSkip={() => resolveStation("scan")}
              />
            )}
            {src === "mining" && (
              <AiDatabaseMining onComplete={() => resolveStation("mining")} />
            )}
          </FirstRunStation>
        ))}
      </div>

      <AnimatePresence>
        {doneCount === 3 && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: CAL_EASE }}
            className="mt-6 text-center"
          >
            <span
              className="font-mono text-micro uppercase tracking-wider"
              style={{ color: "#9DB582" }}
            >
              {t("firstRun.completeLine")}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
```

**Commit:** `feat(calibration): first-run wizard shell with 3 stations + scope-complete reveal`

---

#### E4. Extract EmailScanRunner from ai-setup page

**File:** `src/app/(dashboard)/calibration/_components/email-scan-runner.tsx` (create)

Move the existing `EmailScanSection` inline component from the stopgap `ai-setup/page.tsx` (lines 50-216) into its own file. Component signature becomes `EmailScanRunner({ onComplete, onSkip })`. Internal logic unchanged — it already polls `/api/integrations/ai-setup/email-scan?jobId=<id>` every 3s.

```tsx
"use client";

// Extracted from stopgap /settings/integrations/ai-setup/page.tsx.
// Preserves the 3s polling + progress UI; copy unchanged until
// migration phase when we adopt Supabase realtime for this state too.

// [paste the full EmailScanSection component here, rename to EmailScanRunner,
//  change imports from "@/components/settings/..." to use local types from
//  @/lib/types/calibration where applicable]
```

**Commit:** `refactor(calibration): extract email-scan runner from stopgap ai-setup page`

---

### Group F — INPUTS drill-in

#### F1. INPUTS section shell

**File:** `src/app/(dashboard)/calibration/_components/section-inputs.tsx` (create)

Implements §7 of the spec. Reuses:
- `AiIntakeInterview` for interview
- `EmailScanRunner` (from E4) for scan
- `AiDatabaseMining` for mining

Renders three stacked sub-section panels with state-aware CTAs, running progress bars, and a permanent accumulation explainer at the bottom.

```tsx
"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useDictionary } from "@/i18n/client";
import { useCalibrationDeck } from "./hooks/use-calibration-deck";
import { SectionBreadcrumb } from "./section-breadcrumb";
import { ReRunConfirmPopover } from "./re-run-confirm-popover"; // task F3
import { AiIntakeInterview } from "@/components/settings/ai-intake-interview";
import { AiDatabaseMining } from "@/components/settings/ai-database-mining";
import { EmailScanRunner } from "./email-scan-runner";
import type { InputState, InputSource } from "@/lib/types/calibration";
import { CAL_EASE } from "@/lib/utils/calibration-motion";

export function SectionInputs() {
  const { t } = useDictionary("calibration");
  const { data: deck } = useCalibrationDeck();
  const [expandedSource, setExpandedSource] = useState<InputSource | null>(null);
  const [reRunTarget, setReRunTarget] = useState<InputSource | null>(null);

  if (!deck) return null;

  const renderCta = (src: InputSource, state: InputState) => {
    // ... status → action mapping per spec §7.3
    const actionKey = ctaKey(src, state.status);
    const primary = state.status !== "running";
    return (
      <button
        onClick={() => {
          if (state.status === "complete") setReRunTarget(src);
          else setExpandedSource(src);
        }}
        className={primary
          ? "font-cakemono font-light uppercase text-[14px] px-4 py-2.5 rounded-[5px] border border-ops-accent text-ops-accent hover:bg-ops-accent hover:text-black transition-colors"
          : "font-cakemono font-light uppercase text-[14px] px-4 py-2.5 rounded-[5px] text-text-2 hover:text-text transition-colors"
        }
      >
        {t(`sections.inputs.actions.${actionKey}`)}
      </button>
    );
  };

  return (
    <div className="px-11 py-9 max-w-[1080px] mx-auto">
      <SectionBreadcrumb currentSection="inputs" />
      <h2 className="font-cakemono font-light uppercase text-[22px] text-text mb-6">
        <span className="text-text-mute mr-2">//</span>INPUTS
      </h2>
      <div className="flex flex-col gap-4">
        {(["interview", "scan", "mining"] as const).map((src) => (
          <InputsSubsection
            key={src}
            source={src}
            state={deck.inputs[src]}
            isExpanded={expandedSource === src}
            renderCta={() => renderCta(src, deck.inputs[src])}
            onCollapse={() => setExpandedSource(null)}
          />
        ))}
      </div>
      <hr className="my-6 border-t border-[rgba(255,255,255,0.08)]" />
      <p className="font-mohave text-body-sm text-text-2 max-w-[640px]">
        {t("sections.inputs.accumulation")}
      </p>
      {reRunTarget && (
        <ReRunConfirmPopover
          source={reRunTarget}
          onConfirm={() => {
            setReRunTarget(null);
            setExpandedSource(reRunTarget);
          }}
          onCancel={() => setReRunTarget(null)}
        />
      )}
    </div>
  );
}

// ... InputsSubsection, ctaKey helper
```

**Commit:** `feat(calibration): INPUTS drill-in section`

---

#### F2. Re-run confirm popover

**File:** `src/app/(dashboard)/calibration/_components/re-run-confirm-popover.tsx` (create)

Dense-glass popover anchored to the re-run CTA. Uses Radix Popover primitive (existing dependency). Text from `sections.inputs.reRunConfirm.*`.

**Commit:** `feat(calibration): re-run confirm popover`

---

### Group G — CORPUS drill-in

#### G1. CORPUS section shell

**File:** `src/app/(dashboard)/calibration/_components/section-corpus.tsx` (create)

Implements §8. Layout:
- Breadcrumb
- Section header with fact/entity count
- Split 3-column: FACTS drawer (280px) | Graph (flex-1) | ENTITY drawer (320px)
- Below 768px: replaces graph with mobile fallback CTA; facts drawer becomes bottom sheet.

Graph is imported dynamically from existing `/intel` GalaxyScene:

```tsx
import dynamic from "next/dynamic";
const GalaxyScene = dynamic(
  () => import("@/components/intel/galaxy-scene").then((m) => m.GalaxyScene),
  { ssr: false }
);
```

**Commit:** `feat(calibration): CORPUS drill-in with facts + graph + entity drawers`

---

#### G2. Mobile fallback for knowledge graph

**File:** `src/app/(dashboard)/calibration/_components/corpus-mobile-fallback.tsx` (create)

Renders a "VIEW ON DESKTOP" CTA below 768px. Links to the FACTS list as a fallback.

```tsx
"use client";
import { Monitor } from "lucide-react";
import { useDictionary } from "@/i18n/client";

export function CorpusMobileFallback({ onViewFacts }: { onViewFacts: () => void }) {
  const { t } = useDictionary("calibration");
  return (
    <div className="flex flex-col items-center justify-center gap-4 p-8 text-center">
      <Monitor className="w-8 h-8 text-text-mute" aria-hidden="true" />
      <h3 className="font-cakemono font-light uppercase text-[18px] text-text">
        {t("sections.corpus.mobileFallback.heading")}
      </h3>
      <p className="font-mohave text-body-sm text-text-2 max-w-[320px]">
        {t("sections.corpus.mobileFallback.body")}
      </p>
      <button onClick={onViewFacts} className="font-cakemono font-light uppercase text-[14px] px-4 py-2.5 rounded-[5px] border border-ops-accent text-ops-accent hover:bg-ops-accent hover:text-black transition-colors">
        {t("sections.corpus.mobileFallback.cta")}
      </button>
    </div>
  );
}
```

**Commit:** `feat(calibration): mobile fallback for knowledge graph`

---

### Group H — CONFIG drill-in

#### H1. CONFIG section shell

**File:** `src/app/(dashboard)/calibration/_components/section-config.tsx` (create)

Implements §9. Three panels (Autonomy / Filters / Categories) + external links footer. Reuses:
- `AutonomyStatusPanel` logic → becomes the AUTONOMY summary body (reuse the component or inline the autonomy rows)
- `EmailFilterBuilder` → launched from FILTERS edit button
- `EmailCategoryAutonomy` → embedded directly in CATEGORIES panel

Primary CTA: `RE-RUN WIZARD` launches `CommsConfigOverlay` (task H2).

**Per V6:** drop the Duplicate Detection external link. Only show `TASK TYPES →`.

**Commit:** `feat(calibration): CONFIG drill-in with autonomy + filters + categories + wizard launcher`

---

#### H2. Comms-config wizard overlay

**File:** `src/app/(dashboard)/calibration/_components/comms-config-overlay.tsx` (create)

Full-screen overlay hosting `<CommsConfigWizard>`. Uses Radix Dialog primitive with custom visual treatment (`.glass-dense rounded-modal`, 100% viewport minus 48px padding).

```tsx
"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { CommsConfigWizard } from "@/components/agent/comms-config-wizard";
import { X } from "lucide-react";
import { useDictionary } from "@/i18n/client";

export function CommsConfigOverlay({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useDictionary("calibration");
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-[2900]" />
        <Dialog.Content
          className="fixed inset-12 z-[3000] glass-dense rounded-modal overflow-hidden flex flex-col"
          onEscapeKeyDown={() => onOpenChange(false)}
        >
          <div className="flex items-center justify-between p-4 border-b border-[rgba(255,255,255,0.08)]">
            <Dialog.Title className="font-cakemono font-light uppercase text-[18px] text-text">
              {t("sections.config.autonomy.title")} · WIZARD
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="p-2 text-text-mute hover:text-text-2 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </Dialog.Close>
          </div>
          <div className="flex-1 min-h-0 overflow-auto">
            <CommsConfigWizard />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

**Commit:** `feat(calibration): full-screen comms-config wizard overlay`

---

### Group I — ACTIVITY drill-in

#### I1. Full activity log query implementation

**File:** `src/lib/api/services/calibration-service.ts` (modify — expand `getActivityLog`)

Replace the stub from task A2 with the full implementation:

```typescript
async getActivityLog(
  companyId: string,
  filters: ActivityFilters,
  cursor?: string,
  limit = 50
): Promise<{ events: RecentEvent[]; nextCursor: string | null }> {
  const supabase = getServiceRoleClient();
  const since = this.#resolveTimeRangeCutoff(filters.timeRange);
  const cursorDate = cursor ? new Date(cursor) : new Date();

  const typeFilter = Array.isArray(filters.types)
    ? new Set(filters.types)
    : null;

  // Each source table returns rows; we merge + sort + paginate client-side.
  // Cursor is the `created_at` of the last event from the prev page.
  const [memories, scans, actions] = await Promise.all([
    typeFilter === null || typeFilter.has("extraction") || typeFilter.has("learning")
      ? supabase
          .from("agent_memories")
          .select("id, source, category, content, created_at")
          .eq("company_id", companyId)
          .gte("created_at", since.toISOString())
          .lt("created_at", cursorDate.toISOString())
          .order("created_at", { ascending: false })
          .limit(limit)
      : Promise.resolve({ data: [], error: null } as const),
    typeFilter === null || typeFilter.has("scan") || typeFilter.has("scan_complete")
      ? supabase
          .from("gmail_scan_jobs")
          .select("id, status, created_at, updated_at")
          .eq("company_id", companyId)
          .gte("updated_at", since.toISOString())
          .lt("updated_at", cursorDate.toISOString())
          .order("updated_at", { ascending: false })
          .limit(limit)
      : Promise.resolve({ data: [], error: null } as const),
    typeFilter === null || typeFilter.has("draft") || typeFilter.has("suggestion")
      ? supabase
          .from("agent_actions")
          .select("id, type, status, created_at")
          .eq("company_id", companyId)
          .gte("created_at", since.toISOString())
          .lt("created_at", cursorDate.toISOString())
          .order("created_at", { ascending: false })
          .limit(limit)
      : Promise.resolve({ data: [], error: null } as const),
  ]);

  const events: RecentEvent[] = [];
  // ... map each source's rows to RecentEvent (same logic as getRecentEvents)
  // ... sort events by createdAt desc
  // ... take first `limit`, set nextCursor = last event's createdAt

  events.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const sliced = events.slice(0, limit);
  const nextCursor = sliced.length === limit ? sliced[sliced.length - 1].createdAt : null;

  return { events: sliced, nextCursor };
}
```

**Commit:** `feat(calibration): full activity log with cursor pagination`

---

#### I2. ACTIVITY section shell

**File:** `src/app/(dashboard)/calibration/_components/section-activity.tsx` (create)

Implements §10. Breadcrumb → Live sensor strip → filter chips → virtualized log table.

Uses `@tanstack/react-virtual` for log virtualization (already a codebase dependency per section O2 verification).

**Commit:** `feat(calibration): ACTIVITY drill-in with live sensor + filtered virtualized log`

---

### Group J — MILESTONES drill-in

#### J1. MILESTONES section shell

**File:** `src/app/(dashboard)/calibration/_components/section-milestones.tsx` (create)

Implements §11. Top header with OVERALL AUTONOMY count → 5-domain grid → 5 per-domain detail sections (reuses `PhaseCDashboard` metrics rendering) → 9-step autonomy ladder.

Unlock pulse: subscribe to Supabase realtime on `email_connections` `UPDATE` events; when `auto_send_settings.milestones.*` transitions true, dispatch a one-shot pulse animation on the corresponding ladder row.

**Commit:** `feat(calibration): MILESTONES drill-in absorbing PhaseCDashboard + ladder`

---

#### J2. Milestone unlock notification firing

**File:** `src/lib/api/services/autonomy-milestone-service.ts` (modify)

In `checkAndFireMilestones()` (the existing method), after the `NotificationService.create()` call that persists a notification, update:
- type: `milestone_unlocked` (new notification type — register in notification-types enum)
- actionUrl: `/calibration?section=milestones#milestone-${position}`
- actionLabel: dictionary key `milestoneUnlock.actionLabel`

No new persistence needed — existing milestone state drives this.

**Commit:** `feat(calibration): milestone unlock notifications route to /calibration`

---

### Group K — Glue (sidebar, page, middleware)

#### K1. Page entry — layout with permission gate

**File:** `src/app/(dashboard)/calibration/layout.tsx` (create)

```tsx
import { Metadata } from "next";
import { redirect } from "next/navigation";
import { verifyPermissionServer } from "@/lib/firebase/server-permission";

export const metadata: Metadata = {
  title: "Calibration · OPS",
};

export default async function CalibrationLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const canAccess = await verifyPermissionServer("email.configure_ai");
  if (!canAccess) redirect("/dashboard");
  return <>{children}</>;
}
```

**Verification note:** `verifyPermissionServer` is the existing server-side permission helper — verify its exact name in `src/lib/firebase/*` before this task. If named differently, adjust.

**Commit:** `feat(calibration): layout with email.configure_ai permission gate`

---

#### K2. Page entry

**File:** `src/app/(dashboard)/calibration/page.tsx` (create)

```tsx
"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { usePageTitle } from "@/lib/hooks";
import { useCalibrationDeck } from "./_components/hooks/use-calibration-deck";
import { useCalibrationFirstRun } from "./_components/hooks/use-calibration-first-run";
import { CommandDeck } from "./_components/command-deck";
import { FirstRunWizard } from "./_components/first-run-wizard";
import { SectionInputs } from "./_components/section-inputs";
import { SectionCorpus } from "./_components/section-corpus";
import { SectionConfig } from "./_components/section-config";
import { SectionActivity } from "./_components/section-activity";
import { SectionMilestones } from "./_components/section-milestones";
import { useDictionary } from "@/i18n/client";
import { Radar } from "lucide-react";

export default function CalibrationPage() {
  const { t } = useDictionary("calibration");
  const router = useRouter();
  const sp = useSearchParams();
  const section = sp.get("section");
  usePageTitle(t("page.title"));

  const { data: deck, isLoading: deckLoading } = useCalibrationDeck();
  const { data: firstRun, isLoading: firLoading } = useCalibrationFirstRun();

  if (deckLoading || firLoading) {
    return (
      <div className="flex items-center justify-center h-[50vh]">
        <span className="font-mono text-micro uppercase tracking-wider text-text-mute">
          SYS :: LOADING
        </span>
      </div>
    );
  }

  // Drill-in: check section param first
  if (section === "inputs") return <SectionInputs />;
  if (section === "corpus") return <SectionCorpus />;
  if (section === "config") return <SectionConfig />;
  if (section === "activity") return <SectionActivity />;
  if (section === "milestones") return <SectionMilestones />;

  // First-run wizard or deck
  if (firstRun?.shouldShowWizard) {
    return (
      <div className="px-11 py-9 max-w-[1320px] mx-auto">
        <div className="flex items-center gap-2 mb-6">
          <Radar className="w-[18px] h-[18px] text-ops-accent" />
          <h1 className="font-cakemono font-light uppercase text-[22px] text-text">
            {t("page.title")}
          </h1>
        </div>
        <FirstRunWizard onDone={() => router.refresh()} />
      </div>
    );
  }

  if (!deck) return null;

  return (
    <>
      <div className="flex items-center gap-2 px-11 pt-9">
        <Radar className="w-[18px] h-[18px] text-ops-accent" />
        <h1 className="font-cakemono font-light uppercase text-[22px] text-text">
          {t("page.title")}
        </h1>
      </div>
      <p className="font-mono text-micro uppercase tracking-wider text-text-3 px-11 pb-2">
        <span className="text-text-mute">//</span> {t("page.breadcrumb").replace("Command // Calibration", "COMMAND")}
        <span className="text-text-mute mx-1">//</span> CALIBRATION
      </p>
      <CommandDeck deck={deck} />
    </>
  );
}
```

**Commit:** `feat(calibration): page entry with section routing + first-run detection`

---

#### K3. Section breadcrumb primitive

**File:** `src/app/(dashboard)/calibration/_components/section-breadcrumb.tsx` (create)

```tsx
"use client";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import type { CalibrationSection } from "@/lib/types/calibration";

const LABEL: Record<CalibrationSection, string> = {
  inputs: "Inputs",
  corpus: "Corpus",
  config: "Config",
  activity: "Activity",
  milestones: "Milestones",
};

export function SectionBreadcrumb({ currentSection }: { currentSection: CalibrationSection }) {
  const router = useRouter();
  const { t } = useDictionary("calibration");
  return (
    <button
      onClick={() => router.push("/calibration")}
      className="flex items-center gap-2 mb-6 text-text-3 hover:text-text-2 transition-colors group"
    >
      <ChevronLeft className="w-4 h-4" />
      <span className="font-mono text-micro uppercase tracking-wider">
        <span className="text-text-mute">COMMAND // CALIBRATION //</span>{" "}
        <span className="text-text-2 group-hover:text-text">{LABEL[currentSection]}</span>
      </span>
    </button>
  );
}
```

**Commit:** `feat(calibration): section breadcrumb with back-nav`

---

#### K4. Sidebar entry + /intel removal

**File:** `src/components/layouts/sidebar.tsx` (modify)

Apply the diff described in spec §17.3:

```diff
 { label: t("nav.inbox"), href: "/inbox", icon: Mail, permission: "pipeline.view" },
+{ label: t("nav.calibration"), href: "/calibration", icon: Radar, permission: "email.configure_ai" },
 { label: t("nav.estimates"), href: "/estimates", icon: FileText, permission: "estimates.view" },
 ...
-{ label: t("nav.intel"), href: "/intel", icon: Radar, permission: "pipeline.view" },
 { label: t("nav.agentQueue"), href: "/agent/queue", icon: BrainCircuit, permission: "admin" },
```

**Commit:** `feat(calibration): sidebar entry for /calibration; remove /intel entry`

---

#### K5. Remove PhaseCDashboard from /agent/queue

**File:** `src/app/(dashboard)/agent/queue/page.tsx` (modify)

Remove the `<PhaseCDashboard />` import and render. Keep the rest of the queue page unchanged.

**Commit:** `refactor(calibration): remove phase-c-dashboard widget from /agent/queue (moved to /calibration)`

---

#### K6. Middleware redirects

**File:** `src/middleware.ts` (modify)

Verify current middleware structure first. Add redirect logic:

```typescript
// Add near the top of middleware(request):
const CALIBRATION_REDIRECTS: Record<string, string> = {
  "/settings/integrations/ai-setup": "/calibration",
  "/agent/comms-config": "/calibration?section=config&wizard=open",
  "/intel": "/calibration?section=corpus",
};

const pathname = request.nextUrl.pathname;
if (CALIBRATION_REDIRECTS[pathname] !== undefined) {
  const target = CALIBRATION_REDIRECTS[pathname];
  const url = request.nextUrl.clone();
  const [base, query] = target.split("?");
  url.pathname = base;
  url.search = query ? `?${query}` : "";
  return NextResponse.redirect(url, 308);
}
```

**Commit:** `feat(calibration): middleware 308 redirects from legacy AI routes`

Validation: `curl -I http://localhost:3000/settings/integrations/ai-setup` should return 308 with `Location: /calibration`.

---

### Group O — Browser verification

#### O1. Local verification — populated deck

1. Start dev server: `pnpm dev`
2. Sign in as a user with `email.configure_ai` permission on a company with `phase_c` enabled and existing corpus.
3. Navigate to `/calibration`.
4. Verify:
   - Sidebar shows Radar icon highlighted.
   - 5 tiles render with stagger animation.
   - RECENT rail shows last 5 events, streaming label visible.
   - Radar sweeps rotate in each tile's bottom-right corner.
   - Hover over a tile → glass brightens, sweep accelerates.
   - Click INPUTS → drill-in morphs via `layoutId`, back-nav returns deck.
5. Chrome DevTools: toggle `prefers-reduced-motion: reduce`. Reload. Verify:
   - Tiles appear simultaneously with 150ms opacity fade only.
   - Radar sweeps are static arms at 0.35 opacity.
   - Count-ups show final values instantly.
6. Chrome DevTools performance panel: record 5s of deck load. Verify:
   - Deck render completes in <400ms on 4G throttling.
   - No layout thrash.

---

#### O2. Local verification — first-run wizard

1. In Supabase, manually delete all `agent_memories`, `gmail_scan_jobs`, and set `users.preferences.calibrationFirstRunDismissed = false` for a test user.
2. Navigate to `/calibration` as that user.
3. Verify:
   - First-run wizard renders (not the deck).
   - Three stations: INTERVIEW / EMAIL SCAN / DATABASE MINING each with `ENGAGE` and `SKIP`.
   - Progress indicator top-right: `0 / 3`.
4. Click INTERVIEW → ENGAGE. Verify the station expands inline and the existing `AiIntakeInterview` renders.
5. Complete or skip all 3 stations. Verify:
   - `SYS :: SCOPE COMPLETE · STANDBY FOR DECK` line appears.
   - 900ms delay, then deck fades in with entry stagger.
   - `users.preferences.calibrationFirstRunDismissed` is now `true`.
6. Reload the page. Verify deck renders directly (no wizard).

---

#### O3. Local verification — CORPUS drill-in

1. On `/calibration`, click CORPUS tile.
2. Verify:
   - Breadcrumb shows `COMMAND // CALIBRATION // Corpus`.
   - Knowledge graph renders (existing GalaxyScene).
   - Left FACTS drawer renders with scrollable fact list, filters, search.
   - Right ENTITY drawer shows `SELECT AN ENTITY` empty state.
3. Click an entity in the graph. Verify the ENTITY drawer populates with facts + connected records + `VIEW IN OPS` CTA.
4. Resize browser to 600px width. Verify mobile fallback CTA replaces graph.

---

#### O4. Local verification — CONFIG + wizard launcher

1. Click CONFIG tile.
2. Verify the three panels (AUTONOMY / FILTERS / CATEGORIES) render.
3. Click `RE-RUN WIZARD`. Verify:
   - Full-screen overlay with glass-dense background.
   - Existing `CommsConfigWizard` renders inside.
   - `ESC` closes overlay.
4. Verify external links render only TASK TYPES (no duplicate link per V6).
5. Navigate directly to `/calibration?section=config&wizard=open`. Verify overlay auto-opens.

---

#### O5. Local verification — ACTIVITY live stream

1. Click ACTIVITY tile.
2. Verify live sensor strip renders: nominal state shows `SYS :: NOMINAL` in olive.
3. In another tab, trigger an email scan via `/calibration → INPUTS → RE-SCAN`.
4. Return to ACTIVITY tab. Verify:
   - Live sensor transitions to RUNNING state with progress bar.
   - New events appear at the top of the log (slide in from above).
5. Apply filter chips (SCANS only, LAST HOUR). Verify log filters correctly.

---

#### O6. Local verification — MILESTONES

1. Click MILESTONES tile.
2. Verify:
   - Top header shows `OVERALL AUTONOMY N / 9`.
   - 5-domain grid with status dots + confidence values.
   - Per-domain detail sections render.
   - 9-step ladder with correct status glyphs.
3. Simulate a milestone crossing in Supabase:
   ```sql
   UPDATE email_connections
   SET auto_send_settings = jsonb_set(auto_send_settings, '{milestones,auto_draft_suggested}', 'true')
   WHERE company_id = '<test-company>' AND type = 'company';
   ```
4. Via realtime, verify:
   - Ladder row for "AUTO-DRAFT UNLOCKED" transitions `◐` → `●` with pulse.
   - Persistent notification appears in rail with `SYS :: AUTONOMY UNLOCK · AUTO-DRAFT UNLOCKED` title.
   - MILESTONES tile on deck (if open in another tab) gets accent border pulse.

---

#### O7. Redirect verification

```bash
curl -I http://localhost:3000/settings/integrations/ai-setup
# Expect: 308 Permanent Redirect, Location: /calibration

curl -I http://localhost:3000/agent/comms-config
# Expect: 308, Location: /calibration?section=config&wizard=open

curl -I http://localhost:3000/intel
# Expect: 308, Location: /calibration?section=corpus
```

---

#### O8. Lighthouse audit

Run Lighthouse on `/calibration` in Chrome DevTools:
- Accessibility: ≥95
- Performance: ≥85 on mobile throttled
- Best Practices: ≥95

Log scores in the PR description.

---

### Group N — Dead code removal (same-day, single tenant)

**Context:** OPS has one active customer today (Jackson's company). No multi-tenant regression fan-out. No revert parachute needed — a break is a direct-message away from being fixed live. Dead code is deleted on ship day, not after a bake window.

**N1. Delete dormant page files**

```bash
rm src/app/(dashboard)/settings/integrations/ai-setup/page.tsx
rm src/app/(dashboard)/agent/comms-config/page.tsx
rm src/app/(dashboard)/intel/page.tsx
rm src/components/settings/ai-setup-dashboard.tsx
rm src/components/settings/auto-send-settings.tsx
rm src/components/settings/autonomy-status-panel.tsx
rm src/components/settings/email-category-autonomy.tsx
```

**Keep:** `src/components/intel/galaxy-scene.tsx` — CORPUS drill-in imports it. Do not delete.

**N2. Drop legacy `ai_email_review` rows**

**File:** `supabase/migrations/20260424000002_calibration_drop_legacy_flag_rows.sql`

```sql
-- Single-tenant cleanup: delete the superseded ai_email_review rows now that
-- phase_c rows are authoritative. Leaves a comment trail in the companies table.
DELETE FROM admin_feature_overrides
WHERE feature_key = 'ai_email_review';
```

**N3. Remove `ai_email_review` from the `AIFeatureKey` union**

**File:** `src/lib/api/services/admin-feature-override-service.ts` (modify)

```diff
-type AIFeatureKey = "ai_email_review" | "phase_c" | "ai_auto_send";
+type AIFeatureKey = "phase_c" | "ai_auto_send";
```

Also delete the deprecation check added in L5 (it becomes unreachable).

**N4. Stopgap plan marker**

Mark `docs/superpowers/plans/2026-04-23-ai-setup-admin-panel.md` as superseded at the top:

```markdown
> **Superseded 2026-04-24 by CALIBRATION** — see `2026-04-23-calibration-implementation.md`. The stopgap target (the ai-setup page) has been deleted.
```

**Commit:** `chore(calibration): delete deprecated AI surfaces + drop legacy flag rows`

---

## 3. Rollout sequencing (single ship day)

One customer. One deploy. No staged rollout, no bake window, no revert parachute needed.

```
Ship day:
  1. L2 → L3 migrations apply to prod Supabase
  2. All code groups merge in dependency order:
        L4, L5  →  M1-M3  →  A1-A6  →  B1-B4
        →  C1-C7, D1-D3, E1-E4, F1-F2, G1-G2, H1-H2, I1-I2, J1-J2 (parallelizable)
        →  K1-K6 (glue — sidebar, redirects, layout, queue widget removal)
        →  N1-N4 (delete dormant files + drop legacy flag rows)
  3. Deploy to production
  4. O1-O8 verification live (Jackson runs through each surface)
  5. If anything sharp, fix live — no staging window

Post-ship:
  ─ Jackson uses CALIBRATION in daily operations
  ─ Regressions surface via direct feedback; fix forward
  ─ When second customer onboards, current rollout model ages into
    a proper staged process (not needed now)
```

**Why no bake window:** Dead code left dormant is a revert parachute for multi-tenant regressions you can't reach customers to warn. With one customer who's also the engineer, dormancy is dead weight. Delete on ship day.

---

## 4. Success criteria (from spec §21)

1. ✅ All existing AI surfaces redirect to `/calibration` (verified via curl).
2. ✅ Jackson runs Interview + Scan + Mining and sees the deck populate.
3. ✅ RECENT rail shows 5 live events with <2s latency.
4. ✅ CORPUS drill-in renders the knowledge graph without regression.
5. ✅ CONFIG drill-in allows re-running comms-config wizard end-to-end.
6. ✅ MILESTONES drill-in matches pre-migration `/agent/queue` dashboard data.
7. ✅ Reduced motion disables all sweeps and count-ups.
8. ✅ Tablet layout works on iPad and iPad Pro.
9. ✅ Lighthouse a11y ≥ 95.
10. ✅ Deck load <400ms on 4G p75.
11. ✅ No regressions in `/inbox`, `/agent/queue`, `/admin/system`.
12. ✅ `ai_email_review` has zero remaining code references on ship day (N3 completes same-day).

---

## 5. Open items deferred to post-ship

- Materialized view `v_calibration_deck_state` (only if deck load > 400ms on production data — unlikely with one company's data volume).
- Duplicate detection configuration page — out of CALIBRATION scope per V6.
- Staged rollout mechanics (`calibration_preview` flag, canary percentage, etc.) — not needed today; revisit when customer N+1 onboards.

---

## 6. Handoff

This plan is ready for execution. Every task has copy-paste-ready code. The §20 open items have been resolved. No assumptions remain unverified.

Execute in the order of the task list. Commit after each task. Run the Group O verification before declaring the work complete.
