# Lead Assignment and Scoped Lead Access — Implementation Plan

> **Execution:** Use `custom-skills:executing-plans` with `superpowers:test-driven-development` and `superpowers:subagent-driven-development`. Complete tasks continuously; do not stop for founder review between batches.

**Goal:** Make lead assignment a secure, auditable responsibility handoff across Supabase, OPS Web, OPS iOS, notifications, realtime, and the email/lead engine, without creating any project owner, project assignee, project membership, or automatic task assignment.

**Architecture:** `opportunities.assigned_to` remains current state and gains an assignment-only version. All assignment mutations pass through one private transactional core exposed by separate human and service-only RPC facades. Override-aware scoped helpers become the authorization source for RLS, server routes, clients, inbox intersections, and conversion. Recipient-addressed delivery rows carry access changes to both old and new assignees even when opportunity RLS hides the changed row. Web and iOS consume the same contracts. Operator grants are a final activation migration after both clients are compatible.

**Required Skills:** `supabase:supabase`, `supabase:supabase-postgres-best-practices`, `custom-skills:interface-design`, `frontend-design:frontend-design`, `custom-skills:ops-design`, `ops-copywriter:ops-copywriter`, `custom-skills:mobile-ux-design`, `animation-studio:animation-architect`, `animation-studio:web-animations`, `animation-studio:ios-animations`, `custom-skills:Elite Animations`, `custom-skills:audit-design-system`, `superpowers:verification-before-completion`, `superpowers:requesting-code-review`

---

## Global constraints

- Work only in isolated feature worktrees. Never touch either dirty primary checkout.
- Use OPS `users.id` for actor and assignee identity. Email addresses are mailbox routing data only.
- Never accept company or actor identity from an ordinary client payload.
- Shared-company-mailbox leads start unassigned. Personal-mailbox ingestion may assign only the connection's canonical active eligible OPS owner through the service facade.
- Suggestions never write `assigned_to` or grant access.
- Every assignment change advances `assignment_version` exactly once and atomically writes immutable history plus addressed delivery rows.
- Direct changes to `assigned_to` or `assignment_version`, including service-role table writes, must fail after enforcement lands.
- Assigned-scope users may transfer their current active lead to an eligible user, but cannot unassign it. All-scope users may assign, transfer, or unassign.
- Conversion reauthorizes under the opportunity row lock and preserves the assignee on the won lead.
- Conversion never creates a project owner/assignee/membership and never populates generated task `team_member_ids`.
- Assigned access to Lead A may expose only Lead A's scoped context, not a shared client's sibling leads, unrelated projects, estimates, or raw company-wide client record.
- Reuse existing OPS tokens and motion primitives. No new visual language, hardcoded styling values, spring physics, or bounce.
- User-facing copy stays terse and tactical and must exist in both English and Spanish dictionaries.
- No production database apply, deploy, push, or Operator activation without a separate explicit deployment decision.

## Locked database contracts

The email hardening work may depend on the first migration and commit only after these exact functions exist.

```sql
public.change_opportunity_assignment(
  p_opportunity_id uuid,
  p_expected_assignment_version bigint,
  p_expected_assigned_to uuid,
  p_new_assigned_to uuid,
  p_source text,
  p_suggestion_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
```

This human facade derives actor and company from `private.get_current_user_id()` and `private.get_user_company_id()`.

```sql
public.change_opportunity_assignment_as_system(
  p_opportunity_id uuid,
  p_expected_assignment_version bigint,
  p_expected_assigned_to uuid,
  p_new_assigned_to uuid,
  p_system_source text,
  p_actor_user_id uuid default null,
  p_suggestion_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
```

The system facade is executable only by `service_role`, validates an exact system-source allowlist and any human actor against the opportunity company, then calls the same private core. It is the only assignment function available to personal-mailbox ingestion, deactivation, permission-change remediation, and audited system repair.

Both facades return `ok`, `conflict`, current `assigned_to`, current `assignment_version`, and `event_id`. A stale assignee/version returns current state without mutation.

`public.convert_opportunity_to_project` gains trailing `p_expected_assignment_version bigint default null`; the old signature is dropped to prevent PostgREST overload ambiguity. The transaction writes one idempotent `opportunity_conversion_events` row keyed to the opportunity/project conversion. This is the stable post-conversion integration point for the email pipeline's private `image/*` attachment projection.

## Migration order

1. `supabase/migrations/20260715160000_lead_assignment_foundation.sql`
   - reconciles the live conversion definition with pending repository invariants
   - adds assignment state/history/suggestion/delivery/conversion-event schema
   - adds canonical helpers, both guarded facades, guarded manual creation, and direct-write enforcement
   - does **not** grant Operator access
2. `supabase/migrations/20260715160500_lead_assignment_scoped_rls.sql`
   - opportunity and child-record RLS, opportunity-scoped context functions, preflight/conversion authorization, realtime publication
3. `supabase/migrations/20260715161000_lead_assignment_permission_migration.sql`
   - snapshots and deterministically maps existing preset/custom role grants and user overrides without activating Operator pipeline access
4. Email hardening migrations `20260715162000_email_send_intents.sql` and `20260715163000_phase_c_auto_send_queue.sql` may depend on the foundation contract.
5. `supabase/migrations/20260715164000_lead_assignment_operator_activation.sql`
   - final, separately controlled activation after web and iOS compatibility proof

---

### Task 1: Guarded assignment foundation and conversion integration seam

**Files:**

- Create: `tests/unit/supabase/lead-assignment-foundation-migration.test.ts`
- Create: `tests/sql/lead-assignment-contract.sql`
- Create: `supabase/migrations/20260715160000_lead_assignment_foundation.sql`
- Modify: `src/lib/types/database.types.ts` only after applying the migration to an isolated development database

**Skills:** `supabase:supabase`, `supabase:supabase-postgres-best-practices`, `superpowers:test-driven-development`

1. Write migration contract tests that fail because the migration and exact RPC signatures do not exist.
2. Run the focused Vitest command and capture the expected failures.
3. Reconcile `pg_get_functiondef(public.convert_opportunity_to_project)` from live with `20260713200000_project_opportunity_link_invariant.sql` and the live deck/lead-photo carryover. Preserve every existing responsibility.
4. Add `assignment_version bigint not null default 0`, the `assigned_to -> users(id) on delete restrict` constraint, and the active assigned-list index.
5. Add immutable `opportunity_assignment_events`, explainable `opportunity_assignment_suggestions`, recipient-addressed `opportunity_assignment_deliveries`, and idempotent `opportunity_conversion_events` with RLS/grants/indexes.
6. Add fixed-search-path eligibility and effective-scope helpers, the private mutation core, the exact human and system facades above, and guarded manual creation.
7. Add `private.guard_opportunity_assignment_mutation()` plus the `BEFORE INSERT OR UPDATE OF assigned_to, assignment_version` trigger. Ordinary null/version-zero inserts remain valid; all non-null initial assignment and assignment/version changes require the transaction-local core marker.
8. Redefine conversion with the trailing expected assignment version, row-lock authorization seam, idempotent conversion event, preserved media/deck/project-link behavior, and still-unassigned generated tasks.
9. Run the focused migration test to green.
10. Run the SQL contract against an isolated development database to prove stale conflict behavior, target eligibility, history/delivery idempotency, direct authenticated/service-role write rejection, and conversion invariants.
11. Commit atomically: `feat(leads): add guarded assignment foundation`.
12. Send the exact migration path, commit, RPC signatures, and conversion-event contract to the email audit task immediately.

### Task 2: Scoped authorization, child isolation, and conversion/preflight RLS

**Files:**

- Create: `tests/unit/supabase/lead-assignment-rls-migration.test.ts`
- Create: `tests/unit/supabase/lead-assignment-conversion-migration.test.ts`
- Create: `supabase/migrations/20260715160500_lead_assignment_scoped_rls.sql`
- Modify: `tests/sql/lead-assignment-contract.sql`
- Modify: `src/app/api/opportunities/[id]/preflight/route.ts`
- Modify: `src/app/api/opportunities/[id]/convert/route.ts`
- Modify: `src/lib/api/services/project-conversion-service.ts`
- Modify: conversion callers in `src/lib/api/services/approval-queue-service.ts`, `src/lib/api/services/conversation-state/acceptance-evaluation.ts`, and `src/lib/api/services/sync-engine.ts`

1. Write failing tests for no/assigned/all view, edit, assign, and convert scopes; malformed prerequisite grants; shared-client sibling non-disclosure; and conversion races.
2. Add canonical `current_user_can_create/view/edit/assign/convert_opportunity` helpers with view/edit prerequisite intersection and bounded `pipeline.manage:all` compatibility.
3. Replace opportunity restrictive policies and harden opportunity-linked activities, follow-ups, site visits, deck designs, correspondence, drafts, and pending sends without breaking their non-opportunity paths.
4. Add guarded opportunity-context functions for contact/client, estimates, projects/preflight, activities, follow-ups, visits, media, and correspondence. Do not widen raw client/estimate policies.
5. Make preflight return only authorized project/context information.
6. Pass expected assignment version through conversion routes/services and keep the user on the won lead when the resulting project is inaccessible.
7. Add assignment deliveries to `supabase_realtime` with recipient-only access independent of current lead access.
8. Run focused migration, API, service, and SQL tests to green.
9. Commit atomically: `feat(leads): enforce scoped lead access`.

### Task 3: Permission registry, prerequisite validation, and safe migration

**Files:**

- Modify: `src/lib/types/permissions.ts`
- Modify: `src/lib/permissions/resolve.ts`
- Modify: `src/lib/store/permissions-store.ts`
- Modify: `src/components/settings/permission-grid.tsx`
- Modify: `src/components/settings/roles-tab.tsx`
- Modify: `src/components/settings/member-access-view.tsx`
- Modify: `src/app/api/roles/[id]/permissions/route.ts`
- Modify: `src/app/api/users/[id]/permission-overrides/route.ts`
- Create: `src/lib/permissions/pipeline-dependencies.ts`
- Create: `tests/unit/permissions/pipeline-dependencies.test.ts`
- Extend: permission registry/resolve and role/override route tests
- Create: `supabase/migrations/20260715161000_lead_assignment_permission_migration.sql`

1. Write failing registry and dependency-matrix tests for independent create/view/edit/assign/convert and inbox scopes.
2. Register `pipeline.create/view/edit/assign/convert` and scoped `inbox.view/send`; retain only bounded company-wide compatibility keys.
3. Implement one shared prerequisite normalizer used by the client store and both permission write APIs.
4. Change Pipeline and Inbox editors from module-wide scope forcing to per-action controls capable of `view:all / edit:assigned`, with concise dependency explanations in EN/ES dictionaries.
5. Replace non-atomic permission replacement with guarded atomic RPCs that validate final effective access and block stranding active assignments.
6. Add the deterministic snapshot/mapping migration and machine-checkable before/after report tables. Do not grant Operator pipeline access yet.
7. Run focused tests, type-check changed surfaces, and commit: `feat(permissions): add scoped lead capabilities`.

### Task 4: Web guarded services, routes, hooks, and create flow

**Files:**

- Modify: `src/lib/types/pipeline.ts`
- Modify: `src/lib/api/services/opportunity-service.ts`
- Modify: `src/lib/hooks/use-opportunities.ts`
- Modify: `src/lib/hooks/use-opportunity-field-edit.ts`
- Modify: `src/lib/hooks/pipeline-table/use-opportunity-cell-edit.ts`
- Modify: `src/lib/hooks/pipeline-table/use-pipeline-bulk-actions.ts`
- Create: `src/app/api/opportunities/[id]/assignment/route.ts`
- Create: `src/lib/api/services/lead-assignment-service.ts`
- Create: `src/lib/hooks/use-lead-assignment.ts`
- Modify: `src/components/ops/create-lead-modal.tsx`
- Modify: `src/app/(dashboard)/pipeline/page.tsx`
- Create/extend focused route, service, and hook tests

1. Write failing tests proving generic update/create/bulk paths cannot send `assigned_to` and guarded conflict state reaches callers.
2. Add `assignmentVersion` mapping and remove assignment from generic update payloads.
3. Implement the actor-derived assignment route/service and a hook with network-only mutation, authoritative conflict handling, targeted cache invalidation, and no generic undo.
4. Move manual creation to the guarded creation RPC. Keep company-mailbox creation unassigned and personal-mailbox creation on the service facade contract.
5. Update every direct assignment caller to use the guarded hook or remove assignment behavior.
6. Run focused tests and commit: `feat(leads): route web assignment through guarded contract`.

### Task 5: Web Leads scope, assignment UI, notifications, and realtime eviction

**Files:**

- Modify: `src/app/(dashboard)/pipeline/page.tsx`
- Modify: pipeline filters, map band, field editors, table cells/rows/bulk bar, focused cards, detail panels, and stage actions under `src/app/(dashboard)/pipeline/_components/`
- Create: `src/lib/permissions/lead-access-policy.ts`
- Create: `src/lib/hooks/use-lead-assignment-realtime.ts`
- Create: `src/lib/api/services/lead-assignment-delivery-service.ts`
- Create: `src/app/api/cron/lead-assignment-deliveries/route.ts`
- Modify: `vercel.json`
- Modify: notification service/meta/hooks and `src/stores/window-store.ts`
- Modify: `src/i18n/dictionaries/{en,es}/{pipeline,notifications}.json`
- Add focused unit/integration/E2E tests

1. Write failing policy/UI tests for assigned-only, view-all/edit-assigned, assign-assigned, assign-all, conversion, and deep-link behavior.
2. Replace the single `canManage` flag with row-specific view/edit/assign/convert decisions.
3. Assigned-only users see only their focused queue and no company-wide assignee labels/filters. Company-wide users get All, Mine, Unassigned, and active eligible-member filters.
4. Rename every lead-responsibility “Owner” label/comment to “Assignee.” Put the control near lead identity; allow null only for all-scope actors.
5. Add recipient delivery consumption, list/detail/metrics/inbox invalidation, explicit inaccessible-detail removal, and window closure after access loss.
6. Add standard `lead_assigned` notification copy/deep links and an idempotent delivery worker. Only the new assignee receives visible notification.
7. Reuse existing popover/row transitions and OPS motion tokens; honor reduced motion.
8. Run focused tests, design-system audit, type-check, and browser verification. Commit: `feat(leads): ship assigned lead workflow on web`.

### Task 6: Reconcile the email/lead-engine integration

**Files:**

- Coordinate with worktree `/Users/jacksonsweet/Projects/OPS/ops-web-email-pipeline-hardening`
- Review its assignment-dependent send-intent, Phase C, inbox, draft, attachment, and personal-mailbox ingestion changes
- Add/extend assignment/inbox intersection tests in the owning branch

1. Give the email task the Task 1 commit and exact human/system signatures before it unblocks assignment-dependent code.
2. Require personal-mailbox ingestion to call `change_opportunity_assignment_as_system`; shared mailbox creation remains null assignment.
3. Require thread list/detail/draft/attachment/send authorization to intersect scoped inbox access with scoped opportunity access.
4. Preserve original mailbox/thread identity while recording authenticated OPS actor.
5. Make the later durable `image/*` email attachment projection consume `opportunity_conversion_events` idempotently; do not override an older conversion function.
6. Review its final diff against this plan and run the combined email/assignment test slice before integration.

### Task 7: iOS guarded data model and permission foundation

**Worktree:** Create a dedicated `ops-ios` lead-assignment worktree from the correct integration base after coordinating overlapping active worktrees.

**Files:**

- Add `assignmentVersion` through a correct SwiftData V16 schema/migration; never mutate historical schema fingerprints in place
- Modify Opportunity DTOs/repository and add guarded assignment/create/context methods
- Add `LeadAccessPolicy`
- Modify permission registry/store and Leads-tab visibility
- Extend `OpportunityDTOTests`, pipeline view-model tests, permission tests, and migration tests

1. Write failing DTO, schema-migration, permission-matrix, and repository conflict tests.
2. Introduce the SwiftData V16 opportunity shape and lightweight migration.
3. Remove `assigned_to` from generic create/update DTO paths and call the guarded RPCs.
4. Implement effective create/view/edit/assign/convert prerequisite intersection and make assigned view scope expose the Leads tab.
5. Run focused tests and commit: `feat(leads): add iOS assignment foundation`.

### Task 8: iOS Leads workflow, complete context, realtime purge, and conversion

**Files:**

- Modify Leads list/detail/stage views, add-lead sheet, conversion sheet/service, notifications/deep links, realtime processor, and `DataController`
- Centralize the six audited lead-creation paths on the guarded repository
- Add opportunity-scoped correspondence/context UI and repository calls
- Add focused view-model, notification, realtime, cache-purge, conversion, and snapshot tests

1. Write failing tests for assigned-only queues, independent controls, direct transfer/no unassign, conflict/offline behavior, and conversion races.
2. Implement assigned-only and company-wide list modes with compact assignee identity only where useful.
3. Add assignment control to lead detail using existing OPS mobile tokens and 44pt touch targets.
4. Add authorized lead correspondence/context so a user can read prior shared-mailbox history and reply through OPS instead of `mailto:`.
5. Consume addressed access events, refetch authoritatively, purge all lead-owned cached context after access loss, and close stale detail.
6. Harden conversion failure/success behavior and keep the user on the won lead if project access is absent.
7. Run focused simulator tests, design-system audit, and an isolated generic iOS build. Commit: `feat(leads): ship assigned lead workflow on iOS`.

### Task 9: Operator activation, Bible, generated types, and full verification

**Files:**

- Create: `supabase/migrations/20260715164000_lead_assignment_operator_activation.sql`
- Update: relevant sections of `ops-software-bible/10_JOB_LIFECYCLE_AND_DATA_RELATIONSHIPS.md`, `ops-software-bible/13_EMAIL_SYSTEM.md`, permissions/data architecture documentation, and migration index
- Regenerate: web and iOS database types from the reconciled development database
- Update: this plan's verification ledger/artifacts under `docs/artifacts/`

1. Write a failing activation migration test proving the exact Operator defaults and intentional inbox narrowing.
2. Add the final activation migration only after both client branches pass compatibility tests.
3. Update the Bible with exact function signatures, permission semantics, assignment/history/delivery schema, email identity boundary, conversion-event integration, no-project-owner rule, and rollout/rollback procedure.
4. Run Supabase security/performance advisors on the development schema and fix every feature-related finding.
5. Run all focused web tests, full type-check, production build, Playwright Canpro/Jason scenario, SQL role/JWT contract, iOS focused tests, and isolated iOS build.
6. Request task reviews after every implementation commit and a final whole-branch review. Fix all Critical/Important findings and rerun covering tests.
7. Prepare a founder-facing closeout with exact verified behavior, commits, migration order, deployment state, remaining action requiring explicit authorization, and no unsupported “live” claim.

