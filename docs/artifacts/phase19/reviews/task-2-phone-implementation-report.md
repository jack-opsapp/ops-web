Controller final status: ACCEPTED after final independent phone review. The chronological implementer report below preserves earlier test failures, interim findings and their superseding corrections. See final-phone-integration-review.md and the current phone-verification.md for the final accepted state.

# Task 2 implementer report

Status: DONE_WITH_CONCERNS — phone fixes and additive V28 migration committed; final independent closure remains pending. Full app/test target compilation succeeds. Phone PostgreSQL69PASS; affected field suite6/6 and final migration/registration7/7 pass, with populated V27→V28→independent reopen proof. Historical V1–V27 fingerprints remain unchanged. Two optional private device-copy fixtures were unavailable/skipped; no signed-device or production release proof is claimed.

## Commits and ownership

- Web `392676346470a4b2079aea3a7a4e02c5c0fa7358`: durable shared-row writes and conflict resolution.
- Web `eec1b757332c2bc4d96036645b66d2cb22a5a21d`: fix live photo artifact kinds and rendered-only upload custody.
- iOS `32d67ce9584409a5a70f23d09cd28c7eaf843e62`: preserve phone edits through durable conflict review.
- iOS `c1e70272c211a5c35646bf9597d845fd739e40a9`: reject legacy template repository writes.
- Web `0c3ae18ef56b2a93c290263503436b5ef0814e90`: bind all phone commands/capture/completion/deletion to original actor.
- iOS `83f5a6b061283f010d5ff7e6a0169d9fc9538ff0`: exact actor/receipt/vault custody, legacy template IDs, and passing hosted verification.

Only transferred iOS work and named phone SQL/fixture/artifact files were staged. Root owns compiler, workflow and canonical booking changes. No push, deploy, production write, activation, paid service or signed distribution occurred. No subagents/reviewers were spawned.

## Implementation

Both outbound engines route templates and answers through immutable durable commands. Original bases freeze at draft/first keystroke, attempted commands never coalesce, and unattempted descendants only advance on an exact predecessor receipt. Retry retains identity, actor, exact payload and deletion time. Equivalent timestamp readbacks and canonical empty media selections compare semantically. Network responses check a fresh context so an old in-flight response cannot erase a subsequently recorded resolution choice.

Inbound merges preserve indefinitely dirty, failed, parked, pending and orphan work, including incoming tombstones; fresh pulls never rebase it. Exact save echoes clear only the matching local values with no later dependent operation. Template seeds insert missing templates without rewriting saved company metadata. Buffered text changes persist immediately; a failed local save retains the original base and pending text in memory.

The recovery vault includes template snapshots and full command/attempt/actor/receipt/resolution history before account cleanup, restores exact account custody, rejects contradictory actor/payload or newer dirty state and throws on unreadable/new-version archives. Resolution state survives process restarts. Pending Work displays original, pending and current versions, supports fresh review and explicit current/pending choices, and presents closed/permission/snapshot/unsupported states. Generic discard/retry cannot silently resolve versioned edits. Direct template and checklist repository write conveniences now fail closed.

SQL adds revision/base guards with an EMPTY compatibility activation gate, immutable answer snapshots and one-use private write tokens preventing direct provenance forgery. The shared primitive locks current parents and company graphs before granular authorization, validates whole batches, logical field/default/slug collisions, tenant identities, values and actual artifact/deck custody. Active actor/company checks use captured live permission helpers. Saved command receipts and explicit resolutions are immutable and reauthorized on replay. Accepting current durably supersedes an original request even when it has not reached the server, preventing a delayed HTTP request from executing later. Pending resolution compares the exact displayed current rows and reconciles collisions without mutating the original payload. Capture saves preserve booked schedule/activity/calendar metadata and cannot regress started or completed visits. Completion stays on the canonical phone completion RPC.

## Shared integration contracts

- Unchanged: `private.apply_site_visit_rows(p_actor uuid,p_company text,p_entity text,p_rows jsonb)` returns `{outcome:saved|conflict,rows,reason?}`.
- Added agreed `private.actor_can_edit_site_visit(p_actor uuid,p_company text,p_opportunity uuid,p_project_id text,p_project_ref uuid)` for canonical actor booking.
- Internal `answer_evidence` is a JSON object bounded to 131072 bytes; rows are bounded to 240000 bytes; phone command to 262144 bytes. Phone callers cannot supply host provenance. Unknown/cleared values must be empty; incidental no-ops preserve evidence.
- Review RPC `review_site_visit_write(p_command jsonb,p_expected_actor uuid)` returns current rows; resolution RPC `resolve_site_visit_write(p_resolution_id uuid,p_original_id uuid,p_command jsonb,p_choice text,p_current jsonb,p_expected_actor uuid)` supports current/pending and exact durable replay.
- Media accepts actual live kinds photo, annotated_photo, dimensioned_photo; markup fields require annotated/dimensioned. Nonblank asset_url OR rendered_asset_url proves remote custody, in addition to same visit/company and undeleted row. Deck links require actual active same-company design and same-visit deck artifact.
- The phone auth fixture captures the real deck table shape and live helper definitions in `tests/sql/site-visit-workflow-phone-auth.sql`. Root was notified of its schema for combined workflow fixtures.

## Verification and TDD evidence

`bash tests/sql/site-visit-workflow-run.sh` runs a disposable local PostgreSQL 17 Unix-socket cluster and exits 0. Latest result: 56 PASS notices, including real concurrent sessions with one winner/one conflict. Proof: `docs/artifacts/phase19/phone-protocol-tests.log` and `phone-suite-summary.log`.

Coverage includes both writer orders, two phones/hosts, exact duplicate and timeout replay, changed-payload denial, delayed deletion, immutable snapshots, default atomicity, completed denial with saved replay, real anon/JWT invocation, cross-tenant/revoked/assigned-only denial, representative restrictive RLS, inaccessible review denial, logical answer and template collisions, explicit pending/current reconciliation, resolution replay and cancellation before the original arrives, booking metadata preservation, direct REST provenance forgery rejection, absent media rejection, valid rendered-only annotated/dimensioned uploads, ordinary-photo markup rejection and ordinary-photo positive acceptance. Actual captured artifact CHECK constraints are installed in the fixture.

RED: inherited baseline proof `phone-legacy-race-red.log` records `FAIL: legacy delayed phone silently overwrote the server answer` from the legacy fixture before installing concurrency protection. GREEN: the same legacy-race assertion passes after migration. Later tests were added during implementation; not every new assertion has a separately retained red run. The first media-positive attempt failed on an incorrectly null new-row base; corrected to the protocol-required zero before the passing run. Do not misrepresent that fixture error as product-failure TDD proof.

`bash docs/artifacts/phase19/run-command-tests.sh` in iOS compiles actual Foundation command code, SwiftData template/answer/operation models, date parser, write builders and draft logic and runs 10 XCTest cases, 0 failures. Includes persisted SQLite reopened by a new ModelContainer and independent ModelContext, exact attempted payload/actor/resolution custody, original draft base, deletion timestamp and no automatic supersession rebase. Output in iOS `docs/artifacts/phase19/command-tests.log`. Macro plugin compilation required sandbox escalation. The harness does not compile the whole app, outbound coordinator, vault or SwiftUI.

Changed Swift sources passed `swiftc -frontend -parse`; the final legacy repository change was parsed separately. iOS `git diff --check` passed. Raw PostgreSQL aligned table output has trailing spaces; test output has expected PASS notices. No pristine-output claim is made for those logs.

## Files changed

Web: the two owned phone migrations; site-visit-workflow schema, legacy-race, protocol, durable, phone-auth, phone and runner fixtures; phone-prefixed proof logs.

iOS: SiteVisitType and SyncOperation models; visit/template DTOs and repositories; OutboundProcessor, SiteVisitOutboundSync, SiteVisitVersionedSync, SiteVisitWriteCommand/Models, SyncOperation integration, error classification and both server merge paths; persistence coordinator, type seed store, DataActor/DataController cleanup and enqueue paths; capture view model and template draft logic; PendingWorkDetailSheet and new SiteVisitConflictReview; command/persistence/coordinator/recovery-vault tests; focused executable harness and proof/design documents. Exact file inventory is in the commit stats.

## Self-review findings corrected

Fixed raw date echo comparisons, attempted-operation coalescing, buffered first-keystroke base capture, evidence erasure on semantic no-op, provenance fabrication through direct writes, before-lock authority reliance, current-choice delayed original execution, durable resolution retry custody, in-flight stale response handling, logical ID collisions, newer dirty vault overwrite, corrupt archive successful-empty restore, template seed overwrites and legacy repository bypasses. Root integration review caught artifact answer-kind vs artifact-kind confusion; corrected to live CHECK values and added positive/negative media tests.

## Runtime verification chronology

Required full app-hosted validation resumed only after explicit shared-build baton release and fresh global process/simulator checks. Every run uses private DD/SPM under `/private/tmp/ops-site-visits-p19`, simulator `FA315A2B-AD37-45C2-937A-816BD34CDCDD`, jobs2, serial test execution, and `CODE_SIGNING_ALLOWED=NO`. Sibling caches/results/simulators were preserved.

1. Batch1 exited65 before tests on a throwing short-circuit expression in SiteVisitServerMerge. Corrected to a throwing local fetch before boolean evaluation.
2. Batch2 compiled whole app and test targets, then hosted startup failed before test execution because MBXAccessToken was missing in the private checkout. The scheme test environment was unavailable at that early initialization. Subsequent batches use the Info.plist build substitution `MBX_ACCESS_TOKEN=pk.test-hosted-xctest-token`, with no credential, production configuration change or paid fallback.
3. Batch3 compiled the final actor-bound app and executed 62 tests. 59 passed; 3 assertions failed in 2 multi-context receipt tests. Actual template initialization stored uppercase UUID strings while the wire command used lowercase; exact receipt lookup missed the local model. New IDs normalize, and a shared legacy case-insensitive template lookup now serves receipts, inbound merge and vault restoration. Regression fixtures explicitly retain uppercase persisted IDs. Hosted390pt and 320pt accessibility snapshots rendered; inspection caught truncated title/disclosure labels, now corrected to wrap.
4. Batch4 exited 0 with TEST SUCCEEDED: 63 executed tests, 0 failures, 0 skips. The legacy uppercase-ID receipt and inbound regressions pass. Full app/test-target compilation passed. Suites: 4 versioned sync, 20 coordinator, 12 vault, 9 repository, 5 selected outbound, 7 command, 3 persisted-state, 3 hosted UI/summaries. Updated 390pt and 320pt accessibility PNGs were visually inspected; title/disclosure text wraps and all comparison/actions remain visible.

Raw logs are `/private/tmp/ops-site-visits-p19/phone-app-tests-N.log`; results are `/private/tmp/ops-site-visits-p19/phone-tests-N.xcresult`. Committed focused logs are iOS `docs/artifacts/phase19/phone-app-tests-N-summary.log`; final screenshots are `phone-conflict-review-390.png` and `phone-conflict-review-320-accessibility.png` in that directory. Reproduction script: iOS `docs/artifacts/phase19/run-phone-app-tests.sh`. The script requires separately coordinated build ownership; it does not authorize concurrent use.

## Additional self-review corrections

Fresh-context acknowledgement checks exact stored actor, payload and durable resolution, applies against current entity values, and carries committed receipt bookkeeping plus exact unattempted descendant updates back to the owning engine context. Newer edits survive response arrival. The vault compares all mutable values including tombstones and rejects rollback of attempt/receipt/resolution/history; safe directory replacement closes delete-then-move custody loss. Missing media destination fails while preserving the archive. Tests cover those actual app-hosted paths.

Conflict review includes changed field definition/order and existing human-readable type labels. It uses OPSStyle tokens without new hardcoded styles/custom motion. Hosted snapshots use an injected read-only fixture loader to avoid remote review calls; they exercise the actual SwiftUI view. They are rendering proof, not a signed-device or real authenticated end-to-end network exercise.

## Exact-actor boundary correction

Web commit `0c3ae18ef` binds each unreleased phone API to required `p_expected_actor uuid` before effects, readback or replay. Updated signatures: apply_site_visit_write(uuid,jsonb,uuid), review_site_visit_write(jsonb,uuid), resolve_site_visit_write(uuid,uuid,jsonb,text,jsonb,uuid), save_site_visit_capture(jsonb,uuid). New complete_site_visit_capture(uuid,jsonb,uuid) asserts the originating actor then delegates to existing complete_site_visit_guarded without changing its canonical behavior. New delete_site_visit_capture(uuid,timestamptz,uuid) validates locked current company/edit authority, rejects booked and completed/cancelled visits and preserves original deletion timestamp/status on replay. Shared private.apply_site_visit_rows signature is unchanged.

Latest disposable PostgreSQL run exits 0 with 56 PASS checks. Expected actor mismatch/missing actor fails before writes, review, supersession, capture or completion. Added deletion actor mismatch, positive in-progress deletion, exact timestamp replay, canonical booking cancellation protection and completed-record protection. Existing assigned-only tests pass the actual phone-b expected actor, so granular permission proof still reaches the permission gate. Correct-actor canonical completion integration is delegated to root's fixture with actual live completion dependencies; the phone fixture proves actor rejection before delegation and does not stub a success.

The iOS changes pass immutable operation actor through protocol/capture/completion/deletion requests, capture actor at new enqueue only, and segregate coalescing by actor. A replacement account cannot replace the original actor or payload. Legacy unbound operations remain unbound and fail safely; they are NOT remapped to the currently authenticated user. New app-hosted tests cover original actor persistence, missing-actor rejection, cross-actor coalescing, pre-send mismatch, post-response account switch, and repository completion/deletion arguments. These passed in the final 63-test batch.



## Release and review boundaries

Independent controller review remains required. No signed-device/customer-live/offline-network proof is claimed. Local SQL installs captured live dependency shapes/helpers and representative RLS; root owns combined canonical/MCP integration. Compatible signed-client release and separately authorized company activation remain release prerequisites; the compatibility gate remains empty. Legacy operations missing their originating actor fail closed with recoverable work and are never relabeled as the current user.

## Final custody and handoff

The iOS worktree is clean after 83f5a6b0. Exact phone SQL files are committed; unrelated root web WIP was not staged. Build slot was explicitly released to supplier owner 01a068ae-ef54-7393-85e1-1e8679deab73 and root after observed batch 4 exit 0. No heavy tests remain running. Available for controller review corrections.


## Independent-review corrections (2026-09-10, final local verification)

This section supersedes the earlier 63-test acceptance scope. The independent reviewer identified three real field integrations, and re-review identified authoritative empty-answer state loss. All four paths are corrected; final hosted correction result is recorded below. No release or production proof is implied.

- Atomic packet discard: the actual capture view-model queues one immutable actor-bound intent, retaining the pre-discard parent snapshot and superseded operation identities. Local parent/children tombstones are transactional. Discard runs ahead of its older packet queue, including completely unsent packets; orphan recovery does not rebuild that obsolete work. Server locks and authorizes the existing parent or creates a closed parent identity for an unsent packet, tombstones answers while media custody is intact, then artifacts/drafts/parent. Booked, completed and cancelled packets cannot use it. Original queue payloads/actors/receipts remain retained; exact discard receipt marks the captured operations complete. Late answer acknowledgments cannot reopen acknowledged discarded local work.
- Media dependency correction: newly queued media precedes linked answers. A linked answer additionally waits for every unresolved referenced artifact operation, including URL-bearing metadata generated by upload. Older inverted persisted chains are repaired by readiness rules without rewriting attempted answers or their original bases/payloads. URL metadata keeps the media operation actor. The hosted test executes real coordinator/outbound/media paths through fresh contexts for both new and older inverted graphs and verifies remote metadata acknowledgment precedes the immutable answer.
- Photo/markup hydration: plain photo fields may hydrate from supported photo variants; markup-only fields use annotated/dimensioned artifacts. Explicit pending edits and clearing survive reopen.
- Cross-device clear/unknown: the DTO and stored write-state retain authoritative answer_state through fresh and clean inbound merges, accept-current readback, and recovery vault. Hydration suppresses authoritative cleared/unknown, while untouched initial empty answers remain eligible. A phone row may send optional clear_answer:true only for an explicit empty clear; wrappers validate and translate that intent, without accepting host evidence/state from a phone. Original command bytes remain the idempotency identity. Acknowledgment verifies explicit-clear state and retires the local edit marker in favor of the authoritative state.

New public packet endpoint: `discard_site_visit_capture(p_command_id uuid,p_capture jsonb,p_discarded_at timestamptz,p_expected_actor uuid) returns jsonb`, receipt `{command_id,company_id,site_visit_id,discarded_at,outcome:discarded}`. Private receipt table is revoked from all client roles. Existing `private.apply_site_visit_rows(uuid,text,text,jsonb)` signature/row format remains unchanged. New `private.site_visit_phone_rows(text,jsonb)` is a revoked internal phone-intent translator. The core now stores NULL state for an empty insert lacking explicit state; host answered/unknown/cleared inputs and update semantics remain intact.

SQL commits: `9aeb87915` packet discard; `eb929129a` untouched-versus-clear semantics. Disposable PostgreSQL final phone suite: **69 PASS, exit0**, including seven new clear/unknown/intent/no-op/resolution cases, six packet-discard cases, original authorization/media/concurrency tests, and actual two-session race. Evidence: `docs/artifacts/phase19/phone-clear-state-tests.log`, with earlier packet proof in `phone-packet-discard-tests.log`. Root owns a separate combined actual canonical/MCP fixture and has independently verified actor-bound canonical completion and exact replay produce one linked activity.

Hosted chronology after review: batch5 full app compiled and **67/67 passed, exit0**. Batch6 **3/3 snapshots passed**, but manual inspection rejected an oversized blank accessibility raster; this was not accepted as visual proof. Batch7 full app compiled and **68/69 passed, exit65**; the new accept-current test incorrectly used a bare answer command instead of the real payload envelope and was correctly rejected. Only that test fixture was corrected. Batch8 never executed tests: a mistyped simulator UUID left only its own destination wait; that exact process was terminated (143), without touching sibling work. Batch9 is the authorized five-field-test correction rerun: **5/5 passed, exit0**. All69 selected tests now have passing final-source coverage across batch7 plus batch9; no production-source edits followed batch7. Final combined coverage must explicitly use batch7 plus batch9, not claim a single all-green 69-test batch.

Batch7 screenshots were inspected: normal390 populated two-field comparison and narrow320 accessibility populated one-field comparison both show readable pending/current definitions and all actions. The harness now checks nonblank raster content. Actual review is inside PendingWorkDetailSheet's ScrollView. These are app-hosted SwiftUI snapshots, not signed-device, network interaction, VoiceOver or physical scroll proof.

All runs use isolated P19 DD/SPM and private simulator, serial two-job builds, no signing, and a test-only dummy Mapbox build setting. Shared build baton is explicitly coordinated. The bugs simulator/cache and supplier outputs were preserved. No paid fallback, migration deployment, host exposure, company activation, push or release occurred.

Final iOS correction commit: `3005b50e5e366f310a6cd81a2d4a10d5495b681c`; iOS working tree clean. Batch9 exit0 and final build baton explicitly released to root. Evidence bundles `/private/tmp/ops-site-visits-p19/phone-tests-7.xcresult` and `phone-tests-9.xcresult`; concise logs committed under iOS `docs/artifacts/phase19/`.


### Blank text/measurement clear follow-through

Independent review found the explicit-clear flag still accompanied raw blank text values, which the strict wrapper rejects. Commit `6b7096f7` canonicalizes newly built wire values by omitting whitespace-only text/choice; raw local storage, saved original before values, and already-attempted payload bytes are not rewritten. The same builder supplies exact-local receipt comparisons, so canonical clear acknowledgment settles. False, zero text, and nonblank units remain values. `SiteVisitFieldWorkflowTests.testBufferedBlankTextClearHasEmptyWireValueAndPreservesAttemptedAudit` exercises actual buffer→durable command→receipt for text/measurement and empty/whitespace, and checks those preservation cases. Hosted batch10: **6 tests,0failures,exit0**, evidence `phone-app-tests-10-summary.log` and `/private/tmp/ops-site-visits-p19/phone-tests-10.xcresult`. Web fixture commit `9ea332d25` verifies canonical text/measurement clears with unchanged strict SQL;69PASS in `phone-blank-clear-tests.log`.

### Migration boundary work still active

Root discovered the initial new stored write-state/outbox properties widened live models referenced by released V1–V27 schemas. Required correction is to freeze exact base8553b1b4 SyncOperation and form shapes for released versions and add an additive new head/stage. Historical fingerprint values must not change. Full AppUpdateMigrationTests plus populated old-store migration/reopen proof remain required; they are not waived by previous field-flow tests. Schema-number coordination is pending with root before head edits. No build is currently running; batch10 baton released.


## Final migration closure (supersedes the pending migration section)

Migration commit **b15bf20f302fd0c9690e91714114c979ad91d4b4** freezes exact8553b1b4 stored SyncOperation/form definitions in `OPSSchemaLegacyPhoneV27.swift`, registers them for releasedV1–V27 (formsV11–V27), adds liveV28 registrations and adjacent lightweightV27→V28 stage, and advances OPSSchemaCurrent. All new fields are optional; migration does not invent actor, attempts, base, receipt or resolution authority.

Actual hosted **batch11** compiled the complete app/test target and ran31 cases:28passed,2optional private-device-copy cases skipped,1expected failure because the new V28 fingerprint had not yet been added. Every V1–V27 actual fingerprint matched the prior fixture exactly. V28 measured `nKgJeuKrTdQESe0YctzHunky4wMIqOpHYSoPkjdozIk=`; only this new entry was appended. The populated V27 fixture compared every original scalar field of forms, answers and outbox through migration and an independent reopen using exact binary/date/UUID custody snapshots, and verified both new form columns and all five operation columns remained nil. All four SiteVisitMigrationTests and all six FieldWorkflow tests passed. The AppUpdate suite includes two optional copied private-device fixtures; they were not provided, so their skips are explicit rather than represented as runtime proof.

Actual hosted **batch12:7tests,0failures,exit0** reran the all28 fingerprint check plus five DeckMergeBaseMigrationTests and the Catalog adjacent-schema registration test. Current-head expectations advanced toV28; historical fixture reads use frozen model types. No historical fingerprint value or historical schema version identifier was changed. Logs: `phone-app-tests-11-summary.log` (honest missing-new-entry failure) and `phone-app-tests-12-summary.log`; result bundles `/private/tmp/ops-site-visits-p19/phone-tests-11.xcresult` and `phone-tests-12.xcresult`. Across these two migration batches,35 distinct non-skipped cases pass; no single all-green31-case batch is claimed.

Final correction commits: iOS `3005b50e5e366f310a6cd81a2d4a10d5495b681c`, `6b7096f7`, `b15bf20f302fd0c9690e91714114c979ad91d4b4`; web `9aeb87915`, `eb929129a`, `9ea332d25`. Earlier actor/protocol commits remain listed above. iOS working tree is clean. Final serial build baton was explicitly released to root and iOS Bugs coordinator01a08cb3-4e8d-76e0-9b47-40cbd5a20853. No further build is running or planned by this implementer. The independent reviewer has the exact source/test pointers for final closure.
