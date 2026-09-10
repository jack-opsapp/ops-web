# P19-2 deck geometry repair — local handoff

## Status and commits

Implementation and independent review are complete locally. No push, deployment, production migration, business write, OAuth/consent/grant change, iOS build or release occurred. Both isolated worktrees are preserved for parent integration.

| Web commit | Purpose |
| --- | --- |
| `237d151aba2a1ca28b349c5596b8e8ba2b56642c` | Preserve native optional stair destination; synthetic fixtures for both native formats. |
| `9006d343d4dc10d3724b5627bfa26fa0d4a1eb7a` | Explicit result/calculator v2, native placement, measured perimeter scenario, proof/fence binding, persistent deck errors and regressions. Includes narrow shared error transport classification. |
| `1ecd310fda5110f8ef329e3229a4497ce23b39ed` | Separate shared integration: dormant candidate factory, server-owned version selection, domain forwarding, candidate registry and actual in-memory protocol proof. |

Web base: `23ffe646a77effba851fe063c68c15e93114b9cb`; branch `feat/ops-mcp-deck-geometry`; worktree `/Users/jacksonsweet/Projects/OPS/.worktrees/ops-mcp-deck-geometry-web`. Bible base: `03da8c1`; branch `docs/ops-mcp-deck-geometry`; worktree `/Users/jacksonsweet/Projects/OPS/.worktrees/ops-mcp-deck-geometry-bible`. Primary shared checkouts and sibling work were preserved. Bible commit: `6ad7fd3ea25350241fd3acdf6cc5af461e894e14`. Bible changes are in numbered chapters `04_API_AND_INTEGRATION.md` and `07_SPECIALIZED_FEATURES.md`, with exact web commit references.

## Result and compatibility

- Both native `DeckLevel.swift` models permit absent/null `lowerEdgeId`. The parser retains the real connection and stair; invalid named references remain errors. V2 represents null explicitly, plus alignment, offset, flip direction, connection position and native destination source vertices. It never fabricates a lower edge or discards the connection.
- Native raw destination endpoint/vertex references survive public topology welding. The destination is drawing-space placement; it does not locate a measured lower landing opening by implication.
- Strict legacy schema/calculator literals remain `2026-08-22.v1` and `deck-geometry-calculator:2026-08-22.v1`. Representable v1 keeps its original fields and configured quantities. An unrepresentable valid native connection returns public `INTERNAL`, nonretryable, with an incident ID and explanation that OPS must release/enable a compatible connection version. Internal reason: `DECK_GEOMETRY_RESULT_REVISION_UNSUPPORTED`. It is not caller argument error.
- Explicit v2 literals: `deck-geometry-result:2026-09-10.v2` and `deck-geometry-calculator:2026-09-10.v2`. The complete result and selected calculator bind the proof/fence. Default domain selection remains v1; request arguments cannot select revision or authority.
- Configured flat railing zero is preserved as configured coverage. The separate perimeter scenario enumerates included/excluded/unresolved edges from saved inch measurements, boundary membership and located openings. Coordinates stay drawing units. House/wall/proved shared boundaries are excluded; ambiguity, stale/missing dimensions, unknown gates and unlocated landings remain explicit. Native 36-inch component gate allowance is never treated as measured width in the scenario.
- Flat perimeter and one-/assumed-two-side sloped stair lengths are separate. No complete total is returned with unresolved boundaries; empty drawings are unavailable. `order_ready` is always false. Guard decisions, rail system, actual rail sides/extensions, waste, pricing and stock remain missing facts.
- Invalid saved geometry also returns nonretryable `INTERNAL`. Shared mapping changes only the deck-specific reasons; other domains' `SOURCE_DATA_INVALID` behavior is unchanged.

## Verification and limits

- **222 relevant tests pass** across native/golden calculator, result contracts, repository/authorization, source/version proof, errors, composition, candidate protocol, existing transport and existing grant-pinned exposure.
- The extended run is **223 passed / 1 failed / 224 total**. Its sole failure is the untouched `domain-dispatch.test.ts` canonical list expecting 50 entries, while the untouched base dispatcher already has 53 including three Phase17 catalog methods. `baseline-dispatch.json` proves both runtime implementation and test are byte-identical to the base. The module has no runtime project dependencies beyond `server-only`; it imports its domain contracts as types. No catalog code was edited to mask this baseline failure.
- Final typed test refinements rerun **43/43** (candidate protocol 11, v2 service 17, perimeter 15). See retained logs. Bounded TypeScript includes the actual server, deck service and these new tests/dependency graph. Targeted ESLint uses `--max-warnings 0`. Both pass. A whole-repository TypeScript attempt was stopped under resource pressure; no full build/type-check claim is made.
- Parent independently reran 150/150 tests across all nine deck service suites, candidate protocol, error transport and v1 contract (12 files, 6.09 seconds). Parent also byte-verified the baseline dispatcher files and independently replayed the exact private source in memory: opaque reference matched, original source unchanged, connection/null lower edge retained, stair stringer authoritative, configured flat zero, partial perimeter with null total and `landing_opening_unlocated`. This was read-only.
- Local and parent verification used **Node v24.19.0**. The project declares production Node 22.x. Node 24 proof is not production Node 22 runtime acceptance; confirm the approved release under its actual runtime and host.
- Independent read-only review found four substantive edge/destination issues; all are fixed with regression coverage. A final factory correction binds actual nominal actor/token fields; the reviewer confirmed the production bearer supplies those exact fields and grant revision checks remain in existing authorization/repository custody. No unresolved review findings.
- The original confidential saved drawing was replayed through the local pure calculator without changing its source. The retained sanitized summary proves one connection retained, null lower edge preserved, authoritative stair geometry, configured flat zero, and partial perimeter with `landing_opening_unlocated`. It contains no production identities, raw drawing or quantities. This is pure calculator evidence, not authenticated RPC/Claude evidence. Private inputs and replay script remain outside Git under `/private/tmp`.
- Protocol tests use synthetic nominal actors and the actual composed P2 domain, repository, proof, serializer, audit and rate limiter paths. They cover original business arguments, v1/v2 isolation, source substitution/staleness, missing scope/permission, grant/token substitutions, strict injected-field rejection and rate-limit denial before source reads.

## Reproduce the bounded checks

Run from the web worktree with its existing Node/dependencies (no dependency installation or paid fallback required):

```sh
NODE=/Users/jacksonsweet/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
"$NODE" node_modules/vitest/vitest.mjs run \
  src/lib/agent-control-plane/mcp/__tests__/deck-geometry-candidate-protocol.test.ts \
  src/lib/agent-control-plane/mcp/__tests__/grant-pinned-exposure.test.ts \
  src/lib/agent-control-plane/mcp/__tests__/transport.test.ts \
  src/lib/agent-control-plane/services/p2/deck-design \
  src/lib/agent-control-plane/contracts/__tests__/p2-deck-design-geometry.test.ts \
  src/lib/agent-control-plane/services/p2/__tests__/read-error-transport.test.ts \
  src/lib/agent-control-plane/services/p2/__tests__/composition.test.ts \
  --maxWorkers=1 --minWorkers=1
"$NODE" --max-old-space-size=2048 node_modules/typescript/bin/tsc \
  -p docs/artifacts/deck-geometry-2026-09-10/tsconfig.json
git diff --check
```

The retained extended log used the same Vitest command plus `src/lib/agent-control-plane/mcp/__tests__/domain-dispatch.test.ts`. Final refinement command: the candidate protocol, `deck-geometry-v2-service.test.ts`, and `deck-railing-estimate.test.ts` paths with the same one-worker flags. Targeted lint command is `"$NODE" node_modules/eslint/bin/eslint.js --max-warnings 0` followed by the `.ts` files changed by the three code commits; `verification.json` records the exact list.

## Parent integration and release gates

1. Review/integrate these local commits without overwriting shared or sibling work. Parent retains final independent review and owns release. This work does not merge itself into main.
2. The isolated `2026-09-10.mcp-exposure.v23` is a **complete deck-only candidate allowlist**, not an overlay or a valid replacement for an operator's multipurpose connection. Normal `createOpsMcpServer`/`resolveMcpExposure` reject it. Only the isolated candidate factory selects v2, after exact pin and nominal actor/token/grant/client/company/scope binding. No active resolver, discovery, OAuth function, grant or consent path was altered.
3. Candidate allows only `get_deck_design_geometry` and the five read scopes `ops.customers.read`, `ops.files.read`, `ops.jobs.read`, `ops.schedule.read`, `ops.site_visits.read`. Existing nominal policy remains v8. P19-2 reserved manifest `2026-09-10.capability-manifest.v28` and consent `2026-09-10.mcp-consent-catalog.v18` remain unused. Do not rename or silently combine sibling P18/P17-7/P19-1 candidates.
4. Before a separately approved real transition, inspect the actual operator/client/company/grant and compare its **complete tool and scope sets before/after**. Compose the approved exposure so unrelated existing tools and authority survive. Do not point that grant at this deck-only candidate, broaden authority through a union, or activate sibling capabilities. Production push/deployment, any required migration, and grant/consent transition require their applicable explicit authorization.
5. The original native MCP replay failed `INSUFFICIENT_SCOPE` for `ops.files.read`. That is still a real authority gate, not permission to synthesize a grant. After approved release and compatible authorized connection/host refresh or repin, replay the original authenticated Claude request with original business arguments. Confirm result/calculator revision, preserved stair, honest partial estimates, source custody, complete tool discovery and preserved prior capabilities. No customer-live or Claude acceptance claim until this succeeds. Host refresh alone cannot activate this dormant implementation.
