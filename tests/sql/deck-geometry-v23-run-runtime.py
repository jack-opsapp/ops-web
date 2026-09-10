#!/usr/bin/env python3
"""Real PostgreSQL 17, disposable synthetic custody and business approval proof."""
from pathlib import Path
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]
SQL = ROOT / 'tests/sql'
BIN = Path(os.environ.get('OPS_PG17_BIN', '/opt/homebrew/opt/postgresql@17/bin'))
MIGRATION = ROOT / 'supabase/migrations/20260910225814_agent_deck_geometry_v23_exposure.sql'
LOGS = ROOT / 'docs/artifacts/deck-geometry-2026-09-10/v23-runtime'
LOGS.mkdir(parents=True, exist_ok=True)
CLUSTER = Path(tempfile.mkdtemp(prefix='ops-deck-v23-', dir='/private/tmp'))
OLD = '2026-09-04.mcp-exposure.v14'
NEW = '2026-09-10.mcp-exposure.v23'


def command(args, label, expected_error=None):
    result = subprocess.run([str(x) for x in args], text=True, capture_output=True)
    output = result.stdout + result.stderr
    (LOGS / (label + '.log')).write_text(output)
    if expected_error:
        assert result.returncode and expected_error in output, (label, output[-3000:])
    elif result.returncode:
        raise RuntimeError(label + ': ' + output[-4000:])
    return output


def query(database, text, label, expected_error=None):
    file = CLUSTER / (label + '.sql')
    file.write_text("set timezone='UTC';\n" + text)
    return command([BIN / 'psql', '-X', '-U', 'postgres', '-h', CLUSTER,
                    '-p', '55496', '-d', database, '-v', 'ON_ERROR_STOP=1',
                    '-f', file], label, expected_error)


def fixture(database):
    command([BIN / 'createdb', '-U', 'postgres', '-h', CLUSTER, '-p', '55496', database], database+'-create')
    # Reuse real business authority/assignment/commit code and captured OAuth
    # schemas, constraints, immutable triggers. No permissive authority stubs.
    query(database, f'\\i {SQL}/agent-customer-update-setup.sql\n\\i {SQL}/catalog-trial-setup.sql\n', database+'-setup')
    tables = (ROOT / 'supabase/migrations/20260909015000_catalog_trial_oauth.sql').read_text()
    tables = tables[tables.index('create table'):tables.index('create function')]
    tables += '\ncreate table private.agent_catalog_effect_policy(revision text primary key,effect_sha256 text not null);\n'
    tables += "create table private.agent_mcp_rate_limit_keys(key_id text primary key,key_material bytea not null,created_at timestamptz not null default statement_timestamp());\n"
    tables += "insert into private.agent_mcp_rate_limit_keys(key_id,key_material) values('mcp-rate-limit-hmac:2026-08-23.v1',decode(repeat('ab',32),'hex')); -- Synthetic fixture key only.\n"
    tables += "alter table private.agent_mcp_rate_limit_buckets add primary key(bucket_digest);\n"
    definitions = []
    for file in ['deck-geometry-v23-oauth-functions.json', 'deck-geometry-v23-live-functions.json']:
        definitions += json.loads((SQL / file).read_text())
    overlay = 'set check_function_bodies=off;\n' + tables
    for item in definitions:
        identity = item['schema']+'.'+item['name']+'('+', '.join(a.split(' ',1)[1] for a in item['arguments'].split(', ') if a)+')'
        overlay += item['definition'].rstrip()+';\n'
        overlay += f'alter function {identity} owner to postgres;\nrevoke all on function {identity} from public,anon,authenticated,service_role;\n'
        if 'service_role=X' in item['acl']:
            overlay += f'grant execute on function {identity} to service_role;\n'
    # Match live private relation privileges/RLS instead of earlier fixture defaults.
    for table in ['clients','grants','tokens','authorization_codes','consent_previews']:
        overlay += f'alter table private.mcp_oauth_{table} disable row level security;\n'
    overlay += 'alter table private.mcp_oauth_canary_bindings force row level security;\nset check_function_bodies=on;\n'
    query(database, overlay, database+'-live-overlay')


def customer_runtime(version):
    source = (SQL / 'agent-customer-update-runtime.sql').read_text()
    # The existing fixture predates the live registration-source constraint.
    source = source.replace("'fixture',s,", "'dynamic',s,")
    source = source.replace('return public.prepare_agent_customer_update_as_system(', 'return public.prepare_agent_customer_update_for_grant_as_system(')
    source = source.replace("'2026-09-04.capability-manifest.v20','"+OLD+"'", "'2026-09-04.capability-manifest.v20'")
    if version == 'v23':
        source = source.replace(OLD, NEW)
    return source


def oauth_runtime():
    source = (SQL / 'agent-customer-update-oauth-runtime.sql').read_text()
    source = source.replace("insert into public.companies values", "insert into public.companies(id,name,deleted_at) values")
    source = source.replace("'Local fixture A',null", "'Local fixture A',null,'fixture-a'").replace("'Local fixture B',null", "'Local fixture B',null,'fixture-b'").replace("companies(id,name,deleted_at)","companies(id,name,deleted_at,public_handle)")
    source = source.replace("insert into public.users values", "insert into public.users(id,company_id,is_active,deleted_at) values")
    source = source.replace("users(id,company_id,is_active,deleted_at)","users(id,company_id,is_active,deleted_at,first_name,last_name)").replace("true,null)","true,null,'Local','Fixture')")
    marker = "select runtime.connect('v1','legacy-v1');"
    before, after = source.split(marker, 1)
    before += "select runtime.connect('v14','pre-existing-old');\n"
    before += "select runtime.assert((select exposure_revision='"+OLD+"' from public.resolve_mcp_oauth_access_token_as_system((select access_hash from runtime.sessions where name='pre-existing-old'),'"+OLD+"')),'old grant works before migration');\n"
    before += "create table runtime.custody_before as select 'client' kind,to_jsonb(c) row from private.mcp_oauth_clients c union all select 'grant',to_jsonb(g) from private.mcp_oauth_grants g union all select 'token',to_jsonb(t) from private.mcp_oauth_tokens t;\n"
    after = marker + after
    after = after.replace("s.access_hash,'"+OLD+"'", "s.access_hash,'"+NEW+"'")
    after = after.replace("newa,'"+OLD+"'", "newa,'"+NEW+"'")
    after = after.replace("if s.exposure='"+OLD+"' then", "if s.exposure in ('"+OLD+"','"+NEW+"') then")
    extra = "insert into runtime.contracts select replace(version,'v14','v23'),'"+NEW+"',consent,scopes from runtime.contracts where version like 'v14%';\n"
    extra += "select runtime.connect('v23','active-v23');\nselect runtime.connect('v23-dcr-read','registered-readonly-v23');\nselect runtime.connect('v23-dcr-min','registered-minimum-v23');\n"
    after = "set request.jwt.claim.role='service_role';\n" + extra + after
    return before, after


def prove_binding_lock():
    # Pause the real transaction just before commit to observe its actual table
    # locks. The migration text committed to source has no sleep or test hook.
    file = CLUSTER / 'binding-lock-migration.sql'
    file.write_text(MIGRATION.read_text().replace('COMMIT;', 'select pg_sleep(2);\nCOMMIT;'))
    args = [str(BIN/'psql'), '-X', '-U', 'postgres', '-h', str(CLUSTER), '-p', '55496', '-d', 'trials', '-v', 'ON_ERROR_STOP=1']
    with (LOGS/'trials-concurrent-migration.log').open('w') as log:
        process = subprocess.Popen(args+['-f',str(file)], stdout=log, stderr=log)
        try:
            for _ in range(40):
                state = subprocess.run(args+['-Atc', "select count(*) from pg_locks where relation in ('private.agent_catalog_trial_bindings'::regclass,'private.mcp_oauth_canary_bindings'::regclass) and mode='ShareLock' and granted"], text=True, capture_output=True)
                if state.stdout.strip() == '2':
                    break
                time.sleep(.025)
            else:
                raise AssertionError('real migration never acquired both binding SHARE locks')
            for table in ['agent_catalog_trial_bindings','mcp_oauth_canary_bindings']:
                query('trials', f"set lock_timeout='100ms'; insert into private.{table} select * from private.{table};", 'trials-concurrent-'+table, 'canceling statement due to lock timeout')
            assert process.wait(timeout=10) == 0
        finally:
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=10)


TRIAL_SEED = """
set request.jwt.claim.role='service_role';
insert into public.companies(id,name,public_handle) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Local gate','local-gate');
insert into public.users(id,company_id,is_active,first_name,last_name) values('10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true,'Local','Fixture');
insert into private.mcp_oauth_clients(client_id,client_name,redirect_uris,token_endpoint_auth_method,grant_types,response_types,scope,registration_source,scope_ceiling,consent_catalog_revision,exposure_revision)
values('40000000-0000-4000-8000-000000000001','Local gate',array['https://example.invalid/callback'],'none',array['authorization_code'],array['code'],'ops.jobs.read','dynamic',array['ops.jobs.read'],'2026-09-04.mcp-consent-catalog.v9','2026-09-04.mcp-exposure.v14');
insert into private.agent_catalog_trial_bindings(oauth_client_id,actor_user_id,company_id,effect_sha256,expires_at) values('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','sha256:'||repeat('0',64),clock_timestamp()+interval '1 hour');
"""


started = False
try:
    command([BIN/'initdb', '-D', CLUSTER/'data', '-U', 'postgres', '-A', 'trust', '--no-locale', '-E', 'UTF8'], 'init')
    command([BIN/'pg_ctl', '-D', CLUSTER/'data', '-l', LOGS/'server.log', '-o', f"-p 55496 -k {CLUSTER} -h ''", 'start'], 'start')
    started = True
    fixture('baseline')
    # Function security/hash guard must reject drift before any DDL.
    query('baseline', "alter function private.mcp_oauth_scope_array_is_valid(text[]) security definer;", 'baseline-drift')
    query('baseline', MIGRATION.read_text(), 'baseline-rejected', 'DECK_V23_BASELINE_OR_ACL_MISMATCH')
    fixture('trials')
    query('trials', TRIAL_SEED, 'trials-active-catalog')
    query('trials', MIGRATION.read_text(), 'trials-catalog-rejected', 'DECK_V23_ACTIVE_TRIAL_REQUIRES_SEPARATE_ROLLOUT')
    query('trials', "update private.agent_catalog_trial_bindings set created_at=clock_timestamp()-interval '2 hours',expires_at=clock_timestamp()-interval '1 hour'; insert into private.mcp_oauth_canary_bindings(oauth_client_id,user_id,company_id,exposure_revision,consent_catalog_revision,expires_at) values('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','2026-09-07.mcp-exposure.v17','2026-09-07.mcp-consent-catalog.v12',clock_timestamp()+interval '1 hour');", 'trials-active-financial')
    query('trials', MIGRATION.read_text(), 'trials-financial-rejected', 'DECK_V23_ACTIVE_TRIAL_REQUIRES_SEPARATE_ROLLOUT')
    query('trials', "update private.mcp_oauth_canary_bindings set created_at=clock_timestamp()-interval '2 hours',expires_at=clock_timestamp()-interval '1 hour'; create schema runtime; create table runtime.bindings_before as select 'catalog' kind,to_jsonb(b) row from private.agent_catalog_trial_bindings b union all select 'financial',to_jsonb(b) from private.mcp_oauth_canary_bindings b;", 'trials-expired')
    prove_binding_lock()
    query('trials', "do $$begin if exists((select * from runtime.bindings_before except select 'catalog',to_jsonb(b) from private.agent_catalog_trial_bindings b except select 'financial',to_jsonb(b) from private.mcp_oauth_canary_bindings b)) then raise exception 'binding changed';end if;end$$;", 'trials-preserved')
    fixture('oauth')
    before, after = oauth_runtime()
    query('oauth', before, 'oauth-before')
    query('oauth', MIGRATION.read_text(), 'oauth-migration')
    query('oauth', "select runtime.assert(not exists(select * from runtime.custody_before except (select 'client',to_jsonb(c) from private.mcp_oauth_clients c union all select 'grant',to_jsonb(g) from private.mcp_oauth_grants g union all select 'token',to_jsonb(t) from private.mcp_oauth_tokens t)),'migration preserves every old client grant token row');", 'oauth-custody')
    query('oauth', MIGRATION.read_text(), 'oauth-replay')
    query('oauth', after, 'oauth-after')
    fixture('pending')
    prefix = customer_runtime('v14').split('-- Successful opportunity-only edit',1)[0]
    prefix = prefix.replace('return public.prepare_agent_customer_update_for_grant_as_system(', 'return public.prepare_agent_customer_update_as_system(').replace("'2026-09-04.capability-manifest.v20','prepare_customer_update'", "'2026-09-04.capability-manifest.v20','"+OLD+"','prepare_customer_update'")
    query('pending', prefix+"create table runtime.pending as select runtime.prepare(runtime.request('{\"title\":\"Prepared before migration\"}','old-pending')) preview; create table runtime.pending_before as select to_jsonb(p) row from private.agent_customer_updates p;", 'pending-prepared-before')
    query('pending', MIGRATION.read_text(), 'pending-migration')
    query('pending', "set request.jwt.claim.role='service_role'; select runtime.assert((select to_jsonb(p)=(select row from runtime.pending_before) from private.agent_customer_updates p),'migration preserves old pending proposal exactly'); select runtime.assert((select runtime.commit(preview)#>>'{readback,title}'='Prepared before migration' from runtime.pending),'old V14 proposal commits after V23 migration under original grant');", 'pending-committed-after')
    for version in ['v14', 'v23']:
        fixture(version)
        query(version, "update private.agent_customer_update_policy set effect_revision='sha256:'||repeat('0',64); create schema proof; create table proof.policy_before as select * from private.agent_customer_update_policy;", version+'-stale-policy-before')
        query(version, MIGRATION.read_text(), version+'-migration')
        query(version, "do $$begin if (select jsonb_agg(to_jsonb(p)) from private.agent_customer_update_policy p) is distinct from (select jsonb_agg(to_jsonb(p)) from proof.policy_before p) then raise exception 'migration changed stale policy';end if;end$$; -- Seal this disposable synthetic business baseline only, never production.\nupdate private.agent_customer_update_policy set effect_revision=private.agent_customer_update_effect_revision();", version+'-stale-policy-preserved')
        query(version, customer_runtime(version), version+'-customer')
        query(version, (SQL/'deck-geometry-v23-customer-boundaries.sql').read_text(), version+'-boundaries')
    result = {'status':'passed', 'assertions':sum(p.read_text().count('PASS:') for p in LOGS.glob('*.log') if p.name!='server.log'), 'migration_sha256':hashlib.sha256(MIGRATION.read_bytes()).hexdigest(), 'postgres':command([BIN/'postgres','--version'],'version').strip(), 'limits':'Disposable synthetic fixtures, exact captured OAuth/authority functions, real approval/commit core. No production or host canary.'}
    (LOGS/'result.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result, indent=2))
finally:
    if started:
        command([BIN/'pg_ctl', '-D', CLUSTER/'data', '-m', 'fast', 'stop'], 'stop')
    shutil.rmtree(CLUSTER)
