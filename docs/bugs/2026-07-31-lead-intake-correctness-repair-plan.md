# Lead intake correctness — guarded release and recovery plan

Status: implementation proof only. Nothing in this plan authorizes a live
database, mailbox, deployment, or record mutation.

## Non-negotiable boundary

- Never assign or reactivate an individual lead by hand.
- Never relabel provider mail, enqueue an ad hoc recovery row, replay one
  provider message, edit one provider draft, or patch one production record to
  manufacture a passing result.
- Production evidence before release is read-only. Schema migrations, deploys,
  and any recovery execution require separate explicit approval.
- A project may be created only from decisive commercial acceptance plus
  property-level address proof. Locality is never relationship identity.

## Release gate

1. Prove the focused cursor, manual-sync, lifecycle, assignment, archive-stage,
   Phase C, provider-draft reconciliation, and exact-recipient suites.
2. Prove typecheck, lint, and production build from the isolated worktree.
3. Re-read production without selecting lease owner tokens: workload guards,
   connection state, structured continuation, recovery queue, Aharon, and the
   affected draft histories.
4. With explicit approval, apply the repository-parity hotfix and additive
   migrations before the compatible application release.
5. With separate explicit approval, release the application. Do not combine
   this with a data repair.

## Automatic proof after release

- Let the ordinary cron/webhook engine acquire its own leases and drain every
  provider page, pending provider message, and pending lead summary.
- A nonterminal cycle must advance only `history_id`; it must not advance
  `last_synced_at`. The scheduler must ignore the ordinary interval until the
  continuation is terminal.
- A manual sync must return `202 continuing`, `200 complete`, or retryable
  non-2xx `partial`/`failed`; an errors array can never produce a false success.
- Phase C must leave affected threads dirty during an active or nonterminal
  sync. After terminal completion, it may classify once from the complete
  thread. Any provider draft whose exact source message has later persisted
  correspondence must be deleted by the normal reconciliation worker and its
  history marked `superseded`, with no learning applied.
- A genuinely new exact-thread, meaningful related inbound on an archived
  active-stage, unconverted lead must cause the correspondence transaction to
  clear `archived_at` and preserve an eligible assignee, assign the eligible
  mailbox intake owner, or create a version-fenced assignment-required
  delivery. A later outbound in the same catch-up must not erase that event.
- Stage automation must return `archived_opportunity` until that transactional
  reactivation has succeeded.

## Existing incident records

### Aharon Arnstein

Do not change the opportunity directly. The already-ingested inbound predates
the new event trigger, so it is not valid release proof. Verification must use
a future genuine inbound processed by the ordinary engine, or a separately
designed and approved generalized replay lane with the same exact
thread/message, project, terminal-stage, assignment-version, and audit guards.
No one-off replay or assignment is permitted.

### Stale Rose/Cindi drafts

Do not delete or edit them manually. After release, the ordinary sync-owned
draft reconciliation lane must compare each draft's immutable
`source_message_id` with the complete persisted thread, remove a stale provider
draft idempotently, and mark the matching history `superseded`. If exact source
authority cannot be proved, stop for review; do not infer a recipient from a
name or another participant.

### Mailbox backlog

Do not enqueue recovery jobs. The existing structured cursor and recovery-page
state are the only authority. Allow the scheduler to continue automatically,
then read back terminal provider history, zero pending messages/summaries, no
recovery page token, and a `last_synced_at` that advanced only on that terminal
cycle.

## Stop conditions

Stop the rollout without repair if any of these occur: a cursor becomes
terminal while work remains; `last_synced_at` advances on a continuation; Phase
C writes while sync is active/nonterminal; an archived active-stage lead
advances stage before reactivation; assignment cannot be resolved or delivered
to an authorized administrator; a stale provider draft survives automatic
reconciliation; or any terminal/project-linked lead is mutated.
