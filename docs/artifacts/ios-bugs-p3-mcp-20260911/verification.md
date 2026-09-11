# MCP display title verification — 2026-09-11

Report: `d1ed9ed1-35bb-42f9-91d3-7457d9a3d21b`. Source baseline: `cabebb8caf9e8c19b5e2ee8f315391dd89af5ff7`.

The server used the machine tool ID as its display title. It now publishes concise English action labels in both `title` and `annotations.title`, using `src/i18n/dictionaries/en/mcp-tools.json`. Invocation IDs, full descriptions, nested argument schemas, safety values and handlers are unchanged. No business calls, grants, activation, deployment or host rendering were exercised.

## Evidence

- Original18 discovery cases failed because raw identifiers were used as titles.
- Seventeen non-display metadata SHA256 snapshots were generated using the exact baseline server source from `git show cabebb8c:src/lib/agent-control-plane/mcp/server-factory.ts` in a temporary module. Only the two display title fields were omitted. The baseline again failed all18 readable-title assertions; the temporary module was then removed.
- Current server passes all17 original metadata hashes and all18 title assertions. This includes exact tool order, descriptions, all nested schema bytes and safety values; the tests assert zero business/audit/rate calls during listing.
- Final focused suite: **110/110 passed, zero skipped** across display metadata18, grant-pinned exposure19, transport45, catalog candidate17 and deck geometry11. Vitest2.1.9, one worker,9.50seconds.
- Expanded focused TypeScript check passed after correcting one existing catalog test fixture's missing required `clientName`. No production contract was weakened.
- Independent review found no production issue. Its initial request for exact metadata-preservation proof was addressed by the baseline snapshots.

Run from this worktree with the configured Node runtime:

```sh
node node_modules/vitest/vitest.mjs run src/lib/agent-control-plane/mcp/__tests__/tool-display-metadata.test.ts src/lib/agent-control-plane/mcp/__tests__/grant-pinned-exposure.test.ts src/lib/agent-control-plane/mcp/__tests__/transport.test.ts src/lib/agent-control-plane/mcp/__tests__/catalog-candidate-protocol.test.ts src/lib/agent-control-plane/mcp/__tests__/deck-geometry-candidate-protocol.test.ts --maxWorkers=1 --minWorkers=1
node --max-old-space-size=4096 node_modules/typescript/bin/tsc -p docs/artifacts/ios-bugs-p3-mcp-20260911/tsconfig.json
```

Protocol titles are display hints. A client can choose its own rendering or retain cached discovery. Actual Claude display acceptance requires the authorized deployed version and a refreshed tool listing; it is not established by these local tests. No push or deployment was authorized.
