# Books Refinement Punch List

Outstanding Books polish from Jackson's live review (2026-06-12), each diagnosed against the code. Single source of truth for the remaining Books waves. Lands **after** the P3-3 conformance remediation (which is editing these same segment files).

---

## §1 — Connect-flow UX (sync segment) → owned by `WEB OVERHAUL - P3-4`

Side-by-side QuickBooks + Sage connection cards replaced by: one CONNECT ACCOUNTING SOFTWARE entry → brief provider-choice flow → compact live badge when connected → settings/disconnect/switch in a modal behind the badge. Canonical application of the UX-judgment gate (master plan §6). Full scope in the P3-4 chip.

---

## §2 — Tables must use the tokenized table-v2 system → `WEB OVERHAUL - P3-5`

**Problem:** the Books segments render raw hand-rolled tables — `invoices-segment.tsx:377` `<table className="w-full min-w-[760px]">` with bespoke `<thead>/<tbody>`, and per-row icon-button toolbars (the audit's composition finding). Estimates and expenses segments do the same. This is why it reads less clean than Projects/Pipeline.

**Fix:** adopt the established, tokenized table system that Projects and Pipeline already use:
- Reference: `src/app/(dashboard)/projects/_components/table-v2/` — `projects-table-shell.tsx`, `projects-table-header.tsx`, `projects-table-row.tsx`, `cells/`, `projects-density-control.tsx`.
- Pipeline's adaptation is the precedent for reusing it on a second surface: `src/app/(dashboard)/pipeline/_components/table/` (`pipeline-table-shell.tsx`, `pipeline-table-row.tsx`, `cells/`).
- **Decide and document** whether to (a) extract the table-v2 primitives into a shared `src/components/ui/` module consumed by Projects, Pipeline, and Books, or (b) follow Pipeline's copy-adapt pattern. Prefer (a) if the divergence is low — three copies of a table shell is its own debt — but do not destabilize the shipped Projects/Pipeline tables; if extraction risks them, adapt per-surface and note the shared-extraction debt.
- Row anatomy per the kit + table-v2: number mono 13, primary text Mohave 14, metadata/dates/values mono, status as an earth-tone tag — **no per-row icon-button toolbars** (audit composition finding); the row click opens the document; verbs live in the detail surface or one labelled overflow.
- The 28px compact workbar tier is sanctioned (Jackson 2026-06-11) — do not inflate to touch sizes.

Applies to invoices, estimates, and expenses segments + the A/R aging view's table.

## §3 — List/Aging picker must hold one stable position → `WEB OVERHAUL - P3-5`

**Problem (diagnosed):** the list↔aging control physically moves when toggled. In **list** view it's a `FilterChips` pair pinned to the far right of the table's filter row (`invoices-segment.tsx:331` `ml-auto` → `:333-342`). In **aging** view the component returns early (`:297-307`) rendering only `{workbar}` + `<ArAgingView>` — that filter row never mounts, so the toggle vanishes and the way back becomes a *different* `onBackToList` affordance inside `ArAgingView` (`:304`) at a different position. Clicking list/aging makes the control jump locations. Jackson: "very unpredictable and terrible UI design."

**Fix:** one persistent view switch in a single fixed slot, present and identically positioned in **both** states. Move it into the stable `workbar` (which renders in both branches, `:270-294`) — a `SegmentControl` (LIST | AGING), not `FilterChips` (a binary view switch is a segmented toggle, not a filter). Remove the divergent `onBackToList` control from `ArAgingView`. State-aware: when the user can't access both views (`canAging` false / `listAllowed` false) render no toggle at all — never a control with one option. Verify against the shared `src/components/ui/segment-control.tsx`.

## §4 — Remove the redundant New Invoice / New Estimate buttons → `WEB OVERHAUL - P3-5`

**Problem:** inline create buttons duplicate the FAB. `invoices-segment.tsx:281-290` (workbar, always-visible) and `:367-372` (empty state). Estimates segment mirrors this.

**Verified safe:** the FAB already owns creation — `fab-actions.ts:46` invoice → `/books?segment=invoices&action=new` (the exact `?action=new` deep link the inline button triggers, `invoices-segment.tsx:193`), `:45` estimate → create-estimate window, both gated by the same `invoices.create` / `estimates.create` permissions. Consistent with the documented pattern (`OPS-Web/CLAUDE.md` FAB: "Page-level action buttons were removed from the header — use FAB instead").

**Fix:** remove the inline New Invoice / New Estimate buttons from the workbar and the empty states. Empty state states the fact only (`0 INVOICES`, no coach-mark, no button) per DESIGN.md §2 — update the now-stale `:354-355` comment that calls the inline button "the action." Leave one labelled-overflow exception only if the wave finds a creation path the FAB genuinely doesn't cover (it doesn't, per the above) — and flag it for Jackson if so.

---

**Note to the running P3-3 conformance session:** do not spend effort restyling the invoices/estimates tables or the inline New-Invoice buttons — §2 and §4 replace/remove them wholesale. Token-fix everything else.
