# P19-2 deck geometry — full connection release handoff

## Verified local outcome

The complete V14 connection now has a V23 successor with exactly the same ordered **35 tools and 21 scopes**. Only deck geometry representation changes. The normal server factory returns result v2 for V23; old pins retain result v1. The original native stair survives an absent lower edge, configured flat railing zero remains explicit, and incomplete measured perimeter stays partial with a null total and `order_ready: false`.

Local implementation, independent review, database proof, bounded typechecking and lint are complete. **No production migration, push, deployment, grant/consent mutation, business write, iOS build or host canary occurred in this task.** Parent task `01a0551f-df19-7942-a6d9-7e6e33f1bc9e` owns the separately approved rollout and live acceptance.

## Commits and source custody

Web worktree: `/Users/jacksonsweet/Projects/OPS/.worktrees/ops-mcp-deck-geometry-web`, branch `feat/ops-mcp-deck-geometry`.

| Commit | Change |
| --- | --- |
| `237d151aba2a1ca28b349c5596b8e8ba2b56642c` | Preserve optional native stair destination. |
| `9006d343d4dc10d3724b5627bfa26fa0d4a1eb7a` | Explicit v2 measurement/perimeter/proof and persistent deck errors. |
| `1ecd310fda5110f8ef329e3229a4497ce23b39ed` | Original isolated candidate integration. Superseded by the full successor below. |
| `7a73abe404b7d57d8b6a6d191547ee10a27cad64` | Merge production `c217c3bc4ff83976068d66c6ab6fcfb35b07e4db`. |
| `7788200d86af6b9670d4baeb16a542e7918c96e6` | Full V23 discovery, consent selection and grant-derived customer preparation. |
| `6bc665097b7d152f90ae99166cd8856fd299613c` | Guarded additive migration and real PostgreSQL coverage. |
| `0b864057c31114a9b4a44ad8b4ec056d4ba1791d` | Merge newly released Canpro OAuth `ab42b042613d487413f3d9f36f535cbe27a40504`. |
| `2a62dfa561397038bdf9c5511d02a38063cc0351` | V23 Canpro read-only callback/consent regressions. |

Bible worktree: `/Users/jacksonsweet/Projects/OPS/.worktrees/ops-mcp-deck-geometry-bible`, branch `docs/ops-mcp-deck-geometry`. Original documentation `6ad7fd3ea25350241fd3acdf6cc5af461e894e14`; full integration documentation **`2aa6088d376577f42a91343fbb41275977a0c3da`**, numbered chapters `04_API_AND_INTEGRATION.md` and `07_SPECIALIZED_FEATURES.md`. Shared primary checkouts and sibling work were preserved.

## Exact representation and authority

- V23 is `2026-09-10.mcp-exposure.v23`, reusing V14's immutable tool/scope arrays, customer-update manifest v20, existing P2 v8 policy/authorization and V9 consent. No sibling candidate is activated. Reserved manifest v28 and consent v18 remain unused.
- V2 literals are `deck-geometry-result:2026-09-10.v2` and `deck-geometry-calculator:2026-09-10.v2`. Complete results and selected calculator bind source proof/fence. Caller arguments cannot choose representation or identity.
- V1 schema/calculator literals remain unchanged. Valid native geometry that cannot fit v1 returns nonretryable `INTERNAL` with incident ID and a connection-version explanation. Invalid saved geometry is also nonretryable `INTERNAL`; unrelated `SOURCE_DATA_INVALID` mappings remain unchanged.
- Native source destination vertices survive topology welding. Drawing coordinates are not measured lengths. Saved inch dimensions drive perimeter; unresolved gates/landings/boundaries remain explicit. The native 36-inch gate allowance is not substituted for a missing measurement. Flat perimeter and assumed two-side sloped stair lengths stay separate.
- Customer-update preparation now calls service-only `prepare_agent_customer_update_for_grant_as_system`, deriving the immutable grant exposure instead of hardcoding V14. Original preparation and full evidence/current authority/no-change/policy/idempotency checks remain. Queued approval and rate limiting retain the actual V14 or V23 pin. The wrapper takes no early row lock; canonical company-first locking revalidates current grant state inside original preparation.
- Current full V14 connection already includes `ops.files.read`; this integration requires no scope expansion. Refresh never upgrades an existing client/grant.

## Migration and rollout order

**File:** `supabase/migrations/20260910225814_agent_deck_geometry_v23_exposure.sql`

**SHA-256:** `657578123aeb0196c91abff5004553af524aed5afb1146cd17029c6ca0222989`

1. Independently verify current function/ACL baseline and that no enabled, unexpired V17/V19 trial has started. Apply only this additive migration **before** deploying code that registers V23. Preserve the unrelated Canpro migration ledger entry; it is not part of this migration.
2. The migration checks 12 exact captured function bodies/owners/ACLs/search paths and exact enabled immutable triggers, then changes only access resolution, customer authority, queued reauthorization, limiter pin admission and the new wrapper. Original preparation/refresh/consent functions are unchanged. Replay checks the full wrapper definition and makes no changes.
3. SHARE locks on both trial binding tables prevent concurrent insertion/update until commit. Any enabled unexpired V17 financial or V19 catalog binding causes `DECK_V23_ACTIVE_TRIAL_REQUIRES_SEPARATE_ROLLOUT`; do not disable or reseal it to force this release. Parent readback found all existing bindings expired.
4. Financial/catalog computed effect hashes include all public/private functions and **will change**. Their policy and expired binding rows stay untouched; this migration never reseals them. Customer-update effect hash and policy row equality are enforced. Its **pre-existing stale production policy remains stale** and refuses preparation; this is an independent baseline, not fixed or weakened here.
5. After SQL readback, safely integrate/push the code and verify the READY production alias and expected Git SHA. Request a fresh Claude authorization/new client using the full existing tool/scope set. Merely refreshing the old connection preserves its old pin.
6. Perform read-only signed-in discovery and the original deck request. Verify source reference/custody, retained null lower destination and stair, authoritative stringer, configured flat zero, partial perimeter with `landing_opening_unlocated`, and all other tools/scopes. Only this establishes customer-live/Claude acceptance.

**Rollback:** Before any V23 connection exists, old code can continue with additive SQL. Once V23 clients/grants exist, an old deployment cannot resolve their exposure. Retain V23 resolver/representation while stopping new V23 registrations in a narrowly verified change, or repair forward. Do not rewrite historical grants, drop the wrapper used by deployed code, or promise that a preintegration deployment is universally safe.

## Current verification

- **860/860 tests, 42 files, Node 22.23.2**, post-merge: registry, consent/enrollment, exact callbacks, PKCE/token/code routes, Canpro read-only ceiling, userinfo, transport, full normal-factory V14/V23 discovery and v1/v2 dispatch, customer wrapper and denial boundaries. `v23-postmerge-unit.log`.
- **316 PostgreSQL assertions, PostgreSQL 17.11** using current live-captured schema/functions and disposable synthetic identities with real approval/commit core. Covers old/new consent → code → grant → bearer → refresh, reuse/revocation, exact old row preservation, baseline rejection, zero-change replay, active-trial refusal, expired rows, real concurrent insertion blocked during migration, old V14 proposal prepared before/committed after migration, stale-policy/no-change refusal, queued identity substitution and actual limiter binding. Also runs current Canpro V23 callback alias/PKCE/consent/refresh tests. `v23-runtime/result.json` and retained behavior logs. Production PostgreSQL is 17.6; this is local database evidence, not a production canary.
- Bounded TypeScript on the changed server/service/OAuth/repository/tests and their actual dependencies: **exit 0**. Targeted ESLint `--max-warnings 0`: **exit 0**. `tsconfig.json`, `v23-typecheck.log`, `v23-lint.log`, `v23-postmerge-lint.log` and `v23-verification.json`.
- Parent independently verified 139/139 geometry/error/v1 tests on Node22 and the exact private saved source: matching opaque identity, unchanged source, retained null lower edge/stair, authoritative stringer, configured flat zero, partial perimeter and `order_ready: false`. Parent also independently passed merged OAuth/Canpro/normal-factory tests. No confidential identities, raw drawing or quantities are committed.
- Independent review found no unresolved P1/P2 issue. Its early-wrapper-lock recommendation is implemented. Final trigger/replay guards strengthen fail-closed baseline validation.

**Bounded proof limits:** Whole-repository TypeScript exceeded Node's default heap. The original dispatcher baseline expects 50 methods while its unchanged implementation has 53 (`baseline-dispatch.json`). An additional eight-test check passed five; three dormant schedule-candidate tests stop at the existing Node22 `TIMEZONE_RUNTIME_UPDATE_REQUIRED` guard, before their intended RPC assertions. Schedule implementation files are byte-identical to production base and only that test's active-exposure expectation changed (`schedule-baseline.json`, `v23-dormant-baseline.log`). No runtime/package changes or unrelated dormant scheduling fixes were made. Earlier Node24 logs remain historical only.

## Reproduce locally

From the web worktree, use `/Users/jacksonsweet/.nvm/versions/node/v22.23.2/bin/node` (abbreviated `NODE` below). Do not run the SQL fixture against a shared or production database; the Python runner creates and destroys its own private Unix-socket PostgreSQL cluster.

```sh
NODE=/Users/jacksonsweet/.nvm/versions/node/v22.23.2/bin/node
"$NODE" node_modules/vitest/vitest.mjs run src/lib/agent-control-plane/registry/__tests__ src/lib/agent-control-plane/mcp/oauth/__tests__ src/lib/agent-control-plane/mcp/__tests__/grant-pinned-exposure.test.ts src/lib/agent-control-plane/mcp/__tests__/transport.test.ts src/lib/agent-control-plane/mcp/__tests__/deck-geometry-candidate-protocol.test.ts src/lib/agent-control-plane/services/customer-update/__tests__/customer-update.test.ts tests/unit/mcp/oauth-routes.test.ts tests/unit/mcp/oauth-userinfo.test.ts --maxWorkers=1 --minWorkers=1
python3 tests/sql/deck-geometry-v23-run-runtime.py
"$NODE" node_modules/typescript/bin/tsc -p docs/artifacts/deck-geometry-2026-09-10/tsconfig.json
```

ESLint was run with `--max-warnings 0` over the changed TypeScript files, including the new successor/Canpro cases and merged OAuth route test. Live-captured fixture JSON contains function definitions and security metadata only, no live business data or keys. The limiter key is an explicitly synthetic local value.
