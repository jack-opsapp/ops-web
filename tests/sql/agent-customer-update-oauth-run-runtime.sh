#!/bin/bash
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
activation=${1:?Pass the exact customer-update OAuth activation migration path}
bin=${OPS_PG17_BIN:-/opt/homebrew/opt/postgresql@17/bin}
cluster=$(mktemp -d /private/tmp/ops-customer-update-oauth-pg17.XXXXXX)
logs="$root/docs/artifacts/phase12"
mkdir -p "$logs"
cleanup() {
  "$bin/pg_ctl" -D "$cluster/data" -m fast stop > "$logs/oauth-runtime-stop.log" 2>&1 || true
  rm -rf "$cluster"
}
trap cleanup EXIT
"$bin/initdb" -D "$cluster/data" -A trust --no-locale -E UTF8 > "$logs/oauth-runtime-init.log" 2>&1
"$bin/pg_ctl" -D "$cluster/data" -l "$logs/oauth-runtime-server.log" -o "-p 55480 -k $cluster -h ''" start > "$logs/oauth-runtime-start.log" 2>&1
psql=("$bin/psql" -X -h "$cluster" -p 55480 -d postgres -v ON_ERROR_STOP=1)
"${psql[@]}" -f "$root/tests/sql/agent-customer-update-oauth-setup.sql" > "$logs/oauth-runtime-setup.log" 2>&1
"${psql[@]}" -f "$activation" > "$logs/oauth-runtime-activation.log" 2>&1
"${psql[@]}" -f "$root/tests/sql/agent-customer-update-oauth-runtime.sql" > "$logs/oauth-runtime-tests.log" 2>&1
# A second database composes the same activation with the existing real
# customer-update transaction fixture, including current authority and assignment.
"${psql[@]}" -c 'create database subset_authority' > "$logs/oauth-subset-create.log" 2>&1
subset_psql=("$bin/psql" -X -h "$cluster" -p 55480 -d subset_authority -v ON_ERROR_STOP=1)
"${subset_psql[@]}" -f "$root/tests/sql/agent-customer-update-setup.sql" > "$logs/oauth-subset-setup.log" 2>&1
"${subset_psql[@]}" -f "$activation" > "$logs/oauth-subset-activation.log" 2>&1
"${subset_psql[@]}" -f "$root/tests/sql/agent-customer-update-oauth-subset-authority.sql" > "$logs/oauth-subset-tests.log" 2>&1
python3 - "$root" "$activation" <<'PY'
import hashlib,json,pathlib,sys
root=pathlib.Path(sys.argv[1]); activation=pathlib.Path(sys.argv[2]).resolve()
paths=[activation]+sorted((root/'tests/sql').glob('agent-customer-update-oauth-*'))
result={'postgres':'17','oauth_checks_passed':(root/'docs/artifacts/phase12/oauth-runtime-tests.log').read_text().count('PASS:'),'authority_checks_passed':(root/'docs/artifacts/phase12/oauth-subset-tests.log').read_text().count('PASS:'),'sha256':{(str(p.relative_to(root)) if root in p.parents else str(p)):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths},'limits':'Actual live OAuth functions, constraints and immutable/canary triggers, then exact activation migration. Minimal local identity tables; no HTTP host interaction, no production consent, tokens, grants or business mutations.'}
(root/'docs/artifacts/phase12/oauth-runtime-result.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
PY
