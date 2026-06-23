# P4 Radius-Token Codemod — OPS-Web

**Phase:** WEB OVERHAUL — P4 cross-cutting · decision-log **#12** ("radius literals → one deliberate codemod, deferred")
**Run date:** 2026-06-23 · **Branch:** `feat/web-overhaul` · **Worktree:** `ops-web-overhaul-p2-shell`
**Commits:** `bdc6ab7d` (value-identical bulk) · `5d370e3a` (off-ladder decisions + `rounded-btn` fix)
**Verification:** `tsc --noEmit` exit 0 (twice) · eslint 0 errors on changed files · whole-repo completeness sweep clean · independent 3-agent adversarial verification (below)

---

## 1 · Verdict

The deferred radius-token codemod is complete. **845 arbitrary `rounded-[Npx]` literals were converted to named/scale tokens across 273 files with ZERO pixel change** (every literal equals its token's configured value in `tailwind.config.ts`). A further **10 off-ladder / broken sites were resolved with explicit per-site judgment** (these DO change 1–2px and are listed in full for Jackson). Everything intentionally left untouched (gated surfaces, load-bearing thin bars, deferred table-v2 checkboxes, non-px arbitraries) is enumerated with rationale.

The codebase now has a single, named radius vocabulary: arbitrary `rounded-[Npx]` survives only where it is a deliberate off-ladder value the design system has no token for, and only on surfaces out of this wave's scope.

---

## 2 · What the codemod changed (commit `bdc6ab7d`) — VALUE-IDENTICAL, zero pixel change

Each mapping is pixel-identical: the literal px equals the token's value in `tailwind.config.ts`
(`bar:2 · sm:2.5 · chip:4 · DEFAULT:5 · sidebar:6 · lg:8 · panel:10 · modal:12`).

| Literal (arbitrary) | → Token | Count | Token px = literal px |
|---|---|---:|---|
| `rounded-[2px]` | `rounded-bar` | 112 | 2 = 2 |
| `rounded-[2.5px]` | `rounded-sm` | 26 | 2.5 = 2.5 |
| `rounded-[4px]` | `rounded-chip` | 192 | 4 = 4 |
| `rounded-[5px]` | `rounded` (DEFAULT) | 394 | 5 = 5 |
| `rounded-[6px]` | `rounded-sidebar` | 12 | 6 = 6 |
| `rounded-[8px]` | `rounded-lg` | 21 | 8 = 8 |
| `rounded-[10px]` | `rounded-panel` | 72 | 10 = 10 |
| `rounded-[12px]` | `rounded-modal` | 9 | 12 = 12 |
| directional `rounded-{t,r,l}-[2px\|5px\|12px]` | `rounded-{t,r,l}-{bar\|·\|modal}` | 7 | identical |
| **Total** | | **845** | **all pixel-identical** |

Scope: applied **globally** (every `.tsx/.ts/.jsx/.css` under `src/`, including gated surfaces) — because a value-identical token rename is risk-free everywhere and the point of "one deliberate codemod" is a systemic vocabulary. Excluded: `tailwind.config.ts`, the `border-radius:` raw declarations in `globals.css` (token definitions), `rounded-full`/`rounded-none`. The one `globals.css` touch is the `.ops-input` `@apply rounded-[5px]` → `rounded` (a component-class usage, pixel-identical).

### Convention decisions (set during this codemod)
- **5px → bare `rounded`, not a new `rounded-btn` token.** `DESIGN.md` names a `btn:5` radius, but `tailwind.config.ts` implements 5px as `DEFAULT`, and bare `rounded` was already the **dominant** 5px convention (444 existing uses vs 394 literals vs 33 `rounded-md` vs 2 broken `rounded-btn`). Converting to `rounded` unifies ~840 sites on one expression instead of splitting 5px three ways. The named tokens (`bar/chip/sidebar/panel/modal`) carry the *non-default* radii; the default radius is `rounded`. No redundant token was added.
- **8px → `rounded-lg` (value-identical), not the task's suggested 8→10/6 snap.** `lg:8px` exists, so this is a zero-pixel-change hygiene rename. All 21 `[8px]` are on gated surfaces (agent panels, chat bubbles where 8px is intentional, autonomy cards); forcing them onto the OPS ladder (10/6) would needlessly change pixels in surfaces out of scope. `rounded-lg` is the correct, safe target.
- **4px → `rounded-chip`** (the design system's name for the 4px tier; 60 `rounded-chip` already in use → 252 after). Value preserved; the sanctioned chip radius is unchanged in pixels.
- **2.5px → `rounded-sm`** (discovered during re-measure; `sm:2.5px` exists; value-identical).

---

## 3 · Off-ladder decisions (commit `5d370e3a`) — these DO change pixels (1–2px)

These 8 sites + 2 broken-token fixes are the only pixel-changing edits. All are on **live, in-scope** surfaces; every one was independently adversarially reviewed.

| Site | Element | Change | Why |
|---|---|---|---|
| `dashboard/widgets/pipeline-funnel-widget.tsx` | 6px legend pip | `[1px]→bar` **1→2px** | cosmetic square; snaps to bar token |
| `ops/expense-batch-popover.tsx` | 6px status dot | `[1px]→bar` **1→2px** | matches the `rounded-bar` title-bar buttons beside it |
| `ops/estimate-detail-popover.tsx` | 6px status dot | `[1px]→bar` **1→2px** | same title-bar consistency |
| `ops/invoice-detail-popover.tsx` | 6px status dot | `[1px]→bar` **1→2px** | same title-bar consistency |
| `clients/_components/clients-ar-banner.tsx` | "CHASE" text-button | `[3px]→chip` **3→4px** | chip-scale interactive control |
| `ui/key-hint.tsx` | keycap chip | `[3px]→chip` **3→4px** | kbd/keycap = chip token's exact use |
| `layouts/top-bar.tsx` | search `<kbd>` | `[3px]→chip` **3→4px** | keycap = chip |
| `ops/clients/.../contact-tab.tsx` | "ADD" text-button | `[3px]→chip` **3→4px** | chip-scale control |
| `accounting/qbo/customer-match-table.tsx` (×2) | 2 inputs | `rounded-btn→rounded` **0→5px** | **latent bug:** `rounded-btn` referenced a non-existent token → rendered 0px; now the intended 5px |

The three popover status dots are byte-identical; two were verifier-approved on the sibling-consistency argument (their title bars use `rounded-[2px]` buttons), so all three were treated identically. The `rounded-btn` fix also eliminates the last dangling reference to a token that was never defined.

---

## 4 · Intentionally left untouched (with rationale)

**Load-bearing `rounded-[1px]` (6 sites) — converting to bar(2px) would over-round:**
- `projects/_components/project-card.tsx` — progress track is exactly **2px tall** (a 2px radius pills it). Its inline-style `borderRadius:1` inner fill (same element) is also left.
- `layouts/sidebar.tsx` active edge marker (**w-2px**) · `ops/selectable-row.tsx` selected indicator (**w-2px**) — a 2px radius on a 2px-wide bar fully rounds it into a stadium, blunting the crisp edge-marker read.
- `ops/calendar-scheduler.tsx` task bar (**h-3px**), `ops/task-list.tsx` color bar + its loading skeleton (**w-3px**) — on a ≤3px-thin bar a 2px radius clamps to semicircular caps, conflicting with OPS "sharp / no-pills." Kept crisp as a matched pair.

**Gated / out-of-scope surfaces** (value-identical conversions WERE applied; off-ladder pixel-changes were NOT): `rounded-[1px]` in `components/agent/` (4), `phase-c-autonomy-widget`, `settings/wizard/`, `components/intel/`; `rounded-[3px]` in `admin/spec/project-detail/TimelineTab` (13), `pmf/ui/kbd`, `settings/email-category-autonomy`, `ops/inbox/composer` (2). These are class-B surfaces (agent / inbox-shelved / admin-spec / pmf / autonomy / catalog-setup wizard); their off-ladder values stay until each surface's own wave.

**Dev-only:** `providers/dev-bypass-banner.tsx` `[3px]` — never shipped to users.

**Deferred to the table-v2 → RegisterTable convergence (audit §4-E #3):** 4 `rounded-[3px]` checkbox controls in `projects/_components/table-v2/` (bulk-bar, header select-all, row select, cell-team glyph). Normalizing the radius there means the shared RegisterTable checkbox carries the token, rather than patching code slated for replacement.

**Non-px arbitraries (correctly out of scope):** `rounded-[var(--radius)]` (×1), `rounded-[inherit]` (×1) — not literal px, no token mapping.

**Final remaining arbitrary count:** `rounded-[3px]`=22, `rounded-[1px]`=13, `rounded-[var(--radius)]`=1, `rounded-[inherit]`=1. Every one is a documented leave above.

---

## 5 · Verification

- **`tsc --noEmit`** — exit 0 after the bulk, and again after the off-ladder edits (class-string renames are type-inert).
- **eslint** on the 9 off-ladder files — **0 errors** (11 pre-existing warnings: unused vars / hook-deps / `<img>`, none radius-related, none introduced here).
- **Whole-repo completeness sweep** — no `rounded-[...]` outside `tsx/ts/jsx/css`; no missed corner/logical variants (`tl/tr/bl/br/s/e/...`); no escaped CSS radius selectors; final tally matches expected exactly.
- **Independent 3-agent adversarial verification** — all pass, zero errors:
  - _Value-equivalence:_ `allEqual: true`, 0 mismatches — all 8 token mappings confirmed pixel-identical against `tailwind.config.ts`.
  - _No-live-site-left-behind:_ `errorsFound: []` — all 35 remaining `[1px]`/`[3px]` sites independently classified `correctlyLeft: true` (load-bearing / gated / table-v2 / dev). No live, in-scope, non-load-bearing site was missed.
  - _Diff purity:_ `pure: true` — the verifier programmatically checked **all 772 hunks** of `bdc6ab7d` (every removed line equals its added line byte-for-byte after applying the codemod map; all files +/- balanced; no renames/creates/deletes) and reviewed all 9 files of `5d370e3a` line-by-line. No logic, attribute, or whitespace changes; even malformed `rgba(...)` strings and `cn()` expressions were left untouched.

### Zero-pixel-change attestation (the bulk)
Every one of the 845 bulk conversions maps a literal to a token whose value in `tailwind.config.ts` is identical (2→bar, 2.5→sm, 4→chip, 5→DEFAULT, 6→sidebar, 8→lg, 10→panel, 12→modal). Rendered output is byte-identical. The only pixel changes in this entire effort are the 10 explicitly-listed off-ladder/broken sites in §3.
