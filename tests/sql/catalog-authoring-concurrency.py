"""Disposable catalog_p17 only: prove writer fencing and bounded lock release."""
import json
import os
import subprocess
import time

PSQL = ["/opt/homebrew/opt/postgresql@17/bin/psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-h", "/private/tmp/ops-catalog-p17-final-pg/socket", "-p", "55479", "-d", "catalog_p17"]
COMPANY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"


def run(sql, ok=True):
    r = subprocess.run(PSQL, input=sql, text=True, capture_output=True, timeout=10)
    if ok and r.returncode:
        raise AssertionError(r.stderr)
    return r


def check(ok, label):
    assert ok, label
    print("PASS " + label, flush=True)


def start(sql, name):
    p = subprocess.Popen(PSQL, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env={**os.environ, "PGAPPNAME": name})
    p.stdin.write(sql + "\n")
    p.stdin.flush()
    return p


def wait_lock(name, mode, granted=True, relation="products"):
    until = time.monotonic() + 3
    while time.monotonic() < until:
        r = run(f"select exists(select 1 from pg_locks l join pg_stat_activity a on a.pid=l.pid where a.application_name='{name}' and l.relation='public.{relation}'::regclass and l.mode='{mode}' and l.granted={'true' if granted else 'false'});")
        if r.stdout.strip() == "t":
            return
        time.sleep(.025)
    raise AssertionError("expected concurrent lock state: " + name)


# An ordinary catalog writer wins first; candidate returns NOWAIT rather than queues.
writer = start(f"begin; update public.products set default_price=default_price where company_id='{OTHER}';", "p17-ordinary-first")
try:
    wait_lock("p17-ordinary-first", "RowExclusiveLock")
    began = time.monotonic()
    result = run("set request.jwt.claim.role='service_role'; select catalog_test.prepare(catalog_test.one('catalog-busy-001','product','{\"price\":\"33.00\"}',(select id from public.products where name='Installation')));", ok=False)
    check(result.returncode != 0 and "55P03" in result.stderr and time.monotonic()-began < 1, "existing other-company writer makes catalog preparation fail promptly with retryable 55P03")
    check(run("select not exists(select 1 from private.agent_catalog_proposals where request->>'idempotency_key'='catalog-busy-001');").stdout.strip() == "t", "busy preparation persists no proposal")
finally:
    writer.stdin.write("rollback;\n\\q\n"); writer.stdin.flush(); writer.communicate(timeout=3)

# Authority phantoms remain fenced with the same NOWAIT semantics.
writer = start("begin; lock table public.roles in row exclusive mode;", "p17-role-first")
try:
    wait_lock("p17-role-first", "RowExclusiveLock", relation="roles")
    result = run("set request.jwt.claim.role='service_role'; select catalog_test.prepare(catalog_test.one('catalog-rolebusy-001','product','{\"price\":\"33.00\"}',(select id from public.products where name='Installation')));", ok=False)
    check(result.returncode != 0 and "55P03" in result.stderr, "concurrent authority writer cannot slip through permission snapshot fence")
finally:
    writer.stdin.write("rollback;\n\\q\n"); writer.stdin.flush(); writer.communicate(timeout=3)

# A late, deliberately stalled catalog trigger tests the transaction deadline itself.
run("""create function catalog_test.delay_catalog() returns trigger language plpgsql as $$begin if current_setting('catalog_test.delay',true)='on' then perform pg_sleep(5);end if;return new;end$$;
create trigger catalog_test_delay before update on public.products for each row execute function catalog_test.delay_catalog();
update private.agent_catalog_effect_policy set effect_sha256=private.agent_catalog_effect_revision();""")
prepared = run("set request.jwt.claim.role='service_role'; select catalog_test.prepare(catalog_test.one('catalog-deadline-001','product','{\"price\":\"34.00\"}',(select id from public.products where name='Installation')));").stdout.strip()
p = json.loads(prepared)
prior_price = run("select default_price from public.products where name='Installation';").stdout.strip()
# Binding is JSON from this same synthetic database, never caller-selected production SQL.
quoted = prepared.replace("'", "''")
began = time.monotonic()
candidate = start(f"set request.jwt.claim.role='service_role'; set catalog_test.delay='on'; select catalog_test.commit('{quoted}'::jsonb);", "p17-stalled-catalog")
try:
    wait_lock("p17-stalled-catalog", "ShareRowExclusiveLock")
    waiter = start(f"update public.products set default_price=default_price where company_id='{OTHER}';", "p17-other-company-waiter")
    try:
        wait_lock("p17-other-company-waiter", "RowExclusiveLock", granted=False)
        candidate.stdin.close(); candidate.stdin = None
        _, err = candidate.communicate(timeout=4)
        elapsed = time.monotonic()-began
        check(candidate.returncode != 0 and "25P04" in err and elapsed < 3.5, f"stalled catalog transaction terminated by 2s deadline ({elapsed:.3f}s measured)")
        waiter.stdin.close(); waiter.stdin = None
        _, err = waiter.communicate(timeout=3)
        check(waiter.returncode == 0, "waiting other-company writer proceeds after deadline releases all catalog locks: " + err)
    finally:
        if waiter.poll() is None:
            waiter.terminate(); waiter.communicate(timeout=3)
finally:
    if candidate.poll() is None:
        candidate.terminate(); candidate.communicate(timeout=3)
check(run("select default_price from public.products where name='Installation';").stdout.strip() == prior_price, "deadline rolls back catalog price change")
check(run(f"select status='pending' and execution_result is null from public.agent_actions where id='{p['action_id']}';").stdout.strip() == "t", "deadline leaves exact approval pending without false receipt")
receipt = json.loads(run(f"set request.jwt.claim.role='service_role'; select catalog_test.commit('{quoted}'::jsonb);").stdout.strip())
check(receipt["ok"], "same exact approval retries successfully after deadline rollback")
replayed = json.loads(run(f"set request.jwt.claim.role='service_role'; select catalog_test.commit('{quoted}'::jsonb);").stdout.strip())
check(replayed == {**receipt, "replayed": True}, "same-key replay returns one immutable receipt")
check(run(f"select count(*)=1 from private.agent_catalog_proposals where id='{p['change_set_id']}' and receipt is not null;").stdout.strip() == "t" and run("select default_price=34 from public.products where name='Installation';").stdout.strip() == "t", "retry and replay leave one durable receipt and the exact approved price")

# A caller's tighter deadline remains tighter; repeated helpers never extend it.
result = run("begin; set local transaction_timeout='100ms'; select private.agent_catalog_deadline(); select pg_sleep(.25);", ok=False)
check(result.returncode != 0 and "25P04" in result.stderr, "existing shorter transaction deadline is preserved")
result = run("begin; set local transaction_timeout='10s'; select private.agent_catalog_deadline(); select pg_sleep(1); select private.agent_catalog_deadline(); select pg_sleep(1.5);", ok=False)
check(result.returncode != 0 and "25P04" in result.stderr, "long deadline is shortened and repeated checks do not restart the timer")
began = time.monotonic()
result = run("begin; set local transaction_timeout='3s'; select pg_sleep(2.5); select private.agent_catalog_deadline(); select pg_sleep(1);", ok=False)
elapsed = time.monotonic()-began
check(result.returncode != 0 and "25P04" in result.stderr and elapsed < 3.4, f"elapsed time on an older transaction is preserved when shortening its deadline ({elapsed:.3f}s)")
run("drop trigger catalog_test_delay on public.products; drop function catalog_test.delay_catalog(); update private.agent_catalog_effect_policy set effect_sha256=private.agent_catalog_effect_revision();")
# A short statement timer armed before the query remains unchanged by the RPC.
# Do not use a function SET statement_timeout: PostgREST hoisting can widen role settings.
r = subprocess.run(PSQL + ["-c", "set statement_timeout='100ms'", "-c", "do $$begin perform private.agent_catalog_deadline(); perform pg_sleep(.25); end$$;"], capture_output=True, text=True, timeout=3)
check(r.returncode != 0 and "57014" in r.stderr, "already-armed 100ms statement timeout remains enforced through the function boundary")
check(run("select bool_and(not exists(select 1 from unnest(p.proconfig) c where c like 'statement_timeout=%')) from pg_proc p where pronamespace='public'::regnamespace and proname in ('inspect_catalog_changes_as_system','prepare_catalog_changes_as_system','commit_catalog_changes_as_actor','reject_catalog_changes_as_actor');").stdout.strip() == "t", "catalog RPCs do not hoist a statement timeout that could widen existing role limits")
