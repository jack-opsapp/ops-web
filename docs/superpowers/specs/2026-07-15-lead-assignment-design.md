# Lead Assignment and Scoped Lead Access — Design Specification

**Date:** 2026-07-15

**Status:** Approved design; pending written-spec review

**Surfaces:** OPS Web, OPS iOS, Supabase, notifications, email/lead engine

**Primary example:** Canpro assigns a framing or renovation lead to Jason Zavarella so he can see its complete context, communicate with the client, update the lead, transfer it when necessary, and convert it when won.

---

## 1. Outcome

OPS will treat lead assignment as a first-class sales-responsibility concept.

Each lead has either one accountable assignee or no assignee. An assigned team member sees that lead in the Leads tab and can act on it according to independently configurable view, edit, assignment, conversion, and email permissions. Assignment is enforced at the database and server boundaries, not only by hiding interface elements.

This feature does **not** create a project owner, project assignee, project membership, or automatic task assignment. OPS projects have no owner/assignee concept. People are assigned to `project_tasks`; `projects.team_member_ids` is only a server-derived cache of task assignees.

## 2. Product principles

1. **One lead, one accountable person.** Collaboration does not dilute responsibility.
2. **Visibility and editing are independent.** A user may view all leads but edit only assigned leads.
3. **Authorization follows OPS identity.** Access uses the authenticated OPS `users.id`, never an email-address match.
4. **Email identity and application identity are separate.** The mailbox determines the client-facing sender; the OPS user identifies who acted.
5. **Suggestions are not assignments.** A recommendation never grants access until a permitted user confirms it.
6. **Conversion ends lead responsibility without inventing project staffing.** The assignee remains on the won lead as sales history; generated project tasks are unassigned.
7. **Transfers are immediate and auditable.** The new assignee receives access as the prior assignee loses it.
8. **Server enforcement is mandatory.** No client, API route, service-role path, realtime subscription, or child record may bypass the same policy.

## 3. Current-system findings

The 2026-07-15 read-only audit of code, the OPS Software Bible, and the live `ops-app` Supabase project established these facts:

- `public.opportunities.assigned_to uuid` already exists and is nullable, but it is not yet the basis of an end-to-end assigned-access system.
- Opportunity RLS currently requires company-wide `pipeline.view` for reads and company-wide `pipeline.manage` for writes. An `assigned` scope cannot currently work.
- The live Operator preset has no pipeline permissions, so an Operator cannot reliably see the Leads tab today.
- The generic permission engine already understands ordered scopes and per-company overrides; this initiative extends that engine rather than creating role-specific checks.
- iOS loads a company-wide pipeline, defaults a manually created lead to the creator, and does not provide a complete reassignment workflow.
- Web can write `assigned_to` through existing opportunity update paths, but the surrounding permission, audit, notification, and child-record boundaries are incomplete.
- The canonical conversion transaction creates or links a project, relinks estimates, materializes LABOR items as `project_tasks`, copies the supported lead media, wins the opportunity, and records the disposition. It accepts no project or task assignee input.
- Materialized tasks omit `team_member_ids` and therefore start unassigned.
- `project_tasks.team_member_ids` is the authoritative job-assignment source. The live project team cache had zero drift across all active projects at audit time.
- The email send route and thread reads need actor-derived authorization. Client-submitted user/company identifiers and company-mailbox membership are not sufficient authorization.

These are the starting constraints. Implementation must verify the live schema again immediately before migrations because production state is time-sensitive.

## 4. Locked product decisions

| Decision | Locked behavior |
|---|---|
| Accountability | One nullable lead assignee at a time |
| Company-inbox lead | Starts unassigned; a suggested assignee may be shown for confirmation |
| Manually created lead | A user with lead-create authority creates it and receives the initial assignment atomically |
| Personal-mailbox lead | Defaults to that mailbox's active, assignment-eligible OPS user |
| Assigned-only user | Sees assigned leads only; never sees the unassigned queue |
| Company-wide user | Can view all, mine, unassigned, or a selected team member's leads |
| Reassignment | Immediate transfer with audit history and notification |
| Assigned-level assignment | May transfer a currently assigned lead directly to another active, same-company, assignment-eligible user |
| Returning to unassigned | Requires company-wide assignment authority |
| View all / edit assigned | Other users' leads open read-only; assigned leads remain editable |
| View all / edit all | Full company-wide lead editing |
| Complete context | Assigned users receive the lead's existing history, not only post-assignment activity |
| Email replies | Continue through the thread's existing mailbox; the acting OPS user is recorded internally |
| New email | Uses an authorized default mailbox or an explicitly selected authorized sender |
| Conversion | Assigned operators may convert assigned leads when granted conversion permission |
| After conversion | Lead assignee remains on the won opportunity; nobody is assigned to the project or generated tasks |
| Historical backfill | Preserve existing assignments; do not auto-distribute historical unassigned leads |

## 5. Scope and non-goals

### In scope

- First-class lead assignment on web and iOS.
- Dedicated lead creation plus assigned/all scopes for lead view, edit, assignment, and conversion.
- Operator role defaults that expose the Leads tab at assigned scope.
- Database helpers, RLS, guarded mutations, indexes, audit history, notifications, and realtime behavior.
- Assigned-lead access to the lead-owned context necessary to work the lead.
- Company and personal mailbox identity rules for lead communication.
- A defined suggestion contract for the lead engine.
- Safe team-member deactivation behavior.
- Conversion authorization without downstream staffing.
- Backward-compatible rollout across web and App Store-delivered iOS clients.

### Explicit non-goals

- No project owner.
- No project assignee.
- No independent project membership created from a lead.
- No automatic assignment of the lead assignee to project tasks.
- No multi-assignee lead model or secondary collaborator list.
- No cross-company lead sharing.
- No silent automatic routing of company-inbox leads in the initial release.
- No retroactive guessed assignments for existing unassigned leads.
- No rewrite of the mailbox-provider integration or project conversion transaction beyond the authorization boundary required here.

## 6. Permission model

### 6.1 Capabilities

The permission catalog gains independent lead capabilities:

| Permission | `assigned` | `all` |
|---|---|---|
| `pipeline.view` | View leads where `assigned_to` equals the current OPS user | View all non-deleted company leads allowed by the active/archived surface |
| `pipeline.edit` | Edit a lead assigned to the current user | Edit any company lead |
| `pipeline.assign` | Transfer a currently assigned lead directly to another active, same-company, assignment-eligible user | Assign, transfer, or unassign any company lead, including leads in the unassigned queue |
| `pipeline.convert` | Convert a lead assigned to the current user | Convert any eligible company lead |

`pipeline.create:all` is a company-scoped creation capability rather than a row scope. It permits manual lead creation. Creation defaults the lead to the creator and records the initial assignment atomically without requiring `pipeline.assign:all`. A creator with `pipeline.assign:all` may instead choose another assignment-eligible user or leave the new lead unassigned.

Absence of a permission means no access. `own` is not used for these four lead capabilities; lead creation provenance is not responsibility.

`pipeline.manage` remains a temporary compatibility permission for already-shipped clients and company-wide administrative paths. New code must use the granular capabilities. Compatibility fallbacks must accept only `pipeline.manage:all` and must be removed after supported clients no longer depend on them; they must never turn `pipeline.manage` into a second assigned-access model.

### 6.2 Valid combinations

The access editor prevents a capability from exceeding its prerequisite:

- Edit scope cannot exceed view scope.
- Assignment scope cannot exceed edit scope.
- Conversion scope cannot exceed edit scope.
- Create requires a view scope that covers at least assigned leads.
- `view:all / edit:assigned` is valid and intentionally supported.
- `view:assigned / edit:all` is invalid.

The permission editor and every API/RPC that mutates role permissions or user overrides must explain, validate, and preserve these dependencies rather than saving a configuration that can never behave coherently. Runtime helpers also intersect edit/assign/convert with their prerequisites, so malformed direct permission data cannot grant a capability beyond effective view/edit scope.

### 6.3 Role defaults

The Operator preset receives:

- `pipeline.create:all`
- `pipeline.view:assigned`
- `pipeline.edit:assigned`
- `pipeline.assign:assigned`
- `pipeline.convert:assigned`
- `inbox.view:assigned` for threads linked to an assigned lead
- `inbox.send:assigned` for threads linked to an assigned lead

Company owners and office/administrative presets retain company-wide scopes. Runtime authorization remains permission-based; neither RLS nor application code branches on a role name.

### 6.4 Domain intersections

Lead scope is necessary for every lead-linked record. Specialized actions may still require their domain permission:

- `pipeline.view` grants the lead record and the lead-owned context necessary to understand it: contact data, activities, notes, follow-ups, lead files/photos, site visits, and linked estimate context.
- Lead-bound correspondence requires the intersection of `pipeline.view` for the parent lead and `inbox.view` for the thread. The Operator defaults satisfy both at assigned scope, so the assigned user receives the complete pre-assignment conversation.
- `pipeline.edit` governs lead fields, stages, notes/follow-ups, and other lead-lifecycle mutations.
- Sending lead-bound correspondence requires `pipeline.edit` for the parent lead, the appropriate `inbox.send` scope, and an authorized mailbox connection.
- Editing an estimate, deleting media, or performing another specialized action continues to require that domain's existing edit/delete permission.

This intersection prevents both failure modes: an assigned operator does not receive unrelated company data, and a domain permission does not expose a lead the user cannot view.

Shared records must be exposed through opportunity-scoped projections or guarded queries. Permission to Lead A may expose only the client/contact and estimate context linked to Lead A; it must not reveal the same client's Lead B, unrelated projects, unrelated estimates, or a raw company-wide client record.

### 6.5 Inbox scope semantics

- `inbox.view:own` preserves access to the actor's own personal mailbox connections.
- `inbox.view:assigned` includes the actor's own personal-mailbox threads plus threads linked to a lead currently assigned to the actor. Unlinked shared-company-mailbox threads and threads for other users' leads remain hidden.
- `inbox.view:all` exposes company-wide inbox data allowed by the product's existing archive/deletion rules.
- `inbox.send:assigned` permits sending only when the linked lead is currently assigned to the actor and `pipeline.edit` also authorizes it.
- `inbox.send:all` permits sending for any otherwise-authorized company lead/thread.

Mailbox membership or connection ownership is transport authorization only; it never substitutes for lead/thread authorization. For lead-linked correspondence, the opportunity and inbox helpers must be used together by standalone Inbox lists, thread detail, lead detail, drafts, attachments, and sends. An unlinked thread in the actor's own personal mailbox has no parent-lead permission to intersect and remains governed by the personal-mailbox inbox scope; an unlinked shared-company-mailbox thread never satisfies assigned scope.

`inbox.view_company` remains a temporary compatibility alias for company-wide inbox viewing and is retired after clients and permission data migrate to scoped `inbox.view`.

### 6.6 Deterministic permission migration

Before changing effective grants, snapshot every role permission and company/user override. Migrate without widening access:

- Existing `pipeline.view:all` becomes `pipeline.view:all`.
- Existing `pipeline.manage:all` becomes `pipeline.create:all`, `pipeline.edit:all`, `pipeline.assign:all`, and `pipeline.convert:all` while retaining the temporary compatibility grant.
- Existing `inbox.view_company:all` becomes `inbox.view:all`.
- Existing `inbox.view` without `inbox.view_company` is audited connection by connection before it becomes `inbox.view:own`. The new `own` scope means the actor's personal mailbox only; it does not preserve the legacy route's incidental visibility into every thread on a shared company connection.
- The Operator preset moves to `inbox.view:assigned`, retaining personal-mailbox access and adding assigned-lead threads while deliberately removing unrelated and unlinked shared-company-mailbox threads. This is an intentional security narrowing and must appear explicitly in the before/after report.
- Existing company-wide `inbox.send:all` remains company-wide.

Apply the same semantic mapping to customized roles and per-user/company overrides. Produce a before/after diff, reject any accidental scope increase, and verify representative customized users before legacy fallbacks are removed.

## 7. Authorization architecture

### 7.1 Canonical helpers

Create one set of opportunity authorization helpers and reuse them everywhere:

- current user may create opportunity
- current user may view opportunity
- current user may edit opportunity
- current user may change opportunity assignment
- current user may convert opportunity

Create parallel scoped thread helpers for inbox view and send. They resolve an assigned inbox scope through the thread's canonical lead relationship and then intersect it with the corresponding opportunity helper.

Each helper resolves the authenticated actor to the canonical OPS user, confirms company membership, resolves the effective permission scope through the existing override-aware engine, and applies `assigned_to = current_user_id` for assigned scope.

Unassigned opportunities never satisfy assigned scope. Suggested assignees never satisfy assigned scope.

### 7.2 Enforcement layers

The same helpers govern:

- Opportunity RLS.
- RLS or guarded access for lead-linked child records.
- Next.js API routes and service methods.
- SECURITY DEFINER RPCs.
- iOS Supabase reads and mutations.
- Realtime subscriptions and post-event refetches.
- Email thread reads, sends, drafts, attachments, and lead-thread reassignment.
- Conversion preflight and conversion execution.

Service-role use does not erase actor authorization. Any route using a service-role client must authenticate the request, resolve the actor server-side, authorize the target resource, and ignore client-submitted actor/company claims.

### 7.3 Company isolation and assignee validity

`opportunities.assigned_to` references `public.users(id)` with `ON DELETE RESTRICT`. OPS uses the audited soft-deactivation workflow; identity rows referenced by historical assignment or won-lead attribution are not hard-deleted. Every non-null assignee must be an active, same-company, assignment-eligible user whose effective `pipeline.view` permission covers assigned leads. The database rejects cross-company, inactive-user, inaccessible-target, and fabricated assignments even when a buggy client or privileged server route attempts one.

Assignment validation must use the repository's canonical active-user state discovered during implementation; it must not invent a new parallel definition of "active."

## 8. Assignment data and mutation contract

### 8.1 Opportunity fields and indexes

`opportunities.assigned_to` remains the authoritative current state. Add a dedicated `assignment_version` that increments only when assignment changes; unrelated lead edits must not create false assignment conflicts. Add only the constraints and indexes required for integrity and fast company/assignee pipeline queries. Index design must support the real filters used by active, non-deleted, non-archived lead surfaces.

Advisory routing state is separate from `assigned_to`. The canonical shape is an `opportunity_assignment_suggestions` record containing the opportunity, suggested user, confidence, reason/signals, generator version, generation timestamp, and a resolution state of pending, accepted, rejected, invalidated, or superseded. Accepting a suggestion invokes the same guarded assignment operation as a manual choice.

### 8.2 Immutable history

Every assignment transition, including an initial non-null assignment at creation, writes an immutable `opportunity_assignment_events` record containing:

- company and opportunity IDs
- previous assignee, nullable
- new assignee, nullable
- acting OPS user, nullable only for an enumerated trusted system source
- source (`manual`, `suggestion_accept`, `personal_mailbox`, `manual_create`, `deactivation`, `permission_change`, `admin_correction`, or `system_repair`)
- timestamp and structured metadata required for traceability

The history is append-only to application roles and inherits view access from its parent lead. Correcting the current assignee writes another event; it never rewrites history. User identity snapshots retained on the event keep the audit intelligible even after a team member is deactivated or later removed.

### 8.3 Guarded assignment operation

All supported clients and trusted system paths use one guarded operation. In one transaction it:

1. Resolves and authorizes either an authenticated OPS actor or a narrowly allowlisted system principal, recording system provenance when no human actor exists.
2. Locks the opportunity and verifies the caller's expected current assignee and `assignment_version`.
3. Validates that the target is an active, same-company, assignment-eligible user whose effective `pipeline.view` covers assigned leads.
4. Enforces assigned-vs-all assignment semantics.
5. Updates `assigned_to`.
6. Resolves any pending suggestion.
7. Writes the immutable history event.
8. Writes an idempotent `lead_assignment_changed` delivery/outbox event addressed to the affected users; the notification dispatcher derives the new-assignee notification from this durable event.

Every direct change to `assigned_to` outside the guarded operation is rejected by database enforcement, including generic opportunity updates, ordinary edit callers, ingestion code, and service-role routes. No path may skip assignment authorization, immutable history, assignment-version advancement, or outbox creation.

### 8.4 Transfer behavior

- A direct transfer is a single transition from user A to user B; it does not pass through unassigned.
- On commit, user B gains access and user A loses assigned-only access.
- User A retains access only if their view scope is company-wide.
- An assigned-scope user cannot set the assignee to null.
- A company-wide assignment user may set the assignee to null, returning the lead to the controlled unassigned queue.
- Terminal lead assignment is historical. Assigned-scope users cannot transfer terminal leads; company-wide users may make an audited correction when necessary.

## 9. Lead creation and routing

### 9.1 Company mailbox

A lead created from the shared company mailbox starts with `assigned_to = null`. The lead engine may create a suggestion based on source, client history, trade fit, and workload, but only a permitted user's confirmation changes `assigned_to` or grants access.

### 9.2 Manual creation

A user with `pipeline.create:all` may create a manual lead. Creation and its initial assignment occur in one guarded transaction. The lead defaults to the creator when the creator is an active, same-company, assignment-eligible user whose effective `pipeline.view` covers assigned leads; this self-assignment does not require `pipeline.assign:all`. Otherwise it enters the unassigned queue. A creator with `pipeline.assign:all` may choose another eligible user or unassigned during creation. Every non-null initial assignment is recorded with source `manual_create`.

### 9.3 Personal mailbox

A lead deterministically created from a user's personal connected mailbox defaults to that mailbox's canonical OPS owner only when the owner is active, same-company, assignment-eligible, and has effective `pipeline.view` covering assigned leads. If that owner is no longer eligible, the lead enters the company unassigned queue instead of failing or assigning by email address.

### 9.4 Existing data

- Preserve valid existing `assigned_to` values.
- Report and safely clear only proven invalid or cross-company assignments through an explicit reviewed data repair.
- Leave existing unassigned leads unassigned.
- Do not run an AI or heuristic backfill that changes accountability without a human decision.

## 10. User experience

### 10.1 Leads tab

The tab is visible whenever the user has any effective `pipeline.view` scope.

Assigned-only users receive a focused queue containing their accessible leads. Because every visible row is theirs, the list does not repeat an assignee label or expose company-wide filters.

Company-wide viewers can filter between:

- all accessible leads
- their own leads
- unassigned leads
- a selected active team member

The existing urgency, stage, search, archive, and terminal-state behavior remains; assignment is another access/filter dimension, not a replacement pipeline.

### 10.2 Lead detail

The current assignee appears in the lead header near the lead's primary identity and status. It is:

- editable for a permitted assignment actor
- read-only for a viewer without assignment authority
- explicitly unassigned for company-wide viewers when null

The picker searches only active, same-company, assignment-eligible users whose effective `pipeline.view` covers assigned leads, and distinguishes a suggestion from the committed assignee. Company-wide actors can return a lead to unassigned. Assigned-scope actors can only choose another eligible user.

### 10.3 Scan surfaces

Rows remain optimized for scanning. Company-wide views show compact assignee identity because it answers a material triage question. Reassignment actions live in the detail surface and the row context menu rather than adding permanent action buttons to every row.

### 10.4 Realtime handoff

After assignment commits, the durable access-change event is addressed to both the previous and new assignee so each client can invalidate the correct cache even when opportunity-row RLS suppresses the changed row:

- the new assignee receives the lead without a manual refresh
- the prior assigned-only user sees it leave their queue
- company-wide views update the assignee in place
- an open stale detail view closes or becomes inaccessible according to the new permission

Clients must treat the server event/refetch as authoritative and must not retain a leaked cached detail after access is lost. Only the new assignee receives a user-facing assignment notification; the previous assignee's access-change event is a silent cache-purge signal.

## 11. Notifications

Assignment creates a standard, dismissible notification for the new assignee with a deep link to the lead. It appears in the web notification rail and the platform notification path used by iOS; push is delivered when enabled.

Do not notify a user for assigning a lead to themselves unless the action came from an external/system route where confirmation is useful. Reassignment does not create a noisy user-facing notification for the prior assignee; the addressed access-change event removes stale data, and the immutable history preserves the record.

When deactivation returns active leads to unassigned, company-wide assignment users receive a consolidated actionable notification rather than one notification per lead.

## 12. Email and mailbox identity

### 12.1 Identity model

Three identities remain distinct:

1. **OPS actor:** the authenticated `users.id` who viewed or sent.
2. **Mailbox connection:** the provider account authorized to send/sync.
3. **Client-facing address:** the address displayed in the email conversation.

An email address is never used as a substitute for the OPS actor or the lead assignee.

### 12.2 Existing-thread replies

Replies use the mailbox connection already attached to the thread. Jason may therefore reply through Canpro's shared address while OPS attributes the action to Jason internally. Connecting Jason's personal mailbox is not required for him to work a company-mailbox lead.

### 12.3 New conversations and sender switching

For a new outbound conversation, the user may use the authorized company mailbox or their own authorized personal mailbox. Explicit sender switching is allowed only among connections the server confirms the actor may use. Switching away from an existing thread's mailbox starts a new provider thread linked to the same OPS lead/conversation; it never impersonates or mutates the original provider thread. One user may not use another user's personal mailbox merely because both belong to the same company.

### 12.4 Thread reconciliation

Provider message/thread IDs and mailbox-connection identity preserve threading. Inbound replies reconcile to the same OPS conversation and lead even when the mailbox address differs from the assignee's login email. The thread's lead relationship determines assigned-lead authorization; the existence of a company mailbox alone does not grant every company user access.

### 12.5 Send-route hardening

Before calling the provider, the server persists a durable send intent with a deterministic idempotency key and the authorized actor/mailbox/thread/lead relationship. The server then must:

- authenticate the caller
- derive the OPS user and company server-side
- load and authorize the lead/thread
- require lead edit plus inbox send authority
- validate the mailbox connection and original thread identity
- ignore client-supplied actor/company claims
- record the real actor and mailbox connection
- reconcile sent activity exactly once after provider acceptance

If the provider rejects the send, OPS preserves the draft and writes no sent activity. If the provider accepts but database reconciliation initially fails, retry resumes reconciliation from the durable send intent and must not send a duplicate message.

## 13. Lead-engine backend contract

The agent responsible for the AI/lead email backend receives this contract before implementation begins:

- Use OPS `users.id` for assignee and actor identity.
- Treat mailbox email addresses only as connection/routing data.
- Company-mailbox ingestion creates an unassigned lead plus an optional suggestion.
- Personal-mailbox ingestion may deterministically assign only to the connection's active, same-company, assignment-eligible OPS owner.
- A suggestion never updates `assigned_to` and never grants access.
- Suggestion payloads must be explainable and versioned; they include confidence and signals suitable for operator review.
- Inbound and outbound messages must retain mailbox connection, thread identity, lead relationship, and OPS actor attribution.
- Any service-role operation must carry and validate the initiating actor or an enumerated trusted system source.
- The backend must call the guarded assignment operation rather than writing `assigned_to` directly.

No new paid service is required for this design. Suggestions reuse the existing lead-engine stack; marginal model-call usage must be measured during rollout rather than assumed to be free.

## 14. Conversion boundary

Conversion authorization changes from the current company-wide `pipeline.manage:all` gate to the granular conversion helper, with a temporary `pipeline.manage:all` compatibility path for supported legacy clients.

For `pipeline.convert:assigned`, the opportunity must be assigned to the current OPS user at the time the transaction locks it. A stale client cannot convert a lead that was reassigned away moments earlier.

Conversion retains its established responsibilities:

- create or link the project
- preserve reciprocal opportunity/project links
- relink estimates
- materialize LABOR line items as project tasks
- carry the currently supported lead media and source context
- win the opportunity and record disposition/history

Conversion deliberately does not:

- copy `assigned_to` to the project
- populate task `team_member_ids`
- create project membership
- reinterpret `projects.created_by` as ownership

The assignee remains on the preserved won opportunity for sales accountability. If the converter lacks project access after conversion, OPS confirms success on the won-lead surface instead of navigating to an inaccessible project. Later project visibility comes only from company-wide project permission, task assignment, or another existing project-access mechanism such as view-only mention access.

## 15. Deactivation and lifecycle edge cases

Team-member deactivation runs a guarded bulk transition:

- Active, non-terminal, non-archived leads assigned to the departing user return to unassigned.
- Each transition is recorded with source `deactivation`.
- Company-wide assignment users receive one actionable summary notification.
- Won/lost historical leads retain their assignee for attribution unless a company-wide user makes an explicit audited correction.
- The departing user's personal mailbox is disabled through the existing connection lifecycle and can no longer sync or send.

Disabling a personal mailbox connection cannot reroute mail sent to that address. Sync and send stop for that connection unless the mailbox is reconnected or external forwarding is configured. OPS identifies affected active conversations and sends company-wide assignment users one actionable warning to reconnect the mailbox, configure forwarding outside OPS, or establish a new client communication path. Only messages that actually arrive through another connected mailbox enter that mailbox's normal ingestion and assignment flow.

An inactive or cross-company user never appears as an assignable target.

Removing a user's last `pipeline.view` scope that covers assigned leads cannot strand active leads in an invisible assignment. The permission-management flow must require a reviewed bulk transfer or return-to-unassigned action before the permission reduction commits. Reducing edit scope while retaining view scope is valid and intentionally leaves the user's assigned leads read-only.

## 16. Failure and concurrency behavior

- **Concurrent transfer:** compare the expected assignee/version under row lock. Return the current assignment; never silently overwrite.
- **Permission changed mid-session:** refetch effective access, remove mutation controls, and close/redact data the user can no longer view.
- **Offline reassignment:** disallowed because assignment changes authorization and notifications immediately. Existing offline-safe lead edits may retain their current sync behavior, but assignment requires a live server acknowledgement.
- **Notification delivery failure:** the assignment, audit event, and durable outbox event remain authoritative. Channel delivery is retried and observed idempotently without rolling the lead back or producing duplicate notifications.
- **Email provider rejection:** preserve draft, expose a specific recoverable error, and write no sent activity.
- **Post-send persistence failure:** retain the accepted provider result on the durable send intent and retry exactly-once reconciliation without sending again.
- **Conversion succeeded but project is hidden:** show confirmed success and remain on the won lead.
- **Suggestion target became inactive:** invalidate/supersede the suggestion and require a new choice.
- **Lead archived/deleted during assignment:** fail with the current state; do not resurrect it through assignment.

## 17. Rollout strategy

Rollout is backend-first, additive, and compatible with App Store lag:

1. Add schema integrity, indexes, permission catalog entries, audit/suggestion structures, canonical helpers, guarded operations, and tests without granting new Operator access.
2. Snapshot and deterministically migrate built-in/custom role grants and company/user overrides; verify the before/after scope diff before activation.
3. Harden opportunity, child-record, conversion, and email server boundaries. Preserve `pipeline.manage:all`, `inbox.view_company:all`, and documented own-mailbox behavior only as bounded legacy fallbacks.
4. Ship web support for assigned scopes, filters, assignment controls, notifications, and realtime removal/addition.
5. Ship iOS support for assigned scopes, assignment controls, complete lead context, realtime changes, deep links, and offline guardrails.
6. Land the lead-engine/mailbox contract in the backend workstream.
7. After compatible clients are available, grant the Operator preset assigned lead and lead-bound inbox view/send scopes.
8. Verify live behavior with designated test users before broad use.
9. Remove legacy permission fallbacks only after the minimum supported clients no longer call them and migrated overrides are proven equivalent.
10. Update the OPS Software Bible and generated database types in the same implementation initiative.

The permission grants are the activation switch. Operators currently lack pipeline access, so withholding those grants until compatible clients ship avoids an old-client regression where assigned scope may be interpreted as insufficient.

## 18. Verification matrix

The feature is complete only after tests exercise real database policies and server routes in addition to client mocks.

### Permission and isolation

- no permission: Leads tab hidden and direct reads denied
- create without `pipeline.create`: denied; Operator create plus initial self-assignment/history succeeds atomically without assignment-all
- view assigned: assigned rows visible; other and unassigned rows denied
- view all / edit assigned: all rows visible; other users' mutations denied
- view all / edit all: all company rows editable
- assign assigned: direct transfer of own active lead succeeds; unassign and other-lead changes fail
- assign all: assign, transfer, and unassign company leads succeed
- convert assigned: assigned conversion succeeds; other/unassigned conversion fails
- cross-company reads, assignment targets, direct writes, and forged IDs fail
- inactive, cross-company, or assignment-ineligible targets are absent from the picker and rejected by the server
- generic edit, ingestion, and service-role paths cannot change `assigned_to` directly or skip history/outbox creation
- service-role route with spoofed body actor/company fails; allowlisted system principal records explicit provenance
- malformed direct permission data cannot exceed runtime prerequisite intersections
- built-in roles, customized roles, and company/user overrides retain their intended effective access after migration

### Handoff and realtime

- assignment event, audit record, and notification are produced once
- lead appears for the new assignee and disappears for the old assigned-only user
- previous and new assignees receive the addressed access-change event; only the new assignee receives user-facing assignment notification
- company-wide view updates in place
- stale concurrent transfer returns conflict/current state
- deactivation returns only active responsibility leads to unassigned and preserves terminal attribution
- removing the last assigned-view permission is blocked until active assignments are transferred or returned to unassigned

### Complete context

- authorized assignee can load the lead, contact data, activities, correspondence, notes, follow-ups, files/photos, site visits, and linked estimate context
- unrelated company leads and their child records remain inaccessible
- specialized mutations still require their domain permission
- when two leads share a client, access to one exposes no sibling lead, unrelated project/estimate, or raw company-wide client data

### Email

- standalone Inbox assigned scope lists the actor's personal-mailbox threads plus threads linked to the actor's assigned leads; unlinked and unrelated shared-company-mailbox threads are denied
- thread detail, lead detail, drafts, attachments, and sends enforce the same opportunity/inbox intersection
- assigned user replies from the original shared mailbox
- OPS actor attribution records the actual user, not the mailbox email
- new outbound can use the actor's authorized personal mailbox
- explicitly switching sender starts a new provider thread under the same OPS lead rather than mutating the original thread
- another user's personal mailbox is denied
- inbound reply reconciles to the same thread and lead
- spoofed mailbox, user, company, thread, and lead identifiers are denied
- provider failure preserves draft and produces no false sent activity
- provider acceptance followed by database persistence failure reconciles exactly once and does not send a duplicate
- disabling a personal connection stops sync/send and produces an actionable warning for affected active conversations; OPS does not claim automatic rerouting

### Conversion

- assigned operator converts the assigned lead
- conversion race after reassignment is denied
- opportunity retains `assigned_to` and becomes won
- generated project tasks have empty `team_member_ids`
- no project owner/assignee/membership is created
- no-project-access confirmation remains on the won lead

### Client behavior and performance

- iOS and web show equivalent permission behavior
- old supported clients retain administrative company-wide behavior during the compatibility window
- assignment requires network on iOS and reports a recoverable error offline
- realtime access removal clears cached detail data
- indexed assigned/all queries meet production-volume performance targets
- notification deep links open the correct lead on web and iOS

## 19. Observability and operational proof

Instrument and review:

- assignment success/conflict/denial counts
- time from lead creation to confirmed assignment
- age and count of the unassigned queue
- suggestion acceptance/rejection rate and generator version
- assignment notification delivery/deduplication
- email authorization denials and provider failures
- conversion denials caused by stale reassignment
- assigned/all query latency and RLS plan quality

Production closeout must include live readbacks proving the Operator preset scopes, RLS policy definitions, guarded function definitions, valid assignment history, task-unassigned conversion behavior, and notification/email actor attribution. A migration being applied is not proof that the workflow works.

## 20. Acceptance scenario — Canpro / Jason

1. A renovation inquiry reaches Canpro's company mailbox.
2. OPS creates an unassigned lead and may suggest Jason.
3. A company-wide assignment user confirms Jason.
4. Jason receives a notification and the lead appears in his Leads tab.
5. He opens the complete prior history, contacts the client, replies through Canpro's existing mailbox, and OPS records Jason as the actor.
6. He updates the lead, follow-up, notes, and stage within his assigned edit authority.
7. If another team member should take over, Jason transfers the lead directly; access moves immediately and the history records the handoff.
8. If Jason wins the work while still assigned, he converts the lead.
9. OPS preserves Jason on the won lead, creates the linked project, and creates unassigned LABOR tasks.
10. Jason receives no invented project ownership or task assignment. His project access thereafter follows the normal project/task permission system.

That behavior is the launch definition of done.
