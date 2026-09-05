# Phase 12 local PostgreSQL runtime proof

Run with PostgreSQL 17 installed:

```sh
bash tests/sql/agent-customer-update-run-runtime.sh
```

The runner creates a unique directory under `/private/tmp`, opens only its Unix socket, runs the actual current migration, and stops/removes only its own cluster on exit. It rejects SQL errors with `ON_ERROR_STOP`. It does not access production.

Result: **52 checks passed**, including two overlapping cross-company assignments. Exact tested migration SHA-256: `e478142143fe9ebde253a1231cba34255a8d9757556187a6f324677c981831b2`.

Coverage: null-customer opportunity-only commit; ISO Z and offset timestamps; prepare and commit replay; conflicting idempotency keys; seal mismatch; source content drift without timestamp drift; revoked grant; permission provenance drift; cross-tenant reads/commits; actual guarded assignment, write-token consumption, immutable event and silent delivery; delayed activity trigger reaching permanent source suppression; nested helper change invalidating the policy seal; optional linked notes; accounting connection rejection; expiry and rejection; readback mismatch rolling back target, event, delivery and receipt; pending suggestion insertion invalidating approval and exact superseded count; attributed correspondence, changed/forged evidence, missing field support and invalid timestamps; privileged RPC ACLs; real permissive company-scope plus restrictive Phase12 RLS; direct authenticated own/other-actor/missing-email SELECT; browser INSERT/UPDATE/DELETE and legacy-retag denial; service filter actor/permission checks; safe rejection and notification clearance after OAuth revocation.

Columns, types, defaults, NOT NULL constraints and production CHECK constraints on action/event/delivery/suggestion/notification tables came from a read-only production catalog query on 2026-09-04. Authority resolution, permission helpers, canonical assignment guard/core, assignment-event trigger, delayed-activity trigger and enqueue function use production definitions or the actual Phase 12 migration. The successful mutation core is never stubbed.

Limits: this is a focused disposable fixture, not a complete production clone. Unrelated foreign keys/checks/RLS beyond the action privacy path, notification lifecycle, accounting/work-queue trigger graph and actual provider workers are omitted. The accounting test proves the Phase 12 connection gate; it does not run accounting workers. The delayed-activity test additionally instruments the actual enqueue function with an observation row and a tripwire after the source guard, proving suppression happens before other eligibility guards; the function definition is restored afterward. A misbehaving test trigger deliberately forces a readback mismatch to prove transaction rollback. These are local execution proofs, not production or host/client acceptance.

Fixtures are self-contained under `tests/sql/agent-customer-update-*`; runtime logs and exact file hashes are under `docs/artifacts/phase12/runtime-*`.

## Final timeout investigation

Two failed concurrency attempts were caused by macOS sleep while the fixture held its intentional one-second sleep barrier. The first coincided with Clamshell Sleep at 16:23:37 and DarkWake at 16:24:08 (31 seconds). The reproduced failure coincided with Maintenance Sleep at 16:25:42 and DarkWake at 16:26:23 (41 seconds), verified using `pmset -g log`.

The captured PostgreSQL wait graph at 16:26:23 showed PID 31093 waiting on `ShareRowExclusiveLock` for `opportunity_assignment_suggestions`, blocked only by PID 31092. PID 31092 had no blockers and was in `pg_sleep(1)` with a 40.35-second query age. The monitor's half-second interval also jumped by 40 seconds. There was no cycle and no CPU work in the snapshot text check at the blocker.

The unchanged final migration passed the complete 52-check suite at 18:50:35–18:50:37 with normal scheduling. The waiter was blocked for approximately one second; the first transaction committed and the second acquired the lock and committed. Timeout thresholds remain 15 seconds for locks and 30 seconds for statements. No implementation or timeout relaxation was needed. `runtime-lock-graph.jsonl` preserves both failure and successful wait observations. The runner now supports `OPS_P12_DIAGNOSTICS=1` to collect this graph on demand.
