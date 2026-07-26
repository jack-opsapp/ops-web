# Supabase Outage Feedback-Loop Remediation Plan

## Confirmed incident chain

1. Beginning at 00:30 UTC, the same mailbox sync page failed every scheduled
   cycle because lead-summary model-contract errors were treated as durable
   persistence failures.
2. That policy deliberately held the provider cursor. The same messages,
   lifecycle evaluation, Phase C routing, drafts, and summary generation were
   replayed every 15 minutes and by manual syncs.
3. The repeated cycle reached the 300-second function ceiling at 02:30, 03:15,
   and 03:31. The first database statement timeout followed at 03:44, then
   PostgREST schema-cache failures spread at 03:49.
4. A one-minute route concurrently launched five database pipelines with
   175-row aggregate capacity and no route singleton. Five-minute workers were
   aligned on the same minute, and customer polling rose 3.39x. These amplified
   the initiating mailbox replay until the Nano database entered a physical
   I/O stall.
5. The existing July 22 protection only bounds SQLSTATE 40001 serialization
   retries. This incident contained no such signature, so those protections
   worked as designed but did not cover cursor replay caused by model-output
   validation.

## Implementation

### 1. Break the initiating cursor replay

- Treat lead-summary model contract/refusal errors as deferred derived-data
  work, not cursor-holding persistence failures.
- Preserve cursor-holding behavior for actual database reads/writes and
  snapshot-guard failures.
- Add a regression test proving the observed “model omitted current commercial
  schedule/scope/objection” failure advances the mailbox cursor and leaves the
  summary eligible for later refresh.

### 2. Add durable workload controls

- Add a source-controlled `private.cron_workload_controls` table.
- Add fenced service-role RPCs to acquire and complete expiring leases.
- Store consecutive failures and `circuit_open_until` so database availability
  failures stop new work across serverless instances.
- Use row leases, not advisory locks; a crashed function remains fenced until
  expiry.
- Add one bounded acquisition retry with exponential jitter. Failure to reach
  the control RPC fails closed and launches no workload.

### 3. Contain every heavy lane

- Guard email sync, lead/outbox delivery, attachment maintenance, send
  reconciliation, and projection repair.
- Share the lead/outbox lane key with eager project/task drains so cron and
  request-tail work cannot fan out concurrently.
- Replace the lead route's five-way `Promise.all` with sequential fail-fast
  batches and reduce 50/50/25/25/25 capacities to incident-safe limits.
- Reduce projection repair and reconciliation batch sizes.
- Open the persistent circuit and stop launching later batches on statement
  timeout, connection timeout, 504/522, or PGRST002/schema-cache evidence.

### 4. Stagger schedules and clean live drift

- Spread attachment, lead/outbox, reconciliation, projection, and email-sync
  work across separate minute offsets.
- Add a durable migration that unschedules every
  `toctou_race_hold_job` instance.
- Once SQL is responsive, inventory live jobs 10, 11, 13, and 16; add
  source-controlled definitions for legitimate jobs, remove/correct job 16,
  safely resume jobs 10/11, and restore the authenticator timeout to 8 seconds.

## Test-first proof

1. Add RED tests for model-contract deferral and cursor advancement.
2. Add RED unit tests for durable guard acquisition, overlap rejection,
   circuit-open skips, fail-closed control errors, and bounded jitter retry.
3. Add RED route tests proving sequential order, reduced limits, early stop,
   and staggered schedules.
4. Add RED migration contract tests for expiring fenced leases, persistent
   circuit state, service-role-only grants, and leaked-cron cleanup.
5. Implement until focused tests pass, then run relevant suites, typecheck,
   lint, and `SYNC_SKIP_DB=1` production build.

## Production sequence

1. Deploy the guarded code. Before the migration exists, guard acquisition
   fails closed, providing immediate targeted workload containment.
2. Apply the workload-control and cron-cleanup migration as soon as SQL accepts
   DDL.
3. Confirm SQL, REST, PostgREST, tiny-query latency, checkpoint behavior, and
   live workload-control state.
4. Restore the 8-second role timeout and reconcile jobs 10/11/16 from live
   evidence.
5. Observe multiple one-minute and five-minute cycles with no overlap,
   504/522, statement timeout, or PGRST002.
6. Update the OPS Software Bible, commit atomically, deploy the verified
   production state, and merge the finished commits into local `main` without
   touching unrelated work.
