# Email Replay and Intake Owner Design

## Outcome

New shared-mailbox leads cannot be starved by a historical message whose sender later becomes an OPS teammate. A new lead is assigned through the canonical guarded assignment path to the mailbox's configured intake owner, which unlocks Phase C drafting and the existing assignment push. If no valid intake owner exists, authorized company administrators receive a durable, persistent assignment prompt.

## Replay direction

Provider discovery labels are transport hints only. After provider-message deduplication, the sync engine loads the exact existing activity for each discovered provider message. A persisted `inbound` or `outbound` direction is immutable replay authority. Only a message with no persisted activity is classified from the current authoritative teammate roster.

The resolved envelope is reused by inbox/sent partitioning, outbound learning, reconciliation, lifecycle evaluation, and activity/event projection. A malformed persisted direction fails closed. The database identity guard remains unchanged.

This preserves improved teammate recognition for new messages while preventing roster changes from rewriting historical correspondence identity.

## Shared-mailbox intake owner

`public.email_connections.default_intake_owner_id` is a nullable, mailbox-specific UUID reference to `public.users`. It is valid only for a company mailbox and must resolve to an active, nondeleted user in the same company who can view and edit assigned leads and send assigned-mailbox replies.

New company-mailbox opportunities use one service-role-only database transaction that:

1. Validates a strict opportunity payload and deterministic source key.
2. Takes the canonical company assignment lock, then locks and revalidates the connection.
3. Returns any existing source-key winner unchanged, without assigning or prompting it.
4. Creates the opportunity from an explicit field allowlist.
5. Derives the target only from `default_intake_owner_id`.
6. Calls the existing private guarded assignment core or durably enqueues missing-owner prompts before the transaction commits.

The caller never supplies the target. Direct `opportunities.assigned_to` writes remain forbidden. The immutable event source is `company_mailbox_default`. A failure in either assignment or prompt creation rolls the opportunity insert back. Existing source-key rows, non-null assignments, assignment-version changes, and manual unassignments are never overwritten.

Canpro's `canprojack@gmail.com` mailbox will use Jackson's active OPS user as its intake owner.

## Missing-owner prompt

If a newly created email opportunity remains unassigned because the shared mailbox has no valid intake owner, the database enqueues one addressed delivery per active company administrator who still has company-wide lead view and assignment authority.

The existing one-minute assignment worker claims these deliveries with leases and revalidates the opportunity and recipient before doing any user-facing work. A valid claim materializes a persistent notification and sends a OneSignal push, subject to the existing `lead_assignments.push` preference.

- Title: `Lead needs an owner`
- Body: `Assign {lead title}`
- Action: open the lead detail assignment control

The delivery is idempotent by opportunity and recipient. Assignment races suppress the delivery. A successful manual or default assignment resolves every outstanding prompt for that opportunity.

## Failure behavior

- One malformed or conflicting historical message cannot rewrite its activity, but a stable replay can finish and advance the mailbox cursor.
- A missing or newly ineligible intake owner creates the lead and its durable prompts atomically.
- Push-provider failure retries through the durable delivery lease without replaying email ingestion.
- A stale prompt cannot disclose the replacement assignee or overwrite a manual decision.
- No historical bulk assignment or backfill is performed. Only normal forward sync and its bounded current retry window use the new behavior.
- No autonomous email send permission is added.

## Verification

Regression coverage must prove:

- persisted inbound direction survives teammate-roster drift;
- a fresh teammate-authored message still resolves outbound;
- the poison replay does not starve a later external lead;
- cursor advancement and activity/event projection are idempotent;
- company-mailbox default assignment uses the derived-target guarded RPC;
- manual overrides and stale assignment versions win;
- missing/ineligible owners enqueue one durable prompt per authorized admin;
- assignment resolves prompts and stale deliveries suppress;
- assignment push and Phase C actor resolution become available after the canonical event;
- no direct `assigned_to` update exists.
