# Cross-Surface Visual Cohesion Audit — OPS-Web

**Phase:** WEB OVERHAUL — P4-1 (cross-cutting sweep, run early in visual-first mode)
**Date:** 2026-06-13 · **Branch:** `feat/web-overhaul` · **Worktree:** `ops-web-overhaul-p2-shell`
**Type:** AUDIT — findings + recommendations only. **No source changes** were made (the only files written are this report + `gallery/`). Remediation is a separate Jackson-approved wave.

**Method:** live visual pass on port 3017 (dev bypass, real Maverick/Top-Gun seed data, viewport 1512×950) — screenshots are the primary evidence — plus three parallel read-only code agents for file:line grounding, plus first-hand source reads of the load-bearing primitives (`empty-state.tsx`, `ledger-strip.tsx`). Judged against `ops-design-system/project/DESIGN.md` + `colors_and_type.css` + `ui_kits/ops-web/`.

**Skills invoked (master plan §6 gate):** `custom-skills:audit-design-system` (file-level done-gate lens) and `custom-skills:interface-design` (design-judgment lens) — both loaded successfully. `frontend-design:frontend-design` was not separately invoked; `interface-design` is the correct lens for this dashboard/tool surface (frontend-design's own scope note redirects interface work to interface-design). The `animation-studio` UserPromptSubmit hint is a false-positive for an audit (no motion was authored); motion findings are recorded as data, not built.

**Read first (so resolved items are not re-flagged):** master plan §6/§7 + decision log; `2026-06-11-design-conformance-audit.md` + resolutions; `2026-06-12-books-refinement-punchlist.md`; DESIGN.md (incl. the §9 amendment). The following are treated as **sanctioned / already-resolved and are NOT defects here:** the 28px compact-workbar tier + 22–24px chips (web has no touch targets); global slashed-zero + tabular nums; `rounded-[4px]` on chips/tags matching the kit. Known P4 residuals are **folded in** (not rediscovered): dead `data-table.tsx` (**confirmed removed**, commit `55795c06`); legacy `.ops-badge` rounded-sm + unused `.ops-card-accent`; table-v2's own Cake-Mono-12 workbar labels; `RegisterTable` keyboard focus-ring (spawned `WEB OVERHAUL - P3-3-1`); the systemic `rounded-[Npx]`→named-token question; Calibration/pipeline legacy easings.

---

## 1 · Executive cohesion verdict

**Does the rebuilt set read as one product? Mostly yes — with one surface dragging the average down and a thin layer of shared-primitive drift underneath all of them.**

The shell, Books, and Clients are genuinely the same instrument: pure-black canvas, glass-surface panels on hairlines, `// TITLE` section grammar, Cake-Mono display / Mohave names / JetBrains-Mono tabular numbers, earth-tone semantic tags, the `RegisterTable` row anatomy, and accent confined to CTAs + focus rings. Stand Books invoices, the Books AGING view, the Clients roster, the client workspace window, the operator menu, and the notifications drawer side by side and they read as one designed system. That is the win to protect.

**The cohesion breaks come from three places:**

1. **Catalog is the outlier — it re-derived the system instead of consuming it.** It looks close at a glance (same dark tactical language), but it ships its *own* segment control (`CatalogSegmentControl`, Cake-Mono **13px** — an off-scale Cake size the original conformance audit already condemned), its *own* filter-chip / drill-chip, its *own* status tag, three hand-rolled `<table>`s where `RegisterTable` exists, raw `<select>`s, and Button-variant-override CTAs — with a cluster of raw `rgba()` literals where tokens exist. The segment-control size/font difference is visible the instant you flip Books → Catalog. This is exactly the "cheap replica / surface-by-surface divergence" failure this overhaul exists to kill, localized to one surface.

2. **A shared-primitive drift layer sits under *all* surfaces** — small, but it's the kind of thing that compounds. Two hand-rolled "instrument strips" (Books `// LEDGER` vs Catalog `// SUPPLY`) that are visual twins but separate code with 8 measurable drifts (including an *off-curve count-up easing* in Catalog); a shared `EmptyState` primitive that is itself the banned coach-mark pattern (so every register hand-rolls its own empty state, inconsistently); three different error-color conventions across the form primitives; rose hardcodes inside `Button`/`Input`; and a dead `.glass-subtle` token tier.

3. **The not-yet-overhauled surfaces (Dashboard, Pipeline, Schedule, Projects) diverge as expected** — catalogued in §6 as upcoming-wave scope, **not** counted as defects. The one place where a class-B surface contradicts a *rebuilt* concept is the **A/R aging "current" color**: Books renders it olive (on-palette), the Dashboard receivables widget renders it `#417394` steel-blue (off-palette, undocumented) — flagged because it spans a rebuilt concept.

**Bottom line:** the system is real and the baseline (shell/Books/Clients) is strong. Converging Catalog onto the shared primitives, plus a focused pass over ~6 shared primitives/tokens, gets the rebuilt set to genuinely uniform. **A token/primitive pass is warranted — YES (see §5).** Without it, the next surfaces will keep copying the system instead of using it.

---

## 2 · Screenshot gallery

All under `docs/audits/2026-06-13-visual-cohesion/gallery/`. Captured live on port 3017, 1512×950, real seed data.

| # | File | Surface | What it evidences |
|---|------|---------|-------------------|
| 01 | `01-dashboard.jpeg` | Dashboard | Shell (rail, top bar, edge tabs, FAB); widget headers **without `// TITLE`**; A/R aging CURRENT bucket steel-blue |
| 02 | `02-books-invoices.jpeg` | Books · invoices | **Canonical baseline**: `// LEDGER` strip, SegmentControl, LIST\|AGING toggle, RegisterTable + earth-tone Tags + one `ACTIONS` overflow/row |
| 03 | `03-catalog-products.jpeg` | Catalog · PRODUCTS | Forked `CatalogSegmentControl` (chunkier pills), `+ ADD` CTA, **hand-rolled table with per-row bare icon actions** (config + trash) |
| 04 | `04-catalog-stock.jpeg` | Catalog · STOCK | `// SUPPLY` strip, forked status tags (`UNTRACKED`), hand-rolled checkbox table, inline QTY edit |
| 05 | `05-clients-list.jpeg` | Clients · list | **Canonical baseline**: rose A/R banner, FilterChips, RegisterTable; hand-rolled `+ NEW CLIENT` CTA |
| 06 | `06-clients-window.jpeg` | Clients · window | Floating workspace window (CONTACT/PROJECTS/MONEY/ACTIVITY), `// CONTACT` grammar — cohesive with the project window |
| 07 | `07-operator-menu.jpeg` | Shell · operator menu | Glass-dense popover, `// OPERATOR :: PETE`, `ADMIN` badge, SETTINGS/OPS WEBSITE/COURSES/GET THE IOS APP/SIGN OUT (dead "#" link fixed) |
| 08 | `08-books-aging.jpeg` | Books · A/R aging | `// OVERDUE AGING` (CURRENT = **olive**, on-palette ramp), `// TOP CLIENTS`, `// INVOICE BREAKDOWN` stat cells |
| 09 | `09-notifications-drawer.jpeg` | Shell · notifications | Glass-dense drawer, severity FilterChips, `[ EOF ]` / `SYS :: SYNC`, severity left-bars |
| 10 | `10-pipeline.jpeg` | Pipeline (class B) | Focused-card + stage-spine paradigm; metrics bar **without `//`**; per-card bare icon toolbars |
| 11 | `11-schedule.jpeg` | Schedule (class B) | Correctly labeled `SCHEDULE`; `// DAY/WEEK/MONTH/CREW`; today-tick; card-tag overlap |
| 12 | `12-projects-table.jpeg` | Projects · table (class B) | table-v2 (TanStack): saved views, density, zoom; progress bars rose even at 100% |

---

## 3 · Cohesion punch list — rebuilt surfaces + shell (CLASS A — must be uniform now)

Each: **surface · element · the inconsistency · the canonical form to match · file:line.** Priority P1 (visible/structural cohesion break) → P3 (token-level, low-visibility). Items whose remediation belongs to a primitive pass are cross-referenced to §5.

### P1 — Catalog re-derives shared primitives (the cheap-replica cluster)

| # | Surface · element | Inconsistency | Canonical form | file:line |
|---|---|---|---|---|
| A1 | Catalog · segment control | `CatalogSegmentControl` is a hand fork: **Cake Mono 13px / `rounded-[7px]` / `px-[18px] py-[6px]`** — visibly chunkier than Books/Clients, and Cake-13 is an **off-scale Cake size** (spec Cake roles are 14 button / 11 badge only; this is the exact class the 2026-06-11 audit condemned) | shared `SegmentControl` (JetBrains Mono 11px / 28px / `rounded-[5px]`) — what Books uses | `src/components/catalog/segment-toolbar.tsx:19-60` |
| A2 | Catalog · products / stock / snapshots tables | Three hand-rolled `<table>/<thead>/<tbody>` | `RegisterTable` + cell atoms (as Books invoices/estimates + Clients use) | `segments/products-segment.tsx:202-348`, `segments/stock-segment.tsx:501-578,633-648`, `snapshots-view.tsx:102-120,225-238` |
| A3 | Catalog · per-row actions | Bare icon-button toolbar per row (config + trash glyphs) — the "icons are metadata, not actions" anti-pattern Books explicitly retired | one labelled `ACTIONS` overflow per row (Books pattern; row click opens the record) | `segments/products-segment.tsx` row actions; `segments/stock-segment.tsx` |
| A4 | Catalog · status tags | `StatusTag` reimplements `Tag` markup with its own rose/tan/neutral/mute map; taxable pill + status-pill helper also hand-roll Tag | shared `Tag` atom (earth-tone variants) | `segments/stock-segment.tsx:47-75,67`, `segments/products-segment.tsx:305-314` |
| A5 | Catalog · filter / drill chips | Forked `FilterChips` + `DrillChip` duplicate the shared `filter-chip.tsx` primitives | shared `FilterChips` / `DismissChip` (as Books/Clients use) | `segment-toolbar.tsx:67-101,104-120` |
| A6 | Catalog · primary CTAs | `<Button variant="secondary">` className-overridden into an accent-outline CTA (also `manage-modal`/`product-quick-add` hand-roll segmented toggles) | `Button variant="primary"` (filled-at-rest is the shipped primary) | `products-segment.tsx:159-161`, `stock-segment.tsx:320-322`, `snapshots-view.tsx:67-69` |

> A1–A6 are one finding with six faces: **Catalog was built self-contained and re-derived the kit.** Its `segment-toolbar.tsx` even documents the fork as intentional. Converging Catalog onto `RegisterTable` / `SegmentControl` / `FilterChips` / `DismissChip` / `Tag` / `Select` / `Button` is the single highest-leverage cohesion fix in this audit. This is a Catalog-rebuild-class effort, not a token sweep.

### P2 — cross-surface pattern inconsistencies among the rebuilt set

| # | Surface · element | Inconsistency | Canonical form | file:line |
|---|---|---|---|---|
| B1 | Books vs Catalog · instrument strip | `// LEDGER` (Books) and `// SUPPLY` (Catalog) are visual twins but **separate hand-rolls** with 8 drifts: tile padding (`pt-14/pb-12` vs `pt-16/pb-14`), hero type (`text-data-lg` token vs `text-[22px] font-semibold` arbitrary), label size (`text-micro` token vs `text-[11px]` literal), grid gap (`gap-2` vs `gap-4`), and — worst — **count-up easing** (Books: real `EASE_SMOOTH` via framer `animate()`; Catalog: hand-rolled rAF **ease-out-quad approximation**, an off-curve violation) | one extracted `InstrumentStrip` primitive — see §5.1 (mock) | `src/components/books/ledger-strip.tsx` vs `src/components/catalog/supply-strip.tsx:43,72,78,97,122,146,167,240` |
| B2 | Books / Catalog / Clients · empty states | The shared `EmptyState` is unused by every rebuilt register; each hand-rolls its own "0 X" with different padding/title-font/`//`-prefix (Books mono-micro, Catalog mono-11px + `//` + help line) | one tactical register-empty primitive — see §5.2. **Do NOT adopt the existing `EmptyState`** (it is itself the banned coach-mark — §5.2) | `invoices-segment.tsx:499-510`, `products-segment.tsx:188-199` |
| B3 | Books vs Clients vs Catalog · create affordance | **Three conventions for the same action:** Books has *no* inline create (FAB owns it, per P3-5 §4); Clients shows `+ NEW CLIENT`; Catalog shows `+ ADD` + kebab | **decision needed (Jackson):** either all register surfaces carry an inline create or none do. Books' FAB-only is the documented precedent; Clients' inline CTA was Direction-B-approved — so this needs an explicit ruling, not a silent fix | `clients/page.tsx:302-309`; `catalog/segments/products-segment.tsx:159`; Books = FAB only (`fab-actions.ts`) |
| B4 | Clients · primary CTA | `+ NEW CLIENT` is a fully hand-rolled `<button>` (no `Button` import) using the accent-**outline** look; the shipped primary is **filled-at-rest** | `Button variant="primary"` | `clients/page.tsx:302-309,336-343` |
| B5 | Notifications drawer · titles | Title casing is mixed (`LOOSE ENDS` / `PAYMENTS SITTING` UPPERCASE vs `Potential duplicates found` / `Connect Gmail` sentence case) | DESIGN.md §2 voice: UPPERCASE for authority titles. Mostly **content-level / data-driven** (notification source varies) — flag for an `ops-copywriter` normalization pass, low structural weight | `src/components/layouts/notifications-row.tsx` (+ seed content) |

### P3 — token-level (low visibility; fold into the primitive pass §5)

| # | Surface · element | Inconsistency | Canonical form | file:line |
|---|---|---|---|---|
| C1 | Books modals · selects | Raw `<select>` with `bg-surface-input border rounded` in three modals (same modal mixes shared `<Input type="date">` with a raw select) | shared `Select` (Radix, `@/components/ui/select`) | `modals/invoice-form-modal.tsx:225,232,247`, `modals/estimate-form-modal.tsx:211,226`, `modals/record-payment-modal.tsx:108` |
| C2 | Catalog · raw rgba literals | `border-[rgba(255,255,255,0.20)]`, `bg-[rgba(255,255,255,0.02)]`, `hover:bg-[rgba(181,130,137,0.2)]` etc. where named tokens exist | `--border` / `--surface-*` / `--rose-*` tokens | `cells.tsx:87,105,173,197`, `stock-drawer.tsx:184`, `manage-modal.tsx:293,303`, `product-editor.tsx:68,287,327,331,339,460`, `add-stock-dialog.tsx:24`, `stock-segment.tsx:50,381,526,610`, `products-segment.tsx:224`, `snapshots-view.tsx:193,226,233`, `segment-toolbar.tsx:112` |
| C3 | Catalog · off-ladder radius | `rounded-[3px]` inline-edit cells (between `--r-bar` 2 and `--r-chip` 4) | nearest token; folds into the systemic `rounded-[Npx]` residual | `cells.tsx:102` |
| C4 | Shell · notification rgba | JS style objects use `rgba(255,255,255,0.0x)` gradients/surfaces that equal the tokens but bypass them | `var(--surface-*)` / glass-gradient | `notifications-drawer.tsx:179-204,264,341`, `notifications-row.tsx:51,118,160,202,311` (INFO — token-equal) |

**Clean among the rebuilt set (verified):** zero bare hex in `/books/` or `/catalog/`; zero sub-11px text in the shared primitives or the strips; zero `@carbon/icons-react` imports anywhere; `glass-surface`/`glass-dense` CSS match DESIGN.md §5 to the literal; the top-bar route registry is the single title source (Calendar/Schedule drift is dead); breadcrumbs, the client window, the operator menu, and the notifications drawer are on-grammar.

---

## 4 · Tokenized-element misuse — hand-rolled where a primitive exists

Consolidated replacement table (the "use the primitive" list). Severity per `audit-design-system`: **WARNING** = hand-rolled where a primitive exists; **CRITICAL** = hardcoded value where a token exists.

| Hand-rolled at | Should be | Severity |
|---|---|---|
| `catalog/segment-toolbar.tsx:19-60` `CatalogSegmentControl` | `@/components/ui/segment-control` | WARNING |
| `catalog/segment-toolbar.tsx:67-101,104-120` forked chips | `@/components/ui/filter-chip` (`FilterChips`/`DismissChip`) | WARNING |
| `catalog/segments/products-segment.tsx:202-348`, `stock-segment.tsx:501-578`, `snapshots-view.tsx:102-238` raw `<table>` | `@/components/ui/register-table` | WARNING |
| `catalog/segments/stock-segment.tsx:47-75`, `products-segment.tsx:305-314` hand-rolled tags | `@/components/ui/tag` | WARNING |
| `catalog/modals/{manage-modal:58-73, product-quick-add:81-88}` toggles | `SegmentControl` | WARNING |
| `catalog/{product-editor:245, modals/add-stock-dialog:84,121}` raw `<select>` | `@/components/ui/select` | WARNING + CRITICAL (rgba in `selectCls`) |
| `books/modals/{invoice-form:225,232,247, estimate-form:211,226, record-payment:108}` raw `<select>` | `@/components/ui/select` | WARNING |
| `catalog/segments/products-segment.tsx:159`, `stock-segment.tsx:320`, `snapshots-view.tsx:67` Button-override CTAs | `Button variant="primary"` | WARNING |
| `clients/page.tsx:302-309,336-343` hand-rolled CTA (no `Button` import) | `Button variant="primary"` | WARNING |
| `catalog/cells.tsx`, `stock-drawer.tsx`, `manage-modal.tsx`, `product-editor.tsx`, `add-stock-dialog.tsx` raw rgba | `--border` / `--surface-*` / `--rose-*` tokens | CRITICAL |

Legitimately bespoke (no primitive fits — **not** defects): shell nav items / Radix `asChild` triggers / icon buttons in `top-bar.tsx`, `sidebar.tsx`, `operator-menu.tsx`, the drawers, and Clients tab/link/row triggers; Catalog 24px inline-edit `<input>`s (the shared `Input`'s 36px min-height is too tall for cell editing — the *element* is defensible; only its rgba border literal is the violation).

---

## 5 · The primitive / token itself looks wrong → recommend a pass

These are not surface bugs — fixing them surface-by-surface *is* the cheap-replica failure. Each is a recommendation to pass over the primitive/token once, globally.

### 5.1 — Extract one `InstrumentStrip` primitive (HIGH leverage)

**Why:** Books `ledger-strip.tsx` and Catalog `supply-strip.tsx` are the same designed pattern (glass glance-tiles: `// LABEL` + hero number + mini-viz + sub-line + optional scope badge / drill) implemented twice, already drifting on 8 axes including an off-curve count-up easing (B1). A third surface (e.g. a future Schedule or Projects strip) will copy whichever it finds and drift again. The canonical Books implementation is *already cleanly factored* — `TileShell` / `TileHero` / `TileSub` / `ScopeBadge` + slot-based mini-viz — so extraction is low-risk lift-and-share, not a redesign.

**Recommendation:** promote the Books tile components into `src/components/ui/instrument-strip/`, parameterized; Catalog's supply strip consumes it; the mini-viz (`MarginMeter`/`Sparkline`/`AgingRamp`/`DivergingBars`) become slotted children. This deletes all 8 drifts at the source and guarantees the count-up curve.

**Proposed mock** (API shape, traced to the canonical `ledger-strip.tsx`):

```tsx
// src/components/ui/instrument-strip/instrument-strip.tsx
export function InstrumentStrip({ label, period, children }: {
  label: string;                      // "// LEDGER", "// SUPPLY"
  period?: React.ReactNode;           // PeriodPill / right-aligned control
  children: React.ReactNode;          // 3–4 <GlanceTile>
}) {
  return (
    <section aria-label={label}>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="font-mono text-micro uppercase tracking-[0.16em] text-text-3">
          <span className="text-text-mute">{"// "}</span>{label}
        </span>
        {period}
      </div>
      <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">{children}</div>
    </section>
  );
}

// GlanceTile = the canonical TileShell (glass-surface, min-h-132, px-18 pb-12 pt-14,
// // LABEL header, optional right slot, optional onClick→focus-ring button)
export function GlanceTile({ label, right, onClick, children }: GlanceTileProps) { /* = ledger-strip TileShell */ }
export function TileHero({ children })  { return <span className="font-mono text-data-lg leading-tight text-text tabular-nums">{children}</span>; }
export function TileSub({ children })   { return <div className="mt-auto font-mono text-micro tracking-[0.06em] text-text-3 tabular-nums">{children}</div>; }
export function ScopeBadge({ children }) { return <span className="rounded-[4px] border border-border px-[5px] py-px font-mono text-micro uppercase tracking-[0.14em] text-text-3">{children}</span>; }

// Single shared count-up — the one Catalog must stop approximating:
export function useCountUp(target, enabled, duration = 800) {
  /* framer animate(from, target, { ease: [0.22, 1, 0.36, 1] }) — never a hand-rolled rAF curve */
}
```

> Catalog's `text-[22px] font-semibold` hero collapses to `TileHero` (data-lg = 20px mono); its `gap-4` to `gap-2`; its rAF ease-out-quad to `useCountUp`.

### 5.2 — Retire `EmptyState`; mint a tactical register-empty primitive

**Why (this one flips the obvious recommendation):** the shared `src/components/ops/empty-state.tsx` is itself **off-spec**. It renders `icon + title + description + action Button` on a left-border strip — i.e. a coach-mark — which DESIGN.md §2 explicitly bans for empty states ("`$0`, `0%`, or `—` … No coach-marks"). The rebuilt registers are *correct* to avoid it; the problem is they each then hand-roll a tactical empty, inconsistently (B2). So "consolidate everyone onto `EmptyState`" would *reintroduce* the banned pattern.

**Recommendation:** deprecate `EmptyState` for register/segment surfaces and add a tactical primitive the registers share:

```tsx
// src/components/ui/register-table/register-empty.tsx
export function RegisterEmpty({ count, noun, hint }: { count: 0; noun: string; hint?: string }) {
  return (
    <div className="flex flex-col items-start gap-1 px-4 py-10">
      <span className="font-mono text-data-lg tabular-nums text-text-2">{count}</span>
      <span className="font-mono text-micro uppercase tracking-[0.16em] text-text-3">
        <span className="text-text-mute">{"// "}</span>{noun}
      </span>
      {hint && <span className="font-mono text-micro text-text-mute">{hint}</span>}
    </div>
  );
}
// renders "0 // INVOICES" — the fact only. No icon hero, no description sentence, no CTA.
```

(If `EmptyState`'s coach-mark form is wanted anywhere legitimate — onboarding, not registers — keep it but rename it `OnboardingHint` so it can never be reached for as the empty-state default.)

### 5.3 — Unify the form-primitive error color (token, not hex)

**Why:** the form family speaks three error dialects — `Input` hardcodes `text-[#B58289]`/`border-[#B58289]` (the rose *value*, bypassing the token), `Textarea` uses `ops-error`, the rest use the `rose` token. `Button`'s destructive variant also hardcodes `#B58289` + `rgba(181,130,137,…)`. `Textarea` additionally diverges on radius (`rounded-sm` vs the 5px form radius) and label font (`font-mono` vs `Input`'s `font-mohave`).

**Recommendation:** one pass over `button.tsx`, `input.tsx`, `textarea.tsx`, `select.tsx`: error state → `rose` token everywhere (`text-rose`/`border-rose-line`/`bg-rose-soft`); `Textarea` radius → `rounded-[5px]`; sibling label fonts unified. file:line: `button.tsx:39-40`, `input.tsx:34,68`, `textarea.tsx:34,36,47,21`.

### 5.4 — Remove the dead `.glass-subtle` tier

**Why:** `--glass-bg-subtle` / `--glass-subtle` (0.40 alpha) are declared in `globals.css:155,197` but there is **no `.glass-subtle` utility class and zero consumers**. DESIGN.md §5 defines exactly two glass tiers. A declared-but-unimplemented third tier is an invitation for a future surface to invent a non-spec glass. Also `.ultrathin-material-dark` (`globals.css:365`) uses `--glass-border-strong` (0.20) — wrong border alpha vs the 0.09 glass edge.

**Recommendation:** delete the subtle vars; reconcile or retire the `ultrathin` legacy shim.

### 5.5 — Codify the A/R-aging color ramp + retire `#417394`

**Why:** the same financial concept renders in two color systems. Books AGING colors the **CURRENT** bucket **olive** (`#9DB582`, the on-palette healthy→destructive ramp olive→tan→receivables→rose→brick — `ledger-strip.tsx:214` `RAMP_CLASSES`). The Dashboard receivables widget colors **CURRENT** `#417394` steel-blue — a color in **no** DESIGN.md token (the only blue in the system is the accent `#6F94B0`, which this is *not*; verified the accent itself does not leak — a full-dashboard accent scan returned zero). `#417394` also drives "Sent"/active status dots. There is no documented "current / healthy receivables" financial token, so each surface improvises.

**Recommendation (token-level):** (a) add the missing `--fin-current` token = olive (or document that current reuses `--fin-profit`); (b) the Dashboard A/R widget adopts the Books ramp in its P3.7 polish wave; (c) audit `#417394` and retire it from the financial/status palette. The blue side is a class-B (Dashboard) surface, but the *token gap* is system-wide — fix it once.

### 5.6 — Smaller primitive hygiene (batch into the pass)

- **`Tag` not re-exported** from the `register-table` barrel (`index.ts`) — consumers import it separately; add the re-export for one-import row anatomy. (Ergonomic, not visual.)
- **`SearchInput` focus border** is set imperatively in JS (`search-input.tsx:67`) rather than via a token/`:focus` rule — make it declarative.
- **Legacy `segmented-picker` (4 consumers) + legacy `badge` (8 consumers)** still bypass `SegmentControl`/`Tag` — but all consumers are *pre-overhaul* surfaces (schedule, dashboard widgets), so this is class-B migration debt, tracked in §6, not a rebuilt-surface defect.

---

## 6 · Expected-divergence catalogue (CLASS B — upcoming-wave scope, NOT defects)

These four surfaces have not had their waves. Per the master plan they are *expected* to diverge; this is the scope each wave inherits, not a punch list. Canonical anatomy to converge toward = the rebuilt set's `RegisterTable` + `// LABEL` workbar + `EASE_SMOOTH` + accent-on-CTA/focus-only.

> Cross-cutting across all four: **`tracking-wider` is the universal micro-label divergence** vs the canonical `tracking-[0.16em]`. A single find-and-replace per surface during its wave. And **`RegisterTable` convergence for Projects + Pipeline is explicitly deferred debt by design** (`register-table.tsx:11-16`) — RegisterTable was *extracted from* table-v2, so they already look alike; converging is optional and secondary to each wave's load-bearing work.

### Dashboard → P3.7 (light polish)
- **Already cohesive:** `widget-shell.tsx` glass/radius/easing are canonical; accent confined to `WT.accent` data-viz; `// OPERATOR` greeting voice. Genuinely a light pass.
- **Gaps:** no `// TITLE` header grammar on widget front faces — each widget renders its heading ad hoc (`REVENUE`/`RECEIVABLES` with no `//`, gallery 01); pervasive `tracking-wider`; `PlaceholderWidget` uses `rounded-lg` (`page.tsx:116`); the CUSTOMIZE toggle active state is `bg-ops-accent text-white` (`page.tsx:764`) — **accent on a non-CTA toggle + wrong text pairing** (accent fill pairs with `text-black`); A/R widget CURRENT = `#417394` (see §5.5).

### Pipeline → P3.7 (conformance audit) — **most-conformed of the four**
- **Already cohesive:** all easings canonical (`EASE_SMOOTH` / `cubic-bezier(0.22,1,0.36,1)` throughout — no legacy easings); accent correctly focus-ring-only (header even documents the intent); glass/radius on-system.
- **Gaps:** metrics bar labels (`PIPELINE VALUE` / `WIN RATE`) lack the `//` prefix the instrument strips use (gallery 10); per-card bare icon toolbars (phone/chat/share/doc) — the pattern Books retired; own table (`useVirtualizer` div-grid, not RegisterTable — deferred debt); `tracking-wider` in `pipeline-table-header.tsx:84`. (The not-yet-merged `pipeline-table-view` branch is **not** on `feat/web-overhaul` — only the committed focused+table pair was audited.)

### Schedule → P3.6 (rename) + P3.7 (conformance)
- **Already cohesive:** visible label is `SCHEDULE` everywhere user-facing (registry/dict/`usePageTitle`); strong `//` grammar (`// DAY/WEEK/MONTH/CREW`, `// UNSCHEDULED`, `// TEAM`, `// LEGEND`); accent only as today-tick (documented role).
- **Gaps:** the rename is **label-only** — internals are still "calendar" (`CalendarPage`, `useCalendarStore`, `calendar-*` components/hooks, `calendar.json` dict namespace, `calendar.view` permission); **the 3 legacy raw easings** (the known residual): `"easeOut"` in `day/day-timeoff-card.tsx:64` + `day/day-personal-event-card.tsx:42`, `"easeInOut"` in `cascade/ghost-overlay.tsx:132` → should be `EASE_SMOOTH`; `tracking-wider/widest` in the toolbar; task-card tag chips overlap titles (gallery 11, polish).

### Projects → P3.5 (map absorption) — the load-bearing work is NOT the table
- **Already cohesive:** canvas + table view modes both ship; table-v2 row anatomy already close to RegisterTable (it's the parent); accent confined to focus rings.
- **Gaps:** **map not absorbed** — `/map` is still a separate route rendered with **Leaflet** (`map/page.tsx:27`), a *different* engine than the workspace's Mapbox GL; the view-mode union is literally `"canvas" | "spreadsheet"` (`projects/page.tsx:204`) with no `"map"`; the route registry carries the absorption marker `absorbedBy { phase: "3.5", target: "/projects?view=map" }`. Wave work = collapse `/map`, extend the union, remove the sidebar `map` entry, decide Leaflet→Mapbox unification; `tracking-wider` in the table header; progress bars render rose even at 100% (gallery 12 — completion reading as a negative color; worth a P3.7 semantic check).

---

## 7 · Verdict on a token/primitive pass

**YES — warranted.** The rebuilt baseline (shell/Books/Clients) is strong, but two structural risks remain: (1) Catalog re-derived the kit (§3 A1–A6) and (2) a shared-primitive drift layer (§5) — the instrument strip duplicated, the empty-state primitive itself off-spec, three form-error dialects, rose hardcodes, a dead glass tier, and an undocumented A/R color. Fixing these surface-by-surface is precisely the divergence pattern this overhaul exists to eliminate. The recommended sequence for the remediation wave: **(1)** extract `InstrumentStrip` + the tactical register-empty primitive (§5.1, §5.2); **(2)** the form-error/glass-subtle/token hygiene pass (§5.3–§5.6); **(3)** the Catalog-onto-primitives convergence (§3 A1–A6 — the largest lift); **(4)** §5.5 A/R token + the class-B waves fold the rest in. Get Jackson's ruling on B3 (create affordance) before touching it.

**No source was changed in this audit.**
