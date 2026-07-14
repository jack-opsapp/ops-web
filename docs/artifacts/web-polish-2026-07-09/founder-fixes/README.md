# Founder fixes — live evidence (2026-07-13)

Two founder-directed polish fixes on `feat/web-polish-batch`. Verified live on the
`web-polish` dev server (:3210, dev-bypass auth), seed company MAVERICK PROJECTS
LTD. Desktop viewport 1440×960.

---

## TASK A — Expenses review panel: compact floating approve/reject cluster

**Founder ask:** "the reject/approve buttons are too big. They could be much
smaller buttons, floating, in the bottom right of the review panel."

**What changed:** the reviewable-state footer of the expenses detail panel
(`batch-detail-panel.tsx`) went from a full-width bottom action bar to a compact
**28px-tier floating puck**, pinned bottom-right via `sticky bottom-0`. The
wrapper is `pointer-events-none` (click-through gutter) with a
`pointer-events-auto` puck, so the line list stays interactive under it. Approve
keeps its olive treatment, reject the rose/destructive treatment. Every handler,
mutation, disabled and loading state is unchanged. **Only** the reviewable footer
changed — pay / paid / crew / filling footers are untouched.

**Why no live screenshot of the actual cluster:** the seed company's **TO REVIEW
bucket is empty** ("QUEUE CLEAR"), so the reviewable footer cannot be rendered
with live data (same limitation the reconciliation notes hit). Per the plan's
allowance, the reviewable state is proven two ways instead:

1. **Component test** — `tests/unit/expenses/batch-detail-panel-review-footer.test.tsx`
   (8 tests, all passing). Proves the floating cluster renders sticky bottom-right
   with a click-through gutter, and that every state + handler survives the
   full-width-bar → puck change:
   - no flags → disabled REJECT + active olive APPROVE ALL (busy disables it, fires `onApprove`),
   - flags → REMOVE ALL FLAGS (clears every flag) + rose REJECT WITH N (opens the confirm modal),
   - no cluster for non-reviewable buckets or non-reviewers.
2. **Live panel-integrity screenshots** of the analogous states (below) — proving
   the panel and its other footer states still render correctly after the change.

- **`A2-expenses-pay-state-panel.png`** — TO PAY batch selected (EXP-BATCH-0019,
  Pete Mitchell, $960.00). Footer = full-width **MARK PAID — $960.00** (olive),
  unchanged by this task.
- **`A3-expenses-paid-state-panel.png`** — PAID batch selected (EXP-BATCH-0017,
  $240.00). Footer = **PAID JUL 10 · $240.00** stamp (left) + **UNDO PAID** link
  (bottom-right) — the compact treatment that already matched the founder's ask.

---

## TASK B — Lead detail window: collapse the map band to an address strip

**Direction A** from the lead-detail audit: shrink the fixed 158px map band to a
slim ~44px address strip that opens the full map/facts band on demand, and reorder
the overview to lead with the story + the contact.

**What changed:**
- `lead-map-band.tsx` — the fixed 158px slab is now a **44px address strip**
  (map glyph + address + expand chevron). Tapping reveals the full deal band
  (map, value hero, win, priority, facts); tapping again collapses it. Reveal
  animates height on `EASE_SMOOTH` 200ms with an opacity-only reduced-motion
  fallback. The decorative tactical-grid fallback is **deleted** — a lead with no
  coordinates gets the strip alone and reveals its facts on the plain canvas,
  never a fake grid.
- `pipeline-detail-overview-tab.tsx` — the overview now leads with **Summary +
  Contact**, then Scope / Health / Tags / Location / Linked. Map/location demoted.

### Screenshots

- **`B1-lead-detail-collapsed-strip-content-first.png`** — the new default. The
  header is a slim strip `▸ 8680 MIRALANI DR, SAN DIEGO, CA 92126` with a map
  glyph + chevron. The OVERVIEW tab leads with `// CONTACT` → `// SCOPE` →
  `// HEALTH` (this lead has no AI summary, so Contact leads).
- **`B2-lead-detail-expanded-map-band.png`** — strip tapped open: the full band
  reveals the facts row (`// PRIORITY / CLIENT / SOURCE / OWNER`, expected close),
  the OPEN IN MAPS pill, and the map area. (Local dev has no Mapbox token, so the
  map shows ProjectMap's own "MAP UNAVAILABLE" message; production renders real
  tiles. The band's own grid fallback is gone.)

### Scroller reclaim — measured live (`getBoundingClientRect`)

The reading scroller is the `flex-1 overflow-y-auto` record area below the band.
Measured at 1440×960 with a real lead open:

| State | Band height | Reading scroller height |
|---|---:|---:|
| **Collapsed (new default)** | 45 px | **364 px** |
| **Expanded (map open)** | 159 px | **250 px** |
| **Delta** | **+114 px** | **−114 px** |

- Collapsing the band hands the record scroller **exactly 114 px** (band 45 → 159).
- The old always-on 158px band gave the reader ~250 px (matching the audit's
  measured 251 px baseline). The new collapsed default gives **364 px** — the
  audit predicted "roughly 365 px," measured **364 px**. That is a **~46% larger
  reading window** by default, with the map one tap away.

### No-coordinates lead

All six seed opportunities in this company have geocoded addresses, so a
no-coordinates lead **could not be shown live**. That path is covered by two unit
tests in `tests/unit/pipeline/lead-map-band.test.tsx` (collapsed: no map + no
grid; expanded: facts reveal on the plain canvas, still no grid) and by code
review (the grid fallback is deleted; the strip shows `—` when there is no
address).
