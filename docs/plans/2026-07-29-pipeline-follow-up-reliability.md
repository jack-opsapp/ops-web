# Pipeline Follow-Up Reliability Implementation Plan

> **Execution contract:** implement from the newest local and remote OPS state in isolated worktrees. Preserve all unrelated work. Do not send email, modify Gmail, mutate live leads, backfill, deploy, apply a live migration, or push.

## Approved outcome

Make provider-ingested manual follow-ups durable and cycle-completing, prevent one safe conversion refusal from freezing unrelated mailbox work, enforce the same follow-up-cycle rules on iOS and the server, and replace the card's easy send tap with a deliberate accessible interaction.

## Root causes to close

1. `SyncEngine.runSync` durably processes the mailbox batch, then evaluates every possible accept-to-project conversion before publishing the provider cursor. It evaluates the rest of the batch after one failure, but aggregates any failure into a cursor-holding `LifecyclePersistenceError`. A permanent project-address safety refusal therefore replays the entire provider window indefinitely.
2. A meaningful provider-ingested outbound records correspondence and updates the opportunity high-water fields, but only the OPS template-send reconciliation RPC satisfies the active chase cycle, advances `next_follow_up_at`, closes stale lifecycle state, and resolves the operator-miss notification.
3. Follow-up preflight checks whether the stored due day has passed and whether the provider's newest message is outbound. It does not prove that the due timestamp belongs to the current stage or that the newest outbound predates the due cycle.
4. iOS renders the entire chase strip as a normal button. The surrounding card simultaneously owns an axis-resolved horizontal drag for stage changes, so another horizontal send affordance would create an ambiguous nested gesture.

## Product and interaction decision

Four interaction models were evaluated:

1. nested horizontal slide-to-send — rejected because it competes directly with the card's stage swipe;
2. destructive-style two-tap confirmation — rejected because the first tap remains too easy to trigger while scanning;
3. long-press context menu — rejected because it hides the review and adds an unnecessary menu choice;
4. bounded press-and-hold — selected because it is deliberate, glove-tolerant, spatially stable, and does not add a second horizontal recognizer.

The due/overdue chase strip becomes a press-and-hold control:

- first use: `HOLD TO REVIEW` opens a server-derived review sheet;
- sheet: recipient, subject, body preview, `Settings → Comms → Lifecycle`, `Skip review next time`, cancel, and explicit `SEND FOLLOW-UP`;
- later use after opt-out: `HOLD TO SEND` crosses the same provider-backed boundary directly;
- VoiceOver: named review/send accessibility action instead of requiring a physical hold;
- motion: pressed opacity/border only, using OPS tokens and the standard curve; no spring, bounce, or horizontal movement;
- haptics: one light commitment haptic when the hold completes and one success notification haptic only after canonical reconciliation.

## Backend implementation

### 1. Exact commercial-outcome recovery

- Extend the service-only `email_ingestion_recovery_queue` with nullable `opportunity_id` and a third kind, `commercial_outcome`.
- Bind the commercial operation key to connection + opportunity + exact provider message.
- Reauthorize the active connection, exact linked opportunity, exact activity, exact correspondence event, provider thread/message, direction, meaningful status, and projection before retry.
- Detect only typed automatic-project-creation safety holds. Database failures and unknown persistence errors continue to hold the cursor.
- On a typed hold, durably enqueue the exact item before cursor publication and continue evaluating unrelated leads.
- Retry under the physical-mailbox lease through the same opportunity-wide commercial evaluator. Preserve every conversion/address/duplicate/manual-override guard.
- Complete as `commercial_outcome_recovered` when the opportunity is safely evaluated or has become inert; otherwise retain bounded retry/error truth.

### 2. Manual outbound cycle reconciliation

- Add a service-role-only, event-receipted RPC for one `sync_activity` meaningful OPS outbound.
- Re-prove exact event/activity/mailbox/thread/opportunity identity and canonical thread ownership.
- Ignore internal, provider, marketing, ambiguous, orphaned, duplicate, non-meaningful, pre-stage, superseded, terminal, converted, deleted, or unresolved-send cases.
- When the event is the current meaningful truth:
  - stamp `handled_at` from the provider occurrence time;
  - schedule the next check-in from `lead_lifecycle_settings.follow_up_after_days`, preserving only an explicitly sooner future date;
  - increment unanswered follow-up state only when the outbound actually satisfies an existing due cycle;
  - clear due/operator-miss lifecycle state;
  - supersede only the stale open `template_follow_up` draft;
  - resolve the matching open operator-miss notification;
  - write an immutable exact-event receipt so replay cannot apply twice.
- Continue the existing Phase-C opportunity summary refresh from complete inbound + outbound durable history.

### 3. Cycle-authoritative follow-up preview and send

- Add an authenticated read-only GET preview to the existing follow-up route.
- Share one canonical preparation path for preview and send: actor, subscription, stage, conversion state, company timezone, recipient, canonical thread, provider-fresh context, template rendering.
- Require:
  - due day is current/past;
  - due timestamp is not older than `stage_entered_at`;
  - canonical `last_outbound_at` is strictly before the due timestamp;
  - provider's selected newest outbound is strictly before the due timestamp.
- Recheck the same cycle conditions inside the prepared-to-sending database guard immediately before provider I/O.
- Keep the existing durable intent, provider-fresh lease preflight, definitive rejection, delivery-unknown, and reconciliation semantics.

## iOS implementation

- Add server preview models and authenticated GET transport.
- Add a company + actor scoped UserDefaults preference, defaulting to review required.
- Make local eligibility require a real due timestamp, current-stage cycle, and no outbound at/after the due timestamp. The server remains authoritative.
- Extend progress with review loading.
- Replace only the follow-up branch of `LeadChaseStrip` with the bounded hold control. `HANDLED` and `ADJUST` remain ordinary buttons.
- Add one tokenized `LeadFollowUpReviewSheet` and mount it in queue, stage-list, and detail hosts.
- Keep idempotency-key scope and pending reconciliation behavior unchanged.

## Test-first verification

### Web/backend

- migration contract tests: service-only grants/RLS, kind/identity constraints, exact reauthorization, receipt idempotency, lock order, cycle conditions, no weakened safety;
- recovery worker tests: commercial success, retry, stale authorization, mailbox busy, exact target validation, unaffected label/classification behavior;
- sync wiring tests: typed safety hold enqueues and cursor proceeds; unknown/database failure still holds; unrelated manual outbound reaches activity/event/summary path;
- manual-cycle tests: due cycle advances once, early outbound restarts cadence without increment, newer truth wins, stale stage/event ignored, open template draft superseded, unresolved send blocks, duplicate replay inert;
- follow-up service/route tests: GET preview, stage-entered stale due rejection, canonical/provider outbound-after-due rejection, identical preparation for preview/send, second lease preflight retained.

### iOS

- service tests: preview transport/auth/error mapping and existing send idempotency;
- preference tests: actor/company isolation and persistence;
- view-model tests: stage-entered/due/outbound cycle eligibility, preview loading, skip-review direct-send decision;
- interaction tests: follow-up uses press-and-hold semantics, no nested horizontal send drag, VoiceOver action labels, progress copy;
- build-for-testing, focused tests, full relevant pipeline tests, and generic-device build using worktree-local package/DerivedData paths.

### Read-only live shadow evaluation

After local verification, query production without writes to project:

- the held recovery candidate and its exact safety refusal;
- mailbox messages newer than the held cursor that would become independent durable work;
- due/overdue quote-bearing leads where `stage_entered_at > next_follow_up_at`;
- due/overdue leads where a meaningful latest outbound is at/after the due timestamp;
- manual outbound events that would satisfy the new guarded cycle contract;
- current RLS, grants, constraints, and function signatures.

No production mutation follows from the shadow result.
