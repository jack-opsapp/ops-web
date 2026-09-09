# Phase 17 catalog authoring evidence

## Approved restricted trial release, 2026-09-09

The parent release now adds `20260909015000_catalog_trial_oauth.sql` and a six-tool V19/V14 OAuth slice. Public exposure/consent remain V14/V9. Trial access requires a separate immutable exact client/operator/company binding, a reviewed catalog effect hash, current permissions and at most two hours of validity. Every catalog mutation, including an OPS approval/replay, rechecks the original sealed trial context. Internal/API channels cannot bypass the restricted rollout. Existing financial bindings/policies are untouched.

Fresh integrated evidence: 639 tests in 21 files pass. Forty additional real PostgreSQL assertions cover OAuth code/mint/refresh, exact authority, no-write preparation, named approval, receipt replay, revocation, immutable binding, forced RLS and expiry. A real local PostgREST16.2 server with a two-connection pool returned HTTP503/PGRST001 when a deliberately stalled synthetic save hit the bounded transaction deadline. Independent readback proved no category, pending approval and no receipt; the same exact retry then saved once and returned one immutable persisted receipt. This closes the local HTTP disconnect/reconciliation gap, not native-host or production-pool acceptance. See `trial-verification.json`, `run-trial-checks.sh`, and `catalog-trial-postgrest.mjs`.

Jackson approved the catalog application/database release and MAVERICK-only trial, but every production business save still requires his exact OPS approval. The original candidate checkpoint below is historical; it does not describe the new approved trial wiring or claim that deployment has already happened.

The candidate prepares exact catalog imports/edits and separate stock adjustments, then saves only the named operator's sealed approval. It preserves canonical catalog records, source row identities, prices, stock history and receipts. New variants start at zero stock. Supplier text is untrusted evidence. Migration and candidate exposure remain dormant; no production migration, actor/grant/binding/fixture edit, activation, business write, push or deployment was performed.

## Final verification

| Check | Result |
| --- | --- |
| Catalog contracts, domain authority, actual MCP protocol, runtime, approval service, rendered EN/ES components, durable quota adapter, manifest | 131 tests in 9 files; exit 0 |
| All changed production TypeScript/TSX files and their imports, using existing ambient declarations | Exit 0 |
| Disposable SQL runtime | 73 assertions; exit 0 |
| Concurrent direct PostgreSQL connections | 15 assertions; exit 0 |
| Existing narrow trial exposure compatibility | Expected-list fixture corrected under parent authorization; all 20 tests pass |
| Final scoped review | All concrete findings addressed and independently rechecked |
| Token audit | Review component uses existing design tokens; no arbitrary style/color/spacing/font values |

Commands are retained in `run-checks.sh` and `run-sql.sh`; run from the web repository root. The latter recreates only this task's synthetic `catalog_p17` database, then executes `catalog-authoring-setup.sql`, `catalog-authoring-runtime.sql` and `catalog-authoring-concurrency.py`, stopping on any failure. It uses the task-owned socket `/private/tmp/ops-catalog-p17-final-pg/socket`, port 55479. To recreate the disposable server after it is stopped, initialize a fresh local PostgreSQL17 data directory there, create its socket directory, and start `pg_ctl` with that socket/port. Never point this harness at a production or shared database.

`verification.json` records exact results and checksums. `source-sha256.txt` hashes the changed application, migration and SQL fixture/test files at verification. Base web revision is `e6fb07d7d`; the existing plan commit is `81eff9b12`. The final implementation revision is the commit containing these artifacts.

Migration SHA-256: `0d9b3d9fe3864489d67ef668cecc5f3daf709d520b224bf605ff9812367d9efd`.

## What the SQL evidence establishes

The runtime covers exact graph saves, unchanged IDs, canonical price mirrors, zero initial stock, fixed recipes, provider/purchase/accounting separation, cost redaction, current operator/grant/client/permission checks, rejection/expiry, stale records, source/effect/default drift, idempotency and immutable receipts. It includes duplicate SKU/name/option/recipe handling, missing inputs, selected recipe rejection, physical stock capture boundaries, inherited prices/counting units, named category removal and prospective category cycles. Late trigger failure rolls back earlier writes, read revisions, receipts and review completion together.

Concurrent tests use separate real PostgreSQL connections. An ordinary writer makes candidate preparation fail promptly with SQLSTATE 55P03. A deliberately stalled save hits PostgreSQL17 transaction timeout (25P04), disconnects, releases another company's waiting writer, and leaves independently observed original price/pending approval/no receipt. The same exact approval then succeeds; replay returns one immutable receipt. Already shorter transaction and statement timers remain effective, elapsed time on an older transaction is preserved, and repeated helper calls do not restart its deadline.

The kernel arms a transaction-local maximum two-second deadline before catalog/authority locks. Whole-table insertion fences may block another company's writer briefly. No function-level statement timeout is set: PostgREST hoisting would otherwise override a shorter role limit. PostgreSQL's transaction timeout terminates the session; it is not proof by itself of any business outcome. The client reports retryable contention and uses exact retry/readback to establish the result. See the [PostgreSQL17 timeout documentation](https://www.postgresql.org/docs/17/runtime-config-client.html) and [PostgREST hoisted settings](https://postgrest.org/en/stable/references/transactions.html#hoisted-function-settings).

## Limits and activation gates

This is direct PostgreSQL evidence, plus protocol/component tests whose RPC transports are mocked. It does not prove the deployed PostgREST/pool disconnect error shape. Before any catalog activation, exercise an explicitly authorized end-to-end PostgREST/pool timeout, same-key retry and persisted receipt readback canary. Preserve the empty effect-policy table and production exposure/registration exclusion until separate migration and activation authorization.

Browser visual acceptance remains unresolved: a local preview served successfully, but the browser attachment/navigation attempts did not produce a verified screenshot. Actual React component tests cover formatting, names, localization, escaping and invalid-state handling. They are not browser or signed-in native-host acceptance. No browser/platform rewrite was made.

An initial broader run exposed a pre-existing stale expected list in `mcp-exposure-catalog.test.ts`: it stopped at v14 while base `e6fb07d7d` already registered the narrow financial-trial v17. The parent independently verified it and authorized correcting this one generic test. Its expected list now references `MCP_FINANCIAL_TRIAL_EXPOSURE`, with no change to active V14, full V17 candidate, legacy bytes/digests, production code or any Phase16 SQL/data. The correction has its own test-only commit, `b85ce28a4`. The final focused suite includes all 20 exposure tests. A whole-repository build/type check was not completed.

The fixture retains live-read canonical column types/defaults/checks and reachable catalog triggers; unrelated historical foreign keys are omitted from the synthetic database. Raw metadata and its generator are retained in the parent artifact directory; they contain schema/function definitions, not customer rows. No new paid service or API was enabled.
