"""Observe real identity changes during expense authority row-lock waits.

Run ONLY on a disposable fixture with the captured identity/permission helpers,
P4/P5/P7 migrations and correction fixture installed. This does not start a DB.
The original helper must pass --expect vulnerable; repaired code must pass
--expect repaired. No identity/permission helper is stubbed or replaced.
"""
import argparse
import json
import os
import pathlib
import subprocess
import time
import uuid


def literal(value):
    return "'" + str(value).replace("'", "''") + "'"


parser = argparse.ArgumentParser()
parser.add_argument("--psql", required=True)
parser.add_argument("--socket", required=True)
parser.add_argument("--port", type=int, required=True)
parser.add_argument("--database", required=True)
parser.add_argument("--user", default="postgres")
parser.add_argument("--expect", choices=("vulnerable", "repaired"), required=True)
args = parser.parse_args()
socket = pathlib.Path(args.socket).resolve()
if not socket.is_relative_to(pathlib.Path("/private/tmp")) or args.port == 5432 or not 1 <= args.port <= 65535:
    parser.error("Require a disposable /private/tmp socket and nondefault port")
if os.environ.get("OPS_EXPENSE_IDENTITY_FIXTURE") != "1":
    parser.error("Set OPS_EXPENSE_IDENTITY_FIXTURE=1 only for a disposable synthetic fixture")
env = {key: os.environ[key] for key in ("PATH", "LANG", "LC_ALL") if key in os.environ}
base = [args.psql, "-h", str(socket), "-p", str(args.port), "-U", args.user,
        "-d", args.database, "-X", "-Atq", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"]


def run(sql):
    result = subprocess.run(base, input=sql, text=True, capture_output=True, env=env, timeout=10)
    assert result.returncode == 0, (result.stdout, result.stderr)
    return result.stdout.strip()


def open_session(name):
    return subprocess.Popen(base, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, text=True, env={**env, "PGAPPNAME": name})


def observe(predicate, label):
    deadline = time.monotonic() + 4
    while time.monotonic() < deadline:
        if run("select (" + predicate + ")::text") == "true":
            return
        time.sleep(0.01)
    raise AssertionError("Did not observe " + label)


required = ["private.lock_expense_approver_context()", "public.approve_expense_batch(uuid)",
            "public.request_expense_accounting_sync(uuid,uuid)", "public.correct_expense_for_review(jsonb)"]
for signature in required:
    assert run("select to_regprocedure(" + literal(signature) + ") is not null") == "t", signature
# The exact production identity resolver must remain mutable and JWT-backed.
assert run("select md5(pg_get_functiondef('private.get_current_user_id()'::regprocedure))") == "127ffd06387933500d95f96aba24b605"
assert run("select md5(pg_get_functiondef('private.get_user_company_id()'::regprocedure))") == "3de642ffe4b81ee8827c1cc6507f85c4"
# Only the private helper's wait budget changes, to make observing a real
# blocker deterministic. Caller and helper bodies, identities and grants stay
# intact. Capture/restore the existing configuration even on a failed test.
old_config = json.loads(run("select coalesce(to_jsonb(proconfig),'[]'::jsonb) from pg_proc where oid='private.lock_expense_approver_context()'::regprocedure"))
old_lock_timeout = next((entry.split("=", 1)[1] for entry in old_config if entry.startswith("lock_timeout=")), None)


def fixture(binding):
    ids = {key: str(uuid.uuid4()) for key in ("company", "actor", "alternate", "submitter", "batch", "expense", "request")}
    ids["subject"] = "expense-identity-" + ids["actor"]
    ids["jwt"] = json.dumps({"sub": ids["subject"], "role": "authenticated"})
    run(f"""
      insert into public.companies(id) values ('{ids['company']}');
      insert into public.users(id,company_id,{binding},is_active,is_company_admin) values
        ('{ids['actor']}','{ids['company']}',{literal(ids['subject'])},true,true),
        ('{ids['alternate']}','{ids['company']}',null,true,true),
        ('{ids['submitter']}','{ids['company']}',null,true,false);
      insert into public.expense_batches(id,company_id,submitted_by,status,amendment_number,period_start,period_end)
        values ('{ids['batch']}','{ids['company']}','{ids['submitter']}','open',0,current_date,current_date);
      insert into public.expenses(id,company_id,submitted_by,batch_id,status,merchant_name,amount,tax_amount,currency,expense_date,payment_method)
        values ('{ids['expense']}','{ids['company']}','{ids['submitter']}','{ids['batch']}','submitted','Original merchant',100,0,'CAD',current_date,'personal_card');
    """)
    ids["command"] = run(f"""select private.expense_correction_content(e)||jsonb_build_object(
      'request_id','{ids['request']}','expense_id',e.id,'company_id',e.company_id,
      'actor_id','{ids['actor']}','submitted_by',e.submitted_by,'expected_status',e.status,
      'expected_updated_at',e.updated_at,'correction_note','','merchant_name','Corrected merchant','allocations','[]'::jsonb)
      from public.expenses e where e.id='{ids['expense']}'""")
    return ids


def snapshot(ids):
    company = literal(ids["company"])
    return run(f"""select jsonb_build_array(
      (select jsonb_agg(to_jsonb(e) order by id) from public.expenses e where company_id={company}),
      (select jsonb_agg(to_jsonb(b) order by id) from public.expense_batches b where company_id={company}),
      (select jsonb_agg(to_jsonb(n) order by id) from public.notifications n where company_id={company}),
      (select jsonb_agg(to_jsonb(r) order by request_id) from private.expense_correction_requests r where company_id={company}),
      (select jsonb_agg(to_jsonb(e) order by sequence) from public.expense_accounting_events e where company_id={company}),
      (select jsonb_agg(to_jsonb(q) order by id) from public.accounting_sync_queue q where company_id={company}),
      (select jsonb_agg(to_jsonb(r) order by domain) from private.agent_read_domain_revisions r where company_id={company})
    )::text""")


def race(label, binding="auth_id", lane="helper", change="transfer", lock="actor"):
    ids = fixture(binding)
    auth = "select set_config('request.jwt.claims'," + literal(ids["jwt"]) + ",true);"
    correction = "select public.correct_expense_for_review(" + literal(ids["command"]) + "::jsonb);"
    if lane == "replay":
        result = run("begin;" + auth + correction + "commit;").splitlines()[-1]
        assert json.loads(result)["replayed"] is False
    before = snapshot(ids)
    operation = {
        "helper": "select row_to_json(c) from private.lock_expense_approver_context() c;",
        "approve": "select public.approve_expense_batch(" + literal(ids["batch"]) + ");",
        "request": "select public.request_expense_accounting_sync(" + literal(ids["expense"]) + "," + literal(ids["company"]) + ");",
        "correction": correction, "replay": correction,
    }[lane]
    token = uuid.uuid4().hex
    holder_name, waiter_name = "expense_identity_holder_" + token, "expense_identity_waiter_" + token
    holder, waiter = open_session(holder_name), None
    try:
        table, key = ("public.users", "actor") if lock == "actor" else ("public.companies", "company")
        holder.stdin.write("begin; select id from " + table + " where id=" + literal(ids[key]) + " for update;\n")
        holder.stdin.flush()
        observe("exists(select 1 from pg_stat_activity where application_name=" + literal(holder_name) + " and state='idle in transaction')", "holder row lock")
        waiter = open_session(waiter_name)
        waiter.stdin.write("begin; set local statement_timeout='8s';" + auth + operation + "commit;\n")
        waiter.stdin.close()
        waiter.stdin = None
        observe("exists(select 1 from pg_stat_activity w join pg_stat_activity h on h.pid=any(pg_blocking_pids(w.pid)) where w.application_name=" + literal(waiter_name) + " and h.application_name=" + literal(holder_name) + ")", "exact authority blocker")
        if change == "transfer":
            mutation = f"update public.users set {binding}=null where id='{ids['actor']}'; update public.users set {binding}={literal(ids['subject'])} where id='{ids['alternate']}';"
        elif change == "detach":
            mutation = f"update public.users set {binding}=null where id='{ids['actor']}';"
        elif change == "company_deleted":
            mutation = f"update public.companies set deleted_at=clock_timestamp() where id='{ids['company']}';"
        else:
            mutation = ""
        holder.stdin.write(mutation + "commit;\n")
        holder.stdin.close()
        holder.stdin = None
        holder_out, holder_err = holder.communicate(timeout=8)
        assert holder.returncode == 0, (holder_out, holder_err)
        out, err = waiter.communicate(timeout=8)
        # Existing trigger checks already reject a new P7 correction; exact
        # replay is the route without that final write-trigger safeguard.
        denies = change == "company_deleted" or lane == "correction" or (change != "unchanged" and args.expect == "repaired")
        if denies:
            assert waiter.returncode != 0 and "42501" in err, (label, out, err)
            assert snapshot(ids) == before, label + " changed financial/correction state on denial"
        else:
            assert waiter.returncode == 0, (label, out, err)
            if lane == "helper":
                assert json.loads(out.splitlines()[-1])["actor_id"] == ids["actor"]
            if lane == "replay":
                receipt = json.loads(out.splitlines()[-1])
                assert receipt["replayed"] is True and receipt["actor_id"] == ids["actor"]
                assert snapshot(ids) == before
        print("PASS", args.expect, label, "denied with no effects" if denies else "returned")
    finally:
        for process in (holder, waiter):
            if process is not None and process.poll() is None:
                process.terminate()
                process.communicate(timeout=8)


try:
    run("alter function private.lock_expense_approver_context() set lock_timeout='5s'")
    race("auth_id withdrawal during actor wait", change="detach")
    race("firebase_uid withdrawal during actor wait", binding="firebase_uid", change="detach")
    race("auth_id reassignment during actor wait")
    race("company removal during company wait", lock="company", change="company_deleted")
    race("unchanged company after company wait", lock="company", change="unchanged")
    race("approval cannot stamp the previous login owner", lane="approve")
    race("accounting request reauthorizes login ownership", lane="request")
    race("new correction retains existing trigger defense", lane="correction")
    race("exact correction replay reauthorizes login ownership", lane="replay", binding="firebase_uid")
    print("9 real identity-lock checks passed:", args.expect)
finally:
    run("alter function private.lock_expense_approver_context() reset lock_timeout;" + (
        "alter function private.lock_expense_approver_context() set lock_timeout to " + literal(old_lock_timeout) + ";"
        if old_lock_timeout is not None else ""))
