# Discarded Stage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `discarded` as a third terminal stage for pipeline opportunities, enabling ad targeting quality analytics (won+lost vs discarded).

**Architecture:** Add `discarded` to the Postgres CHECK constraint and TypeScript enum. Update stage helpers so `isActiveStage` and `isTerminalStage` recognize it. Wire it into the confirm step dropdown, pipeline card actions dropdown, and metrics bar. Discarded leads stay in the system but are off the active board — same behavior as won/lost.

**Tech Stack:** Supabase (Postgres migration), TypeScript, React, TanStack Query, Framer Motion, i18n dictionaries.

---

### Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/045_discarded_stage.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 045_discarded_stage.sql
-- Add 'discarded' as a terminal stage for pipeline opportunities.
-- Discarded = lead contacted us but was not worth pursuing (ad quality signal).

ALTER TABLE opportunities DROP CONSTRAINT IF EXISTS opportunities_stage_check;
ALTER TABLE opportunities ADD CONSTRAINT opportunities_stage_check
  CHECK (stage IN ('new_lead','qualifying','quoting','quoted','follow_up','negotiation','won','lost','discarded'));
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/045_discarded_stage.sql
git commit -m "feat(db): add discarded to opportunity stage CHECK constraint"
```

---

### Task 2: TypeScript Enum, Colors, Stage Order, Helpers

**Files:**
- Modify: `src/lib/types/pipeline.ts`

- [ ] **Step 1: Add `Discarded` to the `OpportunityStage` enum**

At line 37 (after `Lost = "lost"`), add:

```typescript
  Discarded = "discarded",
```

- [ ] **Step 2: Add to `OPPORTUNITY_STAGE_COLORS`**

At line 204 (after the Lost entry), add:

```typescript
  [OpportunityStage.Discarded]: "#444444",
```

- [ ] **Step 3: Add to `PIPELINE_STAGES_DEFAULT`**

After the Lost entry (around line 348), add:

```typescript
  {
    name: "Discarded",
    slug: "discarded",
    color: "#444444",
    sortOrder: 8,
    winProbability: 0,
    autoFollowUpDays: null,
  },
```

- [ ] **Step 4: Add to `PIPELINE_STAGE_ORDER`**

At line 784 (after `OpportunityStage.Lost`), add:

```typescript
  OpportunityStage.Discarded,
```

- [ ] **Step 5: Update `isActiveStage`**

Change from:

```typescript
export function isActiveStage(stage: OpportunityStage): boolean {
  return stage !== OpportunityStage.Won && stage !== OpportunityStage.Lost;
}
```

To:

```typescript
export function isActiveStage(stage: OpportunityStage): boolean {
  return stage !== OpportunityStage.Won && stage !== OpportunityStage.Lost && stage !== OpportunityStage.Discarded;
}
```

- [ ] **Step 6: Update `isTerminalStage`**

Change from:

```typescript
export function isTerminalStage(stage: OpportunityStage): boolean {
  return stage === OpportunityStage.Won || stage === OpportunityStage.Lost;
}
```

To:

```typescript
export function isTerminalStage(stage: OpportunityStage): boolean {
  return stage === OpportunityStage.Won || stage === OpportunityStage.Lost || stage === OpportunityStage.Discarded;
}
```

- [ ] **Step 7: Verify the build compiles**

Run: `cd OPS-Web && npx tsc --noEmit 2>&1 | head -30`

Expected: No new errors related to OpportunityStage (existing errors may be present).

- [ ] **Step 8: Commit**

```bash
git add src/lib/types/pipeline.ts
git commit -m "feat: add Discarded to OpportunityStage enum and stage helpers"
```

---

### Task 3: Import Wizard Confirm Step — Add Discarded to Stage Dropdown

**Files:**
- Modify: `src/components/settings/wizard-steps/confirm-pipeline-step.tsx`

- [ ] **Step 1: Add `discarded` to `STAGE_CONFIG`**

At line 22 (after the `lost` entry), add:

```typescript
  discarded: { label: "Discarded", color: "#444444" },
```

- [ ] **Step 2: Add `discarded` to `ALL_STAGES`**

Change from:

```typescript
const ALL_STAGES = [
  "new_lead", "qualifying", "quoting", "quoted",
  "follow_up", "negotiation", "won", "lost",
];
```

To:

```typescript
const ALL_STAGES = [
  "new_lead", "qualifying", "quoting", "quoted",
  "follow_up", "negotiation", "won", "lost", "discarded",
];
```

- [ ] **Step 3: Update `counts` memo to count stage-based discarded leads**

The current logic counts a lead as discarded if `!lead.enabled` or triage decision is `"discard"`. It needs to also count leads whose stage is `"discarded"` in the confirm view. Replace the counts `useMemo` (lines 85-109):

```typescript
  const counts = useMemo(() => {
    let active = 0;
    let won = 0;
    let lost = 0;
    let discarded = 0;

    for (const lead of leads) {
      if (!lead.enabled) {
        discarded++;
        continue;
      }
      const decision = triageDecisions.get(lead.id);
      if (decision === "discard") {
        discarded++;
      } else if (decision === "won" || lead.stage === "won") {
        won++;
      } else if (decision === "lost" || lead.stage === "lost") {
        lost++;
      } else if (lead.stage === "discarded") {
        discarded++;
      } else if (!lead.needsReview) {
        active++;
      }
    }

    return { active, won, lost, discarded, importTotal: active + won + lost };
  }, [leads, triageDecisions]);
```

- [ ] **Step 4: Update `importableLeads` memo to exclude stage-discarded leads**

Replace the `importableLeads` `useMemo` (lines 112-121):

```typescript
  const importableLeads = useMemo(() => {
    return leads.filter((l) => {
      if (!l.enabled) return false;
      const decision = triageDecisions.get(l.id);
      if (decision === "discard") return false;
      if (l.stage === "discarded") return false;
      if (decision === "won" || decision === "lost" || decision === "active") return true;
      return !l.needsReview;
    });
  }, [leads, triageDecisions]);
```

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/wizard-steps/confirm-pipeline-step.tsx
git commit -m "feat: add discarded stage to import wizard confirm step dropdown"
```

---

### Task 4: Pipeline Card Actions — Add Discard to Dropdown

**Files:**
- Modify: `src/app/(dashboard)/pipeline/_components/pipeline-card-actions.tsx`

- [ ] **Step 1: Add `Ban` to lucide imports**

Change the import at line 2-15 from:

```typescript
import {
  Phone,
  MessageSquare,
  FileText,
  MoreHorizontal,
  Calendar,
  UserPlus,
  Trophy,
  XCircle,
  Archive,
  Trash2,
} from "lucide-react";
```

To:

```typescript
import {
  Phone,
  MessageSquare,
  FileText,
  MoreHorizontal,
  Calendar,
  UserPlus,
  Trophy,
  XCircle,
  Ban,
  Archive,
  Trash2,
} from "lucide-react";
```

- [ ] **Step 2: Add `onDiscard` to props interface**

Add to `PipelineCardActionsProps` (after `onMarkLost: () => void;`):

```typescript
  onDiscard: () => void;
```

- [ ] **Step 3: Add `onDiscard` to destructured props**

Add `onDiscard` to the destructured parameters of the component function (after `onMarkLost`):

```typescript
  onDiscard,
```

- [ ] **Step 4: Add Discard button to dropdown**

After the "Mark Lost" button (the `isActiveStage(stage)` guarded XCircle button, around line 277-285) and before the Archive button, add:

```typescript
              {isActiveStage(stage) && (
                <button
                  type="button"
                  onClick={(e) => handleDropdownAction(e, onDiscard)}
                  className="flex items-center gap-[8px] w-full px-[10px] py-[6px] font-mohave text-body-sm text-text-secondary hover:bg-[rgba(255,255,255,0.06)] rounded-[4px] transition-colors"
                >
                  <Ban size={14} className="shrink-0" />
                  {t("actions.discard")}
                </button>
              )}
```

- [ ] **Step 5: Commit**

```bash
git add src/app/(dashboard)/pipeline/_components/pipeline-card-actions.tsx
git commit -m "feat: add Discard action to pipeline card dropdown menu"
```

---

### Task 5: Pipeline Board — Wire `onDiscard` Prop

**Files:**
- Modify: `src/app/(dashboard)/pipeline/_components/pipeline-board.tsx`

- [ ] **Step 1: Add `onDiscard` to `PipelineBoardProps`**

Add to the interface (after `onArchive: (opportunityId: string) => void;` at line 41):

```typescript
  onDiscard: (opportunityId: string) => void;
```

- [ ] **Step 2: Destructure `onDiscard` in the component**

Add `onDiscard` to the destructured props of the `PipelineBoard` component (after `onArchive`).

- [ ] **Step 3: Pass `onDiscard` through `PipelineCard`**

In `pipeline-card.tsx`:
1. Add `onDiscard: () => void;` to the props interface (after `onArchive`)
2. Destructure `onDiscard` in the component params (after `onArchive`)
3. Pass `onDiscard={onDiscard}` to `<PipelineCardActions>` (after `onArchive={onArchive}`)

- [ ] **Step 4: Pass `onDiscard` in `pipeline-board.tsx`**

There are two locations where `PipelineCard` is rendered:

1. In the main column rendering (around line 249): add `onDiscard={() => onDiscard(opp.id)}` after `onArchive={onArchive}`
2. In the `DragOverlay` (around line 303): add `onDiscard={() => {}}` after `onArchive={() => {}}`

- [ ] **Step 5: Commit**

```bash
git add src/app/(dashboard)/pipeline/_components/pipeline-board.tsx src/app/(dashboard)/pipeline/_components/pipeline-card.tsx
git commit -m "feat: wire onDiscard prop through pipeline board to card actions"
```

---

### Task 6: Pipeline Metrics Bar — Add Discarded Count

**Files:**
- Modify: `src/app/(dashboard)/pipeline/_components/pipeline-metrics-bar.tsx`

- [ ] **Step 1: Add `Ban` to lucide imports**

Add `Ban` to the existing import from `lucide-react` at line 5:

```typescript
import { Trophy, XCircle, Ban, ChevronDown } from "lucide-react";
```

- [ ] **Step 2: Add discarded to the metrics computation**

In the `metrics` useMemo (starting at line 269), add after `lostDeals`:

```typescript
    const discardedDeals = opportunities.filter(
      (opp) => opp.stage === OpportunityStage.Discarded
    );
    const discardedCount = discardedDeals.length;
```

Add `discardedCount` and `discardedDeals` to the return object.

- [ ] **Step 3: Update the `expandedPanel` state type**

Change line 264 from:

```typescript
  const [expandedPanel, setExpandedPanel] = useState<"won" | "lost" | null>(
```

To:

```typescript
  const [expandedPanel, setExpandedPanel] = useState<"won" | "lost" | "discarded" | null>(
```

- [ ] **Step 4: Update `expandedDeals` and `expandedColor`**

Replace lines 337-347:

```typescript
  const expandedDeals =
    expandedPanel === "won"
      ? metrics.wonDeals
      : expandedPanel === "lost"
        ? metrics.lostDeals
        : expandedPanel === "discarded"
          ? metrics.discardedDeals
          : [];

  const expandedColor =
    expandedPanel === "won"
      ? OPPORTUNITY_STAGE_COLORS[OpportunityStage.Won]
      : expandedPanel === "lost"
        ? OPPORTUNITY_STAGE_COLORS[OpportunityStage.Lost]
        : OPPORTUNITY_STAGE_COLORS[OpportunityStage.Discarded];
```

- [ ] **Step 5: Add Discarded section after the Lost section**

After the Lost button (ends around line 526) and before the closing `</div>` of the metrics row, add a `<MetricDivider />` and the discarded button:

```tsx
        <MetricDivider />

        {/* 6. Discarded — clickable */}
        <button
          onClick={() =>
            setExpandedPanel((prev) => (prev === "discarded" ? null : "discarded"))
          }
          className={cn(
            "flex flex-col items-center justify-center px-4 py-[8px] shrink-0 cursor-pointer transition-colors group/discarded",
            expandedPanel === "discarded"
              ? "bg-[rgba(68,68,68,0.08)]"
              : "hover:bg-[rgba(255,255,255,0.02)]"
          )}
        >
          <div className="flex items-center gap-[6px]">
            <Ban
              className="w-[14px] h-[14px] shrink-0"
              style={{
                color:
                  expandedPanel === "discarded"
                    ? OPPORTUNITY_STAGE_COLORS[OpportunityStage.Discarded]
                    : "var(--text-tertiary, #777)",
              }}
            />
            <span className="font-mohave text-body-lg text-text-primary">
              {isLoading ? "--" : metrics.discardedCount}
            </span>
          </div>
          <div className="flex items-center gap-[2px] mt-[2px]">
            <span className="font-kosugi text-[11px] text-text-tertiary uppercase tracking-[0.12em]">
              {t("metrics.discarded")}
            </span>
            <ChevronDown
              className={cn(
                "w-[10px] h-[10px] text-text-disabled transition-transform duration-200",
                expandedPanel === "discarded" && "rotate-180"
              )}
            />
          </div>
        </button>
```

- [ ] **Step 6: Update the empty state text in the expandable panel**

Update the empty state string (around line 578-583) to handle discarded:

```typescript
                <span className="font-mohave text-body-sm text-text-disabled">
                  {expandedPanel === "won"
                    ? "No won deals yet"
                    : expandedPanel === "lost"
                      ? "No lost deals"
                      : "No discarded leads"}
                </span>
```

- [ ] **Step 7: Commit**

```bash
git add src/app/(dashboard)/pipeline/_components/pipeline-metrics-bar.tsx
git commit -m "feat: add discarded count and expandable section to pipeline metrics bar"
```

---

### Task 7: Pipeline Page — Wire `handleDiscard` and Pass to Board

**Files:**
- Modify: `src/app/(dashboard)/pipeline/page.tsx`

- [ ] **Step 1: Add `handleDiscard` callback**

After `handleMarkLost` (around line 488), add:

```typescript
  /** Discard — direct stage move, no confirmation dialog needed */
  const handleDiscard = useCallback(
    (opportunityId: string) => {
      handleMoveStage(opportunityId, OpportunityStage.Discarded);
    },
    [handleMoveStage]
  );
```

This leverages the existing `handleMoveStage` which handles the stage transition via the `moveStage` mutation. Since `OpportunityStage.Discarded` is not Won or Lost, it goes through the "Normal stage move" code path (no confirmation dialog). The `moveStage` mutation already creates the `StageTransition` record and handles optimistic updates.

- [ ] **Step 2: Add `onDiscard` to `sharedBoardProps`**

In the `sharedBoardProps` object (around line 644), add after `onArchive: handleArchive,`:

```typescript
    onDiscard: handleDiscard,
```

- [ ] **Step 3: Commit**

```bash
git add src/app/(dashboard)/pipeline/page.tsx
git commit -m "feat: wire handleDiscard to pipeline board via handleMoveStage"
```

---

### Task 8: i18n Dictionaries

**Files:**
- Modify: `src/i18n/dictionaries/en/pipeline.json`
- Modify: `src/i18n/dictionaries/es/pipeline.json`

- [ ] **Step 1: Add English pipeline translations**

Add after `"actions.markLost": "Mark Lost",`:

```json
  "actions.discard": "Discard",
```

Add after `"metrics.active": "Active",` (or near the other metrics keys):

```json
  "metrics.discarded": "Discarded",
```

- [ ] **Step 2: Add Spanish pipeline translations**

Add the same keys with Spanish values in `es/pipeline.json`:

```json
  "actions.discard": "Descartar",
  "metrics.discarded": "Descartados",
```

- [ ] **Step 3: Commit**

```bash
git add src/i18n/dictionaries/en/pipeline.json src/i18n/dictionaries/es/pipeline.json
git commit -m "feat(i18n): add discard/discarded translations for pipeline"
```

---

### Task 9: Run Migration on Supabase

- [ ] **Step 1: Apply the migration**

The migration needs to be run against the Supabase database. Either:
- Run via Supabase Dashboard SQL editor
- Or via CLI: `npx supabase db push` (if Supabase CLI is configured)

The SQL to execute:
```sql
ALTER TABLE opportunities DROP CONSTRAINT IF EXISTS opportunities_stage_check;
ALTER TABLE opportunities ADD CONSTRAINT opportunities_stage_check
  CHECK (stage IN ('new_lead','qualifying','quoting','quoted','follow_up','negotiation','won','lost','discarded'));
```

- [ ] **Step 2: Verify the constraint**

```sql
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname = 'opportunities_stage_check';
```

Expected: Shows the new constraint with `discarded` included.

---

### Task 10: Verify End-to-End

- [ ] **Step 1: Build check**

Run: `cd OPS-Web && npx next build 2>&1 | tail -20`

Verify no build errors related to the changes.

- [ ] **Step 2: Manual verification checklist**

1. Open Pipeline page — board should show only active stages (no discarded column)
2. Click More on a card — should see "Discard" option between "Mark Lost" and "Archive"
3. Click Discard — card should disappear from board, toast shows "Moved to Discarded"
4. Metrics bar should show the discarded count
5. Click the discarded count — expandable panel shows the discarded leads
6. Open import wizard → confirm step → stage dropdown should show "Discarded" option
7. Set a lead to "Discarded" stage → it should appear in the Discarded section and not count toward import total
