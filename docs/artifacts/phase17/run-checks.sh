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
  --testTimeout=30000 > docs/artifacts/phase17/focused-tests.log 2>&1
$NODE node_modules/typescript/bin/tsc --noEmit --pretty false -p docs/artifacts/phase17/tsconfig.json > docs/artifacts/phase17/typecheck-focused.log 2>&1
python3 - <<'PY_LOGS'
from pathlib import Path
for name in ['focused-tests.log', 'typecheck-focused.log']:
    p=Path('docs/artifacts/phase17',name)
    s=p.read_text()
    p.write_text('\n'.join(line.rstrip() for line in s.splitlines()).rstrip()+('\n' if s else ''))
PY_LOGS
