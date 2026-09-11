# Final Phase 19 web integration review

Base: `c44cf655e733b257beaef8c7f37498ac057c8cb0`
Reviewed head: `9ea332d250e6ab070747183e10845fd52eb9bc02`
Verdict: **PASS — zero remaining integration findings after the scoped candidate fix.** Core site-visit SQL/approval/time boundaries retain PASS.

Closure reviewed against root-owned working changes on the head above; the finding describes the original committed head and is closed by the reviewed follow-up diff.

## Closed P2: v22 advertised inherited catalog tools that reject every v22 grant

Location: `src/lib/agent-control-plane/registry/mcp-exposure-catalog.ts:437`.

The v22 candidate spreads every V19 tool and grantable scope, including `inspect_catalog_changes`, `prepare_catalog_changes`, and `prepare_inventory_adjustment`. These are listed by the actual candidate server. The actual durable limiter routes these names to `consume_catalog_prepare_rate_limit_as_system` (`mcp/durable-rate-limit.ts:183`), whose SQL requires `grant_record.exposure_revision = '2026-09-08.mcp-exposure.v19'` (`supabase/migrations/20260908221635_agent_catalog_authoring.sql:568`; same predicate in captured `docs/artifacts/phase19/live-rate-contract.json`). The v22 candidate requires v22, so its properly bound grants cannot meet this predicate; invocation fails with `CATALOG_RATE_LIMIT_BINDING_INVALID` before the catalog domain runs. This is an advertised-capability integration failure, not an authority bypass or active-production regression.

The protocol fixture verifies its discovery list against the same v22 constant and proxies inherited domain methods to `{ok:true}`. Its real dispatch/rate cases cover the 11 site-visit names, so the inherited mismatch is outside that proof.

Recommended narrow fix: define the candidate's supported discovery-read set plus the 11 site-visit operations explicitly and limit its consent scopes accordingly. Do not broaden unrelated catalog/financial SQL authority to make the inherited tools callable. Regression: list the candidate's exact intended names/scopes, reject unrelated prepares, and exercise every retained discovery family through its actual authority/rate adapters.

## Focused closure evidence

The candidate now explicitly lists ten required discovery reads plus the eleven site-visit operations. Catalog/financial/other-phase prepares are absent. Grantable scopes are computed from the union of the selected manifest authorization variants and restricted to the registered typed vocabulary. This retains conditional read needs, including photos through job summary variants and files through visit/deck variants. V17 consent registered scopes equal this exact exposure set, allow only read/prepare, and inherit base read labels rather than catalog write/prepare labels. Active exposure/consent and selectable maps remain unchanged.

The retained discovery names route through `consume_agent_mcp_rate_limit_as_system`; its SQL binding checks exact actor/company/grant and current unrevoked/undisabled identities without pinning the grant to an older exposure, so the v19-only catalog limitation does not apply. The actual runtime/facade regression now exercises all ten retained discovery names in both protocol eras through the real durable adapter and current-authority read path, denying absent current membership before business source access. This is denial-path integration proof, not a claim of complete successful live source reads. Ten unrelated prepare calls (five names, two eras) are rejected before rate/domain dispatch.

Measured final focused result from `docs/artifacts/phase19/candidate-discovery-final.log`: **146 tests passed across four suites** — 111 protocol, 17 limiter adapter, 14 UI, four runtime construction tests. The previous 81-test interim pass and unsupported matcher failure are superseded by this measured final run. No broad suite rerun by this reviewer. Finding CLOSED.

## Verified integration boundaries

- Runtime constructs the trusted workflow service with the real bound RPC and authority repository; the facade requires that trusted service and the dispatch table maps all 11 workflow tool names.
- Candidate factory demands v22. Public factory cannot select it. Active exposure remains v14; active consent remains v9. Candidate v22/v17 are absent from public selectable maps. Host discovery includes no workflow commit or physical start/complete tool.
- Dedicated site-visit rate adapter and SQL agree on all 11 names, policy ID, grant/company/actor binding and required scope groups. Rate failures stop domain dispatch. Existing rate and protocol evidence is retained; no broad rerun was warranted.
- PostgreSQL remains the IANA authority. Strict civil conversion, gap/fold rejection and explicit offset validation feed a sealed proof. Node22 verifies arithmetic; the service binds it to the requested appointment before prepare. Commit recompiles current graph/time proof. No unrelated schedule-change guard was changed.
- SQL graph locks, revision/ABA checks, exact source hashes, current grant/role checks, original-argument retries, supersession and named approval remain intact from the independent 24-group/37-output re-review. Effect policy and compatible-company tables remain empty by migration; both exact activation predicates are required before preparation.
- Approval renders the sealed parent visit, precise civil time/offset/seconds, old/new checklist key, and truthful crew reminder defaults. Shared receipt validation binds target, row identities, values/evidence, effects and time proof; independent executed action readback must match identity/action data and receipt. Restricted notes are filtered and React-escaped. No host operation saves autonomously.

## Evidence reused and limits

Reviewed final source changes and `docs/artifacts/phase19/verification.md`. Reused the independently run approval/timezone re-review: 101 focused tests, final 14 UI cases, 24 disposable PostgreSQL groups and 37 fresh actual outputs validated under Node22. Parent final evidence adds 115 focused domain/read tests and 111 protocol/adapter/UI tests plus a passing focused production TypeScript graph. No broad suites rerun for this integration pass.

No production access, source changes, phone source/migration review, iOS builds, activation, exposure changes or release actions were performed. Parent owns the separate phone review, Bible integration and release.
