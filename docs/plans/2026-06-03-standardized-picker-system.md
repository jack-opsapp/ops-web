# Standardized Picker System — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Build one canonical, fully-tokenized picker/popover system for OPS Web and rebuild/migrate the 20+ bespoke pickers onto it — starting with the team (multi-select) and client rebuilds.

**Architecture:** A four-part primitive family (`Picker` = Radix `Popover` + `cmdk` `Command`, plus `PickerSearch` / `PickerList` / `PickerItem` / `PickerFooterAction`) → three concrete pickers (`EntityPicker`, `EnumPicker` + `SegmentedControl`, `DatetimePicker`) → migrations. Presentation-only; all data stays in existing hooks. Plus a dev-gated `/dev/playground` borderless-canvas element gallery.

**Tech Stack:** Next.js 14 App Router, TypeScript, Tailwind, `@radix-ui/react-popover` ^1.1, `cmdk` ^1.0, Framer Motion, TanStack Query, Zustand. Tests: existing Vitest/RTL setup.

**Design System:** `.interface-design/system.md` (quick-ref) + spec `docs/superpowers/specs/2026-06-03-standardized-picker-system-design.md`. Every value traces to a Tailwind/CSS token.

**Required Skills (executing agent must load):**
- `frontend-design` — all component builds.
- `animation-studio:animation-architect` → `animation-studio:web-animations` — open/close + selection motion.
- `custom-skills:audit-design-system` — token-compliance verification on everything built/migrated.
- `ops-copywriter` — every user-facing string (placeholders, empty states, create-actions, conflict advisory) before writing i18n entries.
- Adhere to `.interface-design/system.md` tokens throughout.

---

## Platform note (do not re-litigate)

**OPS Web is cursor-driven desktop. There are no touch targets.** Picker rows are compact desktop density (**~32px**, `min-h-8`, `px-2 py-1.5`), matching existing tables/pickers. The "44×44px touch target" line in `.interface-design/system.md` §Accessibility reflects the **mobile/iOS** MO and does **not** apply to web pickers. (Task 0.4 proposes a one-line clarification to that doc — do not change behavior to 44px.)

## Canonical token reference (memorize)

| Concern | Token / class | Value |
|---|---|---|
| Surface | `.glass-dense` (via `PopoverContent`) | rgba(18,18,20,.78)·blur28·sat1.3·1px rgba(255,255,255,.09)·r12 |
| Row radius | `rounded` / `rounded-[5px]` (btn) | 5 |
| Row height/pad | `min-h-8 px-2 py-1.5` | ~32px |
| Row hover | `hover:bg-surface-hover` | #fff/.05 |
| Row keyboard cursor (cmdk `data-[selected=true]`) | `bg-surface-active` | #fff/.08 |
| Chosen check | lucide `Check` 16px `text-text` | #EDEDED |
| Search field | `bg-surface-input border border-border` | .04 / .10 |
| Focus | `focus-visible:ring-[1.5px] focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black` | accent ring only |
| Group label | `font-mono text-micro uppercase tracking-wider text-text-3` | 11px |
| Conflict text | `text-rose` | #B58289 |
| z-index | `z-dropdown` (new token → `--z-dropdown:1000`) | 1000 |
| Motion | `motion-safe:animate-anchored-in` (enter) | 150ms EASE_SMOOTH |
| Avatar | reuse `<UserAvatar>` from `@/components/ops/user-avatar` | — |

**Selected-state rule (one, everywhere):** hover→`surface-hover`; cmdk cursor→`surface-active`; chosen value→trailing monochrome `Check`; disabled→`opacity-40`. Accent only on focus ring.

---

## Phase 0 — Setup & tokens

### Task 0.1: Create isolated worktree
**Skills:** `superpowers:using-git-worktrees`
- Create a dedicated worktree + branch `feat/picker-system` so picker work never tangles with the parallel inbox WIP in the shared tree or the brief's do-not-touch files (`projects-view-tabs.tsx`, `projects-view-settings-menu.tsx`, share-with-team toast).
- All subsequent tasks run inside the worktree.

### Task 0.2: Add z-index tokens to Tailwind
**Files:** Modify `tailwind.config.ts` (`theme.extend.zIndex`).
- Add `zIndex: { content:'var(--z-content)', interactive:'var(--z-interactive)', nav:'var(--z-nav)', dropdown:'var(--z-dropdown)', 'floating-ui':'var(--z-floating-ui)', window:'var(--z-window)', modal:'var(--z-modal)', 'map-controls':'var(--z-map-controls)', emergency:'var(--z-emergency)' }`. CSS vars already exist in `globals.css`.
- **Verify:** `npx tsc --noEmit` (0 errors) and a throwaway `<div className="z-dropdown" />` compiles. Commit: `feat(tokens): add z-index scale utilities`.

### Task 0.3: Picker i18n namespace
**Files:** Create `src/i18n/dictionaries/en/picker.json` + `src/i18n/dictionaries/es/picker.json`.
**Skills:** `ops-copywriter`.
- Keys: `search`, `noResults`, `none` (`—`), `clear`, `create` (`New {entity}`), `conflict` (`Booked · {project} · {when}`), `loading`, `viewOnly`. Both languages.
- Commit: `feat(i18n): add picker namespace (en+es)`.

### Task 0.4: Design-system doc clarification (non-blocking)
**Files:** Modify `.interface-design/system.md` §Accessibility touch-target row.
- Add: "Touch targets (44px) apply to iOS/mobile; OPS Web is cursor-driven — pickers/rows use ~32px desktop density." (Do NOT change component behavior.)
- Commit: `docs(design-system): clarify touch targets are mobile-only`.

---

## Phase 1 — Primitive family (`src/components/ui/picker/`)

> **Skills:** `frontend-design`, `animation-studio:web-animations` (entrance), `custom-skills:audit-design-system` (end of phase). All UI uses §canonical tokens.

### Task 1.1: `Picker` / `PickerContent`
**Files:** Create `src/components/ui/picker/picker.tsx`; Test `tests/unit/ui/picker/picker.test.tsx`.
- `Picker` = re-export Radix `Popover` root + `PickerTrigger` = `PopoverTrigger`.
- `PickerContent` wraps `PopoverContent`: renders a `cmdk` `Command` root inside; props `size?: 'sm'|'md'|'lg'|'auto'` (224/256/288/auto px → `w-[...]`), `width?`, default `align='start' sideOffset={6}`, `className` merge; sets `z-dropdown`; `onOpenAutoFocus` focuses the search input if present (else first item). Reuses the shipped `.glass-dense` + `motion-safe:animate-anchored-in` already on `PopoverContent`.
- **Step 1 (test):** renders children in a portal when open; has `role` from cmdk; applies `z-dropdown` + width class. **Step 2:** run → fail. **Step 3:** implement. **Step 4:** pass. **Step 5:** commit `feat(picker): add Picker + PickerContent base`.

### Task 1.2: `PickerSearch`
**Files:** Create `src/components/ui/picker/picker-search.tsx`; Test alongside.
- Leading `Search` (16px `text-text-3`), `cmdk` `Command.Input`, trailing clear `X` when value non-empty. `h-8 bg-surface-input border border-border rounded-[5px]`, focus = §focus ring. Mohave `text-body-sm`, `placeholder:text-text-3`. Placeholder via prop (i18n at call site).
- **Tests:** typing filters (cmdk), clear button resets + refocuses, focus ring class present. Commit `feat(picker): add PickerSearch`.

### Task 1.3: `PickerList` + `PickerEmpty` + `PickerGroupLabel`
**Files:** Create `src/components/ui/picker/picker-list.tsx`.
- `PickerList` = `cmdk` `Command.List`, `max-h-[280px]` (prop-override), `overflow-y-auto scrollbar-hide`, scroll contained. `PickerEmpty` = `Command.Empty` → `—`/no-results (`font-mono text-micro uppercase text-text-3`, centered). `PickerGroupLabel` = `// section` micro label.
- **Tests:** empty renders when no matches; group label renders. Commit `feat(picker): add PickerList, PickerEmpty, PickerGroupLabel`.

### Task 1.4: `PickerItem` + `PickerFooterAction`
**Files:** Create `src/components/ui/picker/picker-item.tsx`.
- `PickerItem` = `cmdk` `Command.Item`. Props: `value`, `selected?`, `disabled?`, `onSelect`, `leading?` (avatar/checkbox/dot/icon slot), `children` (label), `subLabel?`, `trailing?`. Styling per §selected-state rule; `min-h-8 px-2 py-1.5 rounded-[5px] gap-2.5`. When `selected` and not multi → trailing `Check` (16px `text-text`). `aria-selected` for single (`role=option`), `aria-checked` for multi.
- `PickerFooterAction` = divided footer row (`border-t border-border-subtle`), shared row styling, `destructive?` → `text-rose`.
- **Tests:** click fires `onSelect`; selected shows check; disabled is non-interactive + `opacity-40`; keyboard `Enter` on cursor commits; cursor highlight class = `data-[selected=true]:bg-surface-active`. Commit `feat(picker): add PickerItem + PickerFooterAction`.

### Task 1.5: Barrel + phase audit
**Files:** Create `src/components/ui/picker/index.ts`.
- Export all primitives. Run `custom-skills:audit-design-system` over `src/components/ui/picker/*` → zero hardcoded values. `npx tsc --noEmit` 0. Commit `feat(picker): barrel export + token audit pass`.

---

## Phase 2 — Concrete pickers (`src/components/ui/`)

> **Skills:** same as Phase 1.

### Task 2.1: `EntityPicker`
**Files:** Create `src/components/ui/entity-picker.tsx`; Test `tests/unit/ui/entity-picker.test.tsx`.
- Props (generic `<T>`): `items`, `value: string|string[]`, `multiple?`, `onChange`, `getId`, `getLabel`, `getSubLabel?`, `getAvatar?` (returns props for `<UserAvatar>`), `searchable?=true`, `placeholder?`, `emptyLabel?`, `noneOption?`, `createAction?:{label;onCreate}`, `conflictFor?:(id)=>string|null`, `loading?`, `disabled?`, `error?`, `triggerLabel`.
- Single → `onChange(id)` + close. Multi → leading checkbox, `onChange(nextIds[])` optimistic, stays open. `noneOption` → leading `— {none}` row committing null/empty. `conflictFor` → render advisory line (`text-rose font-mono text-micro`) under the row.
- Avatars via `<UserAvatar>`. Strings via call-site i18n.
- **Tests:** single select commits+closes; multi toggles + stays open; none-option; create-action fires; conflict line renders; disabled. Commit `feat(picker): add EntityPicker`.

### Task 2.2: `EnumPicker`
**Files:** Create `src/components/ui/enum-picker.tsx`; Test alongside.
- Props: `options:{value;label;dotColor?;icon?;disabled?}[]`, `value`, `onChange`, no search, instant commit + close. Leading dot/icon slot (status thermal colors). Reuses `PickerItem`.
- **Tests:** renders options, commits on click, dot color applied. Commit `feat(picker): add EnumPicker`.

### Task 2.3: `SegmentedControl`
**Files:** Create `src/components/ui/segmented-control.tsx`; Test alongside.
**Skills:** `animation-studio:web-animations` (glider).
- Inline (non-popover) toggle group. Inactive `text-text-3`; hover `text-text-2 bg-[rgba(255,255,255,0.03)]`; active `text-text bg-surface-active border-[rgba(255,255,255,0.18)]` — **no accent** (Toggles spec). Animated glider via Framer Motion `layout`/transform, `EASE_SMOOTH` 200ms, `useReducedMotion` fallback. `iconOnly?` option support.
- **Tests:** active state, onChange, reduced-motion path. Commit `feat(picker): add SegmentedControl`.

### Task 2.4: `DatetimePicker`
**Files:** Create `src/components/ui/datetime-picker.tsx`; Test alongside.
- Props: `presets:{label;sub?;value:()=>Date}[]`, `onSelect`, `customMode?:'datetime'|'range'|'none'`, `footerAction?`. Preset list = `PickerItem`s (instant commit). Custom footer = `datetime-local` input + Set, or a `<CalendarScheduler>` for range (reuse existing). Accent only on selected calendar endpoints.
- **Tests:** preset commits; custom datetime commits; range uses CalendarScheduler. Commit `feat(picker): add DatetimePicker`.

---

## Phase 3 — Priority rebuilds

> **Skills:** `frontend-design`, `ops-copywriter`, `custom-skills:audit-design-system`. Preserve all behavior; simplify UI only.

### Task 3.0: VERIFY team RPC semantics (do first — no guessing)
**Files:** read Supabase migrations for `assign_project_team_member` / `remove_project_team_member` (via Supabase MCP `list_migrations`/`execute_sql` on project `ijeekuhbatykdomumfjx`, or `supabase/migrations/`).
- Determine: (a) does `p_task_ids=[]` have a project-level meaning, or must we pass all active task ids? (b) Is `P0001` (conflict) a hard reject or advisory? (c) what `remove(..., null)` does (remove from all — confirm).
- **Output:** write findings into the plan/spec as a short "RPC semantics" note. This decides the project-cell `onChange` mapping. **Do not implement 3.1 until resolved.**

### Task 3.1: Rebuild team picker (multi-select) — `cell-team.tsx`
**Files:** Rewrite `src/app/(dashboard)/projects/_components/table-v2/cells/cell-team.tsx`; reuse `useProjectTableTeam`; Test `tests/integration/...cell-team.test.tsx`.
- `<EntityPicker multiple>` of company members. Checked = on the job. `onChange` diff → `assignTeamMember`/`removeTeamMember` per the Task 3.0 semantics, optimistic, **no Apply**.
- `conflictFor` wired from `useTeamScheduleConflicts` (verify availability in this context per spec §11.2; if not cheaply available, scope conflict advisory to the per-task surface this phase and log the deferral).
- Trigger: avatar stack (≤3, via `<UserAvatar>`) + count, or `UserPlus` + count when empty (parity).
- States: read-only (RLS `42501`) → disabled rows + `[ view only ]`; error → inline message; loading.
- Delete the two-panel/drill code entirely.
- **Tests:** toggle assigns/removes optimistically; conflict advisory renders; read-only/error/empty. `tsc` 0. Commit `feat(projects): rebuild team cell as multi-select EntityPicker`.

### Task 3.2: Unify per-task team picker
**Files:** Replace `MiniTeamPickerPopover` body in `src/components/ops/badge-popover.tsx` with `<EntityPicker multiple>` (same props it already exposes: `selectedIds`, `members`, `onSave`).
- **Tests:** existing callers compile; toggle still instant. Commit `refactor(team): route per-task picker through EntityPicker`.

### Task 3.3: Rebuild client picker — `editable-cell-client.tsx`
**Files:** Rewrite `src/app/(dashboard)/projects/_components/table-v2/cells/editable-cell-client.tsx`; reuse `useClients`; Test alongside.
- `<EntityPicker single noneOption>`; reuse `useClients` (`enabled: open`). Preserve the controlled `editing`/`onBeginEdit`/`onCancelEdit`/`onCommit` contract + trigger `saving`/`saved` states. Sentence-case rows.
- Delete hand-rolled div + manual `mousedown`.
- **Tests:** none-option commits null; client commits; controlled-editing parity; outside-click closes. Commit `feat(projects): rebuild client cell on EntityPicker`.

### Task 3.4: Phase-3 regression gate
- Run `tests/integration/projects-table-v2-phase4.test.tsx`, `…phase5.test.tsx` → green. `tsc` 0. `audit-design-system` on the two cells. Commit if any fixups.

---

## Phase 4 — Entity-cluster migration

> Pattern: swap bespoke picker → `<EntityPicker>`, preserve hook + behavior, add i18n where missing, audit.

### Task 4.1: Pipeline assignee
**Files:** `src/app/(dashboard)/pipeline/_components/table/cells/editable-cell-assignee.tsx` → `<EntityPicker single>` + `getAvatar` (gains avatars). Reuse `useTeamMembers`. Tests + `tsc`. Commit `refactor(pipeline): assignee on EntityPicker`.

### Task 4.2: Category (+ i18n)
**Files:** `src/components/ops/category-picker.tsx` → `<EntityPicker single createAction>`. Reuse `useCatalogLookups`. **Add i18n** (was hardcoded EN) → strings to `picker.json` / a `catalog` namespace. Tests. Commit `refactor(catalog): category picker on EntityPicker + i18n`.

### Task 4.3: Unit (+ i18n)
**Files:** `src/components/ops/unit-picker.tsx` → `<EntityPicker single createAction>` + `getSubLabel` (abbreviation). Reuse `useCatalogLookups`. **Add i18n.** Tests. Commit `refactor(catalog): unit picker on EntityPicker + i18n`.

---

## Phase 5 — Remaining migrations + tokenization fixes

### Task 5.1: Project status → `EnumPicker`
**Files:** `src/app/(dashboard)/projects/_components/table-v2/cells/editable-cell-status.tsx` → `<EnumPicker>` with thermal dots. Tests; projects-table phase4/5 stay green. Commit `refactor(projects): status cell on EnumPicker`.

### Task 5.2: Segmented picker → `SegmentedControl`
**Files:** Replace `src/components/ops/segmented-picker.tsx` usages with `SegmentedControl`; delete old. Tokenize raw px/easing. Commit `refactor(ui): migrate segmented-picker to SegmentedControl`.

### Task 5.3: Snooze → `DatetimePicker`
**Files:** `src/components/ops/inbox/snooze-picker.tsx`. Preserve `useThreadActions` snooze/unsnooze. Commit `refactor(inbox): snooze on DatetimePicker`.

### Task 5.4: Repeat → `DatetimePicker` (presets) + keep side-panel custom editor
**Files:** `src/app/(dashboard)/calendar/_components/side-panel/repeat-picker.tsx`. Presets via picker; "Custom recurrence…" footer opens the existing RRULE editor. Tokenize raw rgba/px. Commit `refactor(calendar): repeat presets on DatetimePicker`.

### Task 5.5: Badge calendar → `DatetimePicker` (range)
**Files:** `MiniCalendarPopover` in `src/components/ops/badge-popover.tsx` → `DatetimePicker` range wrapping `CalendarScheduler`. Commit `refactor(projects): badge calendar on DatetimePicker`.

### Task 5.6: Color → `Picker` (swatch grid)
**Files:** `src/components/settings/wizard/color-picker-popover.tsx` → `Picker` + grouped swatch grid; drop `createPortal` + hardcoded `blur`/border. Selected = double-ring. Commit `refactor(settings): color picker on Picker`.

### Task 5.7: Thread → `Picker` (list)
**Files:** `src/components/ops/inbox/thread-picker.tsx` → `Picker` + `PickerList`; current = faint accent wash, state tags. Commit `refactor(inbox): thread picker on Picker`.

### Task 5.8: Tokenize base primitives
**Files:**
- `src/components/ui/select.tsx`: `border-[rgba(255,255,255,0.10)]`→`border-border`; `focus:border-[rgba(255,255,255,0.20)]`→`focus:border-glass-border-strong`; `z-[60]`→`z-dropdown`.
- `src/components/ui/command.tsx`: selected `bg-[rgba(255,255,255,0.04)]`→`bg-surface-active`; drop `shadow-[inset_2px_0_0_0_#B5B5B5]`.
- `src/components/ui/popover.tsx` + `dropdown-menu.tsx`: `z-50`→`z-dropdown`.
- Run `audit-design-system` on all four. Commit `refactor(ui): tokenize select/command/popover/dropdown`.

---

## Phase 6 — Dev playground (`/dev/playground`)

> **Skills:** `frontend-design`, `animation-studio:web-animations` (pan/zoom), `custom-skills:audit-design-system`.

### Task 6.1: Route + dev gate
**Files:** Create `src/app/dev/playground/page.tsx`. Return `notFound()` when `process.env.NODE_ENV === 'production'`. No company scope, no i18n (dev tool). Commit `feat(dev): playground route (dev-gated)`.

### Task 6.2: Borderless pan/zoom canvas
**Files:** Create `src/app/dev/playground/_components/canvas.tsx`.
- `overflow-hidden` viewport; large absolutely-positioned surface; pointer-drag on empty space pans (transform translate); wheel pans (shift = x); ctrl-wheel or `+/−` zoom; "reset view" control. `useReducedMotion` → no inertia. No new dependency.
- Commit `feat(dev): borderless pan/zoom canvas`.

### Task 6.3: Pickers zone (first zone)
**Files:** `src/app/dev/playground/_components/zones/pickers.tsx`.
- Render real `EntityPicker` (single/multi/avatar/create/conflict), `EnumPicker`, `SegmentedControl`, `DatetimePicker`, and primitive states — with mock data. Grouped, labeled. Commit `feat(dev): pickers zone`.

### Task 6.4: Element zones (extensible)
**Files:** zones for buttons, inputs, tags & badges, avatars, status, surfaces — using existing shared components. Each a draggable/positioned zone on the canvas. Commit `feat(dev): element gallery zones`.

---

## Phase 7 — Docs, tests, audit, migration note

### Task 7.1: DESIGN.md + system.md
**Files:** Add the canonical picker pattern (anatomy, tokens, states, motion, a11y) to `ops-design-system/project/DESIGN.md` and `.interface-design/system.md` (Component Primitives). Commit `docs(design-system): canonical picker pattern`.

### Task 7.2: Bible
**Files:** Update `ops-software-bible/05_DESIGN_SYSTEM.md` picker/popover section. Commit `docs(bible): picker system`.

### Task 7.3: Full verification gate
- `npx tsc --noEmit` → 0.
- Run picker unit suites + `projects-table-v2-phase4/5` + any cell/picker integration → green.
- `custom-skills:audit-design-system` across all new + migrated files → zero hardcoded values.
- Manual: open `/dev/playground`, eyeball cohesiveness.

### Task 7.4: Migration note
**Files:** Append a "Migration status" section to this plan listing every call site converted + any not yet converted (no silent partial coverage). Commit `docs(picker): migration status note`.

---

## Conventions
- Atomic conventional commits as each task lands. No AI attribution. Stage files by name (never `git add -A`) — the shared tree has parallel WIP.
- No `git push` without explicit user permission.
- TDD where behavior is testable (selection, keyboard, commit, states); visual/token correctness verified via `audit-design-system` + the playground.

---

## Migration status

**Branch:** `feat/picker-system` (worktree off clean `main`). **Gates green at checkpoint:** `tsc --noEmit` 0; picker (9) + entity-picker (6) unit suites; projects-table phase4 (20) + phase5 (19) + edit-core (11) integration suites.

### Converted (committed)
- **Primitive family** — `Picker` / `PickerContent` / `PickerSearch` / `PickerList` / `PickerEmpty` / `PickerGroup` / `PickerItem` / `PickerFooterAction` (`src/components/ui/picker/`). Radix Popover + cmdk, tokenized, tested.
- **`EntityPicker`** (`src/components/ui/entity-picker.tsx`) — search + single/multi + avatars + sub-label + none-option + create-action + conflict advisory + read-only/error. Tested.
- **Team cell** (`cell-team.tsx`) — rebuilt as `EntityPicker multiple`; assign-to-all-active-tasks / remove-all; no-tasks notice; RLS-42501 inline; **inline schedule-conflict advisory** via `useTeamScheduleConflicts`. The ~510-line two-panel is gone.
- **Per-task team picker** — NOTE: `badge-popover.tsx`'s `MiniTeamPickerPopover` is **not yet** routed through EntityPicker (still bespoke; tokenize in a follow-up).
- **Client cell** (`editable-cell-client.tsx`) — rebuilt as `EntityPicker single + noneOption`; portaled; controlled-edit contract preserved.
- **Tokens / scaffold** — `popover.tsx` base z-index → `z-dropdown`; `picker` i18n namespace (en + es); `.interface-design/system.md` touch-target line clarified (web is cursor-driven). z-index utilities (`z-dropdown`) already existed in `globals.css` — no Tailwind config change needed.

### Not yet converted (still on bespoke pickers)
- **Concrete pickers to build:** `EnumPicker`, `SegmentedControl`, `DatetimePicker`.
- **Entity cluster:** pipeline assignee (`editable-cell-assignee.tsx`), category (`category-picker.tsx`, + i18n), unit (`unit-picker.tsx`, + i18n).
- **Enum/datetime/specialized:** project status (`editable-cell-status.tsx` → EnumPicker), `segmented-picker.tsx` → SegmentedControl, `snooze-picker.tsx` / `repeat-picker.tsx` / `badge-popover.tsx` MiniCalendar → DatetimePicker, `color-picker-popover.tsx`, `thread-picker.tsx`.
- **Base tokenization fixes:** `select.tsx` (raw rgba borders, `z-[60]`), `command.tsx` (raw rgba selected bg + `#B5B5B5` inset), `dropdown-menu.tsx` (`z-50`).
- **Dev playground:** `/dev/playground` borderless-canvas element gallery (not started).
- **Docs:** canonical picker pattern into `ops-design-system/project/DESIGN.md` + `ops-software-bible/05_DESIGN_SYSTEM.md` (not started).
