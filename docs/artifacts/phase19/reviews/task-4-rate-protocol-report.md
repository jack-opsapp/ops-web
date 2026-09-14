# Task4 rate/protocol implementer report

Status: DONE_WITH_CONCERNS. Exact owned code committed ea5ca1b71. No production/grant/policy activation, exposure/consent selection, push or deployment.

## Implementation

All eleven candidate host tools, including reads, select dedicated `mcp-site-visit-workflow:2026-09-10.v1` and service-role RPC `consume_site_visit_workflow_rate_limit_as_system`. Existing adapter deadline/abort and fail-closed response validation remain. New migration20260911010000 extends the actual captured closed policy constraint with every predecessor policy preserved. It retains existing buckets/functions and uses their real HMAC digest/prune mechanisms. A shared site_visit_workflow digest identity across tools limits each actor/grant to6 and company to30 per60 seconds; rotating tools does not evade the budget. Ordered atomic bucket locks and2-second lock_timeout bound contention. Each attempt consumes one unit; a timeout is not automatically retried, matching existing adapter semantics.

Current exact grant/client relationship, active actor/company, v22 exposure, v17 consent, accepted labels, ceiling/scope string, and operation-specific scopes are checked under row locks before any charge. The wrapper delegates labels to the root workflow candidate helper, without changing active OAuth labels or registering candidate grants. It is executable only by service_role. Host commit/start/complete are absent.

## Verification

Node22.23.2 runs60 new actual SDK protocol tests plus17 existing adapter tests:77 passed. Both2025 legacy and2026-07-28 modern eras exercise actual wire envelopes/headers, tool visibility, all11 dedicated durable-limit dispatches, read/prepare SQL operation bindings, current actor reauthorization, immutable idempotency request/replay, invalid binding/oversized output/business conflict handling, forged approval/commit rejection, and the existing deployed civil-time fail-closed guard. Real service/SDK/limiter adapter run against explicit RPC/authority fakes; this is not a deployed canary. Test clock isolation prevents cases sharing the existing secondary in-memory quota. Modern initially rejected the incomplete fixture envelope/header; the final test uses the actual required SDK wire contract. No guard was bypassed.

Focused TypeScript dependency graph including the new tests and production adapter passes with no diagnostics via tests/tsconfig.site-visit-protocol.json. New test initially omitted required clientName; corrected and rechecked.

`bash tests/sql/site-visit-rate-run.sh` exits0 in its own disposable PostgreSQL17 socket cluster.26 PASS notices, including twelve authority mutation checks grouped under one assertion, all11 tools, actor/grant shared tool bound, denial audit, role ACL, invalid host capability/null era, company ceiling across six actors,10 real simultaneous sessions with exactly6 accepted, and an unchanged predecessor-policy bucket. Fixture uses captured live table column types/defaults and bucket CHECKs plus actual digest/prune/label functions; unrelated triggers/FKs omitted. No production data or credentials used.

Raw proof: /private/tmp/ops-p19-rate-proof.log, /private/tmp/ops-p19-protocol-proof.log, /private/tmp/ops-p19-protocol-typecheck.log. Reproduction: Node22.23.2 vitest the new site-visit-candidate-protocol.test.ts and existing durable-rate-limit.test.ts; tsc --project tests/tsconfig.site-visit-protocol.json. git diff check passes.

## Concerns and handoff

Candidate remains dormant. Root retains whole workflow/canonical/UI ownership. Node22 tz2026a booking/reschedule guard remains fail-closed; no package-engine or timezone guard changes. Independent review still required. Separately, phone reviewer identified discard/media ordering/markup hydration issues; those are next phone work, not hidden by these passing rate/protocol tests.


Controller final update: the earlier Node-ICU booking limitation in this report was replaced by the parent-approved PostgreSQL timezone authority. Current final wire proof is80 candidate tests plus17 limiter adapter tests, including positive Vancouver booking and substituted-proof denial in both protocol eras. Existing schedule-change guards remain unchanged. See verification.md.
