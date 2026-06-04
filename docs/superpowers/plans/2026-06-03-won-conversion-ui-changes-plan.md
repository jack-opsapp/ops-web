# Won Conversion + Auto-Naming — UI Changes Plan

**Date:** 2026-06-03
**Companion to:** `docs/superpowers/specs/2026-06-03-won-conversion-dedup-and-auto-project-naming-design.md`
**Scope:** the user-facing surface changes the spec implies. Web ships now; iOS parity ships next App Store release.

> **Implementation gate:** every section here must be built through `frontend-design` + the `ops-design` design system + `ops-copywriter` (no hardcoded strings, colors, spacing — trace every value to a token; all copy in the OPS voice). This plan defines *what* changes and *where*; those skills define *how it looks/reads*.

---

## A. Manual project create — remove the name field (the headline change)

**File:** `src/components/ops/projects/workspace/edit-create/project-edit-create-body.tsx`
**Today:** a required **PROJECT NAME** text input (`form.register("title")`, `data-testid="project-edit-create-body-test-title"`) with `title: z.string().min(1, titleRequired).max(200)`; **SITE ADDRESS** is a secondary nullable field.

**Target (creating mode):** the operator never types a name.
- **Remove the name field from the default layout.** Promote **SITE ADDRESS** (Mapbox autocomplete) to the primary input.
- Under the address, show a read-only **`// NAME · auto`** line that previews the derived name live as the address is typed (`1240 W 6th Ave`; before an address → `{Client}'s Project` or `New project`). This is display-only — it mirrors what the DB trigger will store. No setup, invisible help.
- A small **`rename`** disclosure (collapsed by default). Opening it reveals the name input and sets `title_is_auto=false` on submit; what they type is kept verbatim (frozen). Leaving it untouched ⇒ `title_is_auto=true`.
- **Validation:** local Zod + the create schema (`src/lib/schemas/index.ts`) drop `.min(1)` on `title` (keep `.max(200)`); `title` becomes optional on the create input. `editCreate.errors.titleRequired` is retired from the create path.
- **Hand-set duplicate warning:** if the operator uses `rename` and types a name already used in the company, show a non-blocking `DUPLICATE NAME` warning (iOS `ProjectFormSheet` parity). They can proceed.

**Target (editing mode):** preserve the current name but make auto/custom legible.
- If `title_is_auto=true`: show the auto name with the same `// NAME · auto` treatment + `rename`.
- If `title_is_auto=false`: show the current custom name in an editable field + a **`use address`** affordance that reverts to auto (`title_is_auto=true`; the trigger refills from the address).
- Clearing the name field in editing mode ⇒ revert to auto.

**Service plumbing (supports this surface):**
- `ProjectService.createProject` / `updateProject` + `mapToDb` carry `title_is_auto`. `title` optional on the create input (DB column stays NOT NULL — the BEFORE-INSERT trigger fills it before the constraint is checked).
- FAB → "Add Project" opens this same form (`fab-actions.ts`, `handler: "window"`), so the change is inherited everywhere; no separate FAB work.

---

## B. Enriched Won dialog — dedup + naming

**File:** `src/app/(dashboard)/pipeline/_components/stage-transition-dialog.tsx` (`WonContent`)
**Today:** collects only **FINAL VALUE** + an "auto-convert" note, then confirms.

**Target — driven by `get_conversion_preflight` (fetched before the dialog opens, §C):**

1. **FINAL VALUE** — unchanged (mono numeric input, `$` prefix).
2. **NAME (auto)** — read-only `// NAME · 1240 W 6th Ave` with a quiet `rename` escape hatch (sets `title_is_auto=false`). Operator does not type a name in the common path.
3. **SITE ADDRESS** — prefilled from the opportunity, **editable** (shared Mapbox autocomplete, biased by the opp's coordinates). Editing it updates the NAME preview live.
4. **Conditional dedup block** (only when preflight returns hits):
   - **DUPLICATE-EXISTS** (`existing_linked_project`): "This deal already has a project." → primary **Open project**, no new project.
   - **DUPLICATE CANDIDATES** (high/medium, same client + address): a compact list, each row `title · address · [signals]` with a **Link** action; plus **Create new** to proceed.
   - **CLIENT-HAS-OTHERS** (`other_client_projects`): collapsed "[client] has N other projects" list; informational, default action stays **Create new**.
5. **Footer:** `CANCEL` + primary CTA (`MARK WON →` when creating; `LINK & WIN →` when a row is selected).

**States matrix:**

| Preflight result | Dialog body | Primary CTA |
|---|---|---|
| clean (no hits) | value + auto-name + address | `MARK WON →` (create) |
| existing_linked | "already has a project" card | `OPEN PROJECT →` |
| duplicate_candidates | candidates list (Link per row) + create | `LINK & WIN →` / `CREATE NEW →` |
| other_client_projects | value + auto-name + address + collapsed others | `MARK WON →` (create) |

**Design-system:** `glass-dense` modal (radius 12), accent `#6F94B0` on the single primary CTA only, mono tabular numerics for value, Cake Mono Light uppercase for labels/CTAs, `lucide-react` icons, left-aligned, `EASE_SMOOTH` transitions, `prefers-reduced-motion` honored. (Lost dialog untouched.)

---

## C. Shared win-flow wiring + "convert an already-won deal"

**File:** `src/app/(dashboard)/pipeline/_components/use-stage-transition.ts` (consumed by **both** `pipeline/page.tsx` and `table/pipeline-table-shell.tsx` — one path, no drift).

- **Preflight on open:** when `requestStageChange(id, 'won')` fires, fetch `get_conversion_preflight` and pass `existing_linked / duplicate_candidates / other_client_projects / suggested_name` into the dialog.
- **Single atomic win+convert:** on confirm, call **only** `convert` (the unified RPC wins + converts in one transaction). Remove the separate `moveStage(won)` for the converting path — keep optimistic local stage flip + the undo entry. This removes the double-`stage_transitions` risk by construction (spec edge #17).
- **Link branch:** when the operator picks a candidate, call `linkExisting` (convert with `p_link_to_project_id`); on `existing_linked`, "Open project" → mark won with the existing link + deep-link to it (`/dashboard?openProject={id}&mode=view`).
- **Convert-an-already-won affordance:** estimate-approval (`advanceToWon`) wins without converting, so won/unconverted opps exist. Add a `// CONVERT` action that opens this same dialog for them. Insertion points:
  - board: `pipeline-card-actions.tsx` (won/terminal cards) + `pipeline-terminal-stack.tsx` (won column);
  - table: a stage-cell/row action in `table/` (the obsolete `convert-row-action.tsx` from the table-view branch is **not** reused — see memory `project_pipeline_convert_autoconvert`).
  - The RPC's idempotent step-12 guard means converting an already-won opp writes no second transition.

---

## D. i18n strings (en + es)

- **`pipeline` namespace** (`src/i18n/dictionaries/{en,es}/pipeline.json`): Won-dialog additions — `nameAuto`, `rename`, `siteAddress`, `duplicateExistsTitle/Body`, `candidatesTitle`, `linkAction`, `createNewAction`, `clientHasOthers`, `openProject`, `linkAndWin`. Keep/adjust `transition.autoConvertNote`.
- **`project-workspace` namespace** (`…/project-workspace.json`): `editCreate` additions — `nameAutoPreview`, `rename`, `useAddress`, `duplicateNameWarning`; retire `editCreate.errors.titleRequired` from the create path (keep `titleTooLong`).
- All English copy is **draft-only** until `ops-copywriter` finalizes (terse, tactical, sentence-case content / UPPERCASE authority, no emoji/exclamations). Spanish follows.

---

## E. iOS UI parity (next App Store release — not blocking web)

- **`ConvertToProjectSheet.swift`:** drive DUPLICATE-EXISTS / CLIENT-HAS-OTHERS from `get_conversion_preflight` (replace the local SwiftData `existingProject`/`clientProjectsSummary`); name field shows the auto name with rename → `title_is_auto=false`. Keep `markWonNoProject` / `markWonWithExistingProject`.
- **`ProjectFormSheet.swift`:** name field optional with the same auto-name preview; it already has `DUPLICATE NAME` — wire `title_is_auto` on create/edit and a `use address` revert.
- Styling via `OPSStyle` tokens; haptics on commit (medium) per iOS standards.

---

## F. Testing (UI / E2E)

- **Manual create (web):** submit with the name field hidden/blank → project auto-named from address; blank + no address → `New project`; add address later → name self-heals; `rename` → custom name frozen; editing-mode `use address` → reverts to auto; hand-set duplicate → warning, still submits.
- **Won dialog (web):** clean create (auto-name from address, single convert call); duplicate-exists → open project; candidate → link & win (no new project); client-has-others → create new; address edit updates name preview live.
- **Already-won convert:** estimate-approval-won opp → `// CONVERT` opens dialog → converts with no second `stage_transitions` row.
- **Shared-path parity:** board and table produce identical results through `use-stage-transition`.

---

## G. Resolved decisions (2026-06-03)

1. **Name field on create — REMOVED by default.** No name field in the create layout; address is primary, `// NAME · auto` preview, collapsed `rename` for the rare custom name (§A). Not just optional-but-visible — gone by default.
2. **Win-without-project — NOT added.** Convert is mandatory on win; **Link existing** covers the no-new-project case. No `markWonNoProject` parity on web (spec §8.3).
3. **Auto-name preview — minimal.** A quiet `// NAME · …` line (invisible-help), not a prominent "Project name" row.
