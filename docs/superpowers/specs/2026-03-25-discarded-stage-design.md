# Discarded Stage — Design Spec

**Date:** 2026-03-25
**Scope:** OPS-Web pipeline + import wizard

## Purpose

Add `discarded` as a third terminal stage alongside `won` and `lost`. Discarded means "not worth pursuing" — the lead contacted us (counts as an ad conversion) but was junk quality. This enables ad targeting quality analysis: compare won+lost (real leads) vs discarded (bad quality leads).

Discarded leads stay in the system for analytics but are removed from the active board.

## 1. Data Layer

### Postgres Migration

```sql
ALTER TABLE opportunities DROP CONSTRAINT opportunities_stage_check;
ALTER TABLE opportunities ADD CONSTRAINT opportunities_stage_check
  CHECK (stage IN ('new_lead','qualifying','quoting','quoted','follow_up','negotiation','won','lost','discarded'));
```

File: `supabase/migrations/042_discarded_stage.sql`

### TypeScript — `src/lib/types/pipeline.ts`

**OpportunityStage enum:**
```typescript
Discarded = "discarded"
```

**PIPELINE_STAGE_ORDER:** Append `OpportunityStage.Discarded` after `Lost`.

**PIPELINE_STAGES_DEFAULT:** Add entry:
```typescript
{ name: "Discarded", slug: "discarded", color: "#444", sortOrder: 8, winProbability: 0, autoFollowUpDays: null }
```

**OPPORTUNITY_STAGE_COLORS:** Add `[OpportunityStage.Discarded]: "#444"`.

**Helper updates:**
- `isActiveStage()` — add `&& stage !== OpportunityStage.Discarded`
- `isTerminalStage()` — add `|| stage === OpportunityStage.Discarded`

### Opportunity Service — `src/lib/api/services/opportunity-service.ts`

**New method: `discardOpportunity(id: string)`**
- Sets `stage = 'discarded'`, `win_probability = 0`
- Creates a `StageTransition` record (from current stage to discarded)
- Creates an `Activity` record of type `StageChange`
- Same pattern as existing won/lost handling

**Query filter: `includeDiscarded?: boolean`**
- Add to `ListOpportunitiesOptions`
- Default `false` — discarded filtered out unless explicitly requested
- Filter: `.neq("stage", "discarded")` when `!includeDiscarded`

## 2. Import Wizard — Confirm Step

File: `src/components/settings/wizard-steps/confirm-pipeline-step.tsx`

**STAGE_CONFIG:** Add `discarded: { label: "Discarded", color: "#444" }`.

**ALL_STAGES:** Append `"discarded"` after `"lost"`.

**Stage grouping:** Discarded leads appear in a collapsible "Discarded" section (collapsed by default — not in `ACTIVE_STAGES` initial expanded set).

**Summary counts:** The existing `counts.discarded` already works for triage-discarded leads. Also count leads whose stage dropdown is set to `"discarded"` in the confirm view (currently only triage decision `=== "discard"` or `!lead.enabled` increments this counter — add stage-based check).

**LeadRow dropdown:** Already iterates `ALL_STAGES` — adding `"discarded"` to the array is sufficient.

## 3. Pipeline Board

### Card Actions — `src/app/(dashboard)/pipeline/_components/pipeline-card-actions.tsx`

**New dropdown item: "Discard"**
- Position: between "Mark Lost" and "Archive" in the More dropdown
- Icon: `Ban` from lucide-react
- Guard: `isActiveStage(stage)` (same as Mark Won / Mark Lost — only for active leads)
- Callback: `onDiscard()`

### Board — `src/app/(dashboard)/pipeline/_components/pipeline-board.tsx`

**Props:** Add `onDiscard: (opportunityId: string) => void`.

**Filtering:** Discarded opportunities are terminal — they don't appear as board columns. The board already only renders `getActiveStages()` as columns. Once `isActiveStage()` excludes discarded, they're automatically off the board.

### Metrics Bar — `src/app/(dashboard)/pipeline/_components/pipeline-metrics-bar.tsx`

**Add discarded count** next to existing Won/Lost counts:
- Label: "Discarded" (from i18n)
- Color: `#444`
- Count: `opportunities.filter(o => o.stage === "discarded").length`
- Note: the pipeline page's opportunity query (used for both the board and metrics bar) currently excludes discarded by default. The metrics bar needs discarded counts, so pass `includeDiscarded: true` in the query used for the metrics bar, or run a separate count query for discarded opportunities.

## 4. Pipeline Page

File: `src/app/(dashboard)/pipeline/page.tsx`

**New callback: `handleDiscard`**
- Calls `OpportunityService.discardOpportunity(id)` via mutation
- Invalidates opportunities query cache
- Shows toast: "Lead discarded"
- Same optimistic update pattern as existing archive/won/lost handlers

**Pass `onDiscard` to `PipelineBoard`.**

**Metrics query:** Ensure the opportunity fetch for the metrics bar includes `includeDiscarded: true` so the count is visible.

## 5. i18n

### `en/pipeline.json`
```json
"actions.discard": "Discard",
"stages.discarded": "Discarded",
"metrics.discarded": "Discarded"
```

### `es/pipeline.json`
```json
"actions.discard": "Descartar",
"stages.discarded": "Descartado",
"metrics.discarded": "Descartados"
```

### `en/import-wizard.json`
- `summary.discarded` — already exists

## 6. Not Changed

- **Archive** stays as-is (orthogonal `archived_at` timestamp, separate from stage)
- **Triage step** already has discard as a `TriageDecision` — no changes
- **Import route** already handles `action === "discard"` by skipping — no changes
- **Won/Lost modals** and their special flows are untouched
- **iOS app** — no changes in this spec (iOS reads stages from the API)
