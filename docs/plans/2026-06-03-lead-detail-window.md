# Lead Detail Window — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development) to implement this plan task-by-task.

**Goal:** Build out the pipeline deal/lead detail window from an empty shell into a map-backed
summary band (inline-editable facts) + a full Overview tab, shared by both the floating window and
the drawer renderer.

**Architecture:** Add `LeadMapBand` (ProjectMap backdrop + bottom scrim + value/facts overlay) and a
new first `Overview` tab (`PipelineDetailOverviewTab`) into the shared `PipelineDetailBody`. Inline
edits ride a new lean `useOpportunityFieldEdit` hook over the existing optimistic
`useUpdateOpportunity`. No schema changes; no new data services.

**Tech Stack:** Next.js 14 (App Router), TypeScript, Tailwind, TanStack Query, Zustand, Framer Motion,
lucide-react, Mapbox GL JS (`ProjectMap`), vitest + @testing-library/react.

**Design System:** `.interface-design/system.md` (worktree root). Spec:
`docs/superpowers/specs/2026-06-03-lead-detail-window-design.md`.

**Required Skills (load per task):**
- `frontend-design` + `custom-skills:interface-design` — every component/layout task.
- `animation-studio:animation-architect` (gateway) — the save pulse + popover/tab transitions (minimal; reuse `EASE_SMOOTH`).
- `ops-copywriter` — all user-facing copy (labels, empty states, actions) in Phase 6.
- `custom-skills:audit-design-system` — token-compliance pass (Phase 6).

**Worktree:** `/Users/jacksonsweet/Projects/OPS/ops-web-lead-detail` · branch `feat/lead-detail-window`
(off `origin/main`). All commands run here. Commit per task (conventional, no AI attribution, stage by name).

**Non-negotiable design rules (from `.interface-design/system.md`):**
- NEVER hardcode hex. Tailwind tokens in `className`; CSS vars in `style`. Scrim uses existing
  `--map-fade-*` / `--scrim-*` vars, never raw rgba.
- Accent `ops-accent` = primary CTA + focus ring ONLY. Not on tabs/links/chips/input borders.
- Web controls min-h **36px**, radius 5; chips 4px. (No 44px touch reasoning — web is non-touch.)
- AI summary = **agent provenance** palette (`agent`, `agent-text`, `agent-border`, `agent-bg`). Lavender is reserved for Claude-authored surfaces; the AI summary band is the sanctioned use.
- Inline-edit popovers + address autocomplete over the map → `glass-dense` + `--shadow-dropdown`.
- Numbers: `font-mono`, `font-feature-settings:"tnum" 1,"zero" 1`, 11px floor, formatted; empty = `—`.
- Motion: single `EASE_SMOOTH` cubic-bezier(0.22,1,0.36,1); honor `useReducedMotion()` (opacity-only 150ms).
- i18n: every string via `useDictionary("pipeline")`, `t("key") ?? "fallback"`. en + es.
- Permissions: `can("pipeline.manage")` gates all editing/actions (estimates list also needs `estimates.view`).

---

## Phase 0 — Tab IA scaffolding

### Task 0.1: Add `overview` to `DetailTabId` + default it
**Skills:** interface-design.
**Files:**
- Modify: `src/app/(dashboard)/pipeline/_components/pipeline-mode-types.ts` — `DetailTabId = "overview" | "correspondence" | "timeline" | "photos"`.
- Modify: `src/app/(dashboard)/pipeline/_components/pipeline-mode-store.ts` — initial `detailPanelActiveTab: "overview"`.
- Modify: `src/app/(dashboard)/pipeline/_components/pipeline-detail-tab-bar.tsx` — `TABS = ["overview","correspondence","timeline","photos"]`; `TAB_KEYS.overview = "detail.tabOverview"`.
- Test: `src/app/(dashboard)/pipeline/_components/__tests__/pipeline-mode-store.test.ts` (extend).

**Steps (TDD):**
1. Extend the mode-store test: assert default `detailPanelActiveTab === "overview"` and `setDetailPanelActiveTab("photos")` works.
2. Run `npx vitest run pipeline-mode-store` → FAIL (default is `correspondence`).
3. Apply the three edits; add `detail.tabOverview` to en + es `pipeline.json` (placeholder copy, finalized Phase 6).
4. Run vitest → PASS. Typecheck the tab bar (`DetailTabId` exhaustiveness).
5. Commit: `feat(pipeline): add Overview tab id + default to it`.

---

## Phase 1 — Inline-edit primitive

### Task 1.1: `useOpportunityFieldEdit`
**Files:**
- Create: `src/lib/hooks/use-opportunity-field-edit.ts`
- Test: `tests/unit/hooks/use-opportunity-field-edit.test.tsx`

**Contract:**
```ts
type EditableField = "estimatedValue" | "source" | "assignedTo" | "expectedCloseDate"
                   | "priority" | "description" | "tags" | "address";
// address commits { address, latitude, longitude } together.
function useOpportunityFieldEdit(opportunityId: string): {
  saveState: (field: EditableField) => "idle"|"saving"|"saved"|"error";
  commit: (field: EditableField, value: unknown) => Promise<void>;  // optimistic via useUpdateOpportunity
};
```
- Builds the `Partial<UpdateOpportunity>` per field (value→number|null with NaN→null guard; dates→Date|null;
  tags→string[]; address→{address,latitude,longitude}). No-op when unchanged. `saved` pulse 1.5s → idle.
  Last-writer-wins (no updated_at guard — documented delta, matches table hook). Rollback owned by `useUpdateOpportunity`.

**Steps (TDD):** write failing tests (commit maps each field to the right partial; NaN value → null;
no-op unchanged; error sets `error` state) → run FAIL → implement → run PASS → commit
`feat(pipeline): useOpportunityFieldEdit optimistic field hook`.

---

## Phase 2 — Inline field editors

### Task 2.1: `lead-field-editors.tsx`
**Skills:** frontend-design, interface-design, animation-architect (save pulse).
**Files:**
- Create: `src/app/(dashboard)/pipeline/_components/lead-field-editors.tsx`
- Test: `tests/unit/pipeline/lead-field-editors.test.tsx`

**Editors (each: read-only display when `!canManage`; click → glass-dense popover editor; Enter/blur commit, Esc cancel; `--shadow-dropdown`; min-h 36, radius 5; focus ring `ops-accent`):**
- `CurrencyField` (value) — mono, formatted display; numeric input.
- `EnumSelectField` (source via `OpportunitySource`, priority via `OpportunityPriority`) — reuse atoms `select.tsx`.
- `DateField` (expectedCloseDate) — date input; display `formatDate`/`—`.
- `OwnerField` (assignedTo) — `useTeamMembers` picker + `UserAvatar`; clearable.
- `TagsField` (tags) — chip input (atoms `chip.tsx`); add/remove.
- `TextAreaField` (description) — atoms `text-area.tsx`.
- `AddressField` (address) — reuse the existing geocode autocomplete (confirm: create-lead modal vs pipeline card content) → commits `{address,latitude,longitude}`; popover uses `--shadow-dropdown`.

**Design tokens:** inputs `bg-surface-input border-[rgba(255,255,255,0.10)]` focus→`0.20` (no accent); popover `glass-dense` + `--shadow-dropdown`; chips `rounded-chip`; numbers mono tnum+zero.

**Steps (TDD):** tests — display renders value/`—`; click opens editor only when `canManage`; commit calls `useOpportunityFieldEdit.commit` with parsed value; Esc cancels; tags add/remove. FAIL → implement → PASS → commit `feat(pipeline): inline lead field editors`.

---

## Phase 3 — Map-backed band

### Task 3.1: `LeadMapBand`
**Skills:** frontend-design, interface-design, animation-architect.
**Files:**
- Create: `src/app/(dashboard)/pipeline/_components/lead-map-band.tsx`
- Test: `tests/unit/pipeline/lead-map-band.test.tsx`

**Layout (height 158px, `relative overflow-hidden border-b border-border-subtle`):**
- Backdrop: `latitude/longitude != null` → `<ProjectMap latitude longitude pinColor={OPPORTUNITY_STAGE_COLORS[stage]} expanded={false} />` (non-interactive); else tactical-grid placeholder (CSS-var grid over `--map-canvas-bg`).
- Scrim: absolute inset, `pointer-events-none`, bottom gradient via CSS vars (reuse `--map-fade-mid`/`--map-fade-end`, extend to ~94% at base). No raw rgba.
- band-top: address (`font-mono text-micro`, ellipsis) + **Open in Maps** `<a target="_blank" rel="noopener noreferrer" href="https://www.google.com/maps/search/?api=1&query=${lat},${lng}">` (fallback encoded address). Glass pill (`--scrim-window-shadow`, like MapHero pills). Hide link if no lat/lng and no address.
- band-content (absolute bottom): `// ESTIMATED VALUE` label + value hero (mono ~30px, tnum/zero, `—` empty) + win% (read-only) + 2px olive bar + priority chip (high→rose / med→tan / low→neutral border, always with text) + facts row (`CurrencyField·EnumSelectField(source)·OwnerField·DateField`).

**Steps (TDD):** tests — renders ProjectMap when coords present; renders placeholder + hides Maps link when no coords; Open-in-Maps href correct; value `—` when null; facts read-only when `!canManage`. FAIL → implement → PASS → commit `feat(pipeline): map-backed lead summary band`.

---

## Phase 4 — Overview tab

### Task 4.1: `PipelineDetailOverviewTab`
**Skills:** frontend-design, interface-design, ops-copywriter (Phase 6 copy).
**Files:**
- Create: `src/app/(dashboard)/pipeline/_components/pipeline-detail-overview-tab.tsx`
- Test: `tests/unit/pipeline/pipeline-detail-overview-tab.test.tsx`

**Sections (scroll container `overflow-y-auto scrollbar-hide`, gradient fade — no hard cutoff; reuse atoms `Section/FieldRow/Mono/Body/Chip/Stack/Inline`; `// LABEL` mono section headers):**
1. **Summary** — `aiSummary` + `aiStageSignals` chips on **agent provenance** palette (`agent-bg`, `agent-text`, `agent-border`). Render only when present. Quiet, behavior-led copy (no loud "AI").
2. **Scope** — `TextAreaField(description)`; empty → bracketed placeholder.
3. **Health** (read-only grid): win% (stage-derived), weighted value (`getWeightedValue`), days-in-stage (`getDaysInStage`), created, last activity, correspondence in/out (`inboundCount`/`outboundCount`). Numbers mono.
4. **Tags** — `TagsField`.
5. **Contact** — client linked → name + email (mailto) + phone (tel) + client link; unlinked → inline contact + **Attach client** (`useAttachClientToOpportunity`).
6. **Location** — address + Maps link + `AddressField` in-place edit (writes address+lat/lng → feeds band).
7. **Linked** — estimates via `useEstimates({ opportunityId })` (gated `estimates.view`): number · status chip (`ESTIMATE_STATUS_COLORS`) · total (`formatCurrency`) · open + **New estimate**; **project** link when `projectId` set (display/open only — NO convert here); **site visits** via `useSiteVisits({ opportunityId })` (upcoming/past + schedule).

**Steps (TDD):** tests — Summary uses agent palette + hidden when no `aiSummary`; each section empty state; Health computes weighted value; Linked lists estimates and hides when `estimates.view` denied; address edit commits lat/lng. FAIL → implement → PASS → commit `feat(pipeline): lead detail Overview tab`.

---

## Phase 5 — Wire into the body (both renderers)

### Task 5.1: Mount band + Overview in `PipelineDetailBody`
**Files:** Modify `pipeline-detail-panel.tsx` (`PipelineDetailBody`: render `<LeadMapBand>` at top instead of `headerSlot`/contact strip; add `activeTab === "overview"` → `<PipelineDetailOverviewTab>`; keep next-steps + tab bar order); modify `pipeline-focused-detail-window.tsx` (drop `PipelineDetailContactStrip` headerSlot + simplify `buildSubtitle`); trim duplicate value/contact from `PipelineDetailHeader`.
- Test: `tests/unit/pipeline/pipeline-detail-body.test.tsx` — body renders band + defaults to Overview; both renderers mount band; no `pipeline.manage` → read-only.

**Steps (TDD):** failing body test → wire → PASS. Verify drawer (420) reflow (facts row wraps; value no-wrap). Commit `feat(pipeline): mount band + Overview in detail body (window + drawer)`.

---

## Phase 6 — Copy, a11y, tokens

### Task 6.1: i18n copy (ops-copywriter)
**Skills:** ops-copywriter. Finalize en + es `pipeline.json` keys (tabOverview, band labels, section headers, field labels, empty states `[ … ]`, actions). OPS voice: terse, `//` prefixes, `[brackets]`, sentence case content, no emoji/!. Commit `feat(pipeline): lead detail i18n copy (en+es)`.

### Task 6.2: a11y + reduced motion
Inline editors focusable, Enter/Esc, `aria-label`s, focus returns to trigger; `useReducedMotion()` collapses pulses/transitions to opacity-150ms; Maps link real `<a>`. Commit `fix(pipeline): lead detail a11y + reduced-motion`.

### Task 6.3: design-system audit (audit-design-system)
**Skills:** custom-skills:audit-design-system. Verify zero hardcoded hex (scrim/grid use CSS vars), accent only on CTA/focus, min-h 36, mono numbers, agent palette on Summary, `--shadow-dropdown` on popovers. Fix drift. Commit `refactor(pipeline): design-token compliance pass`.

---

## Phase 7 — Verification

- `npx vitest run` (pipeline + hooks) → all pass.
- `npx tsc --noEmit` (or `npm run typecheck`) → clean for touched files.
- `npx next lint` on touched files → clean (note: repo CI lint is red pre-existing; only assert OUR files clean).
- Manual checklist (real app): open a lead from board + table → band renders (map + value + facts); edit value/source/owner/close/priority → optimistic + persists on refresh; Overview tab default + all sections; address edit moves the pin; Open in Maps opens new tab; no coords → grid fallback; read-only when `pipeline.manage` denied; drawer width reflow; reduced-motion.
- Commit any fixes. Final: confirm branch `feat/lead-detail-window` is a clean, reviewable stack.

---

## Open items resolved during planning
- `useEstimates({ opportunityId })` filter — **confirmed** (`FetchEstimatesOptions.opportunityId` → `.eq("opportunity_id", …)`), gated `estimates.view`.
- AI summary palette — **agent provenance (lavender)** per `.interface-design/system.md` (sanctioned use).
- Popover/address-over-map elevation — **`--shadow-dropdown`** (sanctioned token).

## Still to confirm in execution
- Exact existing geocode-autocomplete component to reuse for `AddressField` (create-lead modal vs pipeline card content) + the project sidebar's Maps-link helper/format.
