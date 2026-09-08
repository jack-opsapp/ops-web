"""Real independent PostgreSQL sessions; test-only advisory barriers control order."""
import json
import pathlib
import select
import subprocess
import sys
import time

binary, socket, root = sys.argv[1:]
logs = pathlib.Path(root) / "docs/artifacts/phase14"
command = [binary, "-X", "-Atq", "-h", socket, "-p", "55484", "-d", "postgres", "-v", "ON_ERROR_STOP=1"]
claims = "set timezone='UTC';set request.jwt.claim.role='service_role';set request.jwt.claims='{\"sub\":\"schedule-fixture-auth\",\"company_id\":\"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\"}';"

def run(sql):
    return subprocess.run(command + ["-c", claims + sql], text=True, capture_output=True, check=True).stdout.strip()

run("""create table runtime.concurrent_cases(label text primary key,proposal jsonb not null,visit_id uuid not null,result jsonb);
create function runtime.new_case(label text) returns void language plpgsql as $$
declare req jsonb;visit uuid;p jsonb;
begin
 req:=runtime.next_request('concurrent-'||label);
 visit:=runtime.insert_visit(((req#>>'{tasks,0,destination_date}')::date+1)::timestamp at time zone 'UTC'+interval '9 hours',(select team_member_ids from public.project_tasks where id='40000000-0000-4000-8000-000000000001'));
 p:=runtime.prepare(req);
 insert into runtime.concurrent_cases values(label,p,visit,null);
end $$;""")
processes = []
proof = []

def worker(name, sql):
    output = open(logs / (name + ".log"), "w")
    process = subprocess.Popen(command + ["-c", claims + "set application_name='" + name + "';" + sql], stdout=output, stderr=subprocess.STDOUT, text=True)
    processes.append((process, output))
    return process

def wait_for(sql, label):
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        if run(sql) == "t":
            return
        time.sleep(0.03)
    raise AssertionError("Barrier not observed: " + label)

def barrier():
    process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
    process.stdin.write("select 'READY' from pg_advisory_lock(140014);\n")
    process.stdin.flush()
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        if select.select([process.stdout], [], [], 0.1)[0] and process.stdout.readline().strip() == "READY":
            return process
    process.terminate()
    raise AssertionError("Controller barrier failed")

def release(process):
    process.stdin.write("select pg_advisory_unlock(140014);\n\\q\n")
    process.stdin.flush()
    process.wait(timeout=8)

def complete(process):
    if process.wait(timeout=8) != 0:
        raise AssertionError("Concurrent worker failed; inspect phase14 worker logs")

controller = None
try:
    # Approval's complete write is held uncommitted; the actual staff booking
    # writer must wait for its table fence, then see the committed capacity row.
    run("select runtime.new_case('approval-first');")
    controller = barrier()
    approval = worker("p14_approval_first", "begin;update runtime.concurrent_cases set result=runtime.commit(proposal) where label='approval-first';select pg_advisory_xact_lock(140014);commit;")
    wait_for("select exists(select 1 from pg_stat_activity where application_name='p14_approval_first' and wait_event='advisory');", "approval reached post-write barrier")
    booking = worker("p14_booking_second", "select runtime.rejects((select format('select public.reschedule_site_visit(%L::uuid,%L::timestamptz)',visit_id,(proposal#>>'{proposal,tasks,0,after,start_date}')::timestamptz+interval '9 hours') from runtime.concurrent_cases where label='approval-first'),'CAPACITY_CONFLICT','waiting staff booking sees committed approved capacity');")
    wait_for("select exists(select 1 from pg_stat_activity b where b.application_name='p14_booking_second' and b.wait_event_type='Lock' and exists(select 1 from pg_stat_activity a where a.application_name='p14_approval_first' and a.pid=any(pg_blocking_pids(b.pid))));", "actual booking blocked behind approval")
    release(controller); controller = None
    complete(approval); complete(booking)
    run("select runtime.assert((select result->>'ok'='true' from runtime.concurrent_cases where label='approval-first'),'approval-first receipt persisted');")
    proof.append({"order": "approval first", "observed": "staff reschedule blocked on approval table lock, then rejected by current capacity fence"})

    # Booking's real write is held uncommitted. Approval must abort without
    # waiting in an inverted lock order; after booking commits it must detect it.
    run("select runtime.new_case('booking-first');")
    controller = barrier()
    booking = worker("p14_booking_first", "begin;select public.reschedule_site_visit(visit_id,(proposal#>>'{proposal,tasks,0,after,start_date}')::timestamptz+interval '9 hours') from runtime.concurrent_cases where label='booking-first';select pg_advisory_xact_lock(140014);commit;")
    wait_for("select exists(select 1 from pg_stat_activity where application_name='p14_booking_first' and wait_event='advisory');", "booking reached post-write barrier")
    approval = worker("p14_approval_second", "select runtime.rejects((select format('select runtime.commit(%L::jsonb)',proposal) from runtime.concurrent_cases where label='booking-first'),'BUSY','approval fails fast while booking owns capacity fence');")
    complete(approval)
    release(controller); controller = None
    complete(booking)
    run("select runtime.rejects((select format('select runtime.commit(%L::jsonb)',proposal) from runtime.concurrent_cases where label='booking-first'),'AVAILABILITY_CONFLICT','approval retry sees committed booking');")
    run("select runtime.assert((select c.committed_at is null from runtime.concurrent_cases x join private.agent_schedule_changes c on c.id=(x.proposal->>'change_set_id')::uuid where x.label='booking-first'),'booking-first leaves approval uncommitted');")
    proof.append({"order": "booking first", "observed": "approval aborted on NOWAIT fence; exact retry rejected committed booking conflict"})

    # Two approval attempts share one receipt and one set of canonical effects.
    run("delete from public.site_visits where id in(select visit_id from runtime.concurrent_cases);select runtime.new_case('duplicate');")
    controller = barrier()
    first = worker("p14_duplicate_first", "begin;update runtime.concurrent_cases set result=runtime.commit(proposal) where label='duplicate';select pg_advisory_xact_lock(140014);commit;")
    wait_for("select exists(select 1 from pg_stat_activity where application_name='p14_duplicate_first' and wait_event='advisory');", "first approval reached post-write barrier")
    second = worker("p14_duplicate_second", "select runtime.rejects((select format('select runtime.commit(%L::jsonb)',proposal) from runtime.concurrent_cases where label='duplicate'),'BUSY','simultaneous approval does not enter second write');")
    complete(second)
    release(controller); controller = None
    complete(first)
    run("select runtime.assert((select (runtime.commit(proposal)->>'replayed')::boolean and result->>'confirmation_receipt_id'=runtime.commit(proposal)->>'confirmation_receipt_id' from runtime.concurrent_cases where label='duplicate'),'duplicate retry returns the same durable receipt');")
    proof.append({"order": "duplicate approvals", "observed": "second attempt failed fast; retry returned identical confirmation receipt"})
    # A preexisting row-only lock must fail quickly, not deadlock when the
    # legacy owner later acquires its ordinary write-table lock.
    controller = barrier()
    row_owner = worker("p14_row_owner", "begin;select id from public.projects where id='20000000-0000-4000-8000-000000000001' for update;select pg_advisory_xact_lock(140014);commit;")
    wait_for("select exists(select 1 from pg_stat_activity where application_name='p14_row_owner' and wait_event='advisory');", "legacy row lock acquired")
    row_contender = worker("p14_row_contender", "select runtime.rejects('select runtime.prepare(runtime.next_request(''concurrent-row-lock''))','could not obtain lock','existing row-only writer fails fast without lock inversion');")
    complete(row_contender)
    release(controller); controller = None
    complete(row_owner)
    proof.append({"order": "row lock first", "observed": "approval rejected immediately on exact project row NOWAIT lock"})
    (logs / "concurrency-result.json").write_text(json.dumps({"passed": True, "cases": proof}, indent=2) + "\n")
    print(json.dumps(proof))
finally:
    if controller is not None:
        controller.terminate()
        controller.wait(timeout=8)
    for process, output in processes:
        if process.poll() is None:
            process.terminate()
            process.wait(timeout=8)
        output.close()
