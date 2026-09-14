# Email routing continuation verification

The post-release audit reproduced three independent routing gaps: unrelated surname suggestions suppressed valid inquiries; uncertain replies on new provider threads did not join an existing open lead; third-party introductions inherited the introducer's completed job. A downstream commercial detector also read a delivery duration as a confirmed date, while an appointment review reused an immutable key after its reason changed.

The correction requires plausible complete names, with a narrow explicit couple-contact review exception. Uncertain correspondence may join only the exact customer's unique open sales record when no existing project competes. Proven new work cannot reuse a closed relationship. A current affirmative introduction names the actual recipient as the customer while retaining the introducer as email author; the referrer's signature does not populate customer facts. Referral identity currently requires recipient display-name evidence, as preserved by Gmail; bare recipient addresses alone do not establish that identity.

Commercial duration/quote language no longer implies acceptance. Appointment review reasons have separate immutable keys, with exact unchanged legacy envelopes retaining their original key. Project identity and conversion guards remain enforced.

Verification on the integrated production base:

- 842 tests passed across 14 affected suites.
- 11 focused tests using the actual sync engine passed, including new reply, authorized review recovery, existing-project controls, referral creation/replay, and existing-job routing.
- All 15 changed TypeScript source/test files have zero scoped diagnostics; imported dependencies have 21 existing diagnostics.
- The full sync suite has the same 36 named failures on the unchanged base and this repair. Both initial new regressions pass after the correction. This is not a claim that the repository-wide test suite is green.
- Exact two-message recovery preflight passed against production. Recovery is separately journaled and must be read back after application.

Deployment, recovery, and production rechecks are recorded separately. No new database migration is required for these application corrections. Cross-customer thread recovery needs an additional guarded database contract and separate migration approval. Customer source emails, identities, database snapshots, and private recovery manifests remain outside this public repository.

## Production application release and partial recovery

Application release `61cc787f9d09c06ff9252b52f234a2636e5cd516` reached Vercel READY at 2026-09-14 20:17:52 UTC (`dpl_5kZwgaDFAo6ZTTN3TjeAWaeji7LW`). Independent lookup of `app.opsapp.co` returned that exact deployment. The full production build compiled, passed type validation, generated 484 routes, and completed deployment.

The exact two-message recovery created the missed inquiry under its correct customer and adopted the misplaced reply into its existing lead. Readback confirms two original activity identities/dates, two projected correspondence events, cleared match-review flags, and no duplicate provider message identities. Replaying the same manifest returned `already_applied` for both entries. Customer evidence and recovery hashes remain private.

The third customer's misbound thread is untouched until the separately tested cross-customer finalization migration is approved. The runtime correction itself needs no new database schema.

The normal 20:44 UTC production run independently cleared both previously failing downstream work records at 20:44:54–55 UTC. Both now have completion timestamps, null error fields, and empty component errors. Quote-only commercial evaluation completed with `stageChanged:false`; appointment handoff completed with the appropriate participant-authority review outcome. This proves those two observed retry failures are resolved in production, without claiming every review has been resolved or every future email will classify correctly. At the earlier post-release audit, the only lead created since the previous audit was the deliberately recovered inquiry, and the mailbox was active with sync enabled.

## Prepared exact thread finalization

Migration `20260914201338_finalize_exact_email_thread_recovery.sql` adds a private immutable ledger and service-role-only finalizer. It requires an authorized actor, an owned active mailbox lease, current full source/target/thread/link snapshots, a complete exact message set, and finalized per-message recovery receipts. It independently checks current attachment scans, inspection, materialization, and the unchanged attachment ID sets. The ordinary same-client reassignment API remains unchanged.

Independent PostgreSQL 17 verification passed: 23 assertions, 37 rejection cases, three concurrency cases, and two rollback readbacks. The harness uses the actual deployed ownership triggers and attachment-state function. Review found and reproduced a concurrent photo-object mutation gap; the finalizer now fences all seven dependent tables until commit. Controlled permission fixtures and synthetic rows do not establish a live recovery result. The first isolated run was blocked by sandbox shared-memory restrictions; the approved local rerun passed and removed its temporary cluster.

The private four-message rehearsal is read-only and pins original message authorship, bodies/dates, protected source state, ten stored attachment copies and ten separate older discovery rows. Repeated read-only provider responses confirmed rotating download tokens despite stable MIME parts. The repair therefore requires exact stored-file replay and explicit attachment accounting; a fresh provider scan alone cannot establish completion for that history. No production migration or cross-customer message move has been performed.

The prepared private stored-file replay uses the existing canonical attribution, inspection and exact scan contracts with the original stored descriptors. It checks current MIME parts and stored byte hashes, forbids provider downloads and object writes, preserves all original IDs, and separately accounts for unchanged discovery rows. Seventeen focused tests passed independently, including quoted files, zero-file scans, interrupted inspection, duplicate/changed evidence, and replay. The final integrated read-only rehearsal passed against the current four-message provider snapshot and all ten stored copies at 21:01:24 UTC. The runner and adapter have zero scoped TypeScript diagnostics; imported application dependencies retain the same 21 baseline diagnostics. Migration application, live attachment processing and cross-customer recovery remain pending explicit approval.
