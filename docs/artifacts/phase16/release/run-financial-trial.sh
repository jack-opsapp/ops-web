#!/bin/bash
set -euo pipefail
root=$(cd "$(dirname "$0")/../../../.." && pwd)
bin=${OPS_PG17_BIN:-/opt/homebrew/opt/postgresql@17/bin}
node=${OPS_NODE:-/Users/jacksonsweet/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node}
socket=/private/tmp/ops-editorial-pg/socket
port=55439
database=ops_p16_$(date +%s)_$$
[[ "$database" =~ ^ops_p16_[0-9]+_[0-9]+$ ]] || exit 1
logs="$root/docs/artifacts/phase16/release/${OPS_P16_PROOF_RUN:-final}"
mkdir -p "$logs"
"$bin/createdb" -h "$socket" -p "$port" "$database"
printf 'Disposable local database: %s\n' "$database" > "$logs/financial-trial-sql.log"
cleanup() {
 "$bin/dropdb" -h "$socket" -p "$port" "$database"
 printf 'Dropped disposable local database: %s\n' "$database" >> "$logs/financial-trial-sql.log"
}
trap cleanup EXIT
for input in tests/sql/financial-document-setup.sql supabase/migrations/20260908024426_financial_policy_readiness.sql tests/sql/financial-trial-oauth-setup.sql tests/sql/financial-trial-read-functions.sql tests/sql/financial-trial-company-setup.sql tests/sql/financial-trial-company-helpers.sql supabase/migrations/20260908033425_financial_trial_oauth.sql tests/sql/financial-trial-seed.sql; do
 "$bin/psql" -X -h "$socket" -p "$port" -d "$database" -v ON_ERROR_STOP=1 -f "$root/$input" >> "$logs/financial-trial-sql.log" 2>&1
done
cd "$root"
OPS_P16_PROTOCOL_DATABASE="$database" "$node" node_modules/vitest/vitest.mjs run src/lib/agent-control-plane/mcp/__tests__/financial-trial-protocol.test.ts > "$logs/financial-trial-protocol.log" 2>&1
cat "$logs/financial-trial-protocol.log"
