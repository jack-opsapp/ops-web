# OPS Web — Standardized Picker System

**Status:** Design / pending approval
**Date:** 2026-06-03
**Surface:** OPS Web (`ops-web/`) — the logged-in desktop product
**Author:** picker-system initiative
**Visual reference:** dev playground mockup served during brainstorming (`.superpowers/brainstorm/.../picker-playground.html`)

---

## 1. Problem

OPS Web has **no standardized picker**. Every picker/popover is bespoke — 20+ of them — and they diverge on every axis that matters:

| Axis | Today's spread |
|------|----------------|
| **Mechanism** | Radix `Popover`, Radix `DropdownMenu`, Radix `Select`, `cmdk`, hand-rolled absolute `<div>` + manual outside-click, and `createPortal` with hand-computed coordinates — all coexist. |
| **z-index** | `z-50` (popover/dropdown), `z-[60]` (select), `z-[1000]` (cell pickers), Radix default (category/unit). |
| **Surface radius** | `rounded-modal` (12), `glass-dense` (12), `rounded` (5), Radix default. |
| **Item radius** | `rounded-sm` (2.5), `rounded-[4px]`, `rounded-[5px]`. |
| **Item padding / height** | `py-[8px]`, `py-[6px]`, `py-1.5`, `h-8`, `h-7`. |
| **Selected state** | `bg-surface-active`, `bg-fill-neutral-dim`, `inset 2px #B5B5B5` shadow + `rgba(255,255,255,0.04)`, check-only. **Three competing treatments.** |
| **Hardcoded values** | `select.tsx`: `rgba(255,255,255,0.10)` / `0.20` borders. `command.tsx`: `rgba(255,255,255,0.04)` selected bg + `#B5B5B5` inset. `color-picker-popover.tsx`: hardcoded `blur(28px)` / border. `repeat-picker.tsx`: many raw rgba + px. |
| **i18n** | Some have none — `category-picker`, `unit-picker`, `segmented-picker`, `repeat-picker`, `color-picker` ship hardcoded English. |

Two are the explicit priority rebuilds:

- **Team picker** — `src/app/(dashboard)/projects/_components/table-v2/cells/cell-team.tsx` (~510 lines). A 720px two-panel (member list + per-task assignment matrix). Owner: *"terrible, way too bulky and confusing — delete and rebuild from scratch."*
- **Client picker** — `src/app/(dashboard)/projects/_components/table-v2/cells/editable-cell-client.tsx` (~200 lines). Hand-rolled absolute `<div>`, manual `mousedown` outside-click, not portaled (can clip), fragile.

## 2. Goals & non-goals

**Goals**
- ONE canonical, fully tokenized picker system; every concrete picker is built from it.
- Rebuild team + client first; migrate the entity cluster (assignee, category, unit); then the rest.
- Preserve **all** existing capability — simplify the UI, never the function.
- Zero hardcoded color/spacing/radius/font/z-index values — every value traces to a token.
- A permanent in-app **dev playground** (full element gallery on a borderless pannable canvas) to confirm cohesiveness continuously.

**Non-goals**
- The draggable detail/expansion popovers — `client-detail-popover`, `invoice-detail-popover`, `estimate-detail-popover`. Those are **floating windows**, not pickers. Left untouched.
- iOS / mobile. This is web presentation UI only; no iOS-sync constraints apply.
- Backend/RPC changes. We reuse the existing data hooks and RPCs as-is. (One semantic must be *verified* against the RPC during planning — see §11.)

## 3. Platform framing (important)

**OPS Web is a cursor-driven desktop product.** Interactions are mouse hover + click + keyboard. **There are no touch targets on web** — the ≥44px touch-minimum from the brand MO ("designed for gloves, sunlight, distraction") describes the **iOS/mobile** context and imposes **no size floor here.** Picker rows are **compact desktop density (~32px)**, matching the existing tables and pickers, optimized for cursor precision and scannability — not finger size. Hover and keyboard-focus states are first-class; there is no "tap" state.

## 4. Design principles

1. **Monochrome restraint.** Surfaces, borders, and text come from the neutral ladder. Earth tones are semantic (status dots, conflict text) and border-only.
2. **Accent is rare.** `#6F94B0` (steel blue) appears **only** on the focus ring (and the one primary CTA where a picker has one, e.g. the calendar Save). Never on selected rows, links, toggles, tabs, or tags.
3. **One item state.** Hover → `surface-hover`. Keyboard cursor → `surface-active`. Chosen value → trailing **monochrome** `Check` (in `text`). Disabled → `opacity-40`. This single rule replaces the three competing treatments.
4. **Glass, not shadow.** The surface is the shipped `.glass-dense` material; depth is the hairline border, never a box-shadow on the dark canvas (the dropdown drop-shadow `--shadow-dropdown` is the one allowed elevation, already in use).
5. **One easing, honor reduced-motion.** Enter via `anchored-in` (150ms, `EASE_SMOOTH` = `cubic-bezier(0.22,1,0.36,1)`). No spring/bounce. `motion-safe:` gates entrance; `prefers-reduced-motion` falls back to opacity-only.
6. **Tactical voice.** Panel/section titles use `//`; metadata uses `[brackets]`; UPPERCASE (Cake Mono Light / JetBrains Mono) for authority, sentence case for content. Numbers always JetBrains Mono, tabular + slashed-zero. Empty value is `—`, never "N/A".

## 5. Canonical token decisions

All exist today (verified in `tailwind.config.ts` + `globals.css`) unless marked **new**.

| Concern | Token | Value |
|---------|-------|-------|
| Popover surface | `.glass-dense` | `rgba(18,18,20,0.78)` · `blur(28) saturate(1.3)` · `1px rgba(255,255,255,0.09)` · radius **12** |
| Surface radius | `rounded-modal` | 12 (already baked into `.glass-dense`) |
| **Row / search / button radius** | `rounded-btn` (= default `rounded`) | **5** — picker rows reuse the button radius; no new token |
| Tag/chip radius | `rounded-chip` | 4 |
| Row min-height | — | **~32px** (`min-h-8`), `px-2 py-1.5`; avatar 20–24px |
| Row hover | `bg-surface-hover` | `rgba(255,255,255,0.05)` |
| Row keyboard cursor | `bg-surface-active` | `rgba(255,255,255,0.08)` |
| Chosen check | `text-text` | `#EDEDED`, lucide `Check` 16px |
| Search field | `bg-surface-input` + `border-border` | `0.04` / `0.10` |
| Focus ring | `ring-1 ring-ops-accent` | `#6F94B0` |
| Text ladder | `text` / `text-2` / `text-3` / `text-mute` | `#EDEDED` / `#B5B5B5` / `#8A8A8A` / `#6A6A6A` |
| Group label / micro | `font-mono text-micro uppercase` | 11px |
| Conflict text | `text-rose` (semantic) | `#B58289` |
| **z-index** | `z-dropdown` **(new token)** | maps to `--z-dropdown: 1000` (CSS var already exists) |
| Enter motion | `motion-safe:animate-anchored-in` | 150ms `EASE_SMOOTH` |

**New token additions (tokenization, not improvisation):**
- `theme.extend.zIndex` → `{ content:'var(--z-content)', interactive:'var(--z-interactive)', nav:'var(--z-nav)', dropdown:'var(--z-dropdown)', 'floating-ui':'var(--z-floating-ui)', window:'var(--z-window)', modal:'var(--z-modal)', 'map-controls':'var(--z-map-controls)', emergency:'var(--z-emergency)' }`. This makes the documented z-scale usable as Tailwind utilities (`z-dropdown`) instead of `z-[1000]` literals, and lets us migrate the old `z-50`/`z-[60]` as we touch each file.

## 6. Architecture — primitive family

Built on **Radix `Popover`** (reusing the shipped `PopoverContent`, which already applies `.glass-dense` + `anchored-in`) composed with **`cmdk`** for the searchable, keyboard-navigable list. This is the proven "combobox" pattern (Popover + Command) and uses dependencies already installed — no hand-rolled positioning, no manual outside-click, no `createPortal`.

Location: `src/components/ui/picker/`

### `<Picker>` / `<PickerContent>`
Thin wrapper over `Popover` + `PopoverContent` that standardizes:
- `side` / `align` / `sideOffset` defaults (`bottom` / `start` / `6`).
- z-index at `z-dropdown`.
- width sizing (`size` prop → `sm` 224 / `md` 256 / `lg` 288 / `auto`; or explicit `width`).
- `onOpenAutoFocus` → focus the `PickerSearch` input (when present).
- Renders a `cmdk` `Command` root inside so children get filtering + keyboard for free.
- Escape closes; in table-cell contexts it stops propagation so the table's own key handler doesn't also fire (parity with today's `stopTableKeys`).

### `<PickerSearch>`
Canonical search input: leading `Search` icon (16px, `text-3`), `cmdk` `Command.Input`, optional trailing clear (`X`) when non-empty. 32px, `surface-input`, `border-border`, `focus-within:ring-1 ring-ops-accent`. Mohave 14px, `placeholder:text-3`. Optional (enum/datetime pickers omit it).

### `<PickerList>` (+ `<PickerEmpty>`, `<PickerGroupLabel>`)
Scrollable `cmdk` `Command.List` with `scrollbar-hide`, `max-h` cap (default 280, configurable), and internal scroll-lock so wheel/touchpad doesn't bubble to the page. `PickerEmpty` is the canonical `—`/"no results" state (`cmdk` `Command.Empty`). `PickerGroupLabel` is the `// section` micro-label.

### `<PickerItem>`
The one canonical row (`cmdk` `Command.Item`). Slots: leading (avatar **or** checkbox **or** status dot **or** icon), label (+ optional secondary sub-label), trailing (check / count / sub). Props: `selected`, `disabled`, `value`, `onSelect`. State styling per §4.3. Compact ~32px. `aria-selected` reflects cmdk cursor; chosen value shown via trailing `Check` + `aria-checked` for multi/checkbox semantics.

### `<PickerFooterAction>`
Divided footer row (`border-t border-border-subtle`) for inline create / clear (e.g. "+ New category", "Remove from all"). Shares row styling; destructive variant uses `text-rose`.

### Keyboard & a11y model
- `↑/↓` move the cursor (cmdk); `Enter` commits the cursor; `Esc` closes; type-to-filter; `Home/End` jump.
- Trigger: `aria-haspopup` (`listbox` for single / `dialog` where richer), `aria-expanded`.
- Content: `role="listbox"` (or `dialog` for multi-section), labelled via `aria-label`.
- Single-select rows: `role="option"` + `aria-selected`. Multi-select rows: `aria-checked`.
- Focus returns to trigger on close. Reduced-motion: opacity-only entrance.

## 7. Concrete pickers

Location: `src/components/ui/`

### `<EntityPicker>`
Search + select with avatars. The workhorse — **replaces client, team, assignee, category, unit** (kills ~400 lines).

```
<EntityPicker
  items        ItemT[]            // already-loaded list (we reuse existing hooks)
  value        string | string[] // single or multi
  multiple?    boolean
  onChange     (next) => void     // optimistic; fires per toggle (no Apply)
  getId / getLabel / getSubLabel? / getAvatar?
  searchable?  boolean = true
  placeholder?, emptyLabel? = "—"
  noneOption?  boolean            // renders a leading "— {none}" row (client)
  createAction? { label; onCreate } // footer "+ new …"
  conflictFor? (id) => ConflictNote | null   // inline advisory under a row (team)
  loading?, disabled?, error?
/>
```
- Single → trailing check on the chosen; clicking commits + closes.
- Multi → leading checkbox; clicking toggles + commits optimistically, stays open.
- Data stays in the existing hooks (`useClients`, `useTeamMembers`, `useCatalogLookups`, `useProjectTableTeam`) — `EntityPicker` is presentation only.

### `<EnumPicker>` + `<SegmentedControl>`
- `<EnumPicker>` — fixed option set, no search, instant commit. Options carry an optional leading dot/icon (status thermal-map colors). Replaces **project status**.
- `<SegmentedControl>` — inline (non-popover) sibling for view/density segments; tokenized rebuild of `segmented-picker.tsx` with the animated glider on `EASE_SMOOTH`.

### `<DatetimePicker>`
Preset list (`PickerItem`s) + custom footer. Replaces **snooze** (presets + `datetime-local`), **repeat** (RRULE presets; the full custom editor stays in its side panel, opened via a footer action), and the **badge calendar** (date-range; `CalendarScheduler` reused inside; accent only on selected endpoints).

## 8. Priority rebuilds

### 8.1 Team / crew picker — multi-select (corrected model)
**The two-panel and the drill-in are both gone.** Team assignment is **per-task**, so the picker is **just a multi-select of crew** — search, tap to toggle, instant optimistic commit, inline schedule-conflict advisory.

- ONE `<EntityPicker multiple>` serves **both** surfaces:
  - **Projects-table cell** (`cell-team.tsx` rebuild) — "who's on the job." Multi-select of company members; checked = assigned.
  - **Per-task picker** — replaces `badge-popover.tsx`'s `MiniTeamPickerPopover` (already a plain instant multi-select; finally tokenized).
- **Conflicts:** reuse `useTeamScheduleConflicts` (`{ date; memberName; projectTitle }[]`, already used by `task-list.tsx`). Surfaced inline under the member in `text-rose` as an **advisory, not a hard block**.
- **Capability preserved:** member search, multi-select assign/unassign, conflict surfacing, read-only (RLS `42501`) → rows render `disabled` + a `[ view only ]` `PickerEmpty`-style notice, error states → inline message. The "create first task" / per-task matrix complexity is **removed** (it was the source of the bulk); per-task refinement happens in the per-task picker, not here.
- **Trigger** parity: overlapping avatar stack (≤3) + count, or `UserPlus` + count when empty.
- **RPC semantics to verify (not guess):** see §11.

### 8.2 Client picker
`<EntityPicker single>` with `noneOption` ("— No client"). Replaces the hand-rolled `editable-cell-client.tsx`:
- Portaled via Radix (no clipping), real outside-click/focus management (no manual `mousedown`).
- Preserves the controlled `editing` / `onBeginEdit` / `onCancelEdit` / `onCommit` contract used by the table's cell-edit machinery, and the `saving`/`saved` visual states on the trigger.
- Sentence-case content rows (was all-caps mono).
- Reuses `useClients` (lazy, `enabled: open`).

## 9. Migration map

| Picker | File | Target | Notes |
|--------|------|--------|-------|
| Team (project cell) | `…/table-v2/cells/cell-team.tsx` | `EntityPicker multiple` | priority; delete & rebuild |
| Team (per-task) | `badge-popover.tsx` `MiniTeamPickerPopover` | `EntityPicker multiple` | unify with above |
| Client | `…/table-v2/cells/editable-cell-client.tsx` | `EntityPicker single` + `noneOption` | priority; delete & rebuild |
| Pipeline assignee | `…/pipeline/…/cells/editable-cell-assignee.tsx` | `EntityPicker single` | gains avatars + i18n consistency |
| Category | `components/ops/category-picker.tsx` | `EntityPicker single` + `createAction` | **add i18n** (en+es) |
| Unit | `components/ops/unit-picker.tsx` | `EntityPicker single` + sub-label + `createAction` | **add i18n** |
| Project status | `…/table-v2/cells/editable-cell-status.tsx` | `EnumPicker` | thermal dot + check |
| Segmented | `components/ops/segmented-picker.tsx` | `SegmentedControl` | tokenize raw px/easing |
| Snooze | `components/ops/inbox/snooze-picker.tsx` | `DatetimePicker` | presets + custom |
| Repeat | `…/calendar/…/repeat-picker.tsx` | `DatetimePicker` (+ existing side-panel editor) | presets via picker; custom editor stays |
| Badge calendar | `components/ops/badge-popover.tsx` `MiniCalendarPopover` | `DatetimePicker` (range) | `CalendarScheduler` reused |
| Color | `components/settings/wizard/color-picker-popover.tsx` | `Picker` (swatch grid) | drop `createPortal` + hardcoded blur |
| Thread | `components/ops/inbox/thread-picker.tsx` | `Picker` (list) | navigation list |
| **Out of scope** | `*-detail-popover.tsx` | — | floating windows, untouched |

## 10. Tokenization fixes (apply as each file is touched)
- `select.tsx`: `border-[rgba(255,255,255,0.10)]` → `border-border`; `focus:border-[rgba(255,255,255,0.20)]` → `focus:border-glass-border-strong` (exact 0.20 match); `z-[60]` → `z-dropdown`.
- `command.tsx`: `data-[selected=true]:bg-[rgba(255,255,255,0.04)]` → `bg-surface-active`; drop `shadow-[inset_2px_0_0_0_#B5B5B5]` (cursor = surface-active per §4.3); keep chosen-check pattern at the consumer.
- `popover.tsx` / `dropdown-menu.tsx`: `z-50` → `z-dropdown` (migrate-on-touch).
- `color-picker-popover.tsx`: drop hardcoded `blur(28px) saturate(1.3)` + `rgba` border → ride `PickerContent`/`.glass-dense`.
- Standardize item radius (→ `rounded-btn`/5) and padding (→ `px-2 py-1.5`) across migrated pickers.

## 11. Risks / open items (verify in planning, do not guess)
1. **Projects-table assign target.** When a member is toggled on in the project cell, which tasks do they attach to? `assign_project_team_member(p_task_ids[])` requires task ids; the cell's project-level `teamMemberIds` is the *union* of task assignments. Best read: "assign to all active tasks / remove from all." **Action:** read the `assign_project_team_member` / `remove_project_team_member` RPC SQL (Supabase migrations) before implementing the cell's onChange; confirm whether `p_task_ids = []` has a project-level meaning, and whether `P0001` conflict is a hard reject (which would make "add to all" fail wholesale on one conflicting task — informing whether the cell needs per-task fallback). Pin the exact semantic in the plan.
2. **Conflict data in the projects table.** `useTeamScheduleConflicts` is wired in `task-list.tsx`; confirm it (or its inputs) is available/cheap to call from the projects-table cell context; otherwise scope conflict-advisory to the per-task surface in phase 1 and add it to the cell in a follow-up (logged, not silent).
3. **cmdk inside Radix Popover focus.** Standard pattern but verify focus hand-off (`onOpenAutoFocus` → input) and that table key handlers don't double-fire.

## 12. Dev playground (`/dev/playground`)
A permanent, dev-gated in-app surface — **not** this throwaway mockup. Built from the **real** components + tokens so cohesiveness is verifiable in-app and token drift is caught immediately.

- **Layout:** a **borderless canvas the user pans horizontally and vertically** (not a scroll page). Element groups are absolutely-positioned **zones** on a large surface inside an `overflow-hidden` viewport; pointer-drag on empty canvas translates; wheel pans (shift = horizontal); `+/−` / ctrl-wheel zoom; a "reset view" control. Reduced-motion → no inertia.
- **Zones (extensible):** **Pickers first** (every primitive + concrete picker + states), then Buttons, Inputs, Tags & badges, Avatars, Status, Dataviz, Surfaces. New groups drop in as new zones.
- **Tech:** transform-based pan/zoom, **no new dependency** (cost: $0). If a minimap / zoom-to-fit is later wanted, `@xyflow/react` is an option (note bundle cost before adding).
- **Gating:** route returns `notFound()` in production (`process.env.NODE_ENV === 'production'`) — dev/preview only. Not company-scoped. No i18n (dev tool). No cost.
- **Location:** `src/app/dev/playground/page.tsx` (+ `_components/`).

## 13. File structure
```
src/components/ui/picker/
  picker.tsx            // Picker, PickerContent (Popover + cmdk Command)
  picker-search.tsx     // PickerSearch
  picker-list.tsx       // PickerList, PickerEmpty, PickerGroupLabel
  picker-item.tsx       // PickerItem, PickerFooterAction
  index.ts              // barrel
src/components/ui/entity-picker.tsx
src/components/ui/enum-picker.tsx
src/components/ui/segmented-control.tsx   // rebuild of segmented-picker
src/components/ui/datetime-picker.tsx
src/app/dev/playground/page.tsx + _components/
src/i18n/dictionaries/{en,es}/picker.json // shared picker strings (+ category/unit additions)
```

## 14. i18n
- New shared namespace `picker` (en + es): generic strings — "Search", "No results", "—", "Clear", "New {entity}", conflict advisory template ("Booked · {project} · {when}").
- Category/unit pickers gain dictionary-backed strings (were hardcoded English).
- All migrated pickers route user-facing text through `useDictionary`, en **and** es.

## 15. Testing & verification
- `npx tsc --noEmit` stays at **0 errors**.
- Existing suites stay green: `tests/integration/projects-table-v2-phase4.test.tsx`, `…phase5.test.tsx`, plus any cell/picker tests.
- **New tests:**
  - Unit — primitive family: keyboard nav (↑/↓/Enter/Esc/type-ahead), single vs multi selection, empty state, disabled, focus management, reduced-motion fallback.
  - Integration — rebuilt **team** cell (multi-select toggle → optimistic mutation, conflict advisory render, read-only/error states) and **client** cell (none option, controlled editing contract, commit).
- `custom-skills:audit-design-system` pass over everything built/migrated → zero hardcoded values.
- Docs updated: canonical picker pattern (anatomy, tokens, states, motion, a11y) into `ops-design-system/project/DESIGN.md` and `ops-software-bible/05_DESIGN_SYSTEM.md`.
- **Migration note** at the end listing any call sites not yet converted — no silent partial coverage.

## 16. Phasing
1. **Primitive family** + token additions (`z-*`) + `tsc`/audit green.
2. **Concrete pickers** — `EntityPicker`, `EnumPicker` + `SegmentedControl`, `DatetimePicker`.
3. **Priority rebuilds** — team (verify RPC semantics first), client. Tests.
4. **Entity-cluster migration** — assignee, category (+i18n), unit (+i18n).
5. **Remaining migrations** — status, segmented, snooze, repeat, badge calendar, color, thread + tokenization fixes (`select`, `command`, `popover`, `dropdown-menu`).
6. **Dev playground** — borderless canvas, pickers zone first, extensible.
7. **Docs + bible + migration note.**

Atomic conventional commits as work lands (no AI attribution). No pushes without explicit permission.
