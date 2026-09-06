# Post-release timestamp and no-change repair

The first repair is live on OPS-Web `2a349d8182e449af8891332f5b9636f3121df652`, deployment `dpl_8sC7eyrxAyJSEZ7wF5Kwk2x7J8x6`, production ledger `20260905191357_agent_maverick_read_repairs`. Authenticated read and independent invariant evidence is in `release-canaries.json`. The first release's 892 application tests and 60 SQL assertions remain recorded in `verification.md`.

## Live diagnosis

The exact `get_job_summary` identity returned a millisecond version, while PostgreSQL stored six fractional digits. The unchanged-title request therefore reached `AGENT_CUSTOMER_UPDATE_SOURCE_STALE`. A second unchanged-title probe using the exact six-digit version reached `AGENT_CUSTOMER_UPDATE_NO_CHANGE`; the application incorrectly exposed that guard as retryable unavailability. Production task, opportunity and grant readbacks are unchanged, with zero customer-update proposals. The initial diagnostic input used non-ISO SQL timestamp syntax and was rejected before RPC; it is recorded separately rather than counted as a runtime defect.

## Separate local repair

Migration `20260905192721_agent_customer_update_source_precision.sql`, SHA-256 `73d4218ee05f74c2230295790e69581ebe8ad1dcb33abbf0defc2b256afe927d`, changes one identity `updated_at` expression in the live job-summary core from the shared millisecond formatter to UTC microseconds. It preserves exact mutation guards, function identity/owner/ACL/security, shared timestamp formatting and all authorization. Original definition MD5 `128a904a5ddaa81ab387fdddf95210e4`; expected after `e8ddba2e98fb82a468aa2ce1e0a792e1`. No table, policy, grant or business row changes.

The repository/service maps only exact `AGENT_CUSTOMER_UPDATE_NO_CHANGE` to non-retryable `INVALID_ARGUMENT` with field issue `CUSTOMER_UPDATE_NO_CHANGE`. Input metadata instructs callers to copy every digit of `dates.updated_at` from identity.

## Verification

- Red application regression reproduced retryable unavailability instead of the no-change outcome.
- 178 tests pass across customer-update contracts, capability authorization, service/repository, and job-catalog repositories. The strengthened nine-test customer-update suite separately passes, verifying every timestamp digit reaches the actual RPC arguments.
- Full TypeScript check passes with 8 GiB heap; focused ESLint passes with zero warnings.
- `bash tests/sql/agent-customer-update-precision-run-runtime.sh` reproduces the live precision loss and `SOURCE_STALE` through the real preparation RPC before applying the local migration.
- Twelve SQL assertions then pass: exact six-digit version, real no-change guard, equivalent precise offset, a one-microsecond concurrent edit rejected, rounded versions rejected, successful changed synthetic preview without business mutation (rolled back), zero change sets, zero actions, unchanged business row, preserved function identity/security, unchanged shared formatter.
- Exact migration replay passes; unexpected function volatility drift rejects. The runner removes only its own disposable Unix-socket PostgreSQL cluster.
- GitHub CI run 33986578832 on the first release fails at the pre-existing unchanged delivery-source fixture's `agent_provider_delivery_source_idempotency_conflict`. That failure is separate from these targeted checks and the READY deployment.

## Limits and release authority

The SQL precision fixture evaluates the exact installed live identity projection expression and real preparation authority/mutation guards. It does not execute the full job-summary RPC. The application proof separately validates a fully proof-bound six-digit identity through the actual repository. Production canary acceptance for this additional repair remains pending release approval.

No real business proposal, approval, commit or provider message was attempted. The existing B.C. database timezone-data mismatch remains an independently recorded platform issue; this patch changes no timezone rules.

This additional repair is committed locally only. Jackson's prior approval covered the first migration/web release and its Bible evidence. A separate explicit approval is required to apply this migration and deploy the additional application changes. After approval, re-read identity through MCP, copy its exact version into an unchanged-title request, verify the non-retryable no-change response, and independently read back the source/grant/proposal invariants.
