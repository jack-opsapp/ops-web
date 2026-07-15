# Live Gmail mailbox -> derived lead state audit

- Date: 2026-07-14
- Mailbox verified read-only: `canprojack@gmail.com`
- Company: Canpro Deck and Rail (`a612edc0-5c18-4c4d-af97-55b9410dd077`)
- Email connection: `5dd46f2b-a6b6-4a3d-9c5a-d660341f14a3`
- Supabase project inspected read-only: `ijeekuhbatykdomumfjx`
- Comparison window: previous 30 days

## Verdict

The earlier code/database audit was not enough to claim that the live mailbox
pipeline worked. Direct provider-to-production reconciliation disproved that
claim.

The mailbox was read only. No message was sent, drafted, edited, labeled,
archived, deleted, forwarded, or marked read. No production database row,
migration, or backfill was changed.

## Reconciliation method

1. Confirm the connected Gmail identity.
2. Inventory the 30-day mailbox across Inbox, Sent, the OPS Pipeline label,
   Drafts, Spam, and Trash.
3. Compare raw Gmail message IDs and thread IDs with production
   `activities`, `email_threads`, `opportunity_email_threads`, and linked
   opportunities.
4. Recompute authorship/direction from the connected address, team addresses,
   and company domain instead of trusting the provider discovery bucket.
5. Compare provider message counts, latest delivered timestamp/direction,
   summary state, lead stage evidence, contact fields, and provenance.

## Live evidence

| Check                                     |                   Provider |                                                      Production result | Finding                                                                                                                                                                                                           |
| ----------------------------------------- | -------------------------: | ---------------------------------------------------------------------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inbox + Sent messages                     |                 663 unique |                                             208 exact activity matches | 455 were not represented as activities; most are expected non-lead/noise, so this is not itself a loss count.                                                                                                     |
| OPS Pipeline label                        |  210 messages / 62 threads |                                             199 exact activity matches | 11 labeled messages were missing from activities.                                                                                                                                                                 |
| Current full content for those 62 threads |               295 messages |                                                      718 activity rows | Production contained 423 more activity rows than the current provider threads.                                                                                                                                    |
| Current messages missing activities       |                        295 |                                                             12 missing | Confirmed delivered/provider objects without an activity record.                                                                                                                                                  |
| Activity IDs absent from current Gmail    |                          — |                                                                    435 | Every ID had Gmail message shape; 434 were operator-authored and stored inbound. A sampled ID returned Gmail 404. This is strong evidence of deleted draft revisions/autosaves being persisted as correspondence. |
| Direction on matched labeled messages     | 113 operator / 86 external |                                              20 outbound / 179 inbound | 93 operator-authored messages were stored inbound. External-authored messages were consistently inbound.                                                                                                          |
| Thread counts                             |        62 provider threads |                           29 exact / 33 over-counted / 0 under-counted | Total cached overage was 459 messages.                                                                                                                                                                            |
| Latest delivered timestamp                |                 62 threads |                                                           6 mismatches | Worker insertion order had replaced provider occurrence chronology.                                                                                                                                               |
| Latest delivered direction                |                 62 threads |                                                          40 mismatches | Draft/operator direction corruption propagated into thread state.                                                                                                                                                 |
| Thread summaries                          |                 62 threads |                                                                57 null | Thread derived state was mostly absent.                                                                                                                                                                           |
| Classification marker                     |                 62 threads |                                                    56 never classified | There was no automatic drain for failed/omitted classification.                                                                                                                                                   |
| Linked opportunities                      |                 61 threads |                                                42 unique opportunities | Thread linkage existed for nearly all sampled threads.                                                                                                                                                            |
| Opportunity summaries                     |           42 opportunities |                                                                41 null | Lead summary refresh was not completing.                                                                                                                                                                          |
| Opportunity stage evidence                |           42 opportunities |                                                 37 only `ai_evaluated` | Evidence was not refreshed when the inferred stage did not change.                                                                                                                                                |
| Contact completeness                      |           42 opportunities | 3 missing name/email/description; 20 missing phone; 20 missing address | Basic identity was usually present; richer dossier fields were not consistently accumulated.                                                                                                                      |
| Provenance agreement                      |           42 opportunities |                                     9 phone and 1 address disagreement | A second raw provenance writer could describe a rejected value rather than the canonical lead value.                                                                                                              |

The OPS Pipeline label comparison is the highest-signal mailbox slice. The
all-mail difference must not be treated as 455 dropped leads because newsletters,
receipts, internal mail, and other intentionally filtered correspondence are in
that denominator.

## Confirmed scenarios

### Current draft persisted as inbound correspondence

A current Gmail `DRAFT` object had a production activity with
`direction='inbound'` and a linked opportunity. This is the direct explanation
for a class of inflated counts, reversed direction, and stale latest-message
state.

### Delivered customer conversation completely absent

One OPS-labeled thread contained ten current delivered messages (six inbound,
four sent) and explicit commercial progression, but had zero activities and no
opportunity link. Its `email_threads` cache claimed 23 messages and had never
been classified.

### Draft revisions outnumber current delivered messages

Another thread had five current Gmail objects but seven production activities,
including activity IDs no longer present in Gmail, two direction mismatches, and
a current draft. The linked lead remained `new_lead` with no summary and a
seven-inbound/zero-outbound projection.

### Writing profile and reply-feedback state is not idempotent

The live general writing profile was created on April 19 and claimed 1,891
emails analyzed. Gmail currently contains 467 Sent messages from that date
through July 14. Production activities contained 1,014 distinct
operator/team-authored provider message IDs in the same period, of which 921
were incorrectly stored inbound. Deleted draft revisions can explain part of
the activity excess, but no current provider inventory can explain a profile
sample count four times larger than current Sent mail. The code confirms that
profile rolling averages have no provider-message receipt, so unmatched mail,
draft revisions, and a retry before a durable activity can apply the same
sample repeatedly.

Email-derived memory had 374 rows from 178 timestamp-shaped `source_id` values
in the last 30 days, including eight exact duplicate source/category/content
groups. The source key is occurrence time rather than connection + provider
message identity, and existing-fact reinforcement increments confidence/access
without an evidence receipt. A retry therefore is not exactly-once even when a
fuzzy lookup finds the same fact.

Draft feedback was also incomplete: 137 draft-history rows were created in the
last 30 days, but only four were marked `sent_from_mailbox`; 107 remained
`auto_drafted`, while eleven rows with status `discarded` had no
`discarded_at`. The direct discard paths update the status without the outcome
timestamp, and `recordDraftOutcome` has no atomic conditional claim before its
profile/memory side effects.

## Code root causes and prepared repairs

| Boundary                 | Root cause                                                                                                                                                                                                                   | Prepared repair                                                                                                                                                                                                                                                                  |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gmail History            | Separate label traversals plus unfiltered history materialized drafts/spam/trash.                                                                                                                                            | One canonical History traversal; exclude `DRAFT`, `SPAM`, and `TRASH` after materialization while still advancing the cursor.                                                                                                                                                    |
| Gmail scan/backfill      | Scan and historical-import routes accepted non-delivery labels.                                                                                                                                                              | Exclude non-delivery objects before AI/review/import.                                                                                                                                                                                                                            |
| Full-thread AI context   | Gmail full-thread and Microsoft 365 conversation reads included unsent drafts.                                                                                                                                               | Filter Gmail non-delivery labels; request/filter M365 `isDraft`; fail closed on incomplete pages.                                                                                                                                                                                |
| Direction                | Discovery bucket/label was treated as authorship.                                                                                                                                                                            | Resolve direction from operator identity after unified discovery.                                                                                                                                                                                                                |
| Chronology               | Email activity `created_at` defaulted to database insertion time; inbound/outbound buckets were processed separately.                                                                                                        | Persist provider occurrence time and process one chronological mixed-direction queue.                                                                                                                                                                                            |
| Thread cache             | Every replay incremented `message_count`/`unread_count`.                                                                                                                                                                     | Derive counts and latest state from distinct mailbox-scoped activity message IDs.                                                                                                                                                                                                |
| Mailbox isolation        | Several reads keyed only by company + opaque provider thread ID.                                                                                                                                                             | Add connection scope to conversation, attachment, draft, classifier, and thread-ledger reads.                                                                                                                                                                                    |
| Recent context           | Some prompts selected the oldest 20 rows.                                                                                                                                                                                    | Select newest 20, then reverse into chronological order.                                                                                                                                                                                                                         |
| Summary retry            | Existing outbound/manual-category paths skipped refresh; failures returned an old row; no cron drained dirty rows.                                                                                                           | Clear the classification marker only when canonical delivered state changes, preserve manual category, throw on incomplete refresh, guard against newer-message/human-edit races, and retry ten dirty threads per email cron with concurrency two.                               |
| Opportunity evidence     | `ai_stage_signals` changed only with a stage transition.                                                                                                                                                                     | Refresh latest evidence and summary on every successful touched-opportunity evaluation.                                                                                                                                                                                          |
| Provenance               | Raw resolved-contact provenance was written independently of the canonical update decision.                                                                                                                                  | Write provenance only from applied canonical changes; allow strictly higher-confidence evidence to replace a lower-confidence value only when the old provenance still matches the current value; never replace operator-confirmed state.                                        |
| Import parity            | Historical/wizard imports created activities without refreshing canonical thread state.                                                                                                                                      | Refresh mailbox-scoped thread state after activity/correspondence success and leave classification dirty for the bounded retry worker.                                                                                                                                           |
| Manual send              | Provider delivery could race provider sync on the activity unique key and return a false 500 after the email was already sent.                                                                                               | Adopt exactly one validated same-company/same-mailbox provider activity on `23505`; fail closed on ambiguity or isolation mismatch.                                                                                                                                              |
| AI draft outcome         | Compose feedback and auto-send could record the same outcome twice.                                                                                                                                                          | Send `draftHistoryId` through the authenticated send request; make the send route the single outcome owner; remove auto-send's duplicate call.                                                                                                                                   |
| Writing profile learning | Rolling aggregates have no provider-message sample key or atomic receipt; unmatched/replayed messages can increment `emails_analyzed` repeatedly.                                                                            | A service-role queue now keys each outcome by company + connection + provider message, persists immutable profile/evidence receipts, leases bounded retries, distinguishes terminal from unknown bookkeeping failure, and applies profile/memory/draft state in one transaction. |
| AI draft outcome         | Approval, lifecycle, inbox, and auto-send paths did not all preserve the generated draft identity through final delivery.                                                                                                    | Persist/reuse draft history before delivery, pass `draftHistoryId`/`followUpDraftId` through the canonical send route, store final subject/body and edit deltas once, and reject changed draft/follow-up/thread provenance.                                                      |
| Draft discard state      | Direct discard paths set only `status='discarded'`; duplicate outcome calls can repeat learning side effects.                                                                                                                | Route discards through the canonical outcome service, stamp `discarded_at`, and make outcome application conditional/idempotent before enabling automatic learning.                                                                                                              |
| Win probability          | The database default supplied `10` to almost every open lead; there was no calculation or stage configuration behind the number. Weighted values and weighted pipeline totals only repackaged that same unsupported default. | Remove win probability and every derived weighted value/total from lead-map, detail, pipeline table, grouped totals, and dashboard funnel UI; filter both retired saved-view columns safely; retain the database fields only for compatibility.                                  |
| Email signatures         | OPS has no signature record, never reads Gmail `sendAs` signatures, cannot fetch an Office signature through Microsoft Graph, and has no missing-signature notification.                                                     | Handle this in a separate sweep: OPS signature first, then imported Gmail or user-confirmed Office signature, then a persistent setup notification. Keep signatures outside the authored/learned body and append once at the provider boundary.                                  |

## Not yet a production fix

These changes exist only in the isolated hardening worktree. They have not been
committed, pushed, deployed, applied as migrations, or used to mutate Canpro's
rows. Current production remains affected until the expand migrations and
application are reviewed, deployed in order, and the evidence-backed repair
plan is separately approved.

Historical thread counts cannot always be reconstructed from a partially
populated legacy activity ledger alone. The prepared import parity closes that
gap prospectively; existing rows require a reviewed provider-to-activity repair,
not an inferred SQL decrement.

The isolated worktree now contains the service-role outbound-learning queue,
provider-scoped sample/evidence receipts, bounded leases/retries, sanitized
diagnostics, audited requeue support, and one transaction for profile, memory,
draft, and completion effects. Phase C being disabled no longer prevents the
core sent-draft outcome from being recorded. This is static/TypeScript-tested
only: the migration has not run in PostgreSQL, and production still has no queue
or receipts.

## Separate Phase C edit-learning and signature sweep

This pass establishes reliable provenance and exactly-once outcome plumbing for
drafts the user sends or edits. When Phase C is enabled, the prepared worker can
learn the final authored sample and persist separately receipted correction facts
without rerunning the base extraction. It does not yet complete the higher-level
learning product: repeated edit-pattern promotion, profile-type refinement, and
autonomy milestone behavior still require a dedicated audit against real sent
outcomes.

Signature handling is also intentionally separate. No current send or draft path
adds an OPS, Gmail, or Office signature. The follow-up implementation must store
an OPS-managed user/mailbox signature, resolve precedence as OPS then provider,
append it only at the provider-rendering boundary, strip/hash a known suffix to
prevent duplication, and create one persistent setup notification when no
effective signature exists. Microsoft 365 requires a user-confirmed OPS signature
because Graph mailbox settings do not expose the user's Office signature.

## Deployment and repair boundary

1. Run all focused and changed-file verification locally.
2. Exercise every prepared SQL migration on a non-production Postgres/Supabase
   environment, including RLS, grants, trigger order, concurrent claims, and
   rollback.
3. Apply compatible expand migrations before the application deployment.
4. Deploy, then run one controlled mailbox sync without sending mail.
5. Re-run this provider-ID parity comparison and verify cursor, direction,
   counts, summaries, stage evidence, and provenance.
6. Review the existing allowlist-based backfill. Do not infer customer/thread
   moves or destructive splits from sender, subject, or raw thread ID alone.
