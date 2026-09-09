#!/bin/sh
set -eu
PG=/opt/homebrew/opt/postgresql@17/bin/psql
SOCKET=/private/tmp/ops-catalog-p17-final-pg/socket
PORT=55479
# This task owns only catalog_p17. Never drop another local database.
$PG -h "$SOCKET" -p "$PORT" -d postgres -v ON_ERROR_STOP=1 -c 'drop database if exists catalog_p17' -c 'create database catalog_p17'
$PG -h "$SOCKET" -p "$PORT" -d catalog_p17 -v ON_ERROR_STOP=1 -f tests/sql/catalog-authoring-setup.sql > docs/artifacts/phase17/sql-setup.log 2>&1
$PG -h "$SOCKET" -p "$PORT" -d catalog_p17 -v ON_ERROR_STOP=1 -f tests/sql/catalog-authoring-runtime.sql > docs/artifacts/phase17/sql-runtime.log 2>&1
python3 tests/sql/catalog-authoring-concurrency.py > docs/artifacts/phase17/sql-concurrency.log 2>&1
python3 - <<'PY_LOGS'
from pathlib import Path
for name in ['sql-runtime.log', 'sql-concurrency.log', 'sql-setup.log']:
    p=Path('docs/artifacts/phase17',name)
    s=p.read_text()
    p.write_text('\n'.join(line.rstrip() for line in s.splitlines()).rstrip()+('\n' if s else ''))
PY_LOGS
