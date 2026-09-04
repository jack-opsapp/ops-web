# Design-system divergences — proof pack (2026-09-01)

Branch `fix/design-system-divergences-20260901` off origin/main `7bafb2f9`.
Captured headless (system Chrome via Playwright) at a **1300×900 viewport**
as the dev-bypass user `pete` (Maverick admin). Page shots are stored at 1×
(1300px wide); element crops (`*-btn-*`, `*-footer-*`, `*-hover-*`,
`bug-drawer-panel-*`) keep their `@2x` pixels. `measure-*.json` hold the
computed-style readings the tables below quote.

## 1 · Primary button — outlined at rest

DESIGN.md §9 / spec v2: primary CTA = `text-ops-accent border-ops-accent` on a
transparent fill at rest → `bg-ops-accent text-black` on hover. The shared
`<Button variant="primary">` (59 call sites) and `WorkbarButton` (the compact
create CTA on Pipeline / Books / Catalog / Clients) shipped **filled** at rest.

| CTA | Before (rest) | After (rest) | After (hover) | Files |
|---|---|---|---|---|
| NEW LEAD (Pipeline workbar) | fill `#417394`, black text | transparent, accent text + hairline | fill `#417394`, black text | `pipeline-new-lead-{before,after}.png`, `pipeline-new-lead-hover-*@2x.png` |
| SAVE CHANGES (Settings › Company) | fill `#417394`, black text, **16px** label | transparent, accent text + hairline, **14px** label | fill `#417394`, black text | `settings-company-*`, `settings-company-save-btn-*` |
| Lockout states (Subscribe / Ask admin…) | fill `#6F94B0` | transparent, accent text + hairline | — | `lockout-preview-{before,after}.png` |
| Estimate / invoice form submit (Books) | default variant (neutral glass), **16px** label | unchanged colours — these were never primary; label now **14px** | — | `estimate-form-submit-*`, `invoice-form-submit-*`, `estimate-form-footer-after`, `invoice-form-footer-after`, `books-new-estimate-btn-after` |

(`#417394` is `--ops-accent` as rendered inside the glass shell; the lockout
preview sits on the bare canvas and reads the raw `#6F94B0`.)

### Discovered on the way

- **Every button label rendered 16px, not the 14px spec.** `cn()` registers
  the custom font-size tokens with tailwind-merge so a size and a colour can
  coexist, but the four Cake Mono roles (`text-cake-button` among them) were
  missing — the merge dropped the size on every `<Button>`. Fixed in
  `src/lib/utils/cn.ts` (`11464042`); the settings SAVE reading above shows
  the label at 14px after.
- `send-estimate-flow.tsx` hand-rolled the outlined look with class
  overrides on a default button; it is `variant="primary"` now.
- The shared button's neutral hairlines were literals with exact tokens
  (`0.10` → `border-line`, `0.18` → `border-line-hi`, `0.05` →
  `surface-hover`). Tokenized, no visual change.

### Call-site audit (59 `variant="primary"` sites)

No call site overrides the variant's colours through `className` (grep of
every `<Button … variant="primary" …>` tag for `bg-`/`text-`/`border-`/`hover:`
overrides returned nothing), so all 59 inherit the fix cleanly. None sits on
a light background — the only light-surface hit was the auth layout's own
matte button, which is not a `variant="primary"`. Tests: the only suites that
asserted button classes (`btn.test.tsx`, `mode-footer.test.tsx`) already
expected the outlined rule for the workspace `Btn`; their stale comments
describing the shared Button as "filled for backwards-compat" were updated,
and a new `tests/unit/components/ui/button.test.tsx` pins the rule.

### Still divergent (out of this pass — spawned as DESIGN SYSTEM DIVERGENCES - P1-1)

Hand-rolled CTAs that paint a solid accent at rest without the shared Button:
`note-composer.tsx:225`, `task-list.tsx:588`, `review-tasks-modal.tsx:336`,
`error-boundary.tsx:117`, `settings/wizard/review-step.tsx:179`, plus two
segmented toggles using accent as their active state
(`product-pricing-modifier-form-dialog.tsx:264`,
`product-option-form-dialog.tsx:192`) and ~12 admin-only buttons.

Taste call for Jackson: the Books estimate/invoice form modals and
`create-estimate-modal` submit with the **default** (neutral) variant — those
forms have no primary CTA at all.

## 2 · Bug-report drawer — 11px floor and hairline tokens

| Reading | Before | After |
|---|---|---|
| Category / severity / needs-input chips | `text-[10px]`, line-height 15px | `text-micro` (11px, line-height 14.3px) |
| Category chip height | 33px | 32.3px |
| Severity chip height | 41px | 40.3px |
| Elements under 11px inside the panel | 11 (chips, `//` prefix at 10px, keycap hint at 9px) | **0** |
| Panel height | 696.28px | 694.17px (shrank 2px — did not grow) |
| Chip hairline at rest | `rgba(255,255,255,0.08)` literal | `border-line` (0.10) |
| Chip hairline active | `0.18` literal | `border-line-hi` (0.18) |
| Fills | `0.08` / `0.04` / `0.03` literals | `surface-active` / `surface-input` / `surface-hover-subtle` |

Files: `bug-drawer-{before,after}.png` (full deck), `bug-drawer-panel-after@2x.png` (panel crop).
Chips render only for the power-user account; the capture forced that flag
locally and the override was reverted before commit.

The same chip idiom lives on the unmerged `feat/bug-report-element-picker`
branch (drawer constants + the picker's reticle pills). The identical fix is
committed as `59270d9f` on `fix/element-picker-chip-type-floor-20260901`,
stacked on that branch, with the picker's and drawer's single-file suites
green (24/24).

Literals left in the drawer because no exact token exists: borders at
`0.06`, `0.14`, `0.15`, `0.20`, the rose error tint `rgba(220,80,80,…)`, and
fills at `0.02` / `0.05` / `0.06`. The `[ATTACH SCREENSHOT]` toggle label
also paints `text-ops-accent` — accent on a toggle is a separate violation.
