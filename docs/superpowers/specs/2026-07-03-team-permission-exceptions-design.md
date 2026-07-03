# Team Surface Reconstruction + Per-Member Permission Exceptions — Design

**Date:** 2026-07-03 · **Workstream:** BUG BURNDOWN W5 · **Branch:** `feat/team-permission-exceptions`
**Bugs:** `2984e137-bb6c-4685-9047-401baf7ecb93` (URGENT — no per-member permission exceptions), `18d0d6a3-cf12-4209-93b4-33f82c5c29c9` (HIGH — Team tab reconstruction)

## Problem — verified ground truth

The Settings › TEAM surface received a P3-6 visual rebuild (InstrumentStrip / Workbar / RegisterTable), but the data layer beneath it is dead and the anchor capability is missing:

1. **RBAC reads are RLS-blind.** `RolesService` queries `role_permissions` / `user_roles` directly as the Firebase-bridged `anon` role. Live policies allow reading only the caller's *own* role rows. Result: the Roles editor renders phantom/empty permission sets for every role but your own; the roster can't resolve members' role tags.
2. **RBAC writes bounce.** `user_roles` has a SELECT-only anon grant; `role_permissions` likewise. `RolesService.assignUserRole` / `updateRolePermissions` throw "permission denied" — the Roles editor is a facade. (The one working write path is `PATCH /api/users/[id]/role`, a correct service-role route that also syncs legacy `users.role` — the UI's *other* role action.)
3. **Two role systems side-by-side in the UI.** A legacy `users.role` dropdown and a separate RBAC "Assign company role" modal — canonical design-judgment failure (two presentations because two storage systems exist).
4. **`user_permission_overrides` exists with no web UI, no client resolution, and no server honor.** The web `permissions-store` never reads it. `public.has_permission()`, `private.current_user_scope_for()` (RLS ceilings on expenses/payments/opportunities/estimates/invoices) consult only admin-bypass + role grants. An override written today changes nothing on web.
5. **Registry drift.** DB `role_permissions`/overrides contain `deck_builder.view|create|edit`, `finances.view`, `time_off.approve`, `profile.edit` — none registered in `src/lib/types/permissions.ts`, so the admin bypass (registry-driven) silently *denies admins* permissions that crew members can hold, and no UI can present them.
6. **Cross-tenant hole (found in passing, fixed here because it's this surface):** `roles` write policies check only `is_preset=false AND company_id IS NOT NULL` — any company's member can mutate any other company's custom roles.

iOS parity note: iOS `PermissionService` already resolves overrides client-side (granted+scope ⇒ replace; granted=false ⇒ remove; granted=true+null scope ⇒ ignore). iOS `PermissionAdminService` writes overrides successfully (admin-gated policies exist) but its `user_roles`/`role_permissions` writes are broken by the same grants/policies as web. The DB fixes below un-break iOS *reads* with no app release; iOS write-path adoption is out of scope (noted for the bible).

## Semantics — the resolution contract (matches shipped iOS behavior)

Effective permission for user U, permission P:

1. **Admin bypass** — U is `companies.account_holder_id` ∪ `companies.admin_ids` ∪ `users.is_company_admin` ⇒ every *registered* permission at scope `all`. Overrides are ignored for admins (UI shows a FULL ACCESS state, not an editor).
2. **Override** — a `user_permission_overrides` row (U, P) in U's current company:
   - `granted=false` ⇒ **denied** (revokes a role grant).
   - `granted=true AND scope IS NOT NULL` ⇒ that scope is **authoritative** (widen *or* narrow vs role).
   - `granted=true AND scope IS NULL` ⇒ ignored (falls through to role) — matches iOS.
3. **Role** — widest scope among U's role's `role_permissions` rows (`all` > `assigned` > `own`).

Scope satisfaction is unchanged: `all` ⊇ `assigned` ⊇ `own`.

## Changes

### A. Database (one additive migration, applied to prod via MCP with sentinel checks)

1. **`public.has_permission(p_user_id, p_permission, p_required_scope)`** — CREATE OR REPLACE: after the (unchanged) admin bypass, consult the override for `(user, permission)` scoped to the user's current `company_id`; apply contract above; else role lookup (unchanged). No signature change.
2. **`private.current_user_scope_for(p_permission)`** — CREATE OR REPLACE: override-aware (`granted=false` ⇒ NULL; `granted=true`+scope ⇒ scope; else role scope). `private.current_user_has_permission` composes it and needs no edit. Effect on live data: all 18 existing override rows are `granted=true` grants that were previously ignored server-side ⇒ strictly widens for those holders; nobody loses access.
3. **Read policies (new, additive):**
   - `user_roles`: SELECT for same-company members (`user_id IN (SELECT id::text FROM users WHERE company_id = private.get_user_company_id())`).
   - `role_permissions`: SELECT where role is preset or same-company (`role_id IN (SELECT id FROM roles WHERE is_preset OR company_id = private.get_user_company_id())`).
4. **Override policies** — extend the four admin policies' predicate to `private.current_user_is_admin() OR private.current_user_has_permission('team.assign_roles','all')` (matches the bible's stated write contract).
5. **`roles` write policies** — tighten INSERT/UPDATE/DELETE to same-company + (admin OR `team.assign_roles`); SELECT tightened to presets + same-company rows. Web's roles CRUD (admins) keeps working; the cross-tenant hole closes. No legitimate caller regresses (iOS custom-role creation is already broken by its own missing `company_id`).
6. **No new anon write grants** on `user_roles` / `role_permissions` — writes go through guarded server routes (existing precedent).

### B. Server routes (service-role + Firebase token verify + company match, mirroring `PATCH /api/users/[id]/role`)

- **`PUT /api/users/[id]/permission-overrides`** — body `{ idToken, set: [{permission, scope, granted}], clear: [permission] }`. Guard: caller has `team.assign_roles` (RPC) or admin fallback; target same company; **target must not be admin/account-holder** (400 — overrides are meaningless + confusing there); every permission must exist in the shared registry. Upserts on `(user_id, permission)` with `company_id` = target's company; deletes cleared rows. Dispatches one standard notification to the affected user ("Access updated" + what changed count).
- **`PUT /api/roles/[id]/permissions`** — body `{ idToken, permissions: [{permission, scope}] }`. Guard: `team.assign_roles`/admin; role must be non-preset and same-company. Transactional replace (delete + insert via service role). Un-breaks the Roles editor's save.
- Role assignment continues through existing `PATCH /api/users/[id]/role` (already syncs legacy `users.role` + clears role_needed notifications).

### C. Shared logic (TDD core) — `src/lib/permissions/resolve.ts` (pure, no I/O)

- `resolveEffectivePermissions({rolePermissions, overrides})` → `Map<permission, scope>` per the contract (+ list of active exceptions with their delta type: `added | widened | narrowed | revoked`).
- `diffAgainstRole(roleDefaults, desired)` → `{set[], clear[]}` override mutations (desired == role ⇒ clear; else set).
- `isAdminBypass(user, company)` → boolean (single definition used by store + UI states).
- Used by: permissions-store (self), member access editor (target member), tests.

### D. Client

- **`permissions-store.fetchPermissions`** — non-admin path fetches own overrides (self-read policy exists) and resolves via `resolveEffectivePermissions`. Admin path unchanged.
- **`RolesService`** — `updateRolePermissions`/`assignUserRole` re-pointed to the server routes; reads unchanged (now actually return data under the new policies). New `fetchMemberAccess(userId)` (role + role perms + overrides in one shot) and `fetchAllUserRoles` retained for roster tags.
- **Registry** (`permissions.ts`): add `deck_builder` module (view/create/edit — Core Operations category, labeled "Deck Designer") and register `finances.view`, `time_off.approve`, `profile.edit` in sensible modules so registry ⊇ DB reality and the bypass grants them.

### E. UI (Settings › TEAM)

- **Roster (Members section):** keep P3-6 bones. ONE role column (RBAC truth via fixed reads; legacy tag dropped). Row click → member access view. Kebab: Adjust access / Assign|Remove seat / Deactivate|Reactivate. Legacy "Change role" submenu and separate "Assign company role" action removed. `?assignRole=` deep link (role_needed notifications) re-targets the member view's role select.
- **Member access view (the anchor — V4):** in-place view swap with back nav (same grammar as the roles editor). Identity header (avatar, name, contact, role tag, seat state) → `// ROLE` row (Select; writes via PATCH route; re-bases the grid) → `// ACCESS` panel:
  - Category rows (5) with **effective-state chips** (e.g. `ESTIMATES · VIEW`), collapsed by default; a category containing an exception is expanded on entry and its chip carries the exception mark.
  - Expanded category ⇒ module rows: tier SegmentControl `[None | View | Manage | Full]` + scope SegmentControl where applicable `[All | Assigned | Own]`, prefilled from role; deviation ⇒ `EXCEPTION` tag + per-row reset; header shows exception count + `RESET ALL`.
  - Saves are explicit (sticky save bar appears on dirty state), one batch → override route; toasts per house pattern.
  - **Admin/account-holder target** ⇒ panel replaced by a FULL ACCESS state block (no controls, one line of explanation).
  - Pending-invite / deactivated members: access view read-only (role visible; exceptions disabled with explanation).
- **Roles section:** unchanged layout; its reads/writes now work (policies + route). Stays the once-ever vocabulary surface; Members remains the default TEAM section.

### F. i18n + copy

All new strings in `settings.json` under `team.access.*` (en + es), written via ops-copywriter in the product register (terse, tactical, no exclamation points; `//` panel prefixes; UPPERCASE authority).

## Testing

- **Unit (vitest):** `resolve.ts` exhaustively — role-only, grant-add, widen, narrow, revoke, null-scope ignore, admin bypass precedence, unregistered-permission handling, diff round-trips (set⇄clear).
- **Integration:** both new routes — auth guard, company mismatch, admin-target rejection, registry validation, upsert/delete behavior (mocked service client per existing route-test pattern).
- **DB sentinels (prod, read-only + reversible):** simulated-JWT checks that (a) a granted override flips `has_permission` for a crew user, (b) `granted=false` revokes, (c) admins unaffected, (d) cross-tenant role write now rejected, (e) same-company `user_roles`/`role_permissions` SELECT returns rows.
- **Evidence:** 1280×900 screenshots — roster, member view (clean role state), member view with exceptions (tags + count), admin FULL ACCESS state, roles editor now showing real data; vitest output.

## Risks / coordination

- Parallel chip W3 (security sweep) audits SECURITY DEFINER functions + policies: this migration touches `has_permission`/`current_user_scope_for` and permission-table policies. Migration is one idempotent file; W3 re-runs advisors after. Noted in the final report.
- RLS behavior changes are widen-only for existing data (18 grant rows, 0 revokes). The roles-policy tightening rejects only cross-tenant writes (illegitimate by definition).
- iOS keeps reading `users.role` for legacy display in old builds; the PATCH route's legacy sync preserves that.

## Out of scope

iOS code changes; invitation system; seats/billing; custom-role UX redesign (data-layer fix only); UI for time_off/finances/profile modules beyond registry registration.
