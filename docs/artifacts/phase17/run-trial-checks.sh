#!/bin/sh
set -eu
NODE=/Users/jacksonsweet/.nvm/versions/node/v22.22.3/bin/node
$NODE node_modules/vitest/vitest.mjs run \
  src/lib/agent-control-plane/contracts/__tests__/catalog-authoring.test.ts \
  src/lib/agent-control-plane/services/catalog-authoring/__tests__/catalog-domain.test.ts \
  src/lib/agent-control-plane/mcp/__tests__/catalog-candidate-protocol.test.ts \
  src/lib/agent-control-plane/mcp/__tests__/runtime.test.ts \
  src/lib/api/services/__tests__/catalog-approval.test.ts \
  src/components/agent/__tests__/catalog-changes-preview.test.tsx \
  src/lib/agent-control-plane/mcp/__tests__/durable-rate-limit.test.ts \
  src/lib/agent-control-plane/registry/__tests__/manifest.test.ts \
  src/lib/agent-control-plane/registry/__tests__/mcp-exposure-catalog.test.ts \
  src/lib/agent-control-plane/mcp/__tests__/bearer.test.ts \
  src/lib/agent-control-plane/mcp/oauth/__tests__ \
  --maxWorkers=2 --minWorkers=1 --testTimeout=30000 > docs/artifacts/phase17/trial-tests.log 2>&1
$NODE node_modules/typescript/bin/tsc --noEmit --pretty false -p docs/artifacts/phase17/tsconfig.json > docs/artifacts/phase17/trial-types.log 2>&1
