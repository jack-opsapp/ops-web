# Global Audits Discovery — Group F

> **Bugs covered**
> - `7fdf86b1-eff4-468a-8c03-b0ac0b547703` — During /setup, the logo is wrong. Uses vertical stacked logo+text... should be using horizontal. Audit every place a logo is inserted; consider which type (mark, vertical stack, horizontal stack) should be used where (2026-04-19)
> - `0775fc3e-9d88-4f4f-a75d-51d967305007` — Make sure page BG fill is same as site BG fill across all tabs. Pipeline/projects canvas BG should match site BG, inbox bg should match site bg, etc (2026-04-15)

## Why this is a discovery pass, not an implementation plan

Both bugs are **app-wide audits**, not point fixes. We can't write a plan
with copy-paste code until we know the full set of files affected. This
group runs **solo, after Groups B / C / D / E1 / E2 have merged**, so the
audit sees the post-polish state.

## Run order & isolation

**Dispatch F last.** Do not parallelize with any other group — F touches
files every other group may also touch (headers, page shells, auth routes,
onboarding, etc.).

## Phase 1 — Discovery (20 min)

Produce a single artifact:
`OPS-Web/docs/superpowers/specs/2026-04-23-global-audits-findings.md`

### Logo audit procedure

1. **Inventory every `<OpsMark>` and `<OpsLockup>` usage.**
   ```sh
   cd OPS-Web
   grep -rn "<OpsMark" --include="*.tsx" --include="*.ts" src/
   grep -rn "<OpsLockup" --include="*.tsx" --include="*.ts" src/
   ```

2. **For each hit, record:**
   - File + line
   - Route / surface (derive from file path — auth routes, dashboard,
     onboarding, portal, blog, emails)
   - Current orientation (if lockup): `vertical` | `horizontal` | default
   - Current size prop
   - **Contextual verdict**: per `.interface-design/system.md` §Logo & Brand:
     - **Horizontal lockup** — sidebar footer, auth hero, blog header, portal
       watermark, email headers
     - **Vertical lockup** — loading gates, onboarding welcome screens (1:1 square)
     - **Mark only** — small chrome (16–24px glyph in sidebar footers, loading states, email headers)

3. **Output table:**

```markdown
| File:line | Route / surface | Current | Correct per spec | Verdict |
|-----------|-----------------|---------|------------------|---------|
| src/app/(onboarding)/setup/page.tsx:472 | Onboarding loading gate | vertical | vertical | ✓ Keep |
| src/app/(onboarding)/setup/page.tsx:623 | Setup identity header | vertical | **horizontal** (inline hero, not loading/welcome) | ⚠ Change |
| ... | ... | ... | ... | ... |
```

4. **Flag any mark-color violations** — the spec says monochrome only, `currentColor`-driven, never tinted with accent or earth tones. Grep:
   ```sh
   grep -rn "OpsMark\|OpsLockup" src/ | xargs -I{} grep -l "ops-accent\|olive\|tan\|rose\|brick" {}
   ```

### BG fill audit procedure

1. **Inventory every page-level BG class or style.**
   ```sh
   cd OPS-Web
   grep -rn "bg-background\|bg-glass\|bg-black\|bg-\[#" src/app/ --include="*.tsx"
   grep -rn "backgroundColor:" src/app/ --include="*.tsx"
   ```

2. **For each top-level page component:**
   - `src/app/(dashboard)/*/page.tsx`
   - `src/app/(onboarding)/*/page.tsx`
   - `src/app/(portal)/*/page.tsx`
   - `src/app/admin/**/page.tsx`
   - `src/app/*/page.tsx` (auth, blog, etc.)

3. **Record:**
   - File
   - Root wrapper's BG token (class or inline style)
   - Whether page contains an inner canvas with a different BG (pipeline
     spatial canvas, projects canvas, inbox, calendar, admin views, etc.)
   - Mismatch type if any:
     - Page uses something other than the site BG (`#000000` via
       `bg-background` or body-inherited)
     - Inner canvas intentionally differs (e.g., map page bleeds its own
       layer) — flag as intentional
     - Inner canvas differs by accident (e.g., a widget grid in
       `bg-background-dark #090C15` instead of pure `#000`)

4. **Output table:**

```markdown
| Route | Outer BG | Inner canvas BG | Spec BG | Status |
|-------|----------|-----------------|---------|--------|
| /dashboard | bg-background | — | #000 | ✓ |
| /pipeline | bg-background | spatial canvas uses `#0A0A0A` | #000 | ⚠ Change inner to inherit |
| /inbox | ? | ? | #000 | ? |
| ... | ... | ... | ... | ... |
```

5. **Call out the anti-pattern** from `OPS-Web/CLAUDE.md`:
   > *"Canvas: pure `#000000`"*

   Any page rendering on a non-black root canvas is a bug unless it's a
   glass-surface overlay that relies on the black canvas showing through.

## Phase 2 — Plan (after findings land, 30 min)

Using `2026-04-23-global-audits-findings.md` as input, produce:
`OPS-Web/docs/superpowers/plans/2026-04-23-global-audits-fixes.md`

The plan will:
1. List every file to edit (logo orientation, BG class)
2. Provide the exact diff for each
3. Commit-per-file (with a grouped commit for related files if the diff is a single-token swap across >10 files)
4. End with a browser verification matrix — visit every route listed in the
   inventory and confirm the fix landed.

## Acceptance criteria for Phase 1

- [ ] `docs/superpowers/specs/2026-04-23-global-audits-findings.md` exists and covers every hit from the greps
- [ ] Every `<OpsMark>` and `<OpsLockup>` row has a verdict
- [ ] Every top-level page component has a BG entry in the table
- [ ] Intentional BG deviations (map bleed, full-bleed hero, etc.) are flagged as `Keep (intentional)` so they don't get "fixed"
- [ ] No code changes committed in Phase 1 — findings only

## Acceptance criteria for Phase 2

- [ ] Every ⚠ row in the Phase 1 tables has a matching task in the plan
- [ ] Every task has copy-paste-ready code
- [ ] Plan passes the project's planning standard (see `/Users/jacksonsweet/.claude/CLAUDE.md` §Planning Standards)

## Skills to load

- `interface-design` + `.interface-design/system.md`
- `frontend-design`
- `codebase-consultant` (for cross-cutting discovery — pattern recognition across many files)
- `animation-studio:animation-architect` (only if a fix affects loading-gate transitions or hero animation — unlikely in this scope)

## Run notes

- Expected Phase 1 output: ~100–200 lines of markdown tables, no code
- Expected Phase 2 implementation: 15–30 files touched, mostly one-token diffs
- Allow 90 minutes total across both phases
- The user is available for orientation questions per-surface ("should this
  be horizontal or vertical?") — do not over-interpret the spec without
  verifying in the running app
