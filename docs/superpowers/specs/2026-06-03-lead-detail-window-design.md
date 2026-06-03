# Lead Detail Window — Design Spec

- **Date:** 2026-06-03
- **Surface:** OPS-Web · `/pipeline` deal/lead detail (floating **window** + **drawer**)
- **Status:** Design approved in brainstorming; pending spec review → implementation plan
- **Author:** brainstorming session (visual companion, OPS-styled mockups)

---

## 1. Problem

The pipeline deal/lead detail surface is structurally present but hollow. Both renderers —
`PipelineFocusedDetailWindow` (focused mode, floating window) and `PipelineDetailPanel`
(non-focused drawer) — share one body, `PipelineDetailBody`, which today renders only:

- a thin contact strip (address · phone · email),
- the next-steps signal line (`PipelineDetailNextSteps`), and
- three tabs: **Correspondence · Timeline · Photos**.

Nowhere shows the actual lead record: value, source, owner, priority, close date, win
probability, scope/description, tags, the intelligent summary, the linked estimate/project,
site visits, or the location. The user called it "an empty shell." This spec builds it out.

## 2. Goals / non-goals

**Goals**

- Make the deal's top-line facts glanceable the instant the window opens, over a tactical,
  map-backed header.
- Let the operator correct/update key facts in place without leaving the window.
- Give the full lead record a real home (a new Overview tab).
- Reuse the established OPS entity-detail patterns (project dossier: map + tabs + facts) and
  the proven optimistic mutation path. Build once; both renderers inherit it.

**Non-goals**

- No DB schema changes (every column already exists → iOS-safe, see §12).
- No stage-change UI here — stage transitions keep routing through the existing ⋯ menu and the
  Won/Lost dialogs.
- No notifications for low-signal field edits (§13).
- No new map page; "expand" is replaced by an external "Open in Maps" link (§6).

## 3. Decisions locked (brainstorming)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Target surface | Pipeline deal-detail window (`pipeline-focused-detail-window` + `pipeline-detail-panel`) |
| 2 | Overview placement | **Option C** — persistent summary band across the top, full-width tabs below |
| 3 | Band backdrop | **Full-bleed map** behind the summary, with a gradient scrim |
| 4 | Scrim treatment | **Bottom** — map breathes up top, value + facts anchored along the bottom |
| 5 | Map interaction | **Non-interactive backdrop + "Open in Maps" button** (opens location in a new tab). No inline expand. |
| 6 | Band facts | **Inline-editable** (value, source, owner, close, priority) |
| 7 | Deep record | **New "Overview" tab** (first, default) holds the full lead record |
| 8 | Win probability | **Read-only**, stage-derived (displayed, not editable) |
| 9 | Scope | **Full build** — band + inline edits + complete Overview (incl. tags + in-place address geocode + linked records) |

## 4. Architecture & file map

**New**

- `pipeline/_components/lead-map-band.tsx` — `LeadMapBand`: map backdrop + scrim + value/facts overlay + inline editors + Open-in-Maps. No-coordinate fallback.
- `pipeline/_components/pipeline-detail-overview-tab.tsx` — `PipelineDetailOverviewTab`: the full lead record.
- `pipeline/_components/lead-field-editors.tsx` — small inline editors (currency, enum-select, date, owner picker, tags, textarea) used by the band + overview. Glass-dense popover so they read over the map scrim.
- `lib/hooks/use-opportunity-field-edit.ts` — `useOpportunityFieldEdit`: lean field-level optimistic edit on top of `useUpdateOpportunity` (saving→saved pulse, Esc/Enter). Leaner than the table-row-coupled `useOpportunityCellEdit`; same engine.

**Modified**

- `pipeline/_components/pipeline-detail-panel.tsx` — `PipelineDetailBody` renders `LeadMapBand` at the top (replacing the contact strip); add the Overview tab case; trim duplicate value/contact from `PipelineDetailHeader`.
- `pipeline/_components/pipeline-focused-detail-window.tsx` — drop the `PipelineDetailContactStrip` headerSlot (now redundant — address → band, contact → Overview).
- `pipeline/_components/pipeline-detail-tab-bar.tsx` — `TABS` gets `"overview"` first.
- `pipeline/_components/pipeline-mode-types.ts` — `DetailTabId = "overview" | "correspondence" | "timeline" | "photos"`.
- `pipeline/_components/pipeline-mode-store.ts` — default `detailPanelActiveTab` → `"overview"`.
- `i18n/dictionaries/{en,es}/pipeline.json` — new keys (§11).

## 5. Component tree (both renderers, inside `PipelineDetailBody`)

```
PipelineDetailBody
├─ LeadMapBand                 (new — ~158px)
│   ├─ ProjectMap              (reused; expanded=false → non-interactive backdrop)
│   ├─ scrim (bottom gradient)
│   ├─ band-top: address · "Open in Maps" ↗
│   └─ band-content: $value · win% + bar · priority chip · facts row (inline-edit)
├─ PipelineDetailNextSteps     (existing — unchanged)
├─ PipelineDetailTabBar        (Overview · Correspondence · Timeline · Photos)
└─ active tab body
    ├─ overview        → PipelineDetailOverviewTab   (new)
    ├─ correspondence  → PipelineDetailCorrespondenceTab
    ├─ timeline        → PipelineDetailTimelineTab
    └─ photos          → PipelineDetailPhotosTab
```

## 6. The map-backed band (`LeadMapBand`)

**Layout** — `relative`, height **158px**, `border-b border-border-subtle`, `overflow-hidden`.

- **Backdrop:** `<ProjectMap latitude lng pinColor={stageColor} expanded={false} />`. With
  `expanded=false` ProjectMap is non-interactive (`interactive={expanded}`) — a true backdrop.
  Pin color = `OPPORTUNITY_STAGE_COLORS[stage]`.
- **No coordinates** (`latitude == null || longitude == null`): render a dark tactical-grid
  placeholder (repeating-linear-gradient grid over `--map-canvas-bg`) instead of `ProjectMap`.
  Same scrim + overlay. Never a naked/empty map. `address` may still show if present.
- **Scrim (Bottom):** absolute inset gradient
  `linear-gradient(180deg, rgba(7,8,9,.16) 0%, rgba(7,8,9,.52) 52%, rgba(7,8,9,.94) 100%)`,
  `pointer-events-none`. Guarantees text contrast regardless of map tiles.
- **band-top** (absolute, top): address (mono micro, ellipsis) + **Open in Maps** button (top-right) →
  opens `https://www.google.com/maps/search/?api=1&query=${lat},${lng}` (fallback: encoded address)
  in a new tab (`target="_blank" rel="noopener noreferrer"`). Reuse the project sidebar's existing
  Maps-link helper/format if present. Glass pill (`--scrim-window-shadow` bg) like the MapHero pills.
- **band-content** (absolute, bottom, `justify-end`):
  - `// ESTIMATED VALUE` micro label + `$14,200` hero — **JetBrains Mono 500**, ~30px, white,
    `font-feature-settings:"tnum" 1,"zero" 1`. Empty value → `—`.
  - win% (read-only, from `winProbability`) + 2px olive probability bar.
  - priority chip (border-only): high → rose, medium → tan, low → neutral.
  - facts row: **Client · Source · Owner · Close** — each inline-editable (§7).

**Reduced motion:** no entrance animation needed (static band); any hover/transition honors
`prefers-reduced-motion`.

## 7. Inline editing (`useOpportunityFieldEdit` + `lead-field-editors`)

- **Engine:** `useUpdateOpportunity()` already cancels in-flight queries, snapshots, optimistically
  patches list + detail caches, rolls back on error, invalidates on settle (verified). The new
  `useOpportunityFieldEdit` adds per-field save-state (`idle|saving|saved|error`) + a 1.5s saved
  pulse. **Last-writer-wins** (no `updated_at` guard exists for opportunities — matches the table
  hook's documented delta).
- **Field → column** (all verified present in `mapOpportunityToDb`, partial update):
  - value → `estimatedValue` (currency input; empty → null)
  - source → `source` (`OpportunitySource` enum select)
  - owner → `assignedTo` (team-member picker via `useTeamMembers`; clearable)
  - close → `expectedCloseDate` (date picker; clearable)
  - priority → `priority` (`OpportunityPriority` enum select)
  - (Overview) scope → `description` (textarea)
  - (Overview) tags → `tags` (chip input, `string[]`)
  - (Overview) address → `address` + `latitude` + `longitude` (geocode autocomplete; reuses the
    existing address-autocomplete used by create-lead / pipeline card content, `NEXT_PUBLIC_MAPBOX_TOKEN`)
- **Interaction:** click a fact → inline editor in a **glass-dense** popover (legible over the map
  scrim). Enter / blur commits; Esc cancels; no-op when unchanged. Subtle saving→saved affordance.
- **Permission gating:** all editing gates on `can("pipeline.manage")` (the same `canManage` already
  threaded into both renderers). Without it, every field renders read-only (no edit affordance).

## 8. Overview tab (`PipelineDetailOverviewTab`)

Full-width, `overflow-y-auto scrollbar-hide`, sections top→bottom (mirrors the project dossier
rhythm; each section uses the workspace atoms — `Section`, `FieldRow`, `Mono`, `Body`, `Chip`):

1. **Summary** — the intelligent read: `aiSummary` (sentence case, mono micro) + `aiStageConfidence`
   / `aiStageSignals` as quiet border-only chips. Render only when `aiSummary` present. Per brand
   voice, **not** branded loudly as "AI" — label `// SUMMARY` / behavior-led copy (ops-copywriter).
2. **Scope** — `description`, inline-editable textarea. Empty → `[ no scope captured ]` placeholder.
3. **Health** (read-only, 2-col grid): win probability (stage-derived), weighted value
   (`getWeightedValue`), days-in-stage (`getDaysInStage`), created, last activity
   (`lastActivityAt`), correspondence in/out (`inboundCount` / `outboundCount`).
4. **Tags** — editable chip input (`tags`). Empty → add affordance only.
5. **Contact** — when `client` linked: name + email (mailto) + phone (tel) + link to client record.
   When unlinked: inline `contactName/Email/Phone` + an **Attach client** action
   (`useAttachClientToOpportunity`).
6. **Location** — address + Maps link; **in-place address edit** (geocode autocomplete → writes
   `address` + `latitude` + `longitude`, which also feeds the band map). Empty → add affordance.
7. **Linked** — estimates (number · status chip via `ESTIMATE_STATUS_COLORS` · total · open) with a
   **New estimate** action; **project** link when `projectId` is set (display + open only — do **not**
   add a convert action here; conversion is owned by the existing won-deal flow); **site visits**
   (upcoming/past via `useSiteVisits`, schedule action). Estimates fetched via
   `useEstimates({ opportunityId })` — confirm the option in planning; fall back to the
   `opportunity.estimates` relation.

Every section degrades to a quiet empty state (`—` / bracketed placeholder), never a blank gap.

## 9. Data layer (all verified in barrel `@/lib/hooks`)

- Read: `useOpportunity`, `useOpportunityActivities`, `useStageTransitions`, `useSiteVisits`,
  `useOpportunityFollowUps`, `useEstimates`, `useClient`, `useTeamMembers`, `useCurrentUser`.
- Write: `useUpdateOpportunity` (inline edits), `useAttachClientToOpportunity`,
  `useConvertOpportunityToProject`, `useCompleteFollowUp` (next-steps, existing),
  estimate/site-visit creation hooks for the linked actions.
- Mapper coverage confirmed: `mapOpportunityToDb` includes description, source, assigned_to,
  priority, estimated_value, win_probability, expected_close_date, address, latitude, longitude,
  tags, contact_*. `updateOpportunity` does partial writes (only present keys).

## 10. Design-system compliance (OPS spec v2)

- Canvas `#000`; glass-dense for popovers/editors; borders-only, zero box-shadows.
- Text ladder `#EDEDED / #B5B5B5 / #8A8A8A / #6A6A6A`. Earth tones border-only (priority/stage/status).
- **Accent `#6F94B0` reserved** for the primary CTA / focus ring only — never on tabs, chips, links.
  One accent element per screen max. (Focus rings use `outline-ops-accent`, already the pattern.)
- Numbers always JetBrains Mono, tabular + slashed zero, formatted; empty = `—`.
- Fonts: Cake Mono Light (uppercase display labels), Mohave (UI/body), JetBrains Mono (numbers/micro).
- Motion: single `EASE_SMOOTH` cubic-bezier(0.22,1,0.36,1); no spring/bounce; honor reduced-motion.
- Voice: `//` section prefixes, `[brackets]` for instructional micro-text, sentence case for content,
  UPPERCASE for authority. No emoji, no exclamation points. All user-facing copy via **ops-copywriter**.
- Radii: panel 10 / modal 12 / btn 5 / chip 4 / bar 2.
- Sizing traces to DESIGN.md (web has no touch targets) — controls min-h 36, radius 5; chips 4.

## 11. i18n

Namespace `pipeline` (`useDictionary("pipeline")`), en + es. New keys under `detail.*` /
`overview.*` / `band.*`: tab label `tabOverview`; band labels (estimated value, win, open in maps,
priority high/med/low, no-coordinates); overview section headers (summary, scope, health, tags,
contact, location, linked) + field labels + empty states + actions (attach client, new estimate,
schedule visit). No hardcoded strings.

## 12. iOS sync constraint

No schema change — every written column already exists and is read by iOS as optional. Writing
`source`, `priority`, `tags`, `description`, `address`/`lat`/`lng`, `assigned_to`,
`estimated_value`, `expected_close_date` from web is additive behavior, not a schema migration →
**safe between App Store releases** (per the iOS-sync constraint). No iOS coordination required.

## 13. Notifications

None. Inline field edits are low-signal and self-initiated; creating notification-rail entries for
them would be noise. (Conversion-to-project and other already-instrumented actions keep their
existing dispatches.)

## 14. Edge cases

- No coordinates → tactical-grid fallback band (no ProjectMap, no "Open in Maps" if no address).
- No client linked → contact shows inline fields + Attach-client action.
- No estimates / no site visits / no description / no tags / no value → quiet per-section empty states.
- No `pipeline.manage` → entire band + overview render read-only (no edit affordances, no actions).
- Long address / long client name → truncate with ellipsis; value never wraps.
- Drawer width (420) vs window (780): band + overview are full-width of their container and **must
  reflow at 420** (drawer width) — facts row wraps, value never wraps. Verify during implementation.
- Optimistic edit failure → cache rollback (owned by `useUpdateOpportunity`) + error save-state.
- `prefers-reduced-motion` → save pulses/transitions collapse to 0 duration.

## 15. Accessibility

- Inline editors: focusable, Enter commit / Esc cancel, `aria-label`s, focus returns to the trigger
  on close. Focus-visible ring = `outline-ops-accent`.
- Band text contrast guaranteed by the scrim; value/labels meet WCAG over the darkened base.
- Tab bar keeps existing `aria-pressed` semantics; Overview added as first tab.
- "Open in Maps" is a real link (`<a target="_blank" rel="noopener noreferrer">`).

## 16. Testing

- **Unit:** `useOpportunityFieldEdit` (commit / cancel / no-op / rollback / save-state); field-editor
  value coercion (currency, date, enums, tags).
- **Component/integration:** `LeadMapBand` with + without coordinates; band inline-edit commit
  optimistically updates; Overview renders each section + empty states; Overview address geocode
  writes lat/lng; tab bar shows Overview first + defaults to it; read-only when `pipeline.manage`
  denied (no edit affordances).
- Follow existing pipeline test patterns under `pipeline/_components/__tests__`.

## 17. Out of scope / follow-ups

- Stage editing in the band (stays in ⋯ menu / Won-Lost dialogs).
- Bulk/multi-deal editing.
- Realtime push of others' edits (optimistic + invalidate is sufficient now).

## 18. Items to confirm during planning

- `useEstimates({ opportunityId })` filter option vs. `opportunity.estimates` relation for the
  Linked section.
- The exact existing address-autocomplete/geocode component to reuse (create-lead modal vs.
  pipeline card content) and the project sidebar's Maps-link helper/URL format.
