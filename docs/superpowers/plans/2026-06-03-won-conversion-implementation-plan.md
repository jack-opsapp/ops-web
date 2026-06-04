# Won → Project Conversion: Dedup + Auto Project Naming — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Load `superpowers:subagent-driven-development` if executing in-session.

**Goal:** Replace web's silent, duplicate-prone, badly-named won→project conversion with one shared database brain (dedup preflight + a unified convert RPC) and an auto-naming model where `projects.title` is a self-healing pointer to the site address.

**Architecture:** All conversion logic moves into Postgres — a read-only `get_conversion_preflight` and one superset `convert_opportunity_to_project` RPC that both platforms call (old iOS via a shim, no release needed). `projects.title_is_auto` + a `BEFORE INSERT/UPDATE` trigger keep `title` derived from `address` while auto. Web ships now; iOS adopts next App Store release.

**Tech Stack:** Postgres (Supabase, `supabase/migrations/*.sql`, applied via MCP `apply_migration`), Next.js 14 / TypeScript, TanStack Query, Zod, Vitest (`tests/`), Playwright (`tests/e2e`), Swift/SwiftData (iOS, `ops-ios/OPS`).

**Design System:** `.interface-design/system.md` (OPS visual system). Every UI task references tokens — glass-dense modal (radius 12), accent `#6F94B0` (single primary CTA only), Cake Mono Light uppercase labels, JetBrains Mono tabular numerics, `lucide-react` icons, left-aligned, `EASE_SMOOTH = cubic-bezier(0.22,1,0.36,1)`, honor `prefers-reduced-motion`.

**Source design docs (read first):**
- Spec: `docs/superpowers/specs/2026-06-03-won-conversion-dedup-and-auto-project-naming-design.md`
- UI plan: `docs/superpowers/plans/2026-06-03-won-conversion-ui-changes-plan.md`

**Required Skills (load per task as noted):** `frontend-design`, `ops-design` (design system), `ops-copywriter` (ALL user-facing strings), `audit-design-system` (UI token check), `mobile-ux-design` (iOS), `superpowers:test-driven-development`, `superpowers:verification-before-completion`.

**Global rules:**
- **DRY / YAGNI / TDD / frequent commits.** One logical change per commit; stage by name (never `git add -A`); no AI attribution in messages.
- **iOS sync constraint:** every schema change is additive (nullable column, new function) — never rename/drop/retype a column iOS reads until the next release.
- **ops-web deploy is manual** (auto-deploy OFF) — "deploy" = a deliberate manual step.
- **Prod is low-tenant** (Canpro + Maverick): migrations go to prod directly, but only after read-only recon + a sentinel-rollback test + **explicit user go-ahead** before any live-data/notification write.
- **Permissions:** gate on `pipeline.manage` (already exists in `src/lib/types/permissions.ts`); never filter by role.
- **RPC identity:** never `auth.uid()` (Firebase-bridge JWT) — use `private.get_user_company_id()` / `private.current_user_has_permission(...)` as the existing RPCs do.

**Testing surfaces:** SQL/RPC/trigger behavior → `tests/sql` (pgTAP-style) or integration tests run against the **scratchpad** Supabase project (`lepksnpkrnkokiwxfcsj`) with rollback — **never** prod data. TS units → `tests/unit`. E2E → `tests/e2e`.

---

## PHASE 0 — Recon & safety (no writes)

### Task 0.1: Read-only prod recon + sentinel plan

**Skills:** none. **Files:** none (MCP queries only).

**Step 1:** Via Supabase MCP (`execute_sql`, project `ijeekuhbatykdomumfjx`), capture baselines:
- `select count(*) from projects;` and `count(*) filter (where deleted_at is null)`.
- `select count(*) from projects where title is null;` (expect 0 — `title` is NOT NULL).
- Confirm no column named `title_is_auto` exists yet; confirm only trigger on `projects` is `update_projects_timestamp`.
- Re-confirm both convert RPC bodies are unchanged from the spec (`convert_lead_to_project`, `execute_opportunity_project_conversion_guarded`).

**Step 2:** Write the recon results into a scratch note in the plan PR description. **Do not write anything to prod.**

**Step 3 (CHECKPOINT):** Surface the blast radius to the user and get explicit go-ahead before Phase 1 applies any migration to prod. All Phase-1 SQL is first developed + tested on the **scratchpad** project.

**Commit:** none (recon only).

---

## PHASE 1 — Database brain (additive migration)

> Develop + test every object on the **scratchpad** project first. Assemble into one migration file `supabase/migrations/20260603020000_won_conversion_dedup_naming.sql`. Apply to prod only after Task 0.1 checkpoint.

### Task 1.1: `title_is_auto` column + collision index

**Files:** Create `supabase/migrations/20260603020000_won_conversion_dedup_naming.sql` (append across 1.1–1.8). **Test:** `tests/sql/projects_title_is_auto.test.sql`.

**Step 1 — SQL:**
```sql
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS title_is_auto boolean NOT NULL DEFAULT false;

-- keeps the per-write collision scan O(log n)
CREATE INDEX IF NOT EXISTS projects_company_title_active
  ON public.projects (company_id, title) WHERE deleted_at IS NULL;
```

**Step 2 — verify additive/iOS-safe:** column is nullable-equivalent (`DEFAULT false`), existing rows backfill `false` automatically. No iOS field reads it. Run on scratchpad; confirm existing rows now have `title_is_auto=false` and **no title changed**.

**Step 3 — Commit:** `feat(db): add projects.title_is_auto + collision index`

### Task 1.2: Strengthened SQL normalizers (`private.normalize_address`, `private.normalize_title`)

**Skills:** none. **Files:** migration. **Test:** `tests/sql/normalizers.test.sql` + parity vectors in `tests/unit/duplicate-detection.test.ts`.

**Step 1 — Write failing parity test** (shared vectors): `normalize_address('1240 W 6th Ave') = normalize_address('1240 West 6th Avenue')`; unit/suite stripped; `normalize_title('New project') = ''`.

**Step 2 — SQL** (port + strengthen from `src/lib/utils/name-normalization.ts`):
```sql
CREATE OR REPLACE FUNCTION private.normalize_address(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  WITH base AS (
    SELECT regexp_replace(lower(coalesce(p,'')), '\s+', ' ', 'g') AS s
  ), stripped AS (
    -- strip unit/suite/apt tokens + trailing periods (mirror UNIT_PATTERN)
    SELECT btrim(regexp_replace(s, '\m(unit|suite|ste|apt|#)\M\.?\s*\w+', '', 'g')) AS s FROM base
  ), tokens AS (
    SELECT string_agg(
      CASE w
        WHEN 'w' THEN 'west' WHEN 'e' THEN 'east' WHEN 'n' THEN 'north' WHEN 's' THEN 'south'
        WHEN 'nw' THEN 'northwest' WHEN 'ne' THEN 'northeast' WHEN 'sw' THEN 'southwest' WHEN 'se' THEN 'southeast'
        WHEN 'ave' THEN 'avenue' WHEN 'av' THEN 'avenue' WHEN 'st' THEN 'street' WHEN 'rd' THEN 'road'
        WHEN 'blvd' THEN 'boulevard' WHEN 'dr' THEN 'drive' WHEN 'cres' THEN 'crescent'
        WHEN 'hwy' THEN 'highway' WHEN 'pl' THEN 'place' WHEN 'ct' THEN 'court' WHEN 'ln' THEN 'lane'
        ELSE w END, ' ' ORDER BY ord)
    FROM stripped, regexp_split_to_table(replace(s, '.', ''), '\s+') WITH ORDINALITY AS t(w, ord)
  )
  SELECT btrim(coalesce((SELECT string_agg FROM tokens), '')) ;
$$;

CREATE OR REPLACE FUNCTION private.normalize_title(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN btrim(coalesce(p,'')) = '' THEN ''
    -- placeholders are matching-invisible (both langs handled by the trailing words)
    WHEN p ~* '^(new project|proyecto nuevo)$' THEN ''
    WHEN p ~* '(''s project|de [a-z].* )$' THEN ''   -- "{Client}'s Project" / es form
    ELSE regexp_replace(lower(p), '\s+', ' ', 'g')
  END;
$$;
```
> Exact street-type/directional list + the placeholder regex are finalized against the shared test vectors; keep the TS `normalizeAddress`/`normalizeTitle` in lockstep (Task 4.2).

**Step 3 — Run:** scratchpad `select private.normalize_address('1240 W 6th Ave')` → `1240 west 6th avenue`. Vectors pass.

**Step 4 — Commit:** `feat(db): strengthened SQL address/title normalizers`

### Task 1.3: `private.derive_project_name()`

**Files:** migration. **Test:** `tests/sql/derive_project_name.test.sql`.

**Step 1 — failing tests:** address → street line; no address + client → `{Client}'s Project`; neither → `New project`; comma-less address → whole string.

**Step 2 — SQL:** (from spec §4.5)
```sql
CREATE OR REPLACE FUNCTION private.derive_project_name(p_address text, p_client_name text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN NULLIF(btrim(p_address), '') IS NOT NULL
      THEN COALESCE(NULLIF(btrim(split_part(p_address, ',', 1)), ''), btrim(p_address))
    WHEN NULLIF(btrim(p_client_name), '') IS NOT NULL
      THEN btrim(p_client_name) || '''s Project'      -- copy via ops-copywriter (Task 3.5)
    ELSE 'New project'
  END;
$$;
```

**Step 3 — Run / Step 4 — Commit:** `feat(db): derive_project_name()`

### Task 1.4: Enforce-always naming trigger `projects_autoname_biud`

**Files:** migration. **Test:** `tests/sql/projects_autoname_trigger.test.sql`.

**Step 1 — failing tests (the behavior contract, spec §4.6):**
- insert `{address:'1240 W 6th Ave, Vancouver', title_is_auto:true}` → `title='1240 W 6th Ave'`.
- update address → title self-heals; second project same address → `#2`; edit a typo on the `#2` → stays `#2` (idempotent/stable).
- stray `update projects set title='x'` on an auto project → title reverts to derived (enforce-always).
- set `title_is_auto=false` + `title='Custom'` in one update → `'Custom'` sticks; later address change does NOT rename.
- trigger writes NO `project_notes` row (silence).

**Step 2 — SQL:**
```sql
CREATE OR REPLACE FUNCTION private.projects_autoname()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_client_name text; v_base text; v_name text; n int := 2;
BEGIN
  IF NEW.title_is_auto IS NOT TRUE THEN
    RETURN NEW;                           -- hand-set names are sacred
  END IF;
  IF NEW.client_id IS NOT NULL THEN
    SELECT name INTO v_client_name FROM public.clients WHERE id = NEW.client_id;
  END IF;
  v_base := private.derive_project_name(NEW.address, v_client_name);
  v_name := v_base;
  WHILE EXISTS (
    SELECT 1 FROM public.projects
     WHERE company_id = NEW.company_id AND deleted_at IS NULL
       AND id <> NEW.id AND title = v_name
  ) LOOP
    v_name := v_base || ' #' || n; n := n + 1;
  END LOOP;
  NEW.title := v_name;
  RETURN NEW;
END;
$$;

CREATE TRIGGER projects_autoname_biud           -- sorts before update_projects_timestamp
  BEFORE INSERT OR UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION private.projects_autoname();
```

**Step 3 — Run on scratchpad; Step 4 — Commit:** `feat(db): enforce-always project auto-naming trigger`

### Task 1.5: `get_conversion_preflight()` RPC

**Files:** migration. **Test:** `tests/sql/get_conversion_preflight.test.sql`.

**Step 1 — failing tests (spec §5):** existing_linked when `project_ref` set; high candidate (same client+address); medium (same address, diff client); other_client_projects list; suggested_name preview; empty when nothing matches; auth: cross-company rejected, missing `pipeline.manage` rejected.

**Step 2 — SQL:** `SECURITY DEFINER`, returns `jsonb`. Auth pattern mirrors the existing guarded RPC (service_role OR `private.get_user_company_id()` match + `private.current_user_has_permission('pipeline.manage','all')`). Build the four arrays via `normalize_address` joins; `derive_project_name(opp.address, client.name)` for suggested_name. `GRANT EXECUTE ... TO authenticated, service_role;`.

**Step 3 — Run / Step 4 — Commit:** `feat(db): get_conversion_preflight read-only RPC`

### Task 1.6: Unified `convert_opportunity_to_project()` RPC

**Files:** migration. **Test:** `tests/sql/convert_opportunity_to_project.test.sql`.

**Step 1 — failing tests (spec §6, every branch):**
- create branch: project inserted (status by source/win), `title_is_auto=true` when no override (trigger names it), four-column link contract, estimates relinked (both `project_ref` + text `project_id`), LABOR→tasks deduped by `source_line_item_id`, site-visit photos deduped, disposition row, **lat/long carried**, stage→won + ONE stage_transition.
- `p_win_opportunity=false` (approval_queue): status `rfq`, stage UNTOUCHED, no stage_transition.
- already-won opp: convert links + materializes but writes NO second stage_transition (step-12 idempotent).
- link-existing (`p_link_to_project_id`): no new project, target status/title untouched, estimates/tasks/photos deduped, disposition written.
- idempotency: `project_ref` set → `already_converted`; concurrent guard `WHERE project_ref IS NULL`.
- snapshot mismatch → `snapshot_mismatch`.
- auth: cross-company + missing permission rejected; `created_by` null accepted.

**Step 2 — SQL:** Synthesize from the two verified bodies per spec §6 steps 1–14. Reuse `convert_lead_to_project`'s task/photo blocks (add the `NOT EXISTS` dedup), and `execute_..._guarded`'s link-contract + estimate-mirror + disposition blocks. `SECURITY DEFINER`; `GRANT EXECUTE ... TO authenticated, service_role;`.

**Step 3 — Run all branch tests on scratchpad. Step 4 — Commit:** `feat(db): unified convert_opportunity_to_project RPC`

### Task 1.7: Shim-rewrite `convert_lead_to_project` → unified RPC

**Files:** migration. **Test:** `tests/sql/convert_lead_to_project_shim.test.sql`.

**Step 1 — failing test:** calling the shim with `(p_opportunity_id, p_actual_value, p_title, p_address, p_user_id)` returns the project uuid, the opp is won + linked, disposition written, operator title preserved (`title_is_auto=false`).

**Step 2 — SQL:** replace the body with a call to `convert_opportunity_to_project(p_company_id := <opp.company_id>, p_opportunity_id := p_opportunity_id, p_actual_value := p_actual_value, p_title_override := p_title, p_decided_by := p_user_id, p_source_path := 'ios', p_win_opportunity := true)`; preserve the original return type (uuid) by extracting `(result->>'project_id')::uuid`. Keep the original `opportunity_not_found` / `access_denied` error codes.

**Step 3 — Run / Step 4 — Commit:** `feat(db): route legacy convert_lead_to_project through the unified RPC`

### Task 1.8: Grants, RLS review, permission-catalog check

**Step 1:** Confirm both RPCs are `SECURITY DEFINER` and granted to `authenticated` + `service_role`; preflight is read-only. No new permission **bit** is introduced (reuse `pipeline.manage`), so `src/lib/types/permissions.ts` needs **no** change — verify this explicitly (memory: DB grants must be registered in the client catalog; here we add none).

**Step 2 — Commit:** `chore(db): grants + permission-catalog verification note`

### Task 1.9: Apply migration to prod + regenerate types

**Step 1 (CHECKPOINT):** Present the assembled migration + scratchpad test results to the user. **Wait for explicit go-ahead** (memory: prod writes need confirmation).

**Step 2:** Apply via MCP `apply_migration` (project `ijeekuhbatykdomumfjx`, name `won_conversion_dedup_naming`). Run a sentinel: insert a throwaway auto-named project in a rolled-back transaction to confirm the trigger fires on prod; verify no existing project title changed (`title_is_auto=false` everywhere).

**Step 3:** Regenerate types: MCP `generate_typescript_types` → write to `src/lib/types/database.types.ts` (or `supabase gen types`). 

**Step 4 — Commit:** `feat(db): apply won-conversion migration + regen types`

---

## PHASE 2 — Web service layer

### Task 2.1: `ProjectConversionService` → unified RPC + preflight + linkExisting

**Files:** Modify `src/lib/api/services/project-conversion-service.ts`. **Test:** `tests/unit/services/project-conversion-service.test.ts` (exists — extend).

**Step 1 — failing tests:** `convertOpportunityToProject` calls `convert_opportunity_to_project` (not the guarded RPC), no bare-project pre-create; `getConversionPreflight(opportunityId)` returns typed preflight; `linkOpportunityToExistingProject(opportunityId, projectId)` calls convert with `p_link_to_project_id`.

**Step 2 — implement:** swap `CONVERSION_RPC` to `convert_opportunity_to_project`; delete the pre-create + orphan-cleanup dance (RPC is atomic); map new params (`p_source_path`, `p_win_opportunity`, `p_project_status`, `p_title_override`, `p_link_to_project_id`). Add `getConversionPreflight` + `linkOpportunityToExistingProject`. Keep the rail notification on create.

**Step 3 — Run `npx vitest run tests/unit/services/project-conversion-service.test.ts` → PASS. Step 4 — Commit:** `refactor(conversion): web service calls unified RPC + preflight`

### Task 2.2: Approval-queue switch (no force-win)

**Files:** Modify `src/lib/api/services/approval-queue-service.ts` (`executeCreateProject`). **Test:** `tests/unit/...approval-queue...`.

**Step 1 — failing test:** approval-queue create passes `sourcePath:'approval_queue'` ⇒ project `rfq`, opportunity stage **unchanged**, no stage_transition.

**Step 2 — implement:** ensure the call sets win=false/status=rfq (service derives from `sourcePath`). **Step 3 — Run. Step 4 — Commit:** `fix(approval-queue): converting a proposal no longer force-wins the opportunity`

### Task 2.3: Hooks — preflight query + convert/linkExisting mutations

**Files:** Modify `src/lib/hooks/use-opportunities.ts` (+ `query-client.ts` keys). **Test:** `tests/unit/hooks/...`.

**Step 1 — failing tests:** `useConversionPreflight(id)` query; `useConvertOpportunityToProject` posts to the route (single call); `useLinkOpportunityToExistingProject`. **Step 2 — implement.** **Step 3 — Run. Step 4 — Commit:** `feat(hooks): conversion preflight + link-existing`

### Task 2.4: `title_is_auto` plumbing + Zod (blank name allowed)

**Files:** Modify `src/lib/api/services/project-service.ts` (`mapToDb`, `createProject`/`updateProject` input types), `src/lib/schemas/index.ts` (project create schema `title` → `.max(200).optional()`, drop `.min(1)`). **Test:** `tests/unit/...project-service...`, schema tests.

**Step 1 — failing tests:** `mapToDb({titleIsAuto:true})` → `title_is_auto:true`; create schema accepts blank/absent title; update schema unchanged. **Step 2 — implement** (`Project` type gains `titleIsAuto?: boolean`). **Step 3 — Run. Step 4 — Commit:** `feat(projects): title_is_auto plumbing + optional create title`

---

## PHASE 3 — Web UI

> **Skills (every Task in Phase 3):** `frontend-design` + `ops-design` (tokens from `.interface-design/system.md`) + `ops-copywriter` (all strings) + `audit-design-system` before commit.

### Task 3.1: Enriched Won dialog (`WonContent`)

**Files:** Modify `src/app/(dashboard)/pipeline/_components/stage-transition-dialog.tsx`. **Test:** `tests/unit/components/stage-transition-dialog.test.tsx`.

**Design tokens:** `.glass-dense` modal radius 12; primary CTA `text-ops-accent border-ops-accent` → fills `bg-ops-accent text-black` on hover (single CTA); value input mono `tnum`/`zero`; labels Cake Mono Light uppercase; `lucide-react`; left-aligned; `EASE_SMOOTH`; reduced-motion fallback.

**Step 1 — failing tests (states from UI plan §B):** clean → value + `// NAME · {street}` + editable address; `existing_linked` → "already has a project" + `OPEN PROJECT →`; `duplicate_candidates` → list with per-row Link + `CREATE NEW →`; `other_client_projects` → collapsed list; editing address updates the name preview live; `rename` reveals input.

**Step 2 — implement** the preflight-driven `WonContent` (props gain `preflight`). Copy keys via `ops-copywriter` (Task 3.5). **Step 3 — Run + `audit-design-system`. Step 4 — Commit:** `feat(pipeline): enriched Won dialog with dedup + auto-name`

### Task 3.2: Rewire `use-stage-transition.ts` — single atomic win+convert

**Files:** Modify `src/app/(dashboard)/pipeline/_components/use-stage-transition.ts`. **Test:** `tests/unit/...use-stage-transition...`.

**Step 1 — failing tests:** on `won` confirm, calls `convert` **once** (no separate `moveStage(won)` for the converting path); optimistic local stage flip retained; undo entry retained; selecting a candidate calls `linkExisting`; `existing_linked` "open" deep-links `/dashboard?openProject={id}&mode=view`. Preflight fetched on `requestStageChange(id,'won')`.

**Step 2 — implement.** Keep Lost path untouched. **Step 3 — Run. Step 4 — Commit:** `refactor(pipeline): win+convert is one atomic action`

### Task 3.3: Convert-an-already-won affordance

**Files:** Modify `src/app/(dashboard)/pipeline/_components/pipeline-card-actions.tsx`, `pipeline-terminal-stack.tsx`, and the table stage-cell (`table/cells/...`). **Test:** component tests.

**Step 1 — failing test:** a won + unconverted opp (no `project_ref`) shows `// CONVERT`; clicking opens the Won dialog; converting writes no second stage_transition (covered by RPC test, asserted at hook level here).

**Step 2 — implement** a single shared action (reuse `requestStageChange`-style entry that opens the dialog directly for already-won). **Step 3 — Run. Step 4 — Commit:** `feat(pipeline): convert already-won deals`

### Task 3.4: Remove the create-form name field

**Files:** Modify `src/components/ops/projects/workspace/edit-create/project-edit-create-body.tsx`. **Test:** `tests/unit/components/...project-edit-create...` + E2E (Task 7).

**Design tokens:** same as 3.1; `// NAME · auto` line in JetBrains Mono micro/`[brackets]` metadata style; address field is the primary input.

**Step 1 — failing tests:** creating mode renders **no** name input by default; shows `// NAME · {derived}` preview that updates as address changes; submitting with no name + an address → create payload `{title omitted, titleIsAuto:true, address}`; `rename` disclosure reveals input and submits `titleIsAuto:false`; editing mode with `title_is_auto=false` shows the name + `use address` revert; hand-set duplicate shows `DUPLICATE NAME` warning (non-blocking).

**Step 2 — implement:** remove the default title field; add the preview + collapsed `rename`; local Zod `title` optional; wire `titleIsAuto`. **Step 3 — Run + `audit-design-system`. Step 4 — Commit:** `feat(projects): auto-named projects — remove create-form name field`

### Task 3.5: i18n (en + es)

**Files:** Modify `src/i18n/dictionaries/{en,es}/pipeline.json`, `.../project-workspace.json`. **Skills:** `ops-copywriter`.

**Step 1:** Add keys from UI plan §D (Won-dialog + edit-create), retire `editCreate.errors.titleRequired` from the create path. **Step 2:** `ops-copywriter` finalizes EN (terse, tactical, sentence-case content / UPPERCASE authority, no emoji); translate ES. Confirm `{Client}'s Project` + `New project` placeholders. **Step 3 — Commit:** `feat(i18n): won-conversion + auto-naming strings (en/es)`

---

## PHASE 4 — Web cleanup

### Task 4.1: Drop the legacy guarded RPC + regen types

**Step 1 (after web verified in Task 7):** confirm zero callers of `execute_opportunity_project_conversion_guarded` remain in `src`. **Step 2:** migration `2026...drop_guarded_conversion_rpc.sql` → `DROP FUNCTION ...`; apply (0 dependents, verified). Regen types. **Step 3 — Commit:** `chore(db): drop superseded guarded conversion RPC`

### Task 4.2: Converge daily duplicate-scan normalization

**Files:** Modify `src/lib/utils/name-normalization.ts` + `src/lib/api/services/duplicate-detection-service.ts`. **Test:** `tests/unit/duplicate-detection.test.ts`.

**Step 1 — failing tests:** TS `normalizeAddress` now canonicalizes directionals/street-types matching the SQL vectors (shared fixture). **Step 2 — implement** in lockstep with Task 1.2 (or have the scan call the SQL normalizer via RPC). **Step 3 — Run. Step 4 — Commit:** `fix(dedup): align TS + SQL address normalization`

---

## PHASE 5 — iOS (next App Store release; additive, non-blocking)

> **Skills:** `mobile-ux-design`, `ops-copywriter`. Build via `xcodebuild -scheme OPS -destination 'generic/platform=iOS'`; tests on simulator. Copy `Secrets.xcconfig` into the worktree if building there.

### Task 5.1: `LeadConversionService` → preflight + unified RPC
**Files:** `ops-ios/OPS/Services/LeadConversionService.swift`. Replace local `existingProject`/`clientProjectsSummary` with a `get_conversion_preflight` call; call `convert_opportunity_to_project` directly; set `title_is_auto`. Keep `markWonNoProject` / `markWonWithExistingProject`. **Commit:** `feat(ios): adopt server preflight + unified convert RPC`

### Task 5.2: `ConvertToProjectSheet` server-driven states
**Files:** `ops-ios/OPS/Views/Leads/Sheets/ConvertToProjectSheet.swift`. DUPLICATE-EXISTS / CLIENT-HAS-OTHERS from the server preflight; name field shows auto name with rename → `title_is_auto=false`. **Commit:** `feat(ios): preflight-driven convert sheet`

### Task 5.3: `ProjectFormSheet` optional name + auto preview
**Files:** `ops-ios/OPS/Views/JobBoard/ProjectFormSheet.swift`. Optional name with auto-name preview + `use address` revert; wire `title_is_auto`; existing `DUPLICATE NAME` alert retained. **Commit:** `feat(ios): auto-named projects in the project form`

> After iOS ships and old-RPC traffic hits zero, a later migration may collapse the `convert_lead_to_project` shim (out of scope here).

---

## PHASE 6 — Bible

### Task 6.1: Update the bible (same initiative)
**Files:** `ops-software-bible/09_FINANCIAL_SYSTEM.md` (replace the stale "web has no LeadConversionService equivalent" note; document the unified RPC + preflight + shim), `10_JOB_LIFECYCLE_AND_DATA_RELATIONSHIPS.md` § won (auto-naming pointer + dedup-at-convert), `03_DATA_ARCHITECTURE.md` (`projects.title_is_auto` + trigger invariant). **Commit:** `docs(bible): won-conversion unification + auto-naming`

---

## PHASE 7 — E2E + final verification

### Task 7.1: E2E (web)
**Files:** `tests/e2e/won-conversion.spec.ts` (new). Cover spec §9: clean create (auto-name from address, single convert), no-address create → `New project` → add address self-heals, duplicate-exists → open, candidate → link & win, client-has-others → create new, hand-set duplicate warning, convert-an-already-won. **Run:** `npx playwright test tests/e2e/won-conversion.spec.ts`. **Commit:** `test(e2e): won-conversion + auto-naming flows`

### Task 7.2: Verification-before-completion
**Skills:** `superpowers:verification-before-completion`. Run `npx vitest run`, `npx playwright test`, `npx tsc --noEmit`, `next lint` (note: lint may be pre-red on main — verify our files are clean). Manually drive the Won dialog + create form against the scratchpad/staged build. Confirm: no duplicate projects on repeat-client win; auto-name self-heals; no second stage_transition on already-won; iOS untouched (old shim path green). **Then** present manual-deploy readiness to the user. **Commit:** none (verification) — then a final `chore: won-conversion ready for manual deploy` if any cleanup.

---

## Sequencing & dependencies

- **1 → 2 → 3 → 7** is the critical path for the web ship. **4.1** waits on **7** (verified). **4.2** pairs with **1.2**. **5** is parallelizable after **1** (its own iOS release). **6** after **3**.
- **Hard checkpoints (stop for user):** Task 0.1 (recon), Task 1.9 (apply to prod), Task 7.2 (manual deploy).
- **iOS App Store** is the only thing gating full cross-platform parity; web is fully functional before iOS ships (shim covers old clients).
