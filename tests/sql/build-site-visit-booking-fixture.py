"""Build a disposable booking fixture from captured live catalog metadata.

No business records or credentials. Public/private function bodies are actual
read-only snapshots. Unrelated FK targets and trigger families are not installed;
this fixture proves the named booking/identity/permission/calendar contracts only.
"""
import csv
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ART = ROOT / "docs/artifacts/phase19"
if '--actor' in sys.argv:
    phone = (ROOT / 'supabase/migrations/20260910191043_site_visit_durable_writes.sql').read_text()
    marker = 'create or replace function private.actor_can_edit_site_visit('
    if marker not in phone:
        marker = 'create function private.actor_can_edit_site_visit('
    start = phone.index(marker)
    print(phone[start:phone.index('$$;', start) + 3])
    sys.exit(0)
def read(name):
    return json.loads((ART / name).read_text())
print("""
create schema private; create schema auth; create schema extensions;
create extension pgcrypto with schema extensions;
create role anon; create role authenticated; create role service_role;
set check_function_bodies=off;
-- The standard request JWT accessor; fixtures supply signed-request claims locally.
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
create function auth.role() returns text language sql stable as $$ select auth.jwt()->>'role' $$;
grant usage on schema auth,public to anon,authenticated,service_role;
""")
for enum in read('live-enums.json'):
    labels = next(csv.reader([enum['labels'][1:-1]])) if isinstance(enum['labels'], str) else enum['labels']
    print(f'create type public.{enum["typname"]} as enum (' + ','.join("'" + label.replace("'", "''") + "'" for label in labels) + ');')
tables = read("live-transaction-columns.json")
skip = set() if '--workflow' in sys.argv else {"mcp_oauth_clients", "mcp_oauth_grants", "guest_booking_intents"}
for table in tables:
    if table['table_name'] in skip:
        continue
    columns = table['columns']
    defs = [f'"{c["name"]}" {c["type"]}' + (f' default {c["default"]}' if c['default'] else '') + (' not null' if c['not_null'] else '') for c in columns]
    print(f'create table {table["schema_name"]}.{table["table_name"]} (' + ',\n'.join(defs) + ');')
    if any(c['name'] == 'id' for c in columns):
        print(f'alter table {table["schema_name"]}.{table["table_name"]} add primary key(id);')
live = read("live-columns.json")
for table in sorted({r['table_name'] for r in live}):
    defs = []
    for c in [r for r in live if r['table_name'] == table]:
        typ = 'text[]' if c['data_type'] == 'ARRAY' else c['udt_name'] if c['data_type'] == 'USER-DEFINED' else c['data_type']
        defs.append(f'"{c["column_name"]}" {typ}' + (f' default {c["column_default"]}' if c['column_default'] else '') + (' not null' if c['is_nullable'] == 'NO' else ''))
    print(f'create table public.{table} (' + ',\n'.join(defs) + ');')
    print(f'alter table public.{table} add primary key(id);')
print("""
create unique index fixture_calendar_pending on public.google_calendar_sync_queue(site_visit_id,operation) where status='pending';
create unique index fixture_completion_activity on public.activities(site_visit_id) where type='site_visit' and site_visit_id is not null;
""")
for name in ['live-permission-helpers.json','live-authority-helpers.json','live-completion-helpers.json','live-booking-helpers.json','live-helpers.json']:
    for f in read(name):
        print(f['definition'] + ';')
for f in read('live-contract.json')['functions']:
    print(f['definition'] + ';')
print('alter table public.site_visits enable row level security;')
for policy in read('live-contract.json')['policies']:
    if policy['tablename'] != 'site_visits':
        continue
    print(f'create policy "{policy["policyname"]}" on public.site_visits as {policy["permissive"]} for {policy["cmd"]} to ' + ','.join(policy['roles']) +
          (f' using({policy["qual"]})' if policy['qual'] else '') + (f' with check({policy["with_check"]})' if policy['with_check'] else '') + ';')
for grant in read('live-contract.json')['grants']:
    if grant['table_name'] == 'site_visits' and grant['grantee'] in ['anon','authenticated','service_role']:
        print(f'grant {grant["privilege_type"]} on public.site_visits to {grant["grantee"]};')
capacity = read('live-capacity-contract.json')
print('create table private.agent_schedule_capacity_fences (' + ',\n'.join(f'{c["name"]} {c["type"]}' + (' not null' if c['not_null'] else '') for c in capacity['columns']) + ');')
for f in capacity['functions'] + read('live-capacity-helpers.json'):
    print(f['definition'] + ';')
print('create trigger site_visits_guard_agent_approved_capacity before insert or update on public.site_visits for each row execute function private.guard_agent_approved_schedule_capacity();')
print("""
create trigger fixture_calendar after insert or update on public.site_visits for each row execute function public.enqueue_google_calendar_sync();
create trigger fixture_monotonic before update on public.site_visits for each row execute function private.enforce_site_visit_status_monotonicity();
""")
if '--workflow' in sys.argv:
    print((ROOT/'tests/sql/site-visit-workflow-discard.sql').read_text().splitlines()[0])
    phone = (ROOT/'tests/sql/site-visit-workflow-phone-auth.sql').read_text()
    start = phone.index('create table public.deck_designs(')
    print(phone[start:phone.index(';',start)+1])
    actions = read('live-actions-contract.json')
    print('create table public.agent_actions (' + ',\n'.join(f'{c["name"]} {c["type"]}' + (f' default {c["default"]}' if c['default'] else '') + (' not null' if c['not_null'] else '') for c in actions['columns']) + ');')
    print('alter table public.agent_actions add primary key(id);')
    # Use real common deadline/labels functions from the already-deployed catalog
    # migration. No fake approval or authorization implementation is substituted.
    catalog = (ROOT/'supabase/migrations/20260908221635_agent_catalog_authoring.sql').read_text()
    for name in ['agent_catalog_deadline','agent_catalog_labels']:
        start = catalog.index('create function private.'+name+'(')
        print(catalog[start:catalog.index('$$;',start)+3])
else:
    print("""
create table private.site_visit_concurrency_companies(company_id text primary key);
create function private.site_visit_concurrency_enabled(company text) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from private.site_visit_concurrency_companies c where c.company_id=company) $$;
""")
