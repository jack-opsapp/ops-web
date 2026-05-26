# Projects Tab Redesign — Engineering Design Spec (v2.4)

**Date:** 2026-05-12
**Surface:** `OPS-Web` — `/projects` route
**Status:** Spec v2.4 — pending implementation plan
**Supersedes:** v1 (rejected), v2 (rejected), v2.1 (rejected), v2.2 (rejected), v2.3 (rejected)
**Author:** Engineering (with Jackson as product lead)

---

## 0. Changelog from v2.3 (this revision)

v2.3 was reviewed again and three production blockers surfaced. v2.4 patches:

- **`projects.role_scope_update` must remain restrictive.** Live Supabase has permissive `company_isolation` plus restrictive `role_scope_update`; recreating the scoped UPDATE policy as default permissive would turn RLS into `company_isolation OR scoped_update` and allow same-company writes. Phase 1 now explicitly recreates `role_scope_update AS RESTRICTIVE`, and the test plan verifies `pg_policy.polpermissive = false`.
- **Permission helpers carry their own company boundary.** The scoped helper pattern normally sits inside table RLS policies that also enforce `company_id = private.get_user_company_id()`. Phase 1's public `SECURITY DEFINER` RPCs bypass table RLS, so `private.current_user_in_project`, `private.current_user_can_edit_project`, and `private.current_user_can_assign_team_on_project` now inline the live-project company check. `'all'` means all projects in the operator's company, never global.
- **Team cache invariant is enforced in Phase 1, not deferred.** `projects.team_member_ids` is a denormalized cache of non-deleted `project_tasks.team_member_ids`. v2.3 relied on RPC discipline and deferred the trigger, but existing code paths already mutate task assignments directly. v2.4 adds a Phase 1 backfill plus `project_tasks` trigger that recomputes the project cache after task insert/update/delete, including soft-delete and project move cases.
- **`private.current_user_in_project` becomes active-row only.** Live helper currently counts deleted tasks. Phase 1 now replaces it so it only considers non-deleted projects and non-deleted tasks before the new edit/assign helpers are created. This prevents deleted task assignment from satisfying assigned-scope write access.
- **Cancelled tasks no longer count as active work.** The `project_table_rows` SQL now excludes `status = 'cancelled'` from progress denominators, active task counts, and `next_task`. Cancelled work remains historical data, not incomplete work.

Architecture, view management, visual layout, interactions, and rollout remain unchanged from v2.3. These fixes are schema/RLS correctness changes required before Phase 1 planning.

---

## 0a. Changelog from v2.2

v2.2 was reviewed again and three correctness bugs + two stale-text cleanups surfaced. v2.3 patches:

- **Permission helpers now compose existing canonical helpers, no type bug.** v2.2 inlined `v_uid = ANY(COALESCE(team_member_ids, ARRAY[]::uuid[]))`, but `projects.team_member_ids` is `string[] | null` (text array, per [database.types.ts:8295](OPS-Web/src/lib/types/database.types.ts:8295)) — that cast would have errored at runtime. v2.3's new helpers (`private.current_user_can_edit_project`, `private.current_user_can_assign_team_on_project`) now compose the existing canonical primitives `private.current_user_is_admin()`, `private.current_user_scope_for(key)`, and `private.current_user_in_project(p_project_id)` — the exact permission pattern used by [20260506120100_project_tags.sql:96–100](OPS-Web/supabase/migrations/20260506120100_project_tags.sql:96), with the same company boundary enforced inside the helpers because RPCs bypass RLS. Side benefit: `current_user_in_project` already encompasses both `projects.team_member_ids` AND task-level membership, which v2.2 had only partially.
- **Team RPCs now require explicit input validation.** SECURITY DEFINER functions cannot trust caller-supplied IDs. v2.3's `assign_project_team_member` and `remove_project_team_member` open with three rejection checks: `p_user_id` must exist in `users` and share the project's `company_id`; every `p_task_ids` element must have `project_id = p_project_id` AND `deleted_at IS NULL`; both raise `'22023'` on mismatch. v2.2 left these implicit — that's a privilege-escalation hole.
- **Canonical team-membership rule.** v2.2 had a contradiction: the remove RPC recomputed `projects.team_member_ids` as the union of remaining task assignees, but Section 5.4 also said "no-task projects can store direct project-level assignments." The two rules cannot coexist without losing project-level-only members on the next remove. v2.3 picks one canonical rule: **`projects.team_member_ids` is ALWAYS exactly the deduplicated union of all task assignees on the project — never a free-floating direct-assignment list.** Consequence: assigning a team member to a project requires at least one task. Section 5.4's no-task edge case is rewritten to force creation of a first task as part of the assignment flow. Remove RPC becomes trivially correct: recompute from `project_tasks.team_member_ids` after the per-task removal.
- **Stale `pg_trgm requires migration` wording removed** from two out-of-scope notes that contradicted v2.2's corrected "extension may already be installed" framing.
- **E2E "team cascade" test corrected.** v2.2 still asserted the activity timeline showed a team-change event, but team RPCs explicitly don't write `project_notes`. v2.3 changes the assertion to "notification rail entry appears" (the actual user-visible signal).

Architecture, view system, column catalog, visual layout, interactions, and phasing are unchanged from v2.2. These are the last three sharp edges plus two text cleanups.

---

## 0b. Changelog from v2.1

v2.1 was reviewed again and six more issues surfaced — all real, all production-blocking. v2.2 patches:

- **`has_permission()` API corrected to live signature.** Real shape is `has_permission(p_user_id uuid, p_permission text, p_required_scope text DEFAULT 'all')` per [075_has_permission_function.sql:52](OPS-Web/supabase/migrations/075_has_permission_function.sql:52). The third argument is a **scope string** (`'all' / 'assigned' / 'own'`), NOT a project ID. v2.1 invented a `has_permission(uid, key, project_id)` overload that doesn't exist. v2.2 uses the real helpers: `private.current_user_has_permission(key)` for binary checks, and two new helpers `private.current_user_can_edit_project(uuid)` / `private.current_user_can_assign_team_on_project(uuid)` for the per-project scoped checks (defined in Phase 1, modeled on the existing `private.current_user_can_view_project(uuid)` at [074_mention_based_project_access.sql:34](OPS-Web/supabase/migrations/074_mention_based_project_access.sql:34)).
- **Scoped permission would have denied assigned users.** `has_permission(uid, 'projects.assign_team')` defaults to `required_scope = 'all'` and returns false for users granted at `'assigned'` scope. v2.1's RPC gates would have silently denied every assigned-scope operator. v2.2's new helpers explicitly handle the `assigned` scope by checking team membership inline.
- **No `permissions` catalog table exists.** v2.1's Phase 1 migration said to insert into `public.permissions`. The real schema has only `roles`, `user_roles`, and `role_permissions` (with `permission` as plain text — [database.types.ts:8604](OPS-Web/src/lib/types/database.types.ts:8604)). v2.2 drops the catalog-insert step; only `role_permissions` rows are added.
- **`project_notes.event_kind` values weren't canonical.** v2.1 had the team RPCs insert `'team_assigned'` / `'team_removed'` rows. The canonical union at [project-note-service.ts:41](OPS-Web/src/lib/api/services/project-note-service.ts:41) does not include these. v2.2 removes the project_notes write from team RPCs (status changes still write canonical `'status_change'`). Adding `team_*` event kinds is a Phase 2 follow-up if we want team changes in the activity timeline.
- **Photo `uploaded_by` is required.** v2.1 said the client passes nothing and "RLS/default handles it." Reality at [database.types.ts:8094](OPS-Web/src/lib/types/database.types.ts:8094): `uploaded_by` is `string` (not nullable) and Insert requires it. v2.2's storage layer explicitly passes the resolved public `users.id` from `useAuthStore` or equivalent — same pattern existing project-create flows use.
- **SECURITY DEFINER RPCs need hardening.** v2.1 declared them in `public` without `SET search_path` or explicit grants. Existing hardened functions (e.g., [075_has_permission_function.sql:57–60](OPS-Web/supabase/migrations/075_has_permission_function.sql:57)) include `SET search_path = 'public', 'pg_temp'`, explicit `GRANT EXECUTE TO authenticated`, no dynamic SQL. v2.2 spec adds these hardening requirements to every RPC definition.

Plus four cleanups:
- v1 changelog (Section 0b) stale lines about "PascalCase status" and "`pg_trgm` requires extension migration" → marked superseded inline (corrected facts live in 0a/0.5).
- URL example uses lowercase DB values (`filter[status]=accepted`, not `Accepted`).
- Semantic overdue rule uses DB casing (`status NOT IN ('completed', 'closed')`, not PascalCase).
- Definition-of-Done test count synced to test plan (30 integration tests, not 25).

The architecture, view system, column catalog, visual layout, interactions, phasing, and overall direction are unchanged from v2.1. The deltas are all permission-API and minor cleanup corrections.

---

## 0c. Changelog from v2

v2 was reviewed again and rejected. The reviewer caught seven production-blocking issues plus three "also fix" items. All addressed below. Material changes from v2:

- **Project status casing corrected to DB reality.** Production stores `projects.status` as **lowercase/snake_case** (`'rfq'`, `'estimated'`, `'accepted'`, `'in_progress'`, `'completed'`, `'closed'`, `'archived'`) — verified at [project-service.ts:29–44](OPS-Web/src/lib/api/services/project-service.ts:29). The TypeScript `ProjectStatus` enum is PascalCase (`ProjectStatus.InProgress`) but only at the rendering boundary; every SQL/RLS/seed/filter uses the lowercase DB form. v2's PascalCase filters (`'In Progress'`, `'Closed'`) would have matched zero rows in production.
- **RLS/RPC identity resolution corrected.** OPS uses `private.get_current_user_id()` — not `auth.uid()` directly. The helper owns the auth-subject-to-`public.users.id` mapping; policies and RPCs must not restate its internals because live and migration history have differed here. v2's policies would have denied real authenticated users. Every policy and RPC in this spec uses the helper.
- **Permission scoping corrected.** `projects.assign_team` is a distinct permission key from `projects.edit` ([015_permissions_system.sql:19](OPS-Web/supabase/migrations/015_permissions_system.sql:19)). Operator role has `projects.edit` scoped to `'assigned'` only, not `'all'` ([015_permissions_system.sql:390–392](OPS-Web/supabase/migrations/015_permissions_system.sql:390)). v2's blanket `projects.edit` check would have over-permitted operators on projects they're not assigned to. v2.1 splits the RPCs: team cascade requires `projects.assign_team`; field updates check `has_permission(uid, 'projects.edit', project_id)` against assignment.
- **Generic `update_project_field` RPC removed.** v2's `update_project_field(field text, value jsonb)` SECURITY DEFINER function was too sharp. v2.1 replaces it with direct UPDATEs through PostgREST gated by scoped RLS — RLS does the permission enforcement; PostgREST's `Prefer: return=representation` returns the new `updated_at`. RPCs remain only for the genuinely atomic multi-table writes (team cascade, status change with notes-row, bulk operations).
- **Financial column gating made explicit in SQL.** v2 hand-waved "RLS on a security-invoker view" — that's not how it works; `security_invoker` respects underlying-table RLS but doesn't conditionally null columns based on permission. v2.1 wraps every financial aggregate in `CASE WHEN has_permission(private.get_current_user_id(), 'projects.view_financials', 'all') THEN <calc> ELSE NULL END` so unauthorized users receive explicit nulls (UI renders `—`), not misleading zeros.
- **`project_photos.source` enum value corrected.** Real enum is `'site_visit' | 'in_progress' | 'completion' | 'other'` ([database.types.ts:11408](OPS-Web/src/lib/types/database.types.ts:11408)). v2's `source = 'web'` would have raised an enum-violation error on every photo upload. v2.1 uses `'other'`.
- **`set_updated_at()` trigger function declared.** v2 referenced `public.set_updated_at()` without ever defining it. No matching global function exists in migrations; only per-table copies (e.g., `fn_email_campaigns_set_updated_at`). v2.1 adds a generic `public.fn_set_updated_at()` in the Phase 1 migration set and uses it for the `project_views` updated_at trigger.
- **`estimates.status` filter corrected.** Real won-value statuses are `'approved'` AND `'converted'` ([business-context-service.ts:327](OPS-Web/src/lib/api/services/business-context-service.ts:327)), not `'accepted'`. v2's `e.status = 'accepted'` would have returned zero estimate revenue (no estimates are stored with that value). v2.1 uses `IN ('approved', 'converted')`.
- **`pg_trgm` framing softened.** v2 claimed "not enabled" based on absent migration evidence; the reviewer reports the extension IS installed in live Supabase (likely added via the Supabase dashboard, outside the migrations directory). v2.1 corrects the rationale: search uses ILIKE for v1 as a deliberate simplicity choice; trigram is available if/when we want it in Phase 2 — no extension migration required.
- **Duplicate unique constraint removed.** v2 had both a column-level `UNIQUE (company_id, owner_type, owner_id, name)` AND a partial functional `(company_id, owner_type, owner_id, lower(name)) WHERE is_archived = false` index. The first blocked archived-name reuse. v2.1 keeps only the partial functional index — archived views don't block name reuse.

The phasing, architecture direction, view system shape, audit-finding coverage, and most of Sections 4–5 (visual + interaction) are unchanged from v2. The deltas are all schema/SQL/RLS/RPC corrections.

## 0d. Changelog from v1

> **Note:** entries in this section reflect the v2 worldview at the time of writing. Several facts below were later overturned in v2.1 / v2.2 (status casing was wrong; `pg_trgm` framing was wrong). The corrected facts live in Sections 0 / 0a / 0b / 0.5 — those supersede anything in 0d that conflicts.


v1 was reviewed by a senior-engineer over-the-shoulder pass and rejected for production safety. Every must-fix from that review is addressed below. Material changes:

- **Schema corrections.** Eight wrong-field references fixed: `clients.phone_number` (was `clients.phone`), `invoices.amount_paid` (was `paid_amount`), `project_photos` table (was legacy `projects.project_images` array), `expense_project_allocations` joined to `expenses` (was nonexistent `project_expenses`). Status casing fixed to PascalCase-with-space (`"In Progress"` not `"InProgress"`).
- **Optimistic-concurrency mechanism made explicit.** The "version tokens" handwave from v1 is replaced with `updated_at` as the if-match token, the standard Supabase pattern.
- **Team-cell write path replaced.** v1's client-side dual-write to `projects.team_member_ids` + `project_tasks.team_member_ids` is replaced with a single Postgres RPC `assign_project_team_member` / `remove_project_team_member` that does the work atomically and returns the fresh `updated_at`.
- **`project_views` RLS hardened.** Company isolation on every policy, `(company_id, owner_type, owner_id, lower(name))` unique constraint, JSONB size cap, explicit `WITH CHECK` clause forbidding non-admins from setting `permission_key` on their own views.
- **Status colors and pill semantics rewritten** to match the actual `PROJECT_STATUS_COLORS` map in `src/lib/types/models.ts`. The v1 mapping was wrong (e.g., v1 said `Completed = olive`; the real map says `Completed = rose`).
- **Accent discipline tightened.** Three more v1 leakages of `--ops-accent` onto non-CTA, non-focus surfaces removed.
- **i18n discipline added.** Every user-facing string flagged for the existing `projects.json` dictionary namespace under `table.*` sub-keys (which is the established OPS-Web convention).
- **Feature-flag rollout corrected.** The OPS-Web feature flag system is per-user (Zustand store, fed from `/api/feature-flags` at login). v1's "flag on per-company" assumption was wrong. Beta cohort is now "selected users at representative companies."
- **Search downgraded.** `pg_trgm` is not enabled on the production Supabase instance. v1 assumed trigram fuzzy match. v2 uses Postgres `ILIKE` substring matching for v1 of the redesign; trigram is Phase 2 (gated on an extension migration).
- **Analytics calls made concrete.** v1 said `useAnalytics()`. The real pattern is `analyticsService.track("action", "<event_name>", { ...props })`. v2 specifies the exact calls.
- **Implementation phasing added.** New Section 14 splits the work into six phases, each independently shippable behind its own sub-flag.
- **New dependencies declared explicitly.** `@tanstack/react-table` and `@tanstack/react-virtual` are not yet in `package.json` and need to be added. v2 calls this out and justifies the install.
- **Test plan additions.** RLS spoofing, duplicate view names, JSONB size cap, photo storage failure, status casing roundtrip, team-RPC concurrency under load, dictionary-key coverage.

## 0.5 Resolved blockers (verified, with citations)

| Item | Resolution | Citation |
|---|---|---|
| **`projects.status` DB casing** | **Lowercase/snake_case in DB:** `'rfq'`, `'estimated'`, `'accepted'`, `'in_progress'`, `'completed'`, `'closed'`, `'archived'`. TypeScript enum `ProjectStatus` is PascalCase at the rendering boundary only. Every SQL/RLS/seed/filter in this spec uses the lowercase DB form. | [project-service.ts:29–44](OPS-Web/src/lib/api/services/project-service.ts:29) (`serializeProjectStatus`) + verification grep in `business-context-service.ts:834` (`.in("status", ["rfq", "estimated", "accepted", "in_progress"])`) |
| `estimates.status` won-value filter | `IN ('approved', 'converted')`. Not `'accepted'`. | [business-context-service.ts:327, 696](OPS-Web/src/lib/api/services/business-context-service.ts:327) |
| Status colors | RFQ `#8F9AA3` · Estimated `#B6AC97` · Accepted `#9DB582` · In Progress `#D99A3E` · Completed `#B58289` · Closed `#8C6A57` · Archived `#4E4B48`. Imported from `PROJECT_STATUS_COLORS` map; never hardcoded in cell code. | [src/lib/types/models.ts:81–89](OPS-Web/src/lib/types/models.ts:81) |
| **Auth identity resolver** | **`private.get_current_user_id()`** — SECURITY DEFINER helper that resolves the current authenticated subject to `public.users.id`. Every RLS policy and every SECURITY DEFINER RPC in this spec uses this helper, NOT `auth.uid()` directly. Do not restate the helper's internals in new policies. | [015_permissions_system.sql:89](OPS-Web/supabase/migrations/015_permissions_system.sql:89) |
| **`has_permission` real signature** | `public.has_permission(p_user_id uuid, p_permission text, p_required_scope text DEFAULT 'all')`. Third arg is a SCOPE STRING (`'all' / 'assigned' / 'own'`), NOT a project ID. Defaulting to `'all'` means a user with `'assigned'`-scope grant returns FALSE for the default call. Use scope `'assigned'` explicitly to satisfy assigned-scope grants. | [075_has_permission_function.sql:52–60](OPS-Web/supabase/migrations/075_has_permission_function.sql:52) |
| **Existing private permission helpers** | `private.current_user_has_permission(perm app_permission)` — binary wrapper, calls `has_permission(uid, perm)` with default scope. `private.current_user_can_view_project(p_project_id uuid)` — combines view permission + mention-based access. This spec adds two analogous helpers: `current_user_can_edit_project(uuid)` and `current_user_can_assign_team_on_project(uuid)`, after replacing `current_user_in_project(uuid)` with the active-row version. | [016_permission_rls_policies.sql:25](OPS-Web/supabase/migrations/016_permission_rls_policies.sql:25), [074_mention_based_project_access.sql:34](OPS-Web/supabase/migrations/074_mention_based_project_access.sql:34) |
| **Project permission keys (existing)** | `projects.view`, `projects.create`, `projects.edit`, `projects.delete`, `projects.archive`, `projects.assign_team`. Scope is `'all'` or `'assigned'` per role. Operator role has `projects.edit` scoped to `'assigned'` only. | [015_permissions_system.sql:18–19, 390–392](OPS-Web/supabase/migrations/015_permissions_system.sql:18) |
| **No `permissions` catalog table** | Only `roles`, `user_roles`, `role_permissions`. The `role_permissions.permission` column is plain text — no FK to a catalog. New permission keys are added by inserting `role_permissions` rows for the relevant roles; no catalog row is needed. | [database.types.ts:8604](OPS-Web/src/lib/types/database.types.ts:8604) |
| New permission keys (this spec adds) | `projects.view_financials`, `projects.manage_views`. Added via `role_permissions` inserts only — no catalog table involved. | (this spec) |
| Expenses cost path | `expense_project_allocations` (`expense_id`, `project_id`, `percentage`, `amount` nullable) → `expenses` (`status` ∈ `submitted`/`approved`/`rejected`). Use `coalesce(epa.amount, e.amount * epa.percentage / 100.0)` for the cost contribution. | [database.types.ts:5171, 5239](OPS-Web/src/lib/types/database.types.ts:5171) |
| **`project_photos.source` enum** | **`'site_visit' \| 'in_progress' \| 'completion' \| 'other'`**. New uploads from the web table use `'other'` (NOT `'web'` — that value does not exist in the enum). | [database.types.ts:11408](OPS-Web/src/lib/types/database.types.ts:11408) |
| `project_photos` schema | One row per photo: `id`, `project_id`, `url`, `thumbnail_url`, `uploaded_by`, `taken_at`, `caption`, `is_client_visible`, `source` (see above), `site_visit_id`, `company_id`, `created_at`, `deleted_at`. | [database.types.ts:8081–8127](OPS-Web/src/lib/types/database.types.ts:8081) |
| **Trigger function for `updated_at`** | **No generic `public.set_updated_at()` exists in migrations.** Each table that uses one declares its own (e.g., `fn_email_campaigns_set_updated_at`). Phase 1 migration creates `public.fn_set_updated_at()` as a generic helper and uses it for `project_views`. | (verified absent in `supabase/migrations/`) |
| Analytics | `analyticsService.track("action" \| "screen_view", "<event_name>", { ...props }, durationMs?)` — direct service call, not a React hook. | [src/lib/analytics/analytics-service.ts:75–107](OPS-Web/src/lib/analytics/analytics-service.ts:75) |
| Feature flags | Per-user store; `useFeatureFlagsStore().canAccessFeature(slug)`. No per-company override exists today. Per-company enable is achieved via admin script that toggles all users in that company. | [src/lib/store/feature-flags-store.ts](OPS-Web/src/lib/store/feature-flags-store.ts) |
| **`pg_trgm` status** | **Not present in `supabase/migrations/` but reportedly installed in live Supabase (likely via dashboard).** This spec uses Postgres `ILIKE` for v1 search as a deliberate simplicity choice. Trigram is available for Phase 2 search optimization without an extension migration. | (verified absent in migrations; live presence per external review) |
| Team canonicality | `projects.team_member_ids` is the table-display read source and a denormalized cache of non-deleted `project_tasks.team_member_ids`. Phase 1 backfills and adds a `project_tasks` trigger so every task assignment mutation recomputes the project cache. `task_team_members` exists but is empty/dead for this workflow; the RPCs do NOT write it. | [assignment-service.ts:92–96](OPS-Web/src/lib/api/services/assignment-service.ts:92), [database.types.ts:9595](OPS-Web/src/lib/types/database.types.ts:9595) |
| Notification helpers | `dispatchProjectAssignment`, `dispatchProjectStatusChange`, `dispatchProjectArchived`, `dispatchMentionPush` — typed, fire-and-forget. | [src/lib/api/services/notification-dispatch.ts](OPS-Web/src/lib/api/services/notification-dispatch.ts) |
| TanStack libs | `@tanstack/react-table` and `@tanstack/react-virtual` **not installed.** This spec adds both. | [package.json](OPS-Web/package.json) |
| i18n namespace | Existing `dictionaries/en/projects.json` uses `table.*` sub-keys. All new strings extend that file (+ matching `es/projects.json`). | [src/i18n/dictionaries/en/projects.json](OPS-Web/src/i18n/dictionaries/en/projects.json) |
| Below-768px policy | Not supported. Below 768px width the route renders `// USE OPS ON IPAD OR LARGER` with deep-link to iOS app. | Brainstorm Q4 |

## 1. Problem statement

The current Projects tab Spreadsheet (Table) view feels glitchy and is not laid out intuitively. The audit identified eight concrete issues:

1. Zero responsiveness — every column has hardcoded pixel widths; iPad portrait is effectively unusable.
2. No row virtualization — all rows render to the DOM; performance degrades past ~200 projects.
3. Sticky header can desync with the scrolling container on some browsers.
4. Row selection persists across filter changes — bulk-archive can hit the wrong projects.
5. Hardcoded `rgba(255,255,255,0.06)` inline color values that don't trace to the design system.
6. No empty states, loading skeletons, or undo affordance.
7. No keyboard navigation between cells — the spreadsheet model is broken without it.
8. Action menu doesn't close on horizontal scroll, creating z-order confusion.

Architecturally, the current implementation is one 877-line page wrapping one 619-line spreadsheet component owning nine concerns. This redesign splits responsibilities into layers, replaces the spreadsheet with an Airtable-class table, and ships saved views, full inline editing, keyboard navigation, optimistic updates with undo, responsive frozen-left + horizontal scroll, and pinch-to-zoom density. The Kanban Canvas view and the project workspace floating window are unchanged.

Bible references — keep current:
- `ops-software-bible/02_USER_EXPERIENCE_AND_WORKFLOWS.md` § Project lifecycle
- `ops-software-bible/09_FINANCIAL_SYSTEM.md` (margin/cost basis)
- `ops-software-bible/10_JOB_LIFECYCLE_AND_DATA_RELATIONSHIPS.md` (task/project relationships)

## 2. Product decisions (from brainstorming)

1. **View presets** — three default views ship; users create their own. Inspired by Airtable/Linear/Notion.
2. **Full inline editing** — Airtable model. Cascading popovers for fields with logic (team membership).
3. **Row interaction model** — click cell edits; checkbox column on the left for selection (Shift = range, Cmd/Ctrl = toggle); hover row reveals an expand-to-detail chevron at the row's left edge.
4. **Responsive strategy** — frozen-left + horizontal scroll always. Same table at every size from iPad portrait (~810px) to desktop. No card-mode collapse.
5. **Pinch-to-zoom** — adjusts density (font + row height + min-widths together), not a visual scale transform.
6. **Saved views** — three seeded company views. User-defined are personal; "Share with team" promotes to a company view (requires `projects.manage_views`).
7. **Save model** — pure optimistic with clear failure recovery, persistent undo toast, Cmd+Z, conflict detection via `updated_at` if-match.

## 3. Architecture

Seven concrete layers plus one new RPC layer (v2 addition for the team-cell atomic write).

### 3.1 Data layer

`useProjectsTableData(viewId)` hook. Takes the active view's filter/sort definition, queries Supabase, returns table-ready rows from the Postgres view `project_table_rows` (Section 7.1). Owns pagination (200 rows initial, infinite-scroll thereafter) and freshness (30s polling + refocus invalidation).

**Financial column gating mechanism:** the view's currency columns (`estimate_total`, `invoice_total`, `paid_total`, `value`, `margin`, `project_cost`) are each wrapped in a `CASE WHEN has_permission(private.get_current_user_id(), 'projects.view_financials', 'all') THEN <calc> ELSE NULL END` at the view level. Unauthorized users see explicit nulls (UI renders `—`), not misleading zeros. This is enforced at the SQL view, not at the client — operators can't bypass it by editing query options.

No table knowledge. Same hook could feed Kanban or a CSV export.

### 3.2 View layer

`useProjectView(viewId)` hook. Reads/writes the new `project_views` table (Section 6). Handles the three seeded default views plus user-created. Returns the resolved effective definition after URL overrides and session tweaks are layered on top.

### 3.3 Selection layer

`useTableSelection()` hook. Holds `Set<projectId>`. Subscribes to current visible row set and **prunes selected IDs that drop out of the result set** on every change — fixes audit finding #4. Session-local; cleared on view switch and page reload.

### 3.4 Edit layer

`useCellEdit()` hook. Optimistic queue, per-cell state machine, undo stack (50 entries, in-memory only), retry policy (one retry after 2s, then fail), conflict resolution via `updated_at` if-match (Section 5.5).

### 3.5 RPC layer (atomic multi-table writes only)

v2.1 narrowed the RPC layer to operations that genuinely require atomic multi-table writes. **Single-field updates do NOT go through RPCs** — they use direct PostgREST `UPDATE` calls with `Prefer: return=representation` to get the new `updated_at` back. RLS enforces permissions; PostgREST handles optimistic concurrency via the `If-Match` semantics on `updated_at`. This is simpler, more secure, and matches the standard Supabase pattern.

#### 3.5.1 Private permission helpers (Phase 1 migration adds/replaces)

The canonical primitives already exist in production:
- `private.current_user_is_admin()` — admin/account-holder bypass.
- `private.current_user_scope_for(p_permission)` — returns `'all'`, `'assigned'`, `'own'`, or null for the calling user's grant on that permission.
- `private.current_user_in_project(p_project_id uuid)` — returns true if the calling user is on the same-company project's team (covers both `projects.team_member_ids` and per-task assignment with correct text-typed array handling). Used by all WRITE policies on the projects domain.

Phase 1 first **replaces** `private.current_user_in_project` so it ignores deleted rows and enforces the company boundary internally. Live Supabase currently counts deleted tasks, which can incorrectly satisfy assigned-scope write access. Replacement SQL:

```sql
create or replace function private.current_user_in_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public', 'pg_temp'
as $$
  select exists (
    select 1
    from public.projects p
    where p.id = p_project_id
      and p.deleted_at is null
      and p.company_id = (select private.get_user_company_id())
      and private.get_current_user_id()::text = any(coalesce(p.team_member_ids, array[]::text[]))
  ) or exists (
    select 1
    from public.project_tasks pt
    join public.projects p on p.id = pt.project_id
    where pt.project_id = p_project_id
      and pt.deleted_at is null
      and p.deleted_at is null
      and p.company_id = (select private.get_user_company_id())
      and private.get_current_user_id()::text = any(coalesce(pt.team_member_ids, array[]::text[]))
  );
$$;
```

The pattern is established at [20260506120100_project_tags.sql:96–100](OPS-Web/supabase/migrations/20260506120100_project_tags.sql:96):

```sql
private.current_user_is_admin()
OR private.current_user_scope_for('projects.edit') = 'all'
OR (
  private.current_user_scope_for('projects.edit') = 'assigned'
  AND private.current_user_in_project(p_project_id)
)
```

v2.4's two new helpers compose this active-row pattern and include their own company isolation because the public `SECURITY DEFINER` RPCs bypass table RLS. SQL:

```sql
create or replace function private.current_user_can_edit_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public', 'pg_temp'
as $$
  select exists (
    select 1
    from public.projects p
    where p.id = p_project_id
      and p.deleted_at is null
      and p.company_id = (select private.get_user_company_id())
  ) and (
    private.current_user_is_admin()
    or private.current_user_scope_for('projects.edit') = 'all'
    or (
      private.current_user_scope_for('projects.edit') = 'assigned'
      and private.current_user_in_project(p_project_id)
    )
  );
$$;

grant execute on function private.current_user_can_edit_project(uuid) to authenticated;

create or replace function private.current_user_can_assign_team_on_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public', 'pg_temp'
as $$
  select exists (
    select 1
    from public.projects p
    where p.id = p_project_id
      and p.deleted_at is null
      and p.company_id = (select private.get_user_company_id())
  ) and (
    private.current_user_is_admin()
    or private.current_user_scope_for('projects.assign_team') = 'all'
    or (
      private.current_user_scope_for('projects.assign_team') = 'assigned'
      and private.current_user_in_project(p_project_id)
    )
  );
$$;

grant execute on function private.current_user_can_assign_team_on_project(uuid) to authenticated;
```

Both new helpers are `LANGUAGE sql` (cheaper than plpgsql for a single-expression composition), `STABLE` (memoizable within a query), `SECURITY DEFINER` with locked `search_path`, and granted only to `authenticated`. Neither inlines a raw `ANY(team_member_ids)` check — that's `current_user_in_project`'s job, and it handles the `string[]` typing, deleted-row exclusion, and company boundary correctly.

#### 3.5.2 The three RPCs

All three are `SECURITY DEFINER`, defined in `public` schema, with the following standard hardening (matching the pattern in [075_has_permission_function.sql:57–60](OPS-Web/supabase/migrations/075_has_permission_function.sql:57)):
- `LANGUAGE plpgsql`
- `SECURITY DEFINER`
- `SET search_path = 'public', 'pg_temp'` (prevents schema-shadow attacks)
- No dynamic SQL (no `EXECUTE`)
- Explicit `GRANT EXECUTE … TO authenticated`
- Deterministic exception codes: `P0001` for conflict, `42501` for permission denied, `22023` for invalid argument (e.g., unknown status value).

The three:

- **`change_project_status(p_project_id uuid, p_new_status text, p_expected_updated_at timestamptz) RETURNS jsonb`**
  - Permission check: `IF NOT private.current_user_can_edit_project(p_project_id) THEN RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501'; END IF;`
  - Validates `p_new_status` against allowlist of seven DB-cased values (`'rfq'`, `'estimated'`, `'accepted'`, `'in_progress'`, `'completed'`, `'closed'`, `'archived'`). Anything else raises `'22023'`.
  - Updates `projects` row WHERE `id = p_project_id AND updated_at = p_expected_updated_at`. If no rows updated, raises `'P0001'`.
  - Inserts a `project_notes` row with `event_kind = 'status_change'` (canonical kind — [project-note-service.ts:41](OPS-Web/src/lib/api/services/project-note-service.ts:41)), `content` summarizing the transition, `content_metadata` capturing `{from: <old>, to: <new>}`, `author_id = private.get_current_user_id()`.
  - Returns `{ updated_at: <new>, from_status: <old>, to_status: <new> }`.

- **`assign_project_team_member(p_project_id uuid, p_user_id uuid, p_task_ids uuid[], p_expected_updated_at timestamptz) RETURNS jsonb`**
  - **Input validation (raises `'22023'` on any mismatch — must happen BEFORE any write because this is SECURITY DEFINER):**
    1. `p_user_id IS NOT NULL` and `p_project_id IS NOT NULL`.
    2. `p_user_id` exists in `public.users` with `deleted_at IS NULL`.
    3. `p_user_id`'s `company_id` equals the project's `company_id` (no cross-company assignment).
    4. `p_task_ids` is non-empty AND every element references a `project_tasks` row where `project_id = p_project_id` AND `deleted_at IS NULL`. The canonical rule (Section 3.5.2.1 below) requires at least one task — the client never calls this RPC with an empty array.
  - Permission check: `IF NOT private.current_user_can_assign_team_on_project(p_project_id) THEN RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501'; END IF;`
  - Locks the project row first: `SELECT updated_at FROM public.projects WHERE id = p_project_id AND deleted_at IS NULL FOR UPDATE`. If no row exists or `updated_at <> p_expected_updated_at`, raises `'P0001'` before task mutation.
  - For each task in `p_task_ids`: idempotently appends `p_user_id::text` to `project_tasks.team_member_ids` (no-op if already present; the array is `text[]`).
  - The Phase 1 `project_tasks` trigger recomputes `projects.team_member_ids` as the deduplicated union of every team_member_id appearing on any non-deleted task of this project, and bumps `projects.updated_at` only when the cache changes.
  - **Does NOT write to `project_notes`** — `'team_assigned'` is not a canonical `event_kind`. The notification rail entry (via client-side `dispatchProjectAssignment`) is the user-visible signal in v1.
  - Returns `{ updated_at: <new>, team_member_ids: <new array> }`.

- **`remove_project_team_member(p_project_id uuid, p_user_id uuid, p_task_ids uuid[] DEFAULT NULL, p_expected_updated_at timestamptz) RETURNS jsonb`**
  - **Input validation (raises `'22023'`):**
    1. `p_user_id IS NOT NULL` and `p_project_id IS NOT NULL`.
    2. `p_user_id` exists in `public.users` with `deleted_at IS NULL`. (Cross-company check intentionally skipped on remove — removing a user who's somehow in the array but no longer in the company is still desirable.)
    3. If `p_task_ids IS NOT NULL`: every element references a `project_tasks` row where `project_id = p_project_id` AND `deleted_at IS NULL`.
  - Permission check via `private.current_user_can_assign_team_on_project`.
  - Locks the project row first and checks `p_expected_updated_at` using the same `FOR UPDATE` pattern as assign. Conflict raises `'P0001'` before task mutation.
  - If `p_task_ids IS NULL`: removes `p_user_id::text` from every non-deleted task on the project. Otherwise: removes from each task in `p_task_ids`.
  - The Phase 1 `project_tasks` trigger recomputes `projects.team_member_ids` after the task updates.
  - Does NOT write to `project_notes` (same reason).
  - Returns `{ updated_at: <new>, team_member_ids: <new array> }`.

##### 3.5.2.1 Canonical team-membership rule

**`projects.team_member_ids` is ALWAYS exactly the deduplicated union of every non-deleted task's `team_member_ids` on the project.** There are no free-floating direct project-level assignments. The column is a denormalized cache of the task-level truth, maintained at the database layer by a Phase 1 trigger on `project_tasks`.

Consequences:
- Adding a team member to a project always requires at least one task to assign them to. The team-cell cascade popover surfaces this clearly: if the project has zero tasks, the secondary popover forces creation of a first task as part of the add flow (see Section 5.4 edge case below).
- Removing a member is trivially correct — recompute from remaining task assignees, no special cases.
- Phase 1 adds private trigger helpers `private.recompute_project_team_member_ids(p_project_id uuid)` plus `private.sync_project_team_member_ids_from_tasks()` and an `AFTER INSERT OR DELETE OR UPDATE OF team_member_ids, deleted_at, project_id ON public.project_tasks` trigger. The trigger recomputes both `OLD.project_id` and `NEW.project_id` when a task moves projects, and updates `projects.updated_at` only when the effective cache changes. These are private-schema `SECURITY DEFINER` helpers with locked `search_path`, not exposed public RPCs.
- Phase 1 also runs a one-time backfill across all non-deleted projects before the trigger is enabled. The migration logs the pre-backfill mismatch count and verifies post-backfill zero mismatches.
- Existing non-table code paths may continue to mutate `project_tasks.team_member_ids` directly; the trigger preserves the invariant. New table UI team changes still use the RPCs for validation, permission checks, optimistic concurrency, and notification discipline.

The client distinguishes the three exception codes and renders accordingly: `P0001` → conflict overlay; `42501` → read-only toast; `22023` → validation toast.

#### 3.5.3 Scoped permission semantics — bootstrap & edge cases

`projects.assign_team` with `'assigned'` scope means "you can change team on projects you're already on." Operator role gets `projects.edit:assigned` and `projects.assign_team:assigned` by default. Owner/Admin roles get `'all'` scope on every project permission ([015_permissions_system.sql:222–227, 311–315](OPS-Web/supabase/migrations/015_permissions_system.sql:222)) — they're never gated by team membership, but they remain company-scoped.

Bootstrap problem: an Operator can't add themselves to a project they're not on. That's by design — Operators need an Admin/Owner to put them on a project before they have edit/assign rights to it. Future Phase 2 work could add an "invite-to-project" flow with explicit Admin approval, but that's out of scope for the table redesign.

#### 3.5.4 Single-field edits (no RPC)

All other editable columns (`name`, `address`, `start_date`, `end_date`, `duration`, `trade`, `notes`) use direct PostgREST UPDATEs from the client:

```ts
const { data, error } = await supabase
  .from('projects')
  .update({ [field]: value })
  .eq('id', projectId)
  .eq('updated_at', expectedUpdatedAt)   // optimistic concurrency
  .select('updated_at')                   // get new ts back
  .single();
```

RLS enforces scoped `projects.edit` permission on the row via the existing permission policies. The `.eq('updated_at', expectedUpdatedAt)` clause makes the update no-op on conflict (rows affected = 0); the client detects this and triggers the conflict overlay.

**RLS policy for `projects` UPDATE** is currently broad (company isolation + `projects.edit` permission via `private.current_user_has_permission`). For scoped enforcement of `assigned`-scope edits on the table redesign, Phase 1 migration replaces it with a refined policy that wraps the per-row check through `private.current_user_can_edit_project(id)`. This replacement **must be `AS RESTRICTIVE`** because live Supabase has a permissive `company_isolation` policy; recreating `role_scope_update` as default permissive would create an `OR` with company isolation and grant same-company writes. The migration verifies `pg_policy.polpermissive = false` for `projects.role_scope_update`.

### 3.6 Storage layer

`useCellImageUpload()` hook for the `photos` cell. Upload to Supabase Storage at `project-photos/<company_id>/<project_id>/<uuid>.<ext>` with `cacheControl: '3600', upsert: false`. On success, insert into `project_photos` with the following fields:

- `project_id` — current row's id
- `company_id` — resolved from current user's session (existing pattern)
- `url` — Storage public/signed URL of the upload
- `thumbnail_url` — generated via a Storage transform (or `null` if transform unavailable; the photo cell handles either)
- `uploaded_by` — **required (`string`, not nullable per [database.types.ts:8094](OPS-Web/src/lib/types/database.types.ts:8094)).** The client resolves this from `useAuthStore`'s current user record (the public `users.id`) and passes it explicitly. v2.1's claim that "RLS/default handles it" was wrong.
- `taken_at` — EXIF datetime if present in upload metadata; otherwise `now()`
- `source` — **`'other'`** (the v2 value `'web'` is NOT in the `photo_source` enum — real values are `'site_visit' | 'in_progress' | 'completion' | 'other'`)
- `is_client_visible` — `false` by default (operator can flip in the photo popover)

On upload failure: Storage error → toast with retry; no insert attempted, no orphan row. On insert failure (RLS denial, FK violation): the uploaded Storage blob is purged inline via `supabase.storage.from('project-photos').remove([path])` so no orphan blob remains. Soft-delete (sets `deleted_at`) when removed from the gallery; the Storage blob purge for soft-deletes is handled by the existing nightly cleanup job (verify path during implementation).

### 3.7 Layout layer

`ProjectsTable`. Renders the table shell. Built on:

- **TanStack Table** (`@tanstack/react-table@^8.21`) — headless column model, sort, visibility. **New dependency.**
- **TanStack Virtual** (`@tanstack/react-virtual@^3.13`) — row virtualization. **New dependency.**

Both are Apache-2.0, ~30KB gzipped each. Standard headless table stack used by Linear, Cal.com, Resend. The alternative (AG Grid, react-data-grid) ships its own styling that would fight the OPS design system.

### 3.8 Cell layer

One file per cell type, eleven total (Section 7). Each takes `value, isEditing, onStartEdit, onCommit, onCancel`. None know the table around them exists.

### 3.9 Detail layer

Out of scope. Click the row's hover-chevron → `useWindowStore.openProjectWindow({ projectId, mode: 'viewing' })`. Existing detail panel renders.

### 3.10 Data flow — a single status edit

When an operator changes status from Estimated to Accepted:

1. Cell layer sets `isEditing = true`, shows status popover (options labeled via `ProjectStatus` enum, written to DB as lowercase).
2. Operator picks "Accepted"; cell calls `onCommit('accepted')` (DB value).
3. Edit layer pushes previous value to undo stack, applies new value to TanStack Query cache optimistically, fires RPC `change_project_status(project_id, 'accepted', expected_updated_at)`, sets cell to `saving`, displays undo toast.
4. RPC validates `'accepted'` against allowlist, checks scoped `projects.edit` permission, performs UPDATE inside an explicit transaction, inserts `project_notes` row with `event_kind = 'status_change'`, returns `{ updated_at: <new>, from_status: 'estimated', to_status: 'accepted' }`.
5. Cell flashes `saved` (olive bottom border, 1s), then `idle`. Cache merges new `updated_at` so subsequent edits use the fresh token.
6. Aggregate queries invalidate via `queryClient.invalidateQueries`.
7. Client-side: `dispatchProjectStatusChange({ projectId, projectTitle, fromStatus: 'estimated', toStatus: 'accepted', changedByName, recipientUserIds, companyId })`.
8. `analyticsService.track("action", "project_table_cell_committed", { column_id: "status", from: "estimated", to: "accepted", latency_ms: <measured>, project_id })`.

For a single-field edit on a non-status column (e.g., `address`), step 3 fires a direct PostgREST UPDATE with `If-Match` semantics on `updated_at` instead of the RPC. Steps 4–8 are otherwise identical except no `project_notes` row is inserted (text edits don't appear in the activity timeline by design).

Failure path: cell reverts, bottom border flips `rose` for 4s, toast surfaces `// COULDN'T SAVE — Retry / Discard` (i18n key `projects.table.cellError.save`). Conflict path: cell flips `tan`, overlay appears (Section 5.5).

### 3.11 Performance budget

| Metric | Target |
|---|---|
| First contentful paint | < 400ms |
| TTI (200 rows, 4G) | < 1.0s |
| Scroll FPS at 1000 rows | 60fps |
| Edit-to-screen latency | < 50ms |
| Save latency p95 | < 600ms (RPC adds ~50ms over direct UPDATE) |
| Memory ceiling at 5000 rows | < 200MB |
| LCP | < 1.0s |
| INP p95 | < 200ms |
| CLS | 0 |

### 3.12 Data freshness

- **Operator's edits** — optimistic, instant.
- **Other users' edits** — 30s polling + on tab refocus.
- **Aggregate metrics** — invalidated on related mutation via `queryClient.invalidateQueries(...)`.

### 3.13 State placement

| State | Lives in | Why |
|---|---|---|
| Current view ID | URL `?view=<id>` | Shareable, refresh-safe |
| View definitions | `project_views` Supabase table | Cross-device |
| Filter/sort overrides on top of view | URL query params | Shareable layered filters |
| Selected row IDs | React state (`useTableSelection`) | Session-local; clears on filter/view change |
| Active cell-edit | React state in `ProjectsTable` | One cell at a time |
| Optimistic edits in flight | TanStack Query cache | Standard pattern |
| Undo stack | React state in `useCellEdit` | In-memory; clears on reload (intentional) |
| Density / zoom | View definition | Persists per view |
| Column widths after drag-resize | View definition | Persists per view, per user |

## 4. Visual layout

Every value below traces to `ops-design-system/project/colors_and_type.css`, `OPS-Web/CLAUDE.md` v2 spec, or `src/lib/types/models.ts` (status colors). No bare rgba in this section.

### 4.1 Container

`.glass-surface` per OPS-Web v2 spec — `rgba(18, 18, 20, 0.58)` + `backdrop-filter: blur(28px) saturate(1.3)` + `1px solid rgba(255, 255, 255, 0.09)`. **These are spec-canonical values from `OPS-Web/CLAUDE.md` — not "hardcoded rgba." If/when these are tokenized into CSS variables in `ops-design-system/colors_and_type.css`, the table consumes the variable.** Outer radius `10px` (panel — v2 spec).

### 4.2 Toolbar (48px)

- Left: active view name in `.t-section` (Cake Mono Light 18px uppercase, `--text`). String: `dict("projects").views[<viewId>].name` or the user-set name from `project_views.name`.
- Right: search input, filter chips, density selector, ghost `+ New view`, primary `+ New project`.
- `+ New project` is the only primary-accent element on screen at rest (steel-blue outline; fills on hover — `.btn-primary` from OPS-Web design system).
- Bottom: 1px `var(--line)` separator.

### 4.3 View tabs (40px)

- Tab content: optional icon + name in `.t-btn` (Cake Mono Light 14px uppercase).
- **Active indicator:** 1px solid `var(--text)` underline (white — NOT accent per v2 discipline).
- **Inactive:** `var(--text-3)`.
- **Unsaved-dot:** 4px circle `var(--text-2)` when session diverges from saved config.
- Permission-gated tabs (`projects.view_financials` for Financial Overview) hidden if operator lacks the permission.
- Overflow → `+N more ▾`. Active tab always visible.
- Tab drag-reorder via `@dnd-kit/core` (existing).
- Bottom: 1px `var(--line)`.

### 4.4 Frozen-left zone

Three sub-cells, always pinned:

1. **Row handle (32px)** — Checkbox (14×14, `5px` radius (btn — v2), `var(--line)` border at rest, fills `var(--ops-accent)` when checked — checkbox check states are an allowed accent use per the v2 spec because the state is "this is what you'll act on next"). Expand-chevron (Lucide `chevron-right`, 14px, 1.5px stroke) appears on row hover.
2. **Status pill (96px fixed)** — 8px-height pill with the exact `PROJECT_STATUS_COLORS` from `src/lib/types/models.ts`:

   | Status | Pill color | Source token |
   |---|---|---|
   | RFQ | `#8F9AA3` | `PROJECT_STATUS_COLORS.RFQ` |
   | Estimated | `#B6AC97` | `PROJECT_STATUS_COLORS.Estimated` |
   | Accepted | `#9DB582` | `PROJECT_STATUS_COLORS.Accepted` |
   | In Progress | `#D99A3E` | `PROJECT_STATUS_COLORS["In Progress"]` |
   | Completed | `#B58289` | `PROJECT_STATUS_COLORS.Completed` |
   | Closed | `#8C6A57` | `PROJECT_STATUS_COLORS.Closed` |
   | Archived | `#4E4B48` | `PROJECT_STATUS_COLORS.Archived` |

   The colors above are **not direct hardcodes in cell code**. The cell imports `PROJECT_STATUS_COLORS` and looks the color up by the project's status value. Single source of truth.

3. **Project name (resizable; min 200 / default 280 / max 480)** — `var(--font-mohave)` 14px `var(--text)`. At Comfortable+ density, second line shows client name in `.t-metadata` `var(--text-3)`. Ellipsis truncation + 600ms-delay tooltip.

**Frozen-zone right-edge shadow** — 1px `var(--line)` divider. When `scrollLeft > 0`, an 8px gradient appears: `linear-gradient(to right, rgba(0,0,0,0.4), transparent)`. 200ms `EASE_SMOOTH` fade. On iPad portrait, the shadow's first stop deepens to `rgba(0,0,0,0.55)`.

### 4.5 Selected-row indication

Row background `var(--surface-active)` (`rgba(255, 255, 255, 0.08)` — spec-canonical surface token from `colors_and_type.css`). Left edge: 1.5px solid `var(--text)` bar (white, NOT accent — v2 discipline).

### 4.6 Density modes & pinch zoom

| Density | Row height | Cell V-padding | Font scale | Avatar size |
|---|---|---|---|---|
| Compact | 32px | 6px | 100% (13px body) | 20px |
| Comfortable *(default)* | 40px | 8px | 100% (14px body) | 24px |
| Spacious | 56px | 14px | 105% (15px body) | 28px |

**Pinch maps `z ∈ [0.75, 1.5]` to `row_height = clamp(32, 44 * z, 64)`.** Snaps to nearest named density on gesture end. Persisted to view definition's `density` + `zoom_level`.

- macOS trackpad: `wheel` event with `ctrlKey: true`.
- iPad Safari: capture `gesturestart`/`gesturechange`/`gestureend` on table container with `preventDefault`. iPadOS 17+ requires non-passive listener.
- Keyboard: `Cmd++` / `Cmd+-` / `Cmd+0` when focus is in table.

### 4.7 Truncation rules (Compact density + long content)

For project names ≥ 40 characters at Compact:
- Cell shows ellipsis at right edge.
- 600ms-delay tooltip shows full name on hover.
- On focus, the cell expands to show full name as an absolutely-positioned overlay (same width as the column, but height grows to accommodate up to 3 lines), constrained to the row's vertical bounds via `overflow: visible` on the cell. Restored on blur.

### 4.8 iPad portrait (768–1024px)

1. Toolbar wraps to two lines.
2. View tabs become horizontally scrolling strip with edge fades.
3. Frozen-left: handle 32 + status 96 + name 220 (200 min preserved) = ~348px / 810px ≈ 43%. Operator sees 2–3 data columns before swiping.
4. Frozen-zone shadow deepens (`0.55` first stop).
5. Native iOS momentum on horizontal swipe.

Below 768px: route renders `dict("projects").table.ipadOrLargerMessage` — `// USE OPS ON IPAD OR LARGER` — with deep link to iOS app.

### 4.9 Loading, empty, error

All copy strings are dictionary keys. OPS-Web's `useDictionary()` resolves flat keys (`dict[key]`), so these are top-level string entries in `dictionaries/en/projects.json`, not nested JSON objects:

```json
{
  "table.loading.skeleton": "",
  "table.loading.refetching": "// SYNCING PROJECTS",
  "table.empty.filteredTitle": "// NO PROJECTS MATCH",
  "table.empty.filteredBody": "Adjust filters or create a new project.",
  "table.empty.allTitle": "// NO PROJECTS YET",
  "table.empty.allBody": "Create the first project. Start tracking the work.",
  "table.empty.ipadOrLargerMessage": "// USE OPS ON IPAD OR LARGER",
  "table.error.title": "Couldn't load projects.",
  "table.error.retry": "Retry",
  "table.error.saveFailed": "Couldn't save {column} on \"{project}\"",
  "table.error.saveFailedRetry": "Retry",
  "table.error.saveFailedDiscard": "Discard",
  "table.error.readOnly": "// READ-ONLY - no edit permission",
  "table.views.newView": "+ New view",
  "table.views.unavailable": "// VIEW UNAVAILABLE",
  "table.cell.team.title": "// TEAM - {project}",
  "table.cell.currency.hidden": "—",
  "table.undo.toastTitle": "// CHANGE SAVED",
  "table.undo.action": "Undo",
  "table.conflict.title": "// {author} UPDATED THIS {ago}"
}
```

Mirror in `dictionaries/es/projects.json`. All UI strings in this spec are dictionary-backed — no hardcoded English in component code.

**Skeleton:** Shell renders <100ms. Eight skeleton rows. Each cell: `var(--fill-neutral-dim)` rect 16px tall, width 40–80% of column, 1400ms shimmer (paused under `prefers-reduced-motion: reduce`). Replace in-place — no layout shift.

**Refetch:** Existing rows 60% opacity + 1px `var(--text-2)` progress bar across top. Replace in-place.

**Empty (filter zero):** Centered, `.t-section` title from `table.emptyFiltered.title`, `.t-body-2` body from `table.emptyFiltered.body`, `+ New project` primary button.

**Empty (zero projects ever):** Different copy keys (`table.emptyAll.*`).

**Error:** Single error row. Title from `table.error.title`. `.btn-secondary` retry button. `.t-metadata` shows error code if present.

### 4.10 Scrollbars

Custom-styled. Track transparent; `var(--fill-neutral-dim)` on hover. Thumb `var(--fill-neutral)` at rest, `var(--text-2)` on hover/active (NOT accent — v2 discipline correction from v1). 8px desktop, 4px iPad. Horizontal axis always visible when overflow exists; vertical auto-hides 1500ms after idle.

### 4.11 Focus rings

1.5px `var(--ops-accent)` outline + 2px offset. Allowed accent usage per v2 spec. Cell focus follows arrow-key navigation; container auto-scrolls (200ms smooth) to keep focused cell visible.

### 4.12 Motion budget

Single `EASE_SMOOTH = cubic-bezier(0.22, 1, 0.36, 1)`. All durations honor `prefers-reduced-motion: reduce` by collapsing to 0ms.

| Element | Trigger | Duration | Reduced |
|---|---|---|---|
| Row hover bg | pointer | 150ms | instant |
| Cell focus ring | focus | 150ms | instant |
| Save flash (olive) | success | 1000ms hold + 400ms fade | hold only |
| Fail border (rose) | failure | 4000ms hold + 400ms fade | hold only |
| Undo toast in | new edit | 200ms (opacity + 8px translate) | opacity only |
| Undo toast out | timeout/replace | 200ms | opacity only |
| Frozen-zone shadow | scroll > 0 | 200ms opacity | instant |
| Skeleton shimmer | loading | 1400ms loop | static |
| View tab switch | click | 200ms data crossfade | instant |
| Column drag-reorder | drag | live | live |
| Cell popover open | click | 200ms (opacity + scale 0.96→1) | opacity only |
| Density change | button | 250ms row-height interp | instant |
| Pinch zoom | gesture | live | live |
| Sort change | header | 0ms (instant reflow) | 0ms |

## 5. Interactions

### 5.1 Edit grammar

| State | Visual | Trigger |
|---|---|---|
| Idle | plain | default |
| Hover | `var(--surface-hover)` bg + 1px `var(--line)` outline | pointer over |
| Focused | 1.5px `var(--ops-accent)` ring + 2px offset | click / Tab / arrow keys |
| Editing | focus ring + `var(--bg-input)` bg + input element | Enter / F2 / type while focused / direct click on focused cell |
| Saving | 1px `var(--text-2)` bottom border | onCommit fired, RPC in flight |
| Saved | 1px `var(--olive)` bottom border, 1s | RPC success |
| Failed | 1px `var(--rose)` bottom border, 4s; value reverts | RPC error after retry |
| Conflict | 1px `var(--tan)` bottom border + inline overlay | RPC raises `P0001` (if-match mismatch) |

**Commit grammar:** Enter commits + moves down (Shift+Enter up). Tab commits + right (Shift+Tab left). Click outside commits. Escape cancels.

### 5.2 Keyboard navigation

| Key | Action |
|---|---|
| Arrow keys | Move focus 1 cell |
| Tab / Shift+Tab | Right/left, commits if editing |
| Enter | Enter edit (if focused); commit + down (if editing) |
| Shift+Enter | Commit + up |
| Escape | Exit edit no save; clear selection if not editing |
| F2 | Enter edit |
| Space | Toggle focused row selection |
| Cmd/Ctrl+A | Select all visible rows |
| Cmd/Ctrl+click row | Toggle selection |
| Shift+click row | Range-select |
| Cmd/Ctrl+Z | Undo |
| Cmd/Ctrl+Shift+Z | Redo |
| Cmd/Ctrl+F | Focus toolbar search |
| Cmd/Ctrl+K | Command palette (Phase 2 — out of v1 scope) |
| Home / End | First / last column in row |
| Cmd+Home / Cmd+End | First / last cell in table |
| Page Up / Page Down | Page-height scroll |

**Type-to-edit:** focused but not editing + printable character → enter edit AND insert the character.

**Focus follows scroll:** 200ms smooth scroll keeps focused cell visible.

### 5.3 Cell popovers (i18n keys all live under `projects.table.cell.*`)

**Status / Trade (enum):** vertical list popover, each option = colored pill (from `PROJECT_STATUS_COLORS[ProjectStatus.<Member>]`) + label from `dict("projects").status.<member>`. The popover renders TS-enum members (`InProgress`, `Completed` etc.) for ergonomics; on commit, the cell calls `serializeProjectStatus(enumValue)` → DB lowercase form (`'in_progress'`, `'completed'`) → sent to `change_project_status` RPC. The mapping lives in [src/lib/api/services/project-service.ts:29–44](OPS-Web/src/lib/api/services/project-service.ts:29). Current selection has check icon. Arrow keys + Enter, or click.

**Date cells:** single-month calendar popover. Today outlined `var(--ops-accent)` (allowed — "this is what you're acting on" state); selected day filled `var(--ops-accent)`. Chip strip below: `Today / Tomorrow / Next week / Clear` (dict keys `cell.date.today` / `.tomorrow` / `.nextWeek` / `.clear`). Click commits and closes.

**Client cell:** read-only popover. `dict("projects").table.cell.client.<email|phone|openClient>` labels. Source: `clients.name`, `clients.email`, `clients.phone_number` (FIXED from v1's `clients.phone`).

**Team cell (cascading):** Section 5.4.

**Textarea cells:** popover with autosize 4–12 rows. Hint string: `dict("projects").table.cell.textarea.hint` (`⌘+Enter to save · Esc to cancel`). Cmd+Enter / outside-click commits.

**Images cell:** popover with thumbnails (68×68 from `project_photos.thumbnail_url`) + drop zone. Storage layer (Section 3.6) handles upload. On upload failure: toast key `table.cell.images.uploadFailed` with retry. New photos insert into `project_photos`; deletion is soft (set `deleted_at`).

### 5.4 Team cell — RPC-based cascading popover

The v1 dual-write is replaced. The cell still presents a cascading popover, but every write goes through the RPC layer.

**Primary popover** (i18n strings under `table.cell.team.*`):

```
┌──────────────────────────────────┐
│ // TEAM — HENDERSON RENO          │  ← title key: cell.team.title
├──────────────────────────────────┤
│  [Search team members...]         │  ← placeholder key: cell.team.search
├──────────────────────────────────┤
│ ASSIGNED                          │  ← section: cell.team.assigned
│  ◉ Alice Chen        ▸            │
│  ◉ Marcus Rivera     ▸            │
│                                   │
│ AVAILABLE                         │  ← section: cell.team.available
│  ◉ Sara Park                      │
│  ◉ Diego Almeida                  │
│  ... (scrollable)                 │
└──────────────────────────────────┘
```

**Adding** — click Available member → secondary popover shows task list (read from `project_tasks` for this project). Operator checks tasks → calls RPC:

```ts
await supabase.rpc('assign_project_team_member', {
  p_project_id: projectId,
  p_user_id: userId,
  p_task_ids: selectedTaskIds,
  p_expected_updated_at: project.updated_at,
});
```

Result: server-side atomic update of each task's `project_tasks.team_member_ids` array AND `projects.team_member_ids` (union). RPC returns new `updated_at` and the new effective `team_member_ids` array. Client updates TanStack Query cache.

**Removing** — click Assigned member's chevron → secondary popover shows tasks they're currently on (read from `project_tasks WHERE project_id = X AND user_id = ANY(team_member_ids)`). Operator unchecks tasks (or hits "Remove from all") → calls `remove_project_team_member` RPC.

**Concurrency safety:** the RPC's `p_expected_updated_at` check guarantees that if Alice is editing the same project elsewhere, only one of the two RPCs lands. The loser gets `P0001 conflict` → conflict overlay. No silent overwrites.

**Notifications:** after RPC success, client calls `dispatchProjectAssignment({ projectId, projectTitle, newMemberIds, companyId })` per OPS-Web's existing dispatch pattern.

**Edge cases:**

- **Removing last assignment** — RPC returns the new (smaller) `team_member_ids` array; cell re-renders, the avatar fades (200ms).
- **Project has no tasks** — per the canonical rule (Section 3.5.2.1), team membership is always backed by task assignment. The secondary popover shows a mandatory inline `+ Create first task and assign` flow: operator enters a task name, the client creates the task FIRST (a separate `project_tasks` INSERT), then calls `assign_project_team_member` with the new task's id in `p_task_ids`. The RPC never accepts an empty `p_task_ids` array (input validation raises `'22023'`). No project-level-only assignments exist.
- **iPad portrait** — secondary popover stacks below primary instead of beside (chevron rotates 90°).
- **`task_team_members` junction** — confirmed dead/iOS-only per Item 7 verification. The RPC does NOT write to this table. If iOS later requires it, the RPC adds the insert/delete in a follow-up migration; backwards-compatible.

### 5.5 Conflict resolution

When RPC raises `P0001` (the `expected_updated_at != current updated_at` check):

```
┌─────────────────────────────────────────┐
│ // {{ author }} UPDATED THIS {{ ago }}   │   ← keys: table.cell.conflict.title/.ago
│  {{ yourLabel }}:   "In Progress"        │   ← yourLabel/theirLabel
│  {{ theirLabel }}:  "Completed"          │
│                                          │
│  [Use mine]  [Use theirs]  [Cancel]      │   ← keys: useMine/useTheirs/cancel
└─────────────────────────────────────────┘
```

- **Use mine** — refire RPC with the latest `updated_at` token, same value.
- **Use theirs** — discard local edit, pull fresh row.
- **Cancel** — Escape equivalent.

### 5.6 Bulk actions

Sticky bar at bottom (`.glass-dense` — `rgba(10, 10, 10, 0.85)` per spec-canonical token). 1px `var(--line)` top, 48px tall.

- Left: `// {count} SELECTED` (key `bulk.selectedCount`).
- Middle: ghost buttons — `Change status ▾`, `Assign to ▾`, `Set due date ▾`, `Archive`, `Delete` (keys all under `bulk.*`).
- Right: `Clear` text-only (`bulk.clear`).

Each `▾` reuses the per-cell popover. Bulk operations call a server-side batch RPC (`bulk_update_projects`) per operation type — atomic per project, but the bulk wrapper iterates and reports partial failure.

**Destructive actions** (Archive, Delete) and **>25-row operations** show a confirmation modal. Others apply directly with an undo toast.

**Single undo entry per bulk** — Cmd+Z reverts all changes together.

**Partial failure** — `Updated {success} of {total} projects. {failed} failed — Retry / Discard.` (keys `bulk.partialFailure*`).

### 5.7 Undo / redo

In-memory stack, 50 entries, session-local. Each entry: `{ action, project_ids, column_ids, before, after, timestamp, expected_updated_at }`.

**Eviction policy** (v2 addition): when the 51st entry is pushed, the oldest entry is dropped from the bottom of the stack. The persistent toast only ever shows the most recent action; older entries are still Cmd+Z-reachable.

**Persistent toast** — bottom-left, `.glass-dense`, 1.5px `var(--text-2)` left bar (NOT accent — v2 discipline). 10s visible + 300ms fade. New action replaces existing toast (200ms cross-slide). i18n keys `table.undo.toastTitle` and `table.undo.action`.

**Not undoable:** project creation, permission changes, actions with external side-effects (notifications sent). Commit without toast; remedy via detail panel.

### 5.8 Context menus

**Row right-click** — `.glass-dense` popover. Options (all dict-keyed under `table.contextMenu.*`): Open project, Edit status, Assign team, Set due date, ─, Duplicate, Archive, Delete, ─, Copy link. Auto-close on outside-click, Escape, or scroll (fixes audit #8).

**Header right-click** — `Sort ascending`, `Sort descending`, `Hide column`, `Resize to fit content`, `Filter by this column…`. Pin-to-left and insert-column are Phase 2.

### 5.9 Drag & drop

1. **Column reorder** — drag header. 70% opacity preview, 2px `var(--text-2)` insertion indicator (NOT accent — v1 discipline drift fixed).
2. **Column resize** — drag right edge of header. Live reflow.

No row drag-and-drop. Row order is driven by active sort.

### 5.10 Out of scope (Phase 2)

- Cell formulas / computed columns
- Linked records beyond client lookup
- Sub-table task expand
- Cross-cell selection / copy-paste blocks
- Per-cell comments
- Command palette (Cmd+K)
- Trigram fuzzy search (`pg_trgm` is reportedly already installed in live Supabase — Phase 2 would add the indexes only, no extension migration needed).

## 6. View system

### 6.1 `project_views` schema (hardened)

```sql
-- Generic updated_at trigger function (Phase 1 also creates this; idempotent if-not-exists pattern).
-- No matching global function exists in current migrations; only per-table copies.
create or replace function public.fn_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end
$$;

create table public.project_views (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  owner_type      text not null check (owner_type in ('company', 'user')),
  owner_id        uuid not null,
  name            text not null check (char_length(name) between 1 and 60),
  icon            text check (icon is null or char_length(icon) <= 40),
  description     text check (description is null or char_length(description) <= 240),
  permission_key  text check (permission_key is null or permission_key in (
    'projects.view_financials'
    -- enumerated allowlist; CHECK constraint enforces no arbitrary permission_keys
  )),
  is_default      boolean not null default false,
  is_archived     boolean not null default false,
  sort_position   integer not null default 0,
  columns         jsonb not null check (octet_length(columns::text) <= 32768),
  filters         jsonb not null check (octet_length(filters::text) <= 16384),
  sort            jsonb not null check (octet_length(sort::text) <= 4096),
  density         text not null
    check (density in ('compact', 'comfortable', 'spacious'))
    default 'comfortable',
  zoom_level      numeric(3,2) not null default 1.00
    check (zoom_level >= 0.75 and zoom_level <= 1.50),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references public.users(id)
);

-- Case-insensitive uniqueness of name per (company, owner_type, owner_id), excluding archived.
-- Partial functional index — does NOT block name reuse after archive.
create unique index project_views_unique_lower_name
  on public.project_views (company_id, owner_type, owner_id, lower(name))
  where is_archived = false;

create index idx_project_views_company on public.project_views(company_id)
  where is_archived = false;
create index idx_project_views_owner on public.project_views(owner_type, owner_id)
  where is_archived = false;

create trigger project_views_set_updated_at
  before update on public.project_views
  for each row execute function public.fn_set_updated_at();
```

**JSONB size caps** prevent runaway: 32KB for columns array, 16KB for filter tree, 4KB for sort spec. Validated at the CHECK constraint level.

**Unique name** is enforced by the partial functional index alone. The column-level `UNIQUE` constraint from v2 was removed because it would have blocked name reuse after archiving — operators should be able to delete-via-archive `"Q4 Pipeline"` and then create a new `"Q4 Pipeline"` next quarter without seeing a constraint error.

**`permission_key` allowlist** prevents arbitrary permission strings. Today only `'projects.view_financials'` is allowed. Future entries require an explicit migration to extend the CHECK constraint.

### 6.2 RLS policies

All policies use `private.get_current_user_id()` — never `auth.uid()` directly — because OPS centralizes auth-subject resolution through that helper. Using `auth.uid()` directly would bypass the app's public-user mapping and can deny real authenticated users.

```sql
alter table public.project_views enable row level security;

-- READ: same company; either company-owned OR user-owned-by-me; permission gate if set
create policy "users read company and own views"
on public.project_views for select
to authenticated
using (
  company_id = (select company_id from public.users
                 where id = (select private.get_current_user_id()))
  and (
    owner_type = 'company'
    or (owner_type = 'user' and owner_id = (select private.get_current_user_id()))
  )
  and (
    permission_key is null
    or public.has_permission((select private.get_current_user_id()), permission_key)
  )
);

-- INSERT/UPDATE/DELETE for personal views
create policy "users manage own views"
on public.project_views for all
to authenticated
using (
  company_id = (select company_id from public.users
                 where id = (select private.get_current_user_id()))
  and owner_type = 'user'
  and owner_id = (select private.get_current_user_id())
)
with check (
  company_id = (select company_id from public.users
                 where id = (select private.get_current_user_id()))
  and owner_type = 'user'
  and owner_id = (select private.get_current_user_id())
  -- explicit: non-admin personal views cannot grant themselves financial access
  and (
    permission_key is null
    or public.has_permission((select private.get_current_user_id()), 'projects.manage_views')
  )
);

-- INSERT/UPDATE/DELETE for company views — admins only
create policy "admins manage company views"
on public.project_views for all
to authenticated
using (
  company_id = (select company_id from public.users
                 where id = (select private.get_current_user_id()))
  and owner_type = 'company'
  and public.has_permission((select private.get_current_user_id()), 'projects.manage_views')
)
with check (
  company_id = (select company_id from public.users
                 where id = (select private.get_current_user_id()))
  and owner_type = 'company'
  and public.has_permission((select private.get_current_user_id()), 'projects.manage_views')
);
```

Three policies, each with explicit company_id isolation in BOTH `USING` and `WITH CHECK`. The personal-view policy's `WITH CHECK` also forbids `permission_key` unless the user has `projects.manage_views` — closes the v1 hole where a non-admin could grant themselves financial access via a personal view.

### 6.3 New permission keys (additive — safe under iOS sync constraint)

This spec adds **only two** permission keys. The existing six project keys (`projects.view`, `.create`, `.edit`, `.delete`, `.archive`, `.assign_team` — all in [015_permissions_system.sql:18–19](OPS-Web/supabase/migrations/015_permissions_system.sql:18)) are reused unchanged.

| New permission key | Default holders (role_permissions seed) | Purpose |
|---|---|---|
| `projects.view_financials` | Admin (`scope='all'`), Owner (`'all'`), Office (`'all'`), Accountant if present (`'all'`) | All currency columns + Financial Overview view tab. Binary — no scope semantics; you either see financials or you don't. |
| `projects.manage_views` | Owner (`'all'`), Admin (`'all'`) | Company-view CRUD + ability to set `permission_key` on personal views. Binary. |

Phase 1 migration adds `role_permissions` rows for the relevant roles. **No `permissions` catalog table exists** — `role_permissions.permission` is plain text, no foreign key to a catalog, so adding a new key is purely an INSERT into `role_permissions`. Preset role IDs in live: Admin = `00000000-0000-0000-0000-000000000001`, Owner = `…000002`, Office = `…000003`, Operator = `…000004` (gets neither new key), Crew = `…000005` (gets neither). Accountant role is optional; include it only if a matching role exists in the current `roles` table.

Runtime check is `usePermissionStore.can(key)` on the client and either `private.current_user_has_permission(key)` or `public.has_permission(uid, key, scope?)` in RLS/RPC — never role filtering.

### 6.4 Three seeded company views

All filter values below use the DB casing (lowercase/snake_case). The TS enum is mapped at the rendering boundary.

**My Active Work** — landing default
- icon: `briefcase`, sort_position: 0, permission_key: null, density: comfortable, zoom: 1.00
- columns: `name`, `status`, `client`, `end_date`, `next_task`, `progress`
- filter: `assigned_to_current_user AND status NOT IN ('closed', 'archived')`
- sort: `[{ column: 'end_date', dir: 'asc' }, { column: 'name', dir: 'asc' }]`

`assigned_to_current_user` resolves to `private.current_user_in_project(projects.id)` at query time — the same active-row canonical helper used by the WRITE policies on the projects domain. This avoids re-implementing the text-typed array membership check (and the inevitable bugs that come with it). Stored in JSONB as `{ "type": "dynamic", "key": "current_user_assigned" }`.

**All Active**
- icon: `layers`, sort_position: 1, permission_key: null, density: comfortable, zoom: 1.00
- columns: `name`, `status`, `client`, `trade`, `value`, `team`, `start_date`, `end_date`
- filter: `status NOT IN ('closed', 'archived')`
- sort: `[{ column: 'status', dir: 'asc' }, { column: 'end_date', dir: 'asc' }]`
- `value` column renders `—` `var(--text-3)` for operators without `projects.view_financials`. Tooltip explains.

**Financial Overview**
- icon: `trending-up`, sort_position: 2, permission_key: `'projects.view_financials'`, density: comfortable, zoom: 1.00
- columns: `name`, `client`, `estimate_total`, `invoice_total`, `paid_total`, `status`, `completed_at`, `margin`
- filter: `status IN ('accepted', 'in_progress', 'completed') OR completed_within_last_90_days`
- sort: `[{ column: 'estimate_total', dir: 'desc' }]`
- `margin` ships in v1 (`expense_project_allocations` + `expenses` join confirmed available; `estimates.status IN ('approved', 'converted')` for revenue side).

### 6.5 Seeding strategy

Migration `20260512_seed_default_project_views.sql`:
- For every existing company, insert three rows (`owner_type='company'`, `is_default=true`, `created_by=null`).
- Add a trigger on `companies` INSERT to auto-seed new companies. Trigger handler is idempotent — uses ON CONFLICT DO NOTHING against the unique-name index.

### 6.6 User-created views

`+ New view` opens dialog: name (60 chars max, validated client- and server-side against the unique constraint), icon picker (12 curated Lucide icons), starting point (clone current / blank). Owned by user. Private.

**Share with team** (visible only with `projects.manage_views`): converts `owner_type` to `'company'`, `owner_id` to `company_id`. One-way. Original `created_by` preserved.

### 6.7 Settings menu

Gear icon on active tab: Rename, Change icon, Duplicate, Share with team (gated), Reset to defaults (seeded views only), Archive.

"Edit filters / sort / columns" Phase 2; v1 is inline-via-table-interaction.

### 6.8 URL behavior

| URL | Resolves to |
|---|---|
| `/projects` | last-active view; default `My Active Work` |
| `/projects?view=<id>` | specific view |
| `/projects?view=<id>&filter[status]=accepted` | view + filter override (DB values — lowercase/snake_case) |
| `/projects?view=<id>&sort=end_date:desc` | view + sort override |

Hierarchy: view definition → URL overrides → session tweaks. URL referencing inaccessible view → fallback default + toast `table.views.unavailable`.

**View auto-save policy:** definitions never mutate implicitly. Session tweaks (column resize, density change, sort/filter toggles, etc.) are ephemeral until `Update view` or `Save as new view`. Unsaved-dot signals divergence. Reload restores saved config. Selection clears on view switch. Exception: `Share with team` implicitly saves pending tweaks into the new company view.

### 6.9 Edge cases

- **Two views same name in same company** — DB constraint rejects; client surfaces friendly error `views.duplicateName`.
- **Permission revoked mid-session** — next RLS-failed fetch shows toast, redirect to default.
- **Column in view no longer exists** — application filters unknown columns at render; view continues with remaining; telemetry warning.
- **JSONB cap exceeded** — DB rejects; client surfaces `views.tooComplex` and refuses to save until columns trimmed.
- **Empty after filter** — empty state (Section 4.9); view itself fine.

## 7. Column catalog

### 7.1 Postgres view for derived columns

A single read-only view `project_table_rows` joins projects + clients + derived aggregates. `security_invoker = true` makes underlying-table RLS apply to the calling user. **Financial aggregates are gated with `CASE WHEN has_permission(...) THEN <calc> ELSE NULL END`** so unauthorized users explicitly see NULLs in the wire payload, not zeros.

```sql
create or replace view public.project_table_rows
with (security_invoker = true)
as
with
  -- compute permission once per query, not per column
  perm as (
    select public.has_permission(
      (select private.get_current_user_id()),
      'projects.view_financials',
      'all'
    ) as can_view_financials
  )
select
  p.id,
  p.company_id,
  p.title,
  p.status,                                   -- DB casing: 'rfq', 'estimated', 'accepted', 'in_progress', 'completed', 'closed', 'archived'
  p.client_id,
  c.name as client_name,
  c.email as client_email,
  c.phone_number as client_phone,
  p.address,
  p.trade,
  p.start_date,
  p.end_date,
  p.completed_at,
  p.duration,
  p.created_at,
  p.updated_at,
  p.notes,
  p.team_member_ids,

  -- task aggregates
  (select count(*) from public.project_tasks t
     where t.project_id = p.id and t.status in ('active', 'completed') and t.deleted_at is null) as task_count,
  (select count(*) from public.project_tasks t
     where t.project_id = p.id and t.status = 'completed' and t.deleted_at is null) as task_completed_count,

  -- progress (0.0–1.0); cancelled tasks are historical, not incomplete work
  case
    when (select count(*) from public.project_tasks t
            where t.project_id = p.id and t.status in ('active', 'completed') and t.deleted_at is null) = 0 then 0
    else (
      (select count(*)::numeric from public.project_tasks t
         where t.project_id = p.id and t.status = 'completed' and t.deleted_at is null)
      /
      (select count(*) from public.project_tasks t
         where t.project_id = p.id and t.status in ('active', 'completed') and t.deleted_at is null)
    )
  end as progress,

  -- next task (earliest active task, deterministic tie-break; cancelled excluded)
  (select coalesce(t.custom_title, tt.display, 'Task')
     from public.project_tasks t
     left join public.task_types tt on tt.id = t.task_type_id
     where t.project_id = p.id and t.status = 'active' and t.deleted_at is null
     order by t.start_date asc nulls last, t.display_order asc nulls last, t.id asc
     limit 1) as next_task,

  -- days in status
  extract(day from (now() -
    coalesce(
      (select max(pn.created_at) from public.project_notes pn
         where pn.project_id = p.id::text and pn.event_kind = 'status_change'),
      p.created_at
    )
  ))::int as days_in_status,

  -- ─── financial aggregates: NULL when user lacks 'projects.view_financials' ──
  -- Estimate revenue: won-value statuses are 'approved' AND 'converted' (NOT 'accepted')
  case when perm.can_view_financials then
    (select coalesce(sum(e.total), 0) from public.estimates e
       where e.project_id = p.id::text
         and e.status in ('approved', 'converted')
         and e.deleted_at is null)
  else null end as estimate_total,

  case when perm.can_view_financials then
    (select coalesce(sum(i.total), 0) from public.invoices i
       where i.project_id = p.id and i.deleted_at is null)
  else null end as invoice_total,

  case when perm.can_view_financials then
    (select coalesce(sum(i.amount_paid), 0) from public.invoices i
       where i.project_id = p.id and i.deleted_at is null)
  else null end as paid_total,

  -- value: max of estimate revenue and invoice revenue (both gated)
  case when perm.can_view_financials then
    greatest(
      coalesce((select sum(e.total) from public.estimates e
                  where e.project_id = p.id::text
                    and e.status in ('approved', 'converted')
                    and e.deleted_at is null), 0),
      coalesce((select sum(i.total) from public.invoices i
                  where i.project_id = p.id and i.deleted_at is null), 0)
    )
  else null end as value,

  -- project cost from approved expense allocations
  -- expense_project_allocations.amount is nullable; when null, fall back to percentage * expense.amount
  case when perm.can_view_financials then
    (select coalesce(sum(coalesce(epa.amount, e.amount * epa.percentage / 100.0)), 0)
       from public.expense_project_allocations epa
       join public.expenses e on e.id = epa.expense_id
       where epa.project_id = p.id::text
         and e.status = 'approved'
         and e.deleted_at is null)
  else null end as project_cost,

  -- margin: (invoice_total - project_cost) / invoice_total, gated
  case when perm.can_view_financials then
    case
      when (select coalesce(sum(i.total), 0) from public.invoices i
              where i.project_id = p.id and i.deleted_at is null) = 0 then null
      else (
        (select coalesce(sum(i.total), 0) from public.invoices i
           where i.project_id = p.id and i.deleted_at is null)
        -
        (select coalesce(sum(coalesce(epa.amount, e.amount * epa.percentage / 100.0)), 0)
           from public.expense_project_allocations epa
           join public.expenses e on e.id = epa.expense_id
           where epa.project_id = p.id::text
             and e.status = 'approved'
             and e.deleted_at is null)
      ) / nullif(
        (select sum(i.total) from public.invoices i
           where i.project_id = p.id and i.deleted_at is null), 0
      )
    end
  else null end as margin,

  -- photo count (not financial — never gated)
  (select count(*) from public.project_photos pp
     where pp.project_id = p.id::text and pp.deleted_at is null) as photo_count

from public.projects p
left join public.clients c on c.id = p.client_id
cross join perm
where p.deleted_at is null;
```

Notes on the SQL:
- `security_invoker = true` makes the view respect the calling user's RLS context on `projects`, `clients`, etc. — operators only see rows they're entitled to.
- The `perm` CTE computes `has_permission` once per query (cheap; cached in the function's STABLE marker). All six financial aggregates reference `perm.can_view_financials` rather than re-evaluating the function per column. The `cross join perm` makes the boolean available to every selected row.
- Financial nulls are wire-level: an operator without `projects.view_financials` receives `null` for `estimate_total` etc. directly from PostgREST. UI renders `—` `var(--text-3)`. Cannot be bypassed client-side.
- `projects.status` is stored as lowercase/snake_case. The filter literals in the seeded views and in `task_status = 'completed'` reflect that.
- `estimates.status` won-value filter is `IN ('approved', 'converted')`. The v2 spec's `'accepted'` value does not exist in production estimate data.
- `task_types.display` is the canonical task-type label; there is no `task_types.name` column in production.
- `estimates.project_id`, `expense_project_allocations.project_id`, `project_notes.project_id`, and `project_photos.project_id` are legacy text columns, so the SQL compares them to `p.id::text`. `invoices.project_id` and `project_tasks.project_id` are UUID.
- `expense_project_allocations.amount` is nullable; we fall back to `e.amount * epa.percentage / 100.0`. `expenses.amount` is the cost field (NOT `e.total`), and soft-deleted expenses are excluded.
- `invoices.amount_paid` is the correct field name (NOT `paid_amount`).
- Margin returns `null` when `invoice_total = 0`; UI renders `—`.
- Photo count uses the `project_photos` table; row count where `deleted_at is null`.

### 7.2 Full column catalog — 25 columns (one added in v2: `photos`)

| # | ID | Display | Source | Type | Editable | Sort | Min/Def/Max |
|---|---|---|---|---|---|---|---|
| 1 | `name` | NAME | `project_table_rows.title` | text | yes | A↕Z | 200/280/480 |
| 2 | `status` | STATUS | `project_table_rows.status` | enum | yes | by stage order | 96/96/96 |
| 3 | `client` | CLIENT | `project_table_rows.client_name` | relation | no | A↕Z | 140/180/320 |
| 4 | `client_email` | CLIENT EMAIL | `project_table_rows.client_email` | text | no | A↕Z | 160/200/320 |
| 5 | `client_phone` | CLIENT PHONE | `project_table_rows.client_phone` | text (mono) | no | A↕Z | 130/150/200 |
| 6 | `address` | ADDRESS | `projects.address` | text | yes | A↕Z | 160/220/400 |
| 7 | `trade` | TRADE | `projects.trade` | enum | yes | A↕Z | 100/120/180 |
| 8 | `start_date` | START | `projects.start_date` | date | yes | by date | 90/110/140 |
| 9 | `end_date` | DUE | `projects.end_date` | date | yes | by date | 90/110/140 |
| 10 | `completed_at` | COMPLETED | `projects.completed_at` | date | no | by date | 90/110/140 |
| 11 | `duration` | DURATION | `projects.duration` | number (days) | yes | numeric | 80/90/120 |
| 12 | `created_at` | CREATED | `projects.created_at` | date | no | by date | 90/110/140 |
| 13 | `team` | TEAM | `projects.team_member_ids` (display); RPC for edit | avatars | yes (RPC cascade) | by count | 120/160/280 |
| 14 | `progress` | PROGRESS | `project_table_rows.progress` | bar+% | no | numeric | 100/140/200 |
| 15 | `next_task` | NEXT | `project_table_rows.next_task` | text | no | A↕Z | 160/200/320 |
| 16 | `task_count` | TASKS | `project_table_rows.task_count` | number | no | numeric | 80/90/120 |
| 17 | `days_in_status` | DAYS IN STATUS | `project_table_rows.days_in_status` | number (semantic) | no | numeric | 100/130/160 |
| 18 | `estimate_total` | ESTIMATE | `project_table_rows.estimate_total` | currency | no | numeric | 110/130/180 |
| 19 | `invoice_total` | INVOICED | `project_table_rows.invoice_total` | currency | no | numeric | 110/130/180 |
| 20 | `paid_total` | PAID | `project_table_rows.paid_total` | currency | no | numeric | 110/130/180 |
| 21 | `value` | VALUE | `project_table_rows.value` | currency | no | numeric | 110/130/180 |
| 22 | `margin` | MARGIN | `project_table_rows.margin` | percentage | no | numeric | 90/110/140 |
| 23 | `notes` | NOTES | `projects.notes` | textarea (line-clamp-2 preview) | yes (popover) | — | 200/280/480 |
| 24 | `photos` | PHOTOS | `project_table_rows.photo_count` (count) + `project_photos` join (popover) | count + popover gallery | yes (drag-drop upload) | numeric | 80/100/140 |

### 7.3 Semantic color overrides on cell values

- **`days_in_status`** > 30 → text `var(--tan)` (`#C4A868`); > 60 → text `var(--rose)` (`#B58289`).
- **`end_date`** in past AND `status NOT IN ('completed', 'closed')` (DB casing) → text `var(--rose)`.
- **Currency columns** without `projects.view_financials` → `—` in `var(--text-3)`. Column tooltip: `dict("projects").table.cell.currency.permissionTooltip`.

### 7.4 Cell-edit behavior by type

| Type | Pattern | Commit |
|---|---|---|
| text | inline `<input>`, current value selected | Enter / blur. Escape reverts. |
| textarea | popover, autosize 4–12 rows | Cmd+Enter / outside-click. Escape reverts. |
| number | numeric `<input>`, ↑/↓ steps 1 (Shift = 10) | Enter / Tab / blur |
| currency | read-only in v1; chevron-on-hover navigates to source estimate/invoice | n/a |
| date | calendar popover with chip strip | day click / chip / Enter |
| enum | list popover | selection commits and closes |
| relation (client) | read-only popover with `→ Open client` | n/a |
| avatars (team) | RPC-based cascading popover (Section 5.4) | per-checkbox via RPC |
| photos | popover with thumbnails + Supabase Storage drop zone | per-upload |

### 7.5 Default visibility per seeded view

| Column | My Active Work | All Active | Financial Overview |
|---|---|---|---|
| name | ✓ | ✓ | ✓ |
| status | ✓ | ✓ | ✓ |
| client | ✓ | ✓ | ✓ |
| trade | — | ✓ | — |
| start_date | — | ✓ | — |
| end_date | ✓ | ✓ | — |
| completed_at | — | — | ✓ |
| team | — | ✓ | — |
| progress | ✓ | — | — |
| next_task | ✓ | — | — |
| estimate_total | — | — | ✓ |
| invoice_total | — | — | ✓ |
| paid_total | — | — | ✓ |
| value | — | ✓ | — |
| margin | — | — | ✓ |

All other columns available via header column-picker.

### 7.6 Per-column permission gating

| Permission key | Gates | Scope semantics |
|---|---|---|
| `projects.view` | The Projects tab itself + read access via RLS | `'all'` = every company project; `'assigned'` = projects where user is in `team_member_ids` |
| `projects.edit` | All editable cells EXCEPT team (which uses `assign_team`); enforced both in RLS (PostgREST UPDATE) and in `change_project_status` RPC | `'all'` = any project in the user's company; `'assigned'` = only company projects user is on |
| `projects.archive` | Archive bulk + per-row | `'all'` / `'assigned'` |
| `projects.create` | `+ New project` button + duplicate | n/a (binary) |
| `projects.delete` | Hard delete (not exposed in table UI in v1; available via context menu only with confirmation) | `'all'` / `'assigned'` |
| **`projects.assign_team`** | The team cell's RPCs (`assign_project_team_member`, `remove_project_team_member`) and the bulk "Assign to" action | `'all'` = assign within the user's company; `'assigned'` = only modify team on company projects user is already on |
| `projects.view_financials` *(new in this spec)* | All currency columns + Financial Overview tab + margin column. Enforced in the `project_table_rows` view via `CASE WHEN`. | binary |
| `projects.manage_views` *(new in this spec)* | Company-view CRUD + `permission_key` field on any view. Enforced in RLS. | binary |

**Scoped permission semantics** — `'assigned'`-scope grants only satisfy actions on projects in the user's company where the user is already a team member. The check happens via the new `private.current_user_can_edit_project(uuid)` and `private.current_user_can_assign_team_on_project(uuid)` helpers (Section 3.5.1), which first require a live project with `company_id = private.get_user_company_id()`, then combine `private.current_user_is_admin()` OR `private.current_user_scope_for(key) = 'all'` OR (`private.current_user_scope_for(key) = 'assigned'` AND `private.current_user_in_project(p_project_id)`). `has_permission()` takes a scope string, not a project id — it cannot do per-row scoping on its own; `current_user_in_project` is what closes that gap, and Phase 1 replaces it so it handles the `text[]` typing of `team_member_ids` correctly while ignoring deleted projects/tasks. Effects:

- Operator-role users (who have `projects.edit:assigned` and `projects.assign_team:assigned`) can edit cells on projects they're a team member of, and can assign others to those same projects, but cannot touch projects they're not on.
- Owner/Admin users have all six project permissions with `'all'` scope inside their company — no assignment gate.

**Without `projects.view_financials`:** currency cells receive `null` from the view, render `—` in `var(--text-3)`. Tooltip explains.

**Without `projects.edit` (or with `'assigned'` scope on a project user isn't on):** clicking an editable cell flashes 1px `var(--tan)` bottom border (600ms) + toast `table.readOnly`. Never silent.

**Without `projects.assign_team`:** clicking the team cell opens a read-only popover (avatar list with no add/remove controls). Tooltip on the cell explains.

### 7.7 Search

Toolbar search uses Postgres `ILIKE %query%` against four fields: `projects.title`, `clients.name`, `projects.address`, `projects.notes`. Case-insensitive. 3-char minimum. 200ms debounce.

**Performance note:** ILIKE on these fields is fine up to a few thousand projects per company. We choose it for v1 as a simplicity decision — no migration required, no extension dependency, predictable behavior. `pg_trgm` appears to already be installed in the live Supabase instance (no migration evidence either way, but per external review it's available), so Phase 2 can add trigram indexes on the four fields without an extension migration if/when ILIKE performance becomes a problem.

Active search shows clearable chip `Search: "{query}" ×` + count `(N)` next to view tab in `.t-metadata`.

### 7.8 Column header tooltips

600ms-delay tooltip: full column name + one-sentence description, both dictionary-keyed (`table.columnTooltip.<id>.title` / `.body`). Permission-gated columns additionally show required permission key in `.t-metadata`. Built on Radix Tooltip with `.glass-dense` (existing pattern).

## 8. Observability

All events via `analyticsService.track("action", "<event_name>", { ...props })` (corrected from v1's `useAnalytics()` hook reference). Direct service calls from mutation callbacks, not from render.

| Event name | Properties |
|---|---|
| `project_table_page_opened` | `view_id`, `device_class` (desktop/ipad-landscape/ipad-portrait), `column_count`, `row_count` |
| `project_table_view_switched` | `from_view_id`, `to_view_id` |
| `project_table_view_created` | `view_id`, `started_from` (blank/clone), `column_count` |
| `project_table_cell_edit_started` | `column_id`, `project_id` |
| `project_table_cell_committed` | `column_id`, `latency_ms`, `project_id`, `value_changed` (bool) |
| `project_table_cell_failed` | `column_id`, `error_code`, `project_id` |
| `project_table_cell_conflicted` | `column_id`, `project_id` |
| `project_table_bulk_applied` | `action`, `row_count`, `partial_failure_count` |
| `project_table_undo_invoked` | `action`, `seconds_since_action` |
| `project_table_search_queried` | `query_length`, `result_count`, `latency_ms` |
| `project_table_column_resized` | `column_id`, `from_width`, `to_width` |
| `project_table_column_reordered` | `column_id`, `from_index`, `to_index` |
| `project_table_zoom_changed` | `from_zoom`, `to_zoom`, `method` (pinch/button/shortcut) |
| `project_table_scroll_horizontal_hit` | (sampled 1-in-10) `scroll_x_max`, `view_id` |
| `project_table_team_rpc` | `action` (assign/remove), `latency_ms`, `task_count`, `conflict` (bool) |

**PII exclusions:** never log search query content (already covered — we log length only). Never log cell values themselves — log column_id + change-occurred boolean. Never log user names or email addresses; user IDs only.

**Sentry routing:** every cell-edit failure, RPC conflict, view-fetch RLS denial, photo-upload failure. Tags `feature:projects_table`, `surface:web`. Payload includes `project_id`, `column_id`, `error_code`, view context.

**Web Vitals:** LCP / INP / CLS on `/projects`. Baseline captured pre-launch via Lighthouse CI; continuous post-launch via the existing performance monitoring pipeline (verify wiring during implementation).

## 9. Rollout

OPS-Web's feature-flag system is per-user (not per-company — corrected from v1). The flag slug `projects_table_v2` is added to `feature-flag-definitions.ts` and gated via `useFeatureFlagsStore().canAccessFeature("projects_table_v2")`.

Per-company rollout is achieved by enabling the flag for all users at a given company via a backend admin script. This is the existing pattern for other beta features (verify exact script path during implementation).

| Step | When | What |
|---|---|---|
| 1. Migrations | Day 1 | Run additive migrations: `fn_set_updated_at`, active-row private permission helpers, `project_views` table + RLS, restrictive refined `projects` UPDATE policy, `role_permissions` rows for the two new keys, project-team cache backfill + trigger, three hardened RPCs, `project_table_rows` view, default-view seed for all existing companies. See Section 14 Phase 1 for the full ordered list. Zero behavior change except correcting stale denormalized team cache. |
| 2. Feature flag wired | Day 1 | Add `projects_table_v2` flag slug to definitions. Default off. Old route checks flag; renders v2 if on, v1 if off. Coexist. |
| 3. Internal dogfood | Days 2–4 | Flag on for all OPS team user accounts. 48h minimum. Telemetry actively monitored. P0/P1 bugs block. |
| 4. Beta cohort | Days 5–7 | Flag on for nominated users at ~5 representative companies (mix of high/low volume, multi/single user). 72h. Watch `cell_failed` rate, save p95, conflict rate, undo invocation rate. >20% spike → roll back. |
| 5. GA | Day 8+ | Flag on for all users via admin script. Emergency `projects_table_v2_disabled` flag for one-flip rollback (<30s). |
| 6. Cleanup | Day 22 | 14 days clean → delete v1 implementation, remove flag definitions. Net codebase smaller. |

**Beta advancement checklist (added in v2):**
- `cell_failed` rate < 0.5%
- Save p95 < 600ms (measured from `cell_committed` event `latency_ms`)
- Zero RLS denial Sentry events not attributable to legitimate permission gates
- Zero open support tickets tagged `feature:projects_table`
- Lighthouse a11y ≥ 95 on staging
- Manual scroll FPS check: 60fps at 500 rows on a baseline iPad Air

**Rollback contract:** at any step, a single env-var flip reverts every user within 30s. Data isn't lost — no existing tables changed schema. Worst-case rollback leaves orphan rows in `project_views` (cleanable; rows aren't read by v1).

## 10. Test plan

### 10.1 Unit (~60 tests)

- View-definition → SQL fragment projection (snapshot)
- Selection-pruning logic on filter change
- Optimistic mutation reducer transitions
- Undo stack push/pop/redo/eviction-at-50
- Cell-edit state machine transitions
- Density math (zoom ↔ row height) including boundary clamps
- Permission gating resolution per cell type
- Derived field calculations (progress, days_in_status, value, margin) including null and divide-by-zero paths
- Status-color lookup against `PROJECT_STATUS_COLORS` (catches drift if the source map changes)
- Date semantic-color overrides (overdue, days-in-status thresholds)
- Truncation rule at Compact density for long names

### 10.2 Integration (~35 tests, against local Supabase via `npx supabase start`)

- **RLS spoofing:** authenticated user attempts to read another company's `project_views` — denied at the RLS layer (verifies `private.get_current_user_id()` is correctly resolving the auth subject).
- **`auth.uid()` regression test:** a deliberately-broken policy using `auth.uid()` is included in a separate test migration, verified to FAIL for a real Firebase-authenticated test user. Then re-applied with `private.get_current_user_id()` and verified to succeed. Catches regression to the v2 bug.
- **Personal-view `permission_key` escalation attempt:** non-admin user inserts a personal view with `permission_key = 'projects.view_financials'` — denied by `WITH CHECK`.
- **Duplicate view name (active):** insert two non-archived views with same name (varying case) in same company → second rejected by partial functional index.
- **Duplicate view name (archived):** archive a view, then create a new one with the same name → succeeds (partial index does NOT block).
- **JSONB size cap:** insert view with 33KB columns array → rejected by CHECK constraint.
- **JSONB schema validation:** insert view with malformed `filters` JSON (non-tree shape) → rejected by application-layer validation before reaching DB.
- **View CRUD happy path:** create, read, update, share-to-company, archive.
- **Single-field edit:** direct PostgREST UPDATE with `If-Match` on `updated_at` writes correctly; conflict path triggers when the token doesn't match.
- **`change_project_status` RPC:** valid status writes; invalid status (e.g., `'in-progress'` with hyphen) rejected by allowlist; `project_notes` row inserted with `event_kind = 'status_change'`.
- **Status casing roundtrip:** write `'in_progress'` (DB form), read back via PostgREST, verify exact casing preserved end-to-end through the TS enum mapping and back.
- **Conflict path:** simulate two simultaneous edits on same row — second returns `P0001`; client overlay renders.
- **Scoped permission denial:** Operator user (with `projects.edit:assigned`) attempts to edit a project they're NOT in `team_member_ids` of → RLS denial, toast.
- **Scoped permission success:** same Operator on a project they ARE on → succeeds.
- **`projects.role_scope_update` remains restrictive:** inspect `pg_policy` and assert `polpermissive = false` for the update policy. Also verify a same-company user without scoped permission cannot update despite `company_isolation`.
- **`current_user_in_project` deleted-row + company-boundary exclusion:** user assigned only through a deleted task cannot edit; user assigned through a live task can edit; cross-company project/team leakage never grants membership. Deleted project row never grants membership.
- **Bulk edit:** 10 status changes, all commit, one undo reverts all 10. Partial-failure surfaces `bulk.partialFailure` toast.
- **Team RPC concurrency:** 2 concurrent `assign_project_team_member` calls on same project — one wins, other gets `P0001`; final state is correct (no lost user).
- **Team RPC permission gate:** Operator with `projects.assign_team:assigned` on a project they're on succeeds; on a project they're NOT on → denied.
- **Team cache backfill:** seed mismatched `projects.team_member_ids` vs task-union state, run Phase 1 backfill, assert zero mismatches.
- **Team cache trigger:** direct `project_tasks.team_member_ids` insert/update/delete/soft-delete/project move recomputes `projects.team_member_ids` and bumps `projects.updated_at` only when the effective cache changes.
- **Cancelled task semantics:** cancelled tasks are excluded from `task_count`, progress denominator, and `next_task`; completed + active tasks still calculate correctly.
- **`project_photos` enum compliance:** insert with `source = 'web'` → enum violation error. Insert with `source = 'other'` → succeeds.
- **Photo upload happy path:** upload to Storage, insert into `project_photos`, list returns it.
- **Photo upload failure:** inject Storage error → toast surfaces, NO orphan row left in `project_photos` (transactional cleanup).
- **Photo soft delete:** set `deleted_at`, verify table query excludes it, `photo_count` aggregate updates.
- **Financial column exclusion (view-level):** user without `projects.view_financials` queries `project_table_rows` directly via PostgREST → every currency column returns `null` in the response payload (verified via raw SQL inspection, not just UI).
- **Financial column inclusion:** user with `projects.view_financials` → currency columns return real numbers.
- **Estimate status filter:** seed estimates with various statuses, verify `estimate_total` only sums rows where `status IN ('approved', 'converted')`. Rows with `status = 'pending'` or `'rejected'` excluded.
- **Margin null on zero invoices:** project with no invoices → `margin = null`, NOT 0.
- **Margin with percentage allocations:** seed an expense with `amount = NULL, percentage = 50` and `expenses.amount = 1000` → cost contribution = 500.
- **`fn_set_updated_at` trigger:** UPDATE a `project_views` row, verify `updated_at` advances; INSERT does not trigger (only BEFORE UPDATE).
- **Dictionary key coverage:** AST-walk all components for `dict("projects").<key>` references; verify every key exists in both `en/projects.json` AND `es/projects.json`.
- **`projects_table_v2` flag off:** v2 route does not render; v1 route renders unchanged.
- **`projects_table_v2` flag on:** v2 route renders; URL `?view=<id>` works.

### 10.3 E2E (~12 critical paths, Playwright)

- Cold load → skeleton → real rows (no layout shift) — CLS = 0 verified
- Inline edit → row updates → undo toast → Cmd+Z reverts
- View tab switch → table re-renders → selection cleared
- iPad portrait: name + status frozen; swipe right reveals data columns
- Personal view: create from blank → tab strip → reload → still there
- Permission test: log in without `projects.view_financials` → Financial Overview tab absent, value column shows em-dash in All Active
- Bulk archive: shift-click 3 → Archive → confirm → undo offers revert
- Search "henderson" → live filter → clear chip → restore
- Conflict path: two browser sessions edit same cell → second sees overlay → resolves
- Team cascade: open team cell → add user → select 2 tasks → RPC executes → avatar appears in cell + notification rail shows new entry (NOT activity timeline — team RPCs don't write project_notes; adding team event_kinds is Phase 2)
- Pinch zoom (trackpad simulation): zoom Compact → Spacious → density snaps + persists across reload
- Below 768px viewport: route renders iPad-or-larger message

### 10.4 Accessibility (Lighthouse + axe-core on staging + manual VoiceOver)

- Every interactive element has accessible name
- Keyboard nav reaches every cell, action, popover (test recorded with VoiceOver script)
- WCAG AA contrast on every text combination (tokens already pass; verify in deployed surface)
- Logical focus order
- Screen reader announces column + value on arrow key
- `prefers-reduced-motion: reduce` disables every animation (no 1ms cheats)

### 10.5 Performance (staging with 1000-project seed)

- LCP < 1.0s
- INP p95 < 200ms (interaction-to-paint during cell edits)
- CLS = 0
- Memory after 5 minutes of usage < 200MB
- Scroll 60fps at 1000 rows

### 10.6 SQL contract test for `project_table_rows`

- Seed deterministic fixtures: 1 company, 3 users (owner, member, accountant), 5 projects with known estimate/invoice/expense data.
- Query the view as each user.
- Assert: progress, value, margin, days_in_status match hand-computed values byte-for-byte. RLS hides currency columns from member-without-financials.
- Test runs in CI on every migration change.

## 11. File layout

```
src/app/(dashboard)/projects/
  page.tsx                                 ~120 LOC (composition only — was 877)
  layout.tsx                               unchanged
  [id]/                                    unchanged
  new/                                     unchanged
  _components/
    projects-toolbar.tsx                   ~180 LOC
    projects-view-tabs.tsx                 ~140 LOC
    projects-view-settings-menu.tsx        ~120 LOC
    projects-table.tsx                     ~220 LOC (TanStack Table + Virtual)
    projects-table-header.tsx              ~100 LOC
    projects-table-row.tsx                 ~80 LOC
    projects-bulk-bar.tsx                  ~140 LOC
    projects-empty-state.tsx               ~60 LOC
    projects-undo-toast.tsx                ~80 LOC
    projects-conflict-overlay.tsx          ~90 LOC
    cells/
      cell-text.tsx                        ~80 LOC
      cell-textarea.tsx                    ~90 LOC
      cell-number.tsx                      ~70 LOC
      cell-currency.tsx                    ~70 LOC
      cell-date.tsx                        ~120 LOC
      cell-status.tsx                      ~110 LOC
      cell-enum.tsx                        ~90 LOC
      cell-relation.tsx                    ~80 LOC
      cell-team.tsx                        ~180 LOC
      cell-progress.tsx                    ~50 LOC
      cell-photos.tsx                      ~120 LOC (renamed from cell-images for clarity)

src/lib/hooks/projects-table/
  use-projects-table-data.ts               ~140 LOC
  use-project-view.ts                      ~120 LOC
  use-project-views-list.ts                ~80 LOC
  use-table-selection.ts                   ~100 LOC
  use-cell-edit.ts                         ~180 LOC
  use-table-keyboard-nav.ts                ~140 LOC
  use-table-zoom.ts                        ~80 LOC
  use-cell-image-upload.ts                 ~100 LOC

src/lib/api/services/
  project-views-service.ts                 ~140 LOC
  project-table-rpc.ts                     ~100 LOC (typed RPC wrappers)

src/lib/types/
  project-views.ts                         ~60 LOC
  project-table-columns.ts                 ~120 LOC

src/lib/utils/
  project-filter-to-sql.ts                 ~100 LOC
  project-table-formatters.ts              ~80 LOC

src/i18n/dictionaries/en/
  projects.json                            extended (~50 new keys under table.*)
src/i18n/dictionaries/es/
  projects.json                            extended (matching)

supabase/migrations/
  20260512_create_project_views.sql
  20260512_add_project_table_permissions.sql
  20260512_seed_default_project_views.sql
  20260512_create_project_table_rows_view.sql
  20260512_create_project_table_rpcs.sql

package.json
  + @tanstack/react-table@^8.21.0
  + @tanstack/react-virtual@^3.13.0
```

Net: ~3,500 LOC across 37 new/changed files. Current is ~2,800 LOC across 18 files. We add ~700 LOC but each file is independently testable and fits on one screen.

## 12. Out of scope

- Kanban Canvas view — unchanged.
- Project workspace floating window — unchanged.
- `projects` table schema — unchanged (only `project_views` is new).
- `task_team_members` junction table — left as-is. RPC does not write to it. If iOS later requires sync, backwards-compatible follow-up.
- Notification rail — hooked into via existing helpers, not redesigned.
- Mobile phone (<768px) viewport — single "use iPad or larger" message.
- Trigram fuzzy search — Phase 2 (extension already installed in live; just needs index migration).
- Cell formulas, linked records beyond client, sub-table task expand, cross-cell selection, per-cell comments, Cmd+K palette — Phase 2.

## 13. Definition of done

The redesign ships when all of these hold:

- All five migrations applied to production with zero errors.
- All three seeded views populate every existing company.
- `projects_table_v2` flag is on for 100% of users.
- All 60 unit, 35 integration, 12 E2E tests pass in CI.
- Lighthouse a11y score on `/projects` ≥ 95.
- LCP < 1.0s, INP p95 < 200ms, CLS = 0 on production deployed table with 1000-project test company.
- `cell_failed` rate < 0.5% over 72h post-GA window.
- Photo upload success rate > 99% over 72h.
- v1 implementation fully deleted from codebase.
- Supabase TypeScript types regenerated and committed (`supabase gen types typescript --linked > src/lib/types/database.types.ts`).
- Supabase advisors clean (`supabase db lint --linked` returns no critical findings on the new objects).
- All new dictionary keys present in `en/projects.json` AND `es/projects.json`.
- Bible sections updated:
  - `ops-software-bible/02_USER_EXPERIENCE_AND_WORKFLOWS.md` — Projects tab redesign documented
  - `ops-software-bible/10_JOB_LIFECYCLE_AND_DATA_RELATIONSHIPS.md` — `project_views` table, team-RPC pattern documented
  - `ops-software-bible/09_FINANCIAL_SYSTEM.md` — `project_cost` / `margin` derivation documented if not already
- Old `/projects` route's deep links (e.g., `?openProject=<id>&mode=view`) verified still working post-deletion of v1.
- Old hooks (`useScopedProjects`, anything in old `_components/spreadsheet/`) deleted, no orphan imports.

## 14. Implementation phasing

The work splits into six phases. Each is independently shippable and can be feature-flagged independently for graduated rollout. Phases must ship in order — later phases depend on earlier ones.

### Phase 1 — Foundation & schema (Days 1–3)
- Add `@tanstack/react-table@^8.21.0` and `@tanstack/react-virtual@^3.13.0` to package.json.
- Migration A: `public.fn_set_updated_at()` generic trigger function (no existing global helper).
- Migration B: replace `private.current_user_in_project(uuid)` with the active-row, company-scoped version (non-deleted projects + non-deleted tasks only), then add `private.current_user_can_edit_project(uuid)` and `private.current_user_can_assign_team_on_project(uuid)`. All `STABLE SECURITY DEFINER SET search_path = 'public', 'pg_temp'`, granted to `authenticated`. Modeled on existing `private.current_user_can_view_project(uuid)` from migration 074, with company isolation inlined because the Phase 1 RPCs are `SECURITY DEFINER`.
- Migration C: `project_views` table with constraints (no column-level unique on name — only the partial functional `lower(name)` index) + indexes + `BEFORE UPDATE` trigger.
- Migration D: RLS policies on `project_views`, all using `(select private.get_current_user_id())` (never `auth.uid()`).
- Migration E: `role_permissions` inserts for the two new keys — `projects.view_financials` (Admin, Owner, Office, Accountant-if-present — all `'all'` scope) and `projects.manage_views` (Admin, Owner — `'all'` scope). **No `permissions` catalog insert needed; that table doesn't exist.** Pre-check role IDs by querying `roles` table (Admin = `…000001`, Owner = `…000002`, Office = `…000003`; Accountant optional).
- Migration F: replace the existing broad `projects` UPDATE RLS policy with a refined per-row policy that uses `private.current_user_can_edit_project(id)`. Existing SELECT/INSERT/DELETE policies on `projects` left untouched. **Must be created `AS RESTRICTIVE`; verify `pg_policy.polpermissive = false`.**
- Migration G: project-team cache enforcement:
  - `private.recompute_project_team_member_ids(p_project_id uuid) RETURNS text[]`
  - one-time backfill of `projects.team_member_ids` from non-deleted `project_tasks.team_member_ids`
  - `private.sync_project_team_member_ids_from_tasks()` trigger function
  - `AFTER INSERT OR DELETE OR UPDATE OF team_member_ids, deleted_at, project_id ON public.project_tasks`
  - both helper functions are `SECURITY DEFINER SET search_path = 'public', 'pg_temp'`, private schema, no dynamic SQL
  - trigger recomputes `OLD.project_id` and `NEW.project_id` when different; bumps `projects.updated_at` only when the effective cache changes.
- Migration H: `project_table_rows` view with `security_invoker = true` and the `perm` CTE gating financial columns via `has_permission(uid, 'projects.view_financials', 'all')`.
- Migration I: three RPCs, each hardened per Section 3.5.2:
  - `change_project_status(uuid, text, timestamptz) RETURNS jsonb`
  - `assign_project_team_member(uuid, uuid, uuid[], timestamptz) RETURNS jsonb`
  - `remove_project_team_member(uuid, uuid, uuid[], timestamptz) RETURNS jsonb`
  - All: `LANGUAGE plpgsql`, `SECURITY DEFINER`, `SET search_path = 'public', 'pg_temp'`, explicit `GRANT EXECUTE … TO authenticated`, no dynamic SQL, deterministic exception codes `P0001 / 42501 / 22023`.
- Migration J: seed three default views per existing company (idempotent ON CONFLICT against the partial functional index) + trigger on `companies` INSERT for new companies.
- Migration K: regenerate types via `supabase gen types typescript --linked > src/lib/types/database.types.ts`, commit.
- i18n: add `projects.table.*` skeleton keys to en + es dictionaries (per Section 4.9).

**Ship gate:** all eleven migration steps applied to a staging instance, all SQL contract tests pass, generated types clean, RLS-policy regression test for `auth.uid()` vs `private.get_current_user_id()` passes, RPC permission tests pass (Operator denied on un-assigned project, Operator succeeds on assigned project, Admin succeeds on any same-company project, cross-company project denied), `pg_dump --schema-only` includes the replaced `current_user_in_project`, both new helper functions, the team-cache trigger, and all three RPCs with the hardening directives present.

### Phase 2 — Read-only virtualized table (Days 4–7)
- Routes & components: `page.tsx` composition shell, `projects-toolbar`, `projects-view-tabs`, `projects-table`, `projects-table-header`, `projects-table-row`.
- Hooks: `use-projects-table-data`, `use-project-view`, `use-project-views-list`, `use-table-zoom`.
- Cells (read-only flavor only): `cell-text`, `cell-number`, `cell-currency`, `cell-date`, `cell-status` (display only), `cell-progress`, `cell-relation`.
- TanStack Table integration with column definitions.
- TanStack Virtual integration for row virtualization.
- Frozen-left zone + horizontal scroll + scroll shadow.
- Density modes + pinch zoom.
- Loading / empty / error states.
- Three seeded views display correctly.

**Ship gate:** operator can open `/projects`, see one of three views, switch between them, sort/filter, scroll horizontally and vertically without jank. No editing yet.

### Phase 3 — Edit core: optimistic, undo, conflict (Days 8–11)
- `use-cell-edit` hook with full optimistic flow + retry policy + conflict handling.
- `use-table-keyboard-nav` hook.
- `use-table-selection` hook with filter-prune.
- Edit-capable variants of cells from Phase 2 + `cell-textarea`, `cell-enum`.
- `projects-undo-toast` + Cmd+Z wiring.
- `projects-conflict-overlay` for `P0001` responses.
- RPC wrappers in `project-table-rpc.ts`.
- Per-cell save state visual (idle/saving/saved/failed/conflict).

**Ship gate:** all editable cells in Phase 2 are now editable with full optimistic flow. Undo works. Conflict overlay tested with two browser sessions.

### Phase 4 — Complex cells + bulk actions (Days 12–14)
- `cell-team` with cascading popover + RPC integration.
- `cell-photos` with Supabase Storage upload.
- `projects-bulk-bar` with all bulk actions.
- Batch RPC for bulk status / assignment / date changes.
- Context menus (row + header right-click).
- Column drag-reorder + resize with persistence.

**Ship gate:** all 25 columns interact correctly. Bulk actions work. Photo upload works end-to-end.

### Phase 5 — View management + density persistence (Days 15–17)
- `projects-view-settings-menu` with all options (rename, duplicate, share, archive, reset).
- View creation dialog.
- URL deep linking with filter/sort overrides.
- View tab drag-reorder + overflow.
- Density / zoom persistence per view.

**Ship gate:** operators can create personal views, share-to-team (with permission), share links work cross-device.

### Phase 6 — Rollout + hardening (Days 18–22)
- Feature flag `projects_table_v2` wiring.
- Internal dogfood window.
- Beta cohort enable script.
- Performance traces from production data.
- Bible documentation updates.
- v1 deletion + cleanup.

**Ship gate:** all Definition of Done items checked.

---

**Next step:** invoke the `superpowers:writing-plans` skill to produce a step-by-step implementation plan from this v2.4 spec. The implementation plan will follow Phase 1 first, then gate on its ship-gate before producing the Phase 2 plan, and so on. This keeps each phase's plan small enough to execute without losing context.
