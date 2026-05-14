# Projects Table V2 Phase 5 Saved Views + Density Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Projects Table V2 saved-view management, URL/deep-link resolution, and per-view density/zoom persistence without weakening `project_views` RLS or touching Phase 4 team/photo/bulk behavior.

**Architecture:** Phase 5 is a client/service layer over the existing `public.project_views` table. The implementation adds safe mutation methods to `ProjectViewsService`, mutation hooks around TanStack Query, focused table-v2 UI for view settings and density controls, URL-backed active-view state, and tests that prove personal/company ownership, duplicate-name handling, default reset, permission gates, and density persistence.

**Tech Stack:** Next.js 15, React 19, TypeScript, Supabase Postgres/RLS, TanStack Query, TanStack Table/Virtual, Zustand auth/permission stores, Radix Dialog/Dropdown/Popover, Lucide React, OPS design system v2, Vitest, React Testing Library, Playwright/browser verification.

---

## PM Check-In Protocol

Execution agents work one milestone at a time. At the end of each milestone, stop and report exactly:

- Plan file written or milestone completed.
- Source files read.
- Key assumptions / schema findings.
- Proposed milestone breakdown or implemented milestone summary.
- Verification performed.
- Blockers or open questions.
- Confirmation no implementation outside the approved milestone was started.

Do not start the next milestone until the PM approves the check-in.

## Source Documents Read For This Plan

- `/Users/jacksonsweet/Projects/OPS/CLAUDE.md`
- `/Users/jacksonsweet/Projects/OPS/OPS-Web/CLAUDE.md`
- `/Users/jacksonsweet/Projects/OPS/OPS-Web/docs/superpowers/specs/2026-05-12-projects-table-redesign-design.md`
- `/Users/jacksonsweet/Projects/OPS/OPS-Web/docs/superpowers/plans/2026-05-13-projects-table-redesign-phase-4-complex-cells-bulk.md`
- `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/types/database.types.ts`
- `/Users/jacksonsweet/Projects/OPS/ops-software-bible/10_JOB_LIFECYCLE_AND_DATA_RELATIONSHIPS.md`
- `/Users/jacksonsweet/Projects/OPS/ops-design-system/project/SKILL.md`
- `/Users/jacksonsweet/Projects/OPS/ops-design-system/project/uploads/system.md`

## Live State Findings

- OPS-Web Phase 4 is expected complete at commit `35011e07` and Bible Phase 4 at `4c48c3a`.
- `projects_table_v2` is globally enabled.
- Live `project_views` already includes `columns`, `filters`, `sort`, `density`, `zoom_level`, `is_default`, `is_archived`, `permission_key`, `owner_type`, `owner_id`, and `sort_position`.
- Live `project_views_unique_lower_name` is a partial functional index on `(company_id, owner_type, owner_id, lower(name)) where is_archived = false`, so archived-name reuse is supported.
- Live `project_views` RLS has:
  - public read policy for company/default or own user views, with `permission_key` filtering.
  - authenticated own-view manage policy with `WITH CHECK` forbidding non-managers from setting `permission_key`.
  - authenticated company-view manage policy gated by `projects.manage_views`.
- Live grants currently expose `anon` `SELECT` only and authenticated mutation privileges on `project_views`. That is sufficient for reads only. OPS-Web browser sessions use the Firebase/Supabase bridge and prior phases required `anon` grants/RPC exposure for browser write paths, so Phase 5 must not assume direct PostgREST `project_views` DML will work from the table UI.
- Phase 5 therefore needs an explicit browser-safe saved-view write path unless implementation preflight proves current browser sessions reach PostgREST as `authenticated` for table DML. Preferred path: purpose-specific SECURITY DEFINER RPCs that validate payloads, call `private.get_current_user_id()`, enforce company ownership / `projects.manage_views`, and never accept arbitrary `permission_key`. Do not solve this by broadly weakening `project_views` RLS.

## Supabase Preflight Required Before Implementation

Run read-only MCP checks before Task 1 implementation. Do not apply DDL, do not run local Docker/reset, and do not weaken RLS.

```sql
select c.column_name, c.data_type, c.udt_name, c.is_nullable, c.column_default
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name = 'project_views'
order by c.ordinal_position;

select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'project_views'
order by indexname;

select p.polname, p.polcmd, p.polpermissive,
       pg_get_expr(p.polqual, p.polrelid) as using_expr,
       pg_get_expr(p.polwithcheck, p.polrelid) as check_expr,
       array(select rolname from pg_roles where oid = any(p.polroles)) as roles
from pg_policy p
join pg_class c on c.oid = p.polrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'project_views'
order by p.polname;

select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'project_views'
  and grantee in ('anon', 'authenticated')
order by grantee, privilege_type;
```

Expected:

- `density` accepts `compact`, `comfortable`, `spacious`; `zoom_level` clamps `0.75` through `1.50`.
- `permission_key` is nullable and still constrained to the allowed project permission keys.
- The personal-view `WITH CHECK` still blocks non-admin `permission_key` escalation.
- Company-view mutation remains gated by `projects.manage_views`.
- `anon` has `SELECT` only on `project_views`; authenticated has mutation privileges filtered by RLS.
- Existing direct table DML is not enough for browser UI writes unless preflight/browser proof shows Firebase requests execute as `authenticated`.

Stop conditions:

- Stop if the live `project_views` table lacks `density`, `zoom_level`, `columns`, `filters`, or `sort`.
- Stop if RLS is disabled.
- Stop if a non-admin can set `permission_key` on a personal view.
- Stop if implementing company/share controls would require weakening RLS.
- Stop if the selected write path would require granting broad anon DML on `project_views` without equivalent RLS/payload hardening.
- Stop if MCP auth is unavailable; do not substitute local schema assumptions.

## Scope

In scope:

- Personal view creation from current/default view and from a blank/default definition.
- Duplicate current/default view.
- Rename view.
- Safe archive/delete behavior through `is_archived = true`, never hard delete from UI.
- Reset seeded/default views to the seeded definition.
- Share/company controls only when current user has `projects.manage_views` and live RLS supports it.
- Persist `columns`, `filters`, `sort`, `density`, and `zoom_level` through safe `project_views` updates.
- URL active-view deep links via `?view=<id>`, including inaccessible-view fallback.
- Comfortable/compact/spacious preset controls.
- Pinch/ctrl-wheel/keyboard density adjustment if still enabled by spec; no CSS transform scaling.
- Loading/error/empty states for view management.
- Duplicate-name and permission-denied states.
- Personal vs company visibility cues.
- Financial Overview permission gating stays server/RLS-backed.
- Browser gate for create, rename, duplicate, archive, reset, deep-link, and density persistence.

Out of scope:

- Any Phase 4 team/photo/bulk rewrite.
- `ProjectService.update()`.
- Direct writes to `projects.team_member_ids`.
- Weakening `project_views`, `project_table_rows`, or `projects` RLS.
- Dictionary or Bible updates outside the implementation phase. This plan only names the files future implementation must touch.

## File Map

- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/types/project-table.ts`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/utils/project-table-formatters.ts`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/api/services/project-views-service.ts`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/hooks/projects-table/use-project-views-list.ts`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/hooks/projects-table/use-project-view.ts`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/hooks/projects-table/use-table-zoom.ts`
- Create via CLI if preflight confirms browser role needs it: `/Users/jacksonsweet/Projects/OPS/OPS-Web/supabase/migrations/<generated>_projects_table_v2_phase5_saved_view_actions.sql`
- Modify after applying/typegen if RPCs are added: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/types/database.types.ts`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/hooks/projects-table/use-project-view-actions.ts`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/hooks/projects-table/use-project-view-url-state.ts`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/utils/project-view-defaults.ts`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/projects-view-create-dialog.tsx`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/projects-view-settings-menu.tsx`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/projects-density-control.tsx`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/projects-view-tabs.tsx`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/projects-toolbar.tsx`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/projects-table-shell.tsx`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/projects-table.tsx`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/i18n/dictionaries/en/projects.json`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/i18n/dictionaries/es/projects.json`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/tests/unit/projects-table/project-views-service.test.ts`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/tests/unit/hooks/use-project-view-actions.test.tsx`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/tests/unit/projects-table/project-table-formatters.test.ts`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/tests/integration/projects-table-v2-phase5.test.tsx`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/tests/e2e/projects-table-v2-phase5.spec.ts`
- Modify after implementation: `/Users/jacksonsweet/Projects/OPS/ops-software-bible/10_JOB_LIFECYCLE_AND_DATA_RELATIONSHIPS.md`

## Non-Negotiables

- Do not weaken `project_views` RLS. Purpose-specific RPCs are preferred over broad direct table grants for browser saved-view writes.
- Do not allow non-admin users to set `permission_key` on personal views.
- Do not expose company/share controls unless `usePermissionStore.can("projects.manage_views")` and RLS both support it.
- All user-facing text goes through `useDictionary("projects")` and both EN/ES `projects.json`.
- OPS design system v2 only: `.glass-dense` for popovers/dialogs, tokenized color classes, 12px modal/popover radius, 5px buttons, no decorative gradients/orbs, accent only for primary action/focus.
- Density changes move row height, header height, font size, avatar size, and min-widths together. Never use CSS `transform: scale()`.
- Financial columns and Financial Overview visibility stay server/RLS-backed; client filtering is only presentation defense.
- Do not touch Phase 4 team/photo/bulk behavior except compatibility wiring for view/density state.
- Do not call `ProjectService.update()`.
- Do not write `projects.team_member_ids`.

## Task 1: Project View Write Path + Mutation Contracts

**Files:**

- Create via CLI if needed: `/Users/jacksonsweet/Projects/OPS/OPS-Web/supabase/migrations/<generated>_projects_table_v2_phase5_saved_view_actions.sql`
- Modify after apply/typegen if RPCs are added: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/types/database.types.ts`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/types/project-table.ts`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/utils/project-view-defaults.ts`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/api/services/project-views-service.ts`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/tests/unit/projects-table/project-views-service.test.ts`

- [ ] **Step 1: Run Supabase preflight**

Run the read-only MCP SQL from "Supabase Preflight Required Before Implementation".

Expected: schema/RLS/grants match this plan. Because current grants are `anon SELECT` only, implementation must choose one of these paths before writing service mutations:

- Preferred: add purpose-specific saved-view RPCs exposed to `anon, authenticated` with SECURITY DEFINER hardening.
- Acceptable only with evidence: direct `project_views` DML if a browser-level proof shows Firebase Supabase requests execute as `authenticated` for mutations.

Do not proceed with direct `.from("project_views").insert/update/delete` methods on hope alone.

Stop if the expected policies or columns are missing.

- [ ] **Step 2: Add saved-view RPC migration if browser role requires it**

If preflight/browser proof does not establish authenticated direct DML, create a migration with:

```bash
npx supabase migration new projects_table_v2_phase5_saved_view_actions
```

RPC shape:

- `public.create_project_table_view(p_name text, p_source_view_id uuid, p_definition jsonb)`
- `public.rename_project_table_view(p_view_id uuid, p_name text)`
- `public.archive_project_table_view(p_view_id uuid)`
- `public.reset_project_table_view(p_view_id uuid)`
- `public.share_project_table_view(p_view_id uuid)`
- `public.update_project_table_view_definition(p_view_id uuid, p_definition jsonb)`

Hardening rules:

- `language plpgsql security definer set search_path = 'public', 'pg_temp'`.
- No dynamic SQL.
- Use `(select private.get_current_user_id())`, never raw `auth.uid()`.
- Resolve caller company through existing private helpers.
- Personal view creation always sets `owner_type = 'user'`, `owner_id = current user id`, `permission_key = null`.
- Company/share mutations require `public.has_permission(current_user_id, 'projects.manage_views', 'all')`.
- Validate payload JSON keys against an allowlist: `columns`, `filters`, `sort`, `density`, `zoom_level`.
- Enforce JSONB size caps before write and rely on table CHECK constraints as a second line of defense.
- Never accept arbitrary `permission_key` from the client.
- Archive uses `is_archived = true`; do not hard delete.
- Grant execute to `anon, authenticated`; revoke execute from `public` first if needed.

Verification:

```bash
git diff --check -- supabase/migrations tests/sql/projects-table-phase1-contract.sql
rg -n "auth\\.uid\\(|execute\\s+on\\s+function.*project_table_view.*to\\s+public" supabase/migrations/<generated>_projects_table_v2_phase5_saved_view_actions.sql
```

Expected: no raw `auth.uid()`, no public execute grant, no whitespace errors.

Stop for PM approval before applying any Phase 5 migration to live Supabase.

- [ ] **Step 3: Write failing service tests**

Test cases:

- `createPersonalView` inserts `owner_type = "user"`, `owner_id = currentUserId`, `permission_key = null`, `company_id = companyId`, and clones current `columns`, `filters`, `sort`, `density`, `zoom_level`.
- `duplicateView` appends a dictionary-provided duplicate suffix at the UI layer, then service inserts a new user-owned view.
- `renameView` updates `name` only.
- `archiveView` sets `is_archived = true`; it does not delete.
- `resetDefaultView` updates seeded `columns`, `filters`, `sort`, `density`, `zoom_level`, and leaves `owner_type`, `owner_id`, `permission_key`, and `is_default` unchanged.
- `shareViewWithTeam` only sends `owner_type = "company"`, `owner_id = companyId`, and sanitized persisted config when the caller passes `canManageViews = true`; otherwise it throws before Supabase.
- duplicate-name PostgREST code `23505` maps to a typed duplicate-name error.
- RLS/permission RPC/PostgREST codes `42501`, `PGRST301`, and empty update results map to a typed permission-denied error.
- service payloads never include arbitrary `permission_key` for personal views.

Run:

```bash
npm run test -- tests/unit/projects-table/project-views-service.test.ts
```

Expected: FAIL because the mutation methods/types do not exist.

- [ ] **Step 4: Implement typed contracts and service methods**

Add explicit types such as:

- `ProjectTableViewOwnerType = "company" | "user"`
- `ProjectTableViewMutationErrorCode = "duplicate_name" | "permission_denied" | "not_found" | "invalid_payload" | "unknown"`
- `ProjectTableViewCreateInput`
- `ProjectTableViewUpdateInput`
- `ProjectTableViewDensityInput`

Service methods:

- `fetchViews(companyId)`
- `createPersonalView(input)`
- `duplicateView(input)`
- `renameView(input)`
- `archiveView(input)`
- `resetDefaultView(input)`
- `shareViewWithTeam(input)`
- `updateViewDefinition(input)` for `columns`, `filters`, `sort`, `density`, `zoomLevel`

Payload rules:

- Always require `companyId` and `currentUserId`.
- Personal inserts set `permission_key: null`.
- Company/share mutation requires `canManageViews`.
- If RPC write path was added, all mutation methods call the RPCs and do not direct-write `project_views`.
- If direct DML was proven safe, all update/archive operations include `.eq("company_id", companyId)` and `.eq("id", viewId)`.
- Archive uses update, not delete.
- `resetDefaultView` rejects non-default views.
- `updateViewDefinition` writes only allowed definition fields.

- [ ] **Step 5: Run service tests green**

Run:

```bash
npm run test -- tests/unit/projects-table/project-views-service.test.ts
```

Expected: PASS.

- [ ] **Step 6: Static guard checks**

Run:

```bash
rg -n "ProjectService\\.update\\(|team_member_ids\\s*:" src/lib/api/services/project-views-service.ts src/lib/hooks/projects-table src/app/\(dashboard\)/projects/_components/table-v2
rg -P -n "permission_key\\s*:\\s*(?!null)" src/lib/api/services/project-views-service.ts src/lib/hooks/projects-table src/app/\(dashboard\)/projects/_components/table-v2
git diff --check -- src/lib/types/project-table.ts src/lib/utils/project-view-defaults.ts src/lib/api/services/project-views-service.ts tests/unit/projects-table/project-views-service.test.ts
```

Expected: no `ProjectService.update()` usage; no `projects.team_member_ids` write introduced; no client-supplied `permission_key`; no whitespace errors.

**PM checkpoint:** Report files changed, preflight findings, service API shape, exact test output, static guard output, and confirmation Task 2 was not started.

## Task 2: View State, URL Deep Links, and Mutation Hooks

**Files:**

- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/hooks/projects-table/use-project-views-list.ts`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/hooks/projects-table/use-project-view.ts`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/hooks/projects-table/use-project-view-actions.ts`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/hooks/projects-table/use-project-view-url-state.ts`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/tests/unit/hooks/use-project-view-actions.test.tsx`

- [ ] **Step 1: Write failing hook tests**

Test cases:

- `?view=<id>` wins over localStorage.
- inaccessible URL view falls back to default `My Active Work`, clears invalid active ID, and exposes an unavailable-view state for a dictionary toast/banner.
- switching views updates URL with `?view=<id>` and localStorage.
- active view selection clears row selection through the existing shell reset key.
- mutation hooks invalidate `queryKeys.projects.tableViews(companyId, userId)`.
- create/rename/duplicate/archive/reset/share actions expose loading, success, duplicate-name, permission-denied, and generic error states.
- share action is unavailable when `canManageViews` is false.

Run:

```bash
npm run test -- tests/unit/hooks/use-project-view-actions.test.tsx
```

Expected: FAIL.

- [ ] **Step 2: Implement URL state hook**

Use `useSearchParams`, `usePathname`, and `useRouter` from `next/navigation`.

Rules:

- Preserve unrelated query params.
- Set `view=<id>` on explicit tab/menu selection.
- On `/projects` with no `view`, choose localStorage then `My Active Work` then first available view.
- Do not push a history entry for automatic fallback; use `router.replace`.
- Do not break `/dashboard?openProject=...` workspace deep links because this hook is local to `/projects`.

- [ ] **Step 3: Implement mutation hooks**

Use TanStack `useMutation` and `useQueryClient`.

Rules:

- Centralize action state in `useProjectViewActions`.
- Pass `companyId`, `currentUserId`, and `canManageViews` from stores at call time.
- After archive of active view, select the next accessible view, preferably `My Active Work`.
- Do not optimistically reveal company views to users without `projects.manage_views`.
- Surface typed errors; UI will translate through dictionaries.

- [ ] **Step 4: Run hook tests green**

Run:

```bash
npm run test -- tests/unit/hooks/use-project-view-actions.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Run existing read-only regression**

Run:

```bash
npm run test -- tests/integration/projects-table-v2-read-only.test.tsx
```

Expected: PASS. Existing view tabs and table rows still render.

**PM checkpoint:** Report files changed, URL behavior, mutation invalidation behavior, test output, deviations, and confirmation Task 3 was not started.

## Task 3: Saved-View Management UI

**Files:**

- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/projects-view-create-dialog.tsx`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/projects-view-settings-menu.tsx`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/projects-view-tabs.tsx`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/projects-toolbar.tsx`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/projects-table-shell.tsx`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/i18n/dictionaries/en/projects.json`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/i18n/dictionaries/es/projects.json`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/tests/integration/projects-table-v2-phase5.test.tsx`

- [ ] **Step 1: Add failing integration tests for view management**

Test cases:

- `+ New view` opens a `.glass-dense` dialog.
- Create view validates blank and >60-char names before service call.
- Duplicate current view opens with generated name and creates a personal view.
- Rename active view updates tab label.
- Archive active personal view prompts confirmation, archives, and falls back to next accessible view.
- Default seeded view shows `Reset to defaults`; personal non-default view does not.
- Share/company controls are hidden without `projects.manage_views`.
- Share/company controls render for managers.
- Duplicate-name error renders a dictionary-backed error.
- Permission-denied error renders a dictionary-backed error.
- View-list loading/error/empty states render without hardcoded English.

Run:

```bash
npm run test -- tests/integration/projects-table-v2-phase5.test.tsx
```

Expected: FAIL.

- [ ] **Step 2: Add dictionary keys**

Add EN/ES keys for:

- create dialog title, name label, starting-point label, clone current, blank/default, create, cancel.
- settings menu labels: rename, duplicate, share with team, archive, reset to defaults.
- confirmation titles/bodies for archive and reset.
- duplicate-name, permission-denied, unavailable, too-complex, generic error.
- personal/company badges.
- loading and empty copy for view management.

Copy tone:

- Terse OPS voice.
- No emoji.
- No exclamation points.
- Sentence case for body text; uppercase tactical headings where the existing table uses them.

- [ ] **Step 3: Implement UI**

Rules:

- Use Lucide icons for menu commands.
- Use `.glass-dense` for dialogs, popovers, and menus.
- Buttons use 5px radius; chips use 4px radius; dialogs/popovers use 12px radius.
- Active tab indicator remains white/text, not accent.
- Accent appears only on the primary dialog action and focus ring.
- Keep real `<button>` semantics.
- Do not put cards inside cards.
- Do not hardcode visible English.
- Personal/company visibility is metadata-level, not decorative.

- [ ] **Step 4: Run integration tests green**

Run:

```bash
npm run test -- tests/integration/projects-table-v2-phase5.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Run dictionary/static guards**

Run:

```bash
rg -n "\">[A-Za-z][^\"]*<|aria-label=\"[A-Za-z]|placeholder=\"[A-Za-z]" src/app/\(dashboard\)/projects/_components/table-v2
git diff --check -- src/app/\(dashboard\)/projects/_components/table-v2 src/i18n/dictionaries/en/projects.json src/i18n/dictionaries/es/projects.json tests/integration/projects-table-v2-phase5.test.tsx
```

Expected: no hardcoded user-facing English in new/modified table-v2 UI; no whitespace errors.

**PM checkpoint:** Report files changed, dictionary keys added, UI states covered, test output, static guard output, and confirmation Task 4 was not started.

## Task 4: Density Controls and Per-View Persistence

**Files:**

- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/hooks/projects-table/use-table-zoom.ts`
- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/projects-density-control.tsx`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/projects-toolbar.tsx`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/projects-table-shell.tsx`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/projects-table.tsx`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/i18n/dictionaries/en/projects.json`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/i18n/dictionaries/es/projects.json`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/tests/unit/hooks/use-project-view-actions.test.tsx`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/tests/integration/projects-table-v2-phase5.test.tsx`

- [ ] **Step 1: Add failing density tests**

Test cases:

- compact preset sets density `compact` and zoom `0.85`.
- comfortable preset sets density `comfortable` and zoom `1.00`.
- spacious preset sets density `spacious` and zoom `1.25`.
- ctrl-wheel and pinch clamp `0.75` through `1.50`.
- gesture end snaps density to nearest preset and persists to active view.
- keyboard `Cmd++`, `Cmd+-`, `Cmd+0` work when focus is in table.
- metrics change row height, header height, font size, micro font size, avatar size, and column scale together.
- implementation does not apply `transform: scale`.
- density persists only to the active view through `updateViewDefinition`.
- permission-denied on density save shows error and reverts to saved view density.

Run:

```bash
npm run test -- tests/unit/hooks/use-project-view-actions.test.tsx tests/integration/projects-table-v2-phase5.test.tsx
```

Expected: FAIL.

- [ ] **Step 2: Implement density control**

Rules:

- Use a segmented control with three icon/text buttons: compact, comfortable, spacious.
- Render current zoom percentage as mono numerals.
- Keep pointer targets usable on iPad.
- Persist preset changes immediately through the safe active-view update path.
- For pinch/ctrl-wheel, debounce persistence until gesture/wheel idle or explicit end.
- Honor `prefers-reduced-motion`.

- [ ] **Step 3: Extend zoom metrics**

Metrics must include:

- `rowHeight`
- `headerHeight`
- `fontSize`
- `microFontSize`
- `avatarSize`
- `columnScale`
- `density`
- `zoom`

Formula guardrails:

- `zoom = clamp(0.75, value, 1.50)`
- row height follows spec: `clamp(32, 44 * zoom, 64)`
- compact never drops below 11px micro text.
- no CSS transform scaling.

- [ ] **Step 4: Run density tests green**

Run:

```bash
npm run test -- tests/unit/hooks/use-project-view-actions.test.tsx tests/integration/projects-table-v2-phase5.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Static guard**

Run:

```bash
rg -n "transform:\\s*['\"]?scale|scale\\(" src/app/\(dashboard\)/projects/_components/table-v2 src/lib/hooks/projects-table/use-table-zoom.ts
git diff --check -- src/lib/hooks/projects-table/use-table-zoom.ts src/app/\(dashboard\)/projects/_components/table-v2 src/i18n/dictionaries/en/projects.json src/i18n/dictionaries/es/projects.json
```

Expected: no CSS transform scaling for density; no whitespace errors.

**PM checkpoint:** Report files changed, density formulas, persistence behavior, test output, static guard output, and confirmation Task 5 was not started.

## Task 5: Column/Filter/Sort Persistence Compatibility

**Files:**

- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/hooks/projects-table/use-project-view.ts`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/projects-table-shell.tsx`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/(dashboard)/projects/_components/table-v2/projects-table.tsx`
- Modify: `/Users/jacksonsweet/Projects/OPS/OPS-Web/tests/integration/projects-table-v2-phase5.test.tsx`

- [ ] **Step 1: Add failing persistence tests**

Test cases:

- sorting changes can be saved into active `project_views.sort`.
- active view sort is used on initial table load unless URL sort override exists.
- URL sort override does not mutate saved view until explicit save.
- URL filter override layers on top of the saved filter and is shareable.
- unknown columns from saved `columns` are filtered out without crashing.
- Financial Overview remains absent/inaccessible when server/RLS excludes it.
- selection clears when saved or URL view definition changes.

Run:

```bash
npm run test -- tests/integration/projects-table-v2-phase5.test.tsx
```

Expected: FAIL.

- [ ] **Step 2: Wire explicit save/update behavior**

Rules:

- Definitions never mutate implicitly except density preset/zoom persistence required by Phase 5 scope.
- Sort/filter/column changes show unsaved state until `Update view` or `Save as new view`.
- `Share with team` saves the pending effective definition into the company view.
- URL overrides remain URL-only until explicit save.
- Unknown column IDs are dropped at render/service boundary and should not be written back unless the user saves.

- [ ] **Step 3: Run persistence tests green**

Run:

```bash
npm run test -- tests/integration/projects-table-v2-phase5.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Regression guard for Phase 4**

Run:

```bash
npm run test -- tests/integration/projects-table-v2-phase4.test.tsx
```

Expected: PASS. Team, photo, and bulk behavior remain intact.

**PM checkpoint:** Report files changed, explicit-save behavior, URL override behavior, Phase 4 regression output, and confirmation Task 6 was not started.

## Task 6: E2E Browser Gate

**Files:**

- Create: `/Users/jacksonsweet/Projects/OPS/OPS-Web/tests/e2e/projects-table-v2-phase5.spec.ts`
- Modify only if needed for deterministic mocks: `/Users/jacksonsweet/Projects/OPS/OPS-Web/tests/e2e/projects-table-v2-phase4.spec.ts`

- [ ] **Step 1: Add Playwright gate**

Cover:

- create personal view from current view.
- duplicate seeded/default view.
- rename personal view.
- archive personal view and fallback to default.
- reset seeded/default view after changing density/sort.
- deep link to `?view=<id>` loads the intended view.
- inaccessible view id falls back and shows unavailable state.
- non-manager does not see share/company controls.
- manager sees share/company controls and share persists company view.
- duplicate-name error renders.
- permission-denied error renders.
- compact/comfortable/spacious controls change row height and persist after reload.
- ctrl-wheel or simulated pinch changes density without `transform: scale`.

Run:

```bash
npm run test:e2e -- tests/e2e/projects-table-v2-phase5.spec.ts
```

Expected: FAIL until implementation is complete.

- [ ] **Step 2: Make mocks deterministic**

Use the Phase 4 E2E route-mocking pattern:

- deterministic company/user IDs.
- seeded personal and company views.
- route handlers for `project_views` select plus saved-view RPC mutations if Task 1 added the RPC path.
- direct `project_views` insert/update mocks only if Task 1 proved direct DML is the production write path.
- RLS-like handler behavior for manager vs non-manager.
- duplicate-name and permission-denied injection switches.

- [ ] **Step 3: Run E2E green**

Run:

```bash
npm run test:e2e -- tests/e2e/projects-table-v2-phase5.spec.ts
```

Expected: PASS.

- [ ] **Step 4: Run combined E2E regression**

Run:

```bash
npm run test:e2e -- tests/e2e/projects-table-v2-phase4.spec.ts tests/e2e/projects-table-v2-phase5.spec.ts
```

Expected: PASS.

**PM checkpoint:** Report files changed, browser scenarios covered, exact command output, screenshots/traces if failures occurred, and confirmation Task 7 was not started.

## Task 7: Documentation, Bible Update, and Final Verification

**Files:**

- Modify: `/Users/jacksonsweet/Projects/OPS/ops-software-bible/10_JOB_LIFECYCLE_AND_DATA_RELATIONSHIPS.md`
- Include the Phase 5 saved-view RPC migration and regenerated `src/lib/types/database.types.ts` in final verification if Task 1 added RPCs.
- If Task 1 proves direct DML is safe and no migration/typegen is needed, state that explicitly in the PM checkpoint with evidence.

- [ ] **Step 1: Update Bible after implementation**

Document:

- Phase 5 saved-view management.
- Personal vs company view ownership.
- Safe archive instead of delete.
- `project_views` persistence for `columns`, `filters`, `sort`, `density`, and `zoom_level`.
- URL `?view=<id>` behavior.
- Density controls and no transform scaling.
- Permission gates for `projects.manage_views` and `projects.view_financials`.

- [ ] **Step 2: Run focused verification**

Run:

```bash
npm run test -- tests/unit/projects-table/project-views-service.test.ts tests/unit/hooks/use-project-view-actions.test.tsx tests/integration/projects-table-v2-phase5.test.tsx
npm run test -- tests/integration/projects-table-v2-read-only.test.tsx tests/integration/projects-table-v2-edit-core.test.tsx tests/integration/projects-table-v2-phase4.test.tsx
npm run test:e2e -- tests/e2e/projects-table-v2-phase5.spec.ts
rg -n "ProjectService\\.update\\(|team_member_ids\\s*:" src/lib/api/services src/lib/hooks/projects-table src/app/\(dashboard\)/projects/_components/table-v2
rg -P -n "permission_key\\s*:\\s*(?!null)" src/lib/api/services/project-views-service.ts src/lib/hooks/projects-table src/app/\(dashboard\)/projects/_components/table-v2
rg -n "transform:\\s*['\"]?scale|scale\\(" src/app/\(dashboard\)/projects/_components/table-v2 src/lib/hooks/projects-table/use-table-zoom.ts
git diff --check -- supabase/migrations tests/sql/projects-table-phase1-contract.sql src/lib/types/database.types.ts src/lib/types/project-table.ts src/lib/utils/project-table-formatters.ts src/lib/utils/project-view-defaults.ts src/lib/api/services/project-views-service.ts src/lib/hooks/projects-table src/app/\(dashboard\)/projects/_components/table-v2 src/i18n/dictionaries/en/projects.json src/i18n/dictionaries/es/projects.json tests/unit/projects-table tests/unit/hooks tests/integration/projects-table-v2-phase5.test.tsx tests/e2e/projects-table-v2-phase5.spec.ts ../ops-software-bible/10_JOB_LIFECYCLE_AND_DATA_RELATIONSHIPS.md
```

Expected:

- All tests pass.
- Static guards find no forbidden `ProjectService.update()`, no direct `projects.team_member_ids` writes, no client-supplied `permission_key`, and no density transform scaling.
- `git diff --check` passes.

- [ ] **Step 3: Browser acceptance gate on local app**

Start dev server only if no existing server is running:

```bash
npm run dev -- --port 3002
```

Then verify in browser at `http://localhost:3002/projects`:

- create view.
- duplicate view.
- rename view.
- archive view.
- reset default view.
- open copied `?view=<id>` URL.
- compact/comfortable/spacious survive reload.
- non-manager does not see share controls.
- Financial Overview remains hidden or RLS-null-gated for users without `projects.view_financials`.

Expected: all pass.

**PM checkpoint:** Report files changed, commands run, results, migration status, browser findings, rollback readiness, blockers/open questions, and confirmation Phase 6 was not started.

## Browser-Gate Requirements

- Gate must run with `projects_table_v2` enabled.
- Gate must exercise real UI controls, not only service mocks.
- Gate must include at least one user without `projects.manage_views`.
- Gate must include at least one user without `projects.view_financials`.
- Gate must inspect row height or computed style before/after density changes.
- Gate must verify reload persistence.
- Gate must verify URL deep link behavior in a fresh page context.
- Gate must save traces/screenshots on failure.

## Rollback and Kill Switch

- Phase 5 remains covered by the existing `projects_table_v2` feature flag. If saved-view management ships poorly, disable `projects_table_v2` to revert users to the prior product surface.
- If Task 1 adds the preferred saved-view RPC migration, rollback disables the feature flag first and leaves the RPCs unused. Extra `project_views` rows or archived rows are harmless to V1 because V1 does not read them.
- If Task 1 proves direct DML is safe and no migration is needed, rollback leaves only extra `project_views` rows or archived rows.
- Archive/delete is soft only (`is_archived = true`), so user-created views can be restored manually if needed.
- If density persistence causes usability issues, hide the density control in code while leaving saved values intact; defaults still load as comfortable/1.00 for seeded views.
- If share/company controls fail authorization checks, hide the controls and leave personal view CRUD active. Do not relax RLS.

## Risks and Prevention

- **Risk: non-admin escalates financial access through personal `permission_key`.** Prevention: service never sends `permission_key` for personal views, RLS `WITH CHECK` blocks it, tests assert it.
- **Risk: company/share controls bypass permissions.** Prevention: UI gates with `usePermissionStore.can("projects.manage_views")`, service requires `canManageViews`, RLS remains final authority.
- **Risk: duplicate names fail with raw database errors.** Prevention: typed service error maps `23505` to dictionary-backed duplicate-name UI.
- **Risk: deleting seeded/default views breaks all users.** Prevention: UI archives only user-created views; seeded views reset, not archive, unless manager action is explicitly supported and tested.
- **Risk: density zoom uses visual scaling and breaks hit targets.** Prevention: metrics update row/header/font/avatar/width values; static guard rejects `transform: scale`.
- **Risk: URL deep links leak inaccessible views.** Prevention: fetch relies on RLS, inaccessible IDs fallback to default with dictionary state.
- **Risk: Financial Overview appears for unauthorized users.** Prevention: RLS `permission_key` filters views, `project_table_rows` still nulls financial values server-side, browser gate covers no-financial user.
- **Risk: Phase 4 behavior regresses.** Prevention: Phase 4 integration/E2E regression commands run before final acceptance.
- **Risk: hardcoded English enters table-v2 UI.** Prevention: dictionary keys in EN/ES and static hardcoded-string grep.
- **Risk: stale schema/auth assumptions.** Prevention: read-only MCP preflight before Task 1 plus explicit proof of the browser write role. Prefer purpose-specific RPCs when Firebase/PostgREST role behavior is ambiguous.

## Final Ship Gate

Do not call Phase 5 complete until:

- Supabase preflight confirms no migration needed or the PM approves a new migration plan after drift is proven.
- Service, hook, integration, and E2E tests pass.
- Browser gate passes for create, rename, duplicate, archive, reset, deep link, and density persistence.
- Static guards pass for `ProjectService.update()`, `projects.team_member_ids`, transform scaling, and hardcoded English.
- Bible is updated in the implementation phase.
- PM checkpoint confirms Phase 6 was not started.
