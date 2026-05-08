# Project Workspace — Atom Mapping (Phase 5.1)

> Companion to [`2026-05-06-project-workspace-modal-implementation.md`](./2026-05-06-project-workspace-modal-implementation.md).
> Generated: 2026-05-07. Reflects state after Phase 4 (commits `d34faf24`, `8d7d6e27`, `c169f71c`, `8e336280`).

## Purpose

Before building the workspace atom kit, audit OPS-Web for components that already do the job. The plan's rule — **reuse existing OPS-Web components when they cover ≥80% of the handoff spec; build new only when the handoff demands a primitive that doesn't exist**.

This document is the source-of-truth mapping that drives Tasks 5.2 → 5.17. Every atom listed below has an explicit decision: **EXTEND**, **WRAP**, or **NEW**.

---

## Atom-by-atom audit

| # | Handoff atom | OPS-Web equivalent | Decision | Rationale |
|---|--------------|--------------------|----------|-----------|
| 5.2 | `Mono` | none — closest is inline `font-mono uppercase tracking-...` strings scattered across widgets | **NEW** | Tactical voice primitive (`// SLASHES`, `[brackets]`, `SYS ::`) used pervasively in the workspace. Centralises the JetBrains Mono + uppercase + tracking-0.18em recipe so callers stop re-spelling it. |
| 5.3 | `Cake` | none | **NEW** | Cake Mono Light is the heavy uppercase display voice (page titles, section headers, card titles). No existing component encapsulates the font-cakemono + weight-300 + uppercase recipe. |
| 5.4 | `Body` | none — Mohave default text is implicit | **NEW** | Workspace body voice. Sized 12 / 14 / 16 / 18 with the spec-v2 text ladder. Centralises the Mohave + sentence-case recipe; complements `Mono` and `Cake` so every text node has a single source. |
| 5.5 | `Stack` | none standardised | **NEW** | Vertical flex column primitive with a token-based gap. Used densely by every workspace tab body. |
| 5.6 | `Inline` | none standardised | **NEW** | Horizontal flex row primitive with a token-based gap + alignment. Used by every toolbar / metadata strip in the workspace. |
| 5.7 | `Hairline` | none standardised | **NEW** | 1px separator — horizontal or vertical, dashed or solid. The workspace uses dashed hairlines under `// SECTION` titles and solid hairlines between rows; both come from one component. |
| 5.8 | `Btn` (primary outlined→fill, secondary, ghost, destructive) | `<Button>` from `src/components/ui/button.tsx` exists but `primary` is **filled at rest** — the spec-v2 brand mandates **outlined at rest, fills on hover**. The existing `Button` is wired throughout the dashboard and its current variants are intentional for non-workspace surfaces. | **NEW** (workspace-scoped) | Building a workspace `Btn` matches the brand spec without disturbing existing `<Button>` consumers. Documented divergence: the workspace `Btn`'s primary is `text-ops-accent border-ops-accent` at rest → fills on hover. The existing `Button`'s primary is `bg-ops-accent` at rest. |
| 5.9 | `IconBtn` (small 26–32px icon-only) | none — `<Button size="icon">` is 28px (`h-7 w-7`) which is close, but visually heavy for the workspace toolbar | **NEW** | Workspace toolbar / inline action buttons need a smaller, near-zero-chrome icon button. Pairs with the new workspace `Btn`. |
| 5.10 | `Chip` (neutral / olive / tan / rose / accent) | `<WidgetStatusBadge>` exists at `src/components/dashboard/widgets/shared/widget-status-badge.tsx` — entity-scoped, status-driven, hard-coded 9px font. Doesn't expose a generic colour-tone API. | **NEW** | The workspace needs a generic neutral/earth-tone chip independent of any entity status. `WidgetStatusBadge` stays for dashboard widgets; workspace `Chip` wraps the same colour-tone recipe in a generic API. |
| 5.11 | `Section` (`// TITLE` + dashed hairline) | none | **NEW** | Standardises the `//` slash-prefix title voice (Mono uppercase, `var(--text-mute)` slashes) plus the dashed hairline below. Used by every panel in the workspace. |
| 5.12 | `Field` (label + child + optional/required/hint/error) | `<Input>` from `src/components/ui/input.tsx` *bundles* its own label, but min-h-[56px] is bulky and double-labels when wrapped. `<Label>` from `src/components/ui/label.tsx` exists but doesn't carry the workspace voice. | **NEW** | Workspace fields are denser than the dashboard inputs. `Field` owns the label voice (Mono uppercase 9.5px tracking 0.18em) plus optional/required hint/error rendering. Children can be `TextInput`, `TextArea`, `Select`, `Segmented` — anything. |
| 5.13 | `FieldRow` | none | **NEW** | Layout primitive for a row of `Field` cells with proportional widths. |
| 5.14 | `TextInput` | `<Input>` from `src/components/ui/input.tsx` mismatches: bundles its own label (Field would double-label), uses min-h-[56px] (workspace targets ~32–36px). | **NEW** | Workspace-specific `<input>` styling — pure presentation, no internal label. Lets `Field` own the label. Reuses native browser semantics (id wiring via `Field`). |
| 5.15 | `TextArea` | `<Textarea>` from `src/components/ui/textarea.tsx` — same mismatch as `Input`. Bundles its own label, can't co-exist cleanly with `Field`. | **NEW** | Workspace-specific `<textarea>` styling, no internal label. |
| 5.16 | `Select` | `<Select*>` family from `src/components/ui/select.tsx` — already Radix-based, glass-dense menu, workspace-compatible styling. The composition (`<SelectTrigger>` / `<SelectContent>` / `<SelectItem>`) is verbose for workspace callers. | **WRAP** | Build a thin workspace `<Select>` that takes `value` / `onChange` / `options[]` / `placeholder` and internally renders the existing Radix primitives. Keeps the API symmetric with `TextInput` / `TextArea` so `Field` consumers don't case-split on input type. |
| 5.17 | `Segmented` | none | **NEW** | Radio-group-style segmented control for tabs / mode toggles. The existing `<Tabs>` (`src/components/ui/tabs.tsx`) is page-level navigation, not a form-control segmented input. |

## Atoms intentionally **not** in 5.2–5.17

| Handoff atom | Decision | Rationale |
|--------------|----------|-----------|
| `Avatar` | **REUSE** `<UserAvatar>` from `src/components/ops/user-avatar.tsx` | Already accepts `name` / `imageUrl` / `size` / `online`. The deprecated `color` prop is a no-op (OPS aesthetic is monochrome). No workspace-specific changes needed. |
| `Lucide` | **DIRECT** | Use `lucide-react` directly — no wrapper. Brand spec mandates 1.5px stroke + `currentColor`; that's a usage rule, not an atom. |
| `ROText` / `ROPerson` | **COMPOSE** | Pure compositions of `Body` + `UserAvatar`. No standalone atom needed; will be inline at the call site. |
| `ColorSwatchPicker` | **REMOVED** | Removed from inventory at design review — projects use status hex, not user-picked colours. |
| `ReadField` / `ReadGrid` | **REMOVED** | The handoff's SITE card was cut at design review. ReadField/ReadGrid have no remaining consumers. |

## Token-compliance rules (apply to every atom)

1. **No hex literals.** Every colour value must trace to a token. Allowed:
   - Tailwind tokens: `text-text`, `text-text-2`, `text-text-3`, `text-ops-accent`, `border-ops-accent`, etc.
   - CSS variables: `var(--text)`, `var(--text-2)`, `var(--text-3)`, `var(--text-mute)`, `var(--ops-accent)`, `var(--ops-accent-soft)`, `var(--ops-accent-line)`, `var(--olive)`, `var(--tan)`, `var(--rose)`, `var(--brick)`, plus all `-soft` / `-line` variants.
2. **No hard-coded font families.** Use `font-mohave` / `font-mono` / `font-cakemono` Tailwind tokens (or the `var(--font-mohave)` / `var(--font-mono)` / `var(--font-cakemono)` CSS variables when inline-style is unavoidable).
3. **No hard-coded radii.** Use `rounded-bar` (2) / `rounded-chip` (4) / `rounded` (5) / `rounded-panel` (10) / `rounded-modal` (12). The workspace's compact controls use `rounded` (5) by default; chips use `rounded-chip` (4); progress / strip elements use `rounded-bar` (2).
4. **Spacing comes from the 8-point Tailwind scale.** `0.5` (4) / `1` (8) / `1.5` (12) / `2` (16) / `3` (24) / `4` (32) / etc.
5. **Motion.** Single curve `cubic-bezier(0.22, 1, 0.36, 1)` (token: `var(--ease-smooth)`); `var(--d-hover)` (150ms) for hover transitions; `var(--d-panel)` (200ms) for panel transitions.
6. **Atoms ≤ 80 lines of implementation.** If an atom needs more than 80 lines, decompose.
7. **Each atom has a co-located test.** Tests assert: correct font-family token, correct size, correct colour via CSS variable (not hex), correct radius via the token name, correct hover state.

## Implementation order (5.2 → 5.17)

`Mono` → `Cake` → `Body` → `Stack` → `Inline` → `Hairline` → `Btn` → `IconBtn` → `Chip` → `Section` → `Field` → `FieldRow` → `TextInput` → `TextArea` → `Select` → `Segmented`

Typography first so layout primitives can compose them; layout primitives next so structural atoms can compose them; interactive primitives (`Btn`, `IconBtn`, `Chip`) before structural primitives (`Section`); form atoms last so `Field` can own label voice consistently.

## Final-pass verification

After all atoms are committed:
1. `npm run type-check` — zero errors.
2. `npm test -- src/components/ops/projects/workspace/atoms` — full atom suite green.
3. Invoke `audit-design-system` skill on `src/components/ops/projects/workspace/atoms/` — zero token violations, zero pattern deviations.
