# Team Surface Reconstruction + Per-Member Permission Exceptions — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use custom-skills:executing-plans to implement this plan task-by-task.

**Goal:** Make the permission system actually work end-to-end on web (reads, writes, server/RLS honor) and ship per-member permission exceptions as the anchor of a coherent Settings › TEAM surface.

**Architecture:** Pure resolver module (TDD) shared by store + UI; one additive DB migration (override-aware `has_permission`/`current_user_scope_for`, company-read policies, tightened roles policies); two guarded service-role API routes for writes (house precedent: `PATCH /api/users/[id]/role`); V4 member access view reusing the roles-editor grammar inside `TeamSection` view-swap.

**Tech Stack:** Next.js 14 App Router, TypeScript, Tailwind (token classes), TanStack Query, Zustand, Supabase (anon + service-role), vitest.

**Design System:** `ops-design-system/project/DESIGN.md` + repo token classes (`text-text/-2/-3/-mute`, `glass-surface`, `rounded-panel/-bar`, `Tag` variants, `SegmentControl`, `RegisterTable`, `font-mono text-micro uppercase tracking-[0.16em]` section labels, `ease-smooth`). Zero raw hex/px inventions — new UI composes existing kit components only.

**Required Skills:** `ops-design`, `frontend-design:frontend-design`, `custom-skills:interface-design`, `custom-skills:ui-ux-pro-max`, `ops-copywriter:ops-copywriter` (all copy), `custom-skills:audit-design-system` (gate), `superpowers:test-driven-development` (Tasks 1, 4, 5).

**Reference spec:** `docs/superpowers/specs/2026-07-03-team-permission-exceptions-design.md` (resolution contract §Semantics is normative).

---

### Task 1: Resolver module (TDD)

**Files:**
- Create: `src/lib/permissions/resolve.ts`
- Test: `tests/unit/permissions/resolve.test.ts`

Pure functions, no I/O:

```ts
export interface OverrideInput { permission: string; scope: PermissionScope | null; granted: boolean }
export type ExceptionKind = "added" | "widened" | "narrowed" | "revoked";
export interface MemberException { permission: string; kind: ExceptionKind; roleScope: PermissionScope | null; effectiveScope: PermissionScope | null }

resolveEffectivePermissions(rolePerms: {permission,scope}[], overrides: OverrideInput[]): Map<string, PermissionScope>
classifyExceptions(rolePerms, overrides): MemberException[]
diffAgainstRole(rolePerms, desired: Map<string, PermissionScope | null>): { set: {permission,scope,granted}[]; clear: string[] }
isAdminBypass(u: {id; isCompanyAdmin?}, c: {accountHolderId?; adminIds?} | null): boolean
```

Contract (normative, matches iOS `PermissionService`): role map first (widest per permission: all>assigned>own — DB unique key makes dupes impossible but resolver stays defensive); then overrides: `granted && scope!=null` ⇒ replace; `granted && scope==null` ⇒ ignore; `!granted` ⇒ delete. `diffAgainstRole`: desired == role value ⇒ `clear`; desired null where role grants ⇒ `set granted:false`; desired scope ≠ role (incl. role-absent) ⇒ `set granted:true, scope`. Round-trip law: `resolveEffectivePermissions(role, diff→rows) == desired`.

Steps: write failing tests (role-only; add; widen; narrow; revoke; null-scope ignore; diff round-trip property over hand-built cases; isAdminBypass truth table incl. `isCompanyAdmin` flag) → `npx vitest run tests/unit/permissions/resolve.test.ts` FAIL → implement → PASS → commit `feat(permissions): pure override resolution core (iOS-parity semantics)`.

### Task 2: Registry additions

**Files:** Modify `src/lib/types/permissions.ts`; Test: `tests/unit/permissions/registry.test.ts`

First verify live scopes: `select permission, array_agg(distinct scope) from role_permissions where permission in ('deck_builder.view','deck_builder.create','deck_builder.edit','projects.view_financials','inventory.manage','finances.view','time_off.approve','profile.edit') group by 1;` — set each action's `scopes` to cover what's live (superset OK).

Add: `deck_builder` module (Core Operations, label "Deck Designer": view/create/edit); `projects.view_financials` action in projects module; `inventory.manage` action in catalog module; `finances` module (Financial: `finances.view`); `time_off` module (People & Location: `time_off.approve`); `profile` module (People & Location: `profile.edit`). Add `"view_financials"` to `DESTRUCTIVE_SUFFIXES` (financial visibility never rides in via Manage tier). **Do NOT register `spec.admin`** — add an explicit comment: registering it would hand the SPEC console to every company admin via the bypass.

Test asserts: all new ids ∈ `ALL_PERMISSIONS`; `"spec.admin"` ∉ `ALL_PERMISSIONS`; no duplicate ids; `getActionsForTier("projects","manage")` excludes `view_financials`.

Commit: `feat(permissions): register live DB permissions (deck_builder, financial visibility, inventory, time_off, profile)`.

### Task 3: DB migration file

**Files:** Create `supabase/migrations/20260703120000_permission_overrides_engine.sql`

Contents (all idempotent `CREATE OR REPLACE` / `DROP POLICY IF EXISTS` + `CREATE POLICY`):
1. `public.has_permission(uuid,text,text)` — unchanged admin bypass; then `SELECT ... FROM user_permission_overrides upo JOIN users u ON u.id = upo.user_id WHERE upo.user_id = p_user_id AND upo.permission = p_permission AND upo.company_id = u.company_id` → if found: `granted=false` ⇒ return false; `granted AND scope IS NOT NULL` ⇒ scope-hierarchy check on that scope; else fall through to role lookup (unchanged).
2. `private.current_user_scope_for(text)` — same fold-in for the current user (`private.get_current_user_id()` + `private.get_user_company_id()`), returning NULL on revoke, override scope on grant, else role scope.
3. New SELECT policies: `user_roles` company-read; `role_permissions` preset-or-company-role read (both `TO public`).
4. `user_permission_overrides`: recreate the 4 admin policies with `private.current_user_is_admin() OR private.current_user_has_permission('team.assign_roles','all')`.
5. `roles`: recreate select/insert/update/delete — select: preset or same-company; writes: non-preset AND same-company AND (admin OR `team.assign_roles`).
6. Comment block with sentinel queries (Task 11 runs them).

Commit: `feat(db): override-aware permission engine + permission-table read policies + roles tenancy tightening`. (Applied to prod in Task 11, not now.)

### Task 4: Override API route (TDD)

**Files:** Create `src/app/api/users/[id]/permission-overrides/route.ts`; Test: `tests/integration/permission-overrides-route.test.ts` (mock pattern from `tests/integration/role-needed.test.ts`).

`PUT` body `{ idToken, set: [{permission, scope, granted}], clear: string[] }`. Guards in order: field validation → `verifyAuthToken` → `findUserByAuth` caller → target exists, same company → target NOT admin-bypass (`is_company_admin` / `account_holder_id` / `admin_ids`) ⇒ 409 `target_is_admin` → every permission ∈ `ALL_PERMISSIONS` (blocks `spec.admin`) and every `set` row `granted=false` OR valid scope → permission check: `checkPermission(uid, 'team.assign_roles', email)` w/ admin_ids fallback (mirror `users/[id]/role/route.ts:68-87`) → service-role upsert (`onConflict: user_id,permission`, `company_id` = target's) + delete cleared → insert one standard notification to target (`type: 'permission_change'`… verify `notifications.type` CHECK constraint first; if constrained, use an allowed type) → 200 `{applied, cleared}`.

TDD: failing tests (401 bad token, 403 cross-company, 409 admin target, 400 unregistered permission, happy path upsert+clear+notification) → implement → PASS → commit `feat(team): guarded per-member permission override route`.

### Task 5: Role-permissions API route (TDD)

**Files:** Create `src/app/api/roles/[id]/permissions/route.ts`; Test: `tests/integration/role-permissions-route.test.ts`.

`PUT` body `{ idToken, permissions: [{permission, scope}] }`. Guards: token → caller → role exists; 403 unless (`is_preset=false` AND `company_id == caller.company_id`) → registry validation → `team.assign_roles`/admin-fallback → replace set (delete+insert, service role; restore-on-failure like `RolesService.updateRolePermissions`). Commit `feat(team): guarded role-permissions replace route`.

### Task 6: Services, store, hooks

**Files:**
- Modify `src/lib/api/services/roles-service.ts` — `updateRolePermissions` + `assignUserRole` become authed `fetch` calls to the routes (token pattern: same as the existing caller of `PATCH /api/users/[id]/role` — locate via `grep -rn "users/.*role" src/lib/hooks src/lib/api`); add `fetchUserOverrides(userId)`, `fetchMemberAccess(userId)` (user_roles row + role + role_permissions + overrides).
- Create `src/lib/api/services/permission-overrides-service.ts` — `saveMemberOverrides(userId, {set, clear})` → PUT route.
- Modify `src/lib/store/permissions-store.ts` — non-admin path: fetch own overrides (self-read policy) + `resolveEffectivePermissions`; bypass path uses shared `isAdminBypass` (now includes `currentUser.isCompanyAdmin` — fixes client/server asymmetry).
- Hooks: create `src/lib/hooks/use-member-access.ts` (`useMemberAccess(userId)`, `useSaveMemberAccess()`); register query keys in `src/lib/api/query-client.ts`; invalidate member-access + permissions on save.
- Test: extend `tests/unit/permissions/resolve.test.ts` consumers only if logic moved — store change is thin plumbing over the tested core.

Commit: `feat(team): member-access data layer — override reads, guarded writes, store resolution`.

### Task 7: Member access view (V4) + roster rewire

**Skills:** `ops-design` + `frontend-design` + `interface-design` + `ui-ux-pro-max`. Kit-only composition.

**Files:**
- Create `src/components/settings/permission-grid.tsx` — extract/generalize `ModulePermissionRow` + `SectionLabel` from `roles-tab.tsx` (roles-tab imports from here; zero visual change there). Member mode adds: baseline (role) map prop, per-row `EXCEPTION` Tag (`variant="tan"`) + reset-to-role affordance, effective-state chip text (`TableMono`-style mono micro).
- Create `src/components/settings/member-access-view.tsx` — header (back + `UserAvatar` + name + contact + seat Tag + `[UNSAVED]` tan tag + primary Save button, exact roles-editor pattern `roles-tab.tsx:495-532`); `// ROLE` glass panel with role `Select` (writes via existing `PATCH /api/users/[id]/role` hook → toasts) + exception count + `RESET ALL`; `// ACCESS` — categories as collapsed sections with effective chips, expand → `permission-grid` rows seeded from role baseline + overrides; admin target ⇒ FULL ACCESS state block (no controls); inactive/pending target ⇒ read-only grid; danger zone (seat/deactivate — reuse existing mutations).
- Modify `src/components/settings/team-section.tsx` — view swap on `?member=<id>` (pattern of RolesTab `view` state but URL-driven like `?assignRole`); roster: RBAC role column (`useAllUserRoles` + `useRoles`, fallback Tag `dim` "Unassigned"; keep `Shield` admin marker driven by `isAdminBypass`); `onRowClick` → member view; kebab: `Adjust access` (first, `team.assign_roles`-gated), seat, deactivate/reactivate — legacy Change-role submenu + AssignRole item removed; `?assignRole=<id>` now routes to `?member=<id>` (role_needed deep links keep working); update the header comment (dual-system reconciliation is now real, via the syncing PATCH route).
- Delete `src/components/ops/assign-role-modal.tsx` (grep first: only team-section imports it).

Animation: category expand/collapse uses existing house transition classes (`transition-[grid-template-rows] duration-200 ease-smooth` pattern or the kit's existing collapse — check `PendingInvitesSection`; honor `prefers-reduced-motion` via `motion-reduce:transition-none`). No new motion vocabulary.

Commit: `feat(team): member access view — role + exceptions, one role system, roster rewire`.

### Task 8: Copy + i18n (ops-copywriter)

**Files:** Modify `src/i18n/dictionaries/en/settings.json` + `es/settings.json`.

New `team.access.*` namespace (view title, role panel, exception tag/count, reset, full-access state, read-only states, save/discard, toasts, notification strings used by the route). Product register: terse, no exclamation points, `//` titles, UPPERCASE authority, `[brackets]` micro-instructional. Remove dead keys (`team.changeRole`, `team.assignCompanyRole`, assign-modal strings) after grep confirms no other consumers. Commit `feat(team): access editor copy, en+es`.

### Task 9: Vitest full pass + lint scope check

Run `npx vitest run` (all) + `npx next lint --dir src/components/settings --dir src/app/api/users --dir src/app/api/roles --dir src/lib/permissions` (repo lint is globally red on pre-existing errors — judge only touched files). Fix anything mine. Commit fixes if any.

### Task 10: audit-design-system gate

Run `custom-skills:audit-design-system` over new/modified UI files. Zero hardcoded colors/spacing/radius/fonts outside token classes. Fix + commit.

### Task 11: Apply migration to prod + sentinels

`mcp apply_migration` with Task 3 SQL. Sentinels (SQL, prod): (1) crew-role test user + temp override row on a throwaway permission → `has_permission` flips true → revoke row → false → delete row; (2) `current_user_scope_for` via `set role anon; set request.jwt.claims` simulation for a real crew user; (3) cross-tenant `roles` UPDATE as simulated other-company user → 0 rows; (4) same-company `user_roles`/`role_permissions` SELECT as simulated member → >0 rows; (5) `get_advisors(security)` delta check — no new criticals. All temp rows cleaned.

### Task 12: Dev-server evidence

`npm run dev:webpack` in the worktree (`DEV_BYPASS_AUTH=true` already in copied `.env.local` — verify) → Playwright/preview at 1280×900: roster (RBAC tags), member view clean, member view with a real exception (tag + count + chip), FULL ACCESS admin state, roles editor showing real preset data. Save to `docs/artifacts/team-w5/`. Test an actual save round-trip against prod DB as bypass admin user (PETE) on a demo member, then clean up the override rows.

### Task 13: Bible + bugs + report

- Update `ops-software-bible/03_DATA_ARCHITECTURE.md` § Permissions System (override semantics, new policies, route contracts, registry rule incl. spec.admin exclusion; note iOS write-path adoption pending).
- Both bugs → `resolved` + `fix_commit` + `fix_notes` (cite evidence).
- Plain-English report for Jackson: what the Team tab now does, the taste calls, what needs his go (merge/deploy).
