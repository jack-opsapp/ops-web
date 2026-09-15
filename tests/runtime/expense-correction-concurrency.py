"""Real two-session tests against the caller's fresh, socket-only fixture."""
import json
import os
import subprocess
import sys

psql, socket = sys.argv[1:3]
base = [psql, '-h', socket, '-p', '55494', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose']
env = {k:v for k,v in os.environ.items() if not k.startswith('PG')}
actor = "select set_config('request.jwt.claims','{\"sub\":\"p7-reviewer\",\"role\":\"authenticated\"}',false);\n"
def uid(n): return '77000000-0000-4000-8000-' + str(n).zfill(12)
def run(sql, expected=None):
    r = subprocess.run(base, input=sql, text=True, capture_output=True, env=env, timeout=8)
    if expected:
        assert r.returncode != 0 and expected in r.stderr, (expected, r.stdout, r.stderr)
    else:
        assert r.returncode == 0, (r.stdout, r.stderr)
    return r.stdout.strip()
def command(expense, request):
    raw = run("select private.expense_correction_content(e)||jsonb_build_object("
      "'request_id','"+uid(request)+"','expense_id',e.id,'company_id',e.company_id,"
      "'actor_id','"+uid(10)+"','submitted_by',e.submitted_by,'expected_status',e.status,"
      "'expected_updated_at',e.updated_at,'correction_note','','amount',108,'allocations',"
      "jsonb_build_array(jsonb_build_object('project_id','"+uid(32)+"','percentage',100,'amount',null)))"
      " from expenses e where id='"+uid(expense)+"';")
    return "public.correct_expense_for_review('"+raw.replace("'", "''")+"'::jsonb)"
def holder(sql, pause=0.7):
    p = subprocess.Popen(base, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env)
    p.stdin.write('begin;\n'+sql+'\n\\echo READY\nselect pg_sleep('+str(pause)+');\ncommit;\n')
    p.stdin.close()
    while True:
        line = p.stdout.readline()
        if line.strip() == 'READY': break
        if not line:
            raise AssertionError(('holder failed',p.stderr.read()))
    return p

def finish(p):
    p.stdout.read()
    err = p.stderr.read()
    assert p.wait(timeout=8) == 0, err

# One exact receipt despite a concurrent same-request submission and response loss.
c = command(220,520)
p = holder(actor+'select '+c+';')
run(actor+'select '+c+';', '40001')
finish(p)
replay = json.loads(run(actor+'select '+c+';').splitlines()[-1])
assert replay['replayed'] is True
assert run("select count(*) from private.expense_correction_requests where request_id='"+uid(520)+"';") == '1'
assert run("select count(*) from notifications where dedupe_key='expense_correction:"+uid(520)+"';") == '1'
print('PASS concurrent same-request retry commits one receipt and one notification')

# A legacy allocation mutation owns the child then touches the parent. The
# correction fails while locked, then the original revision fails after commit.
c = command(221,521)
p = holder("update expense_project_allocations set percentage=95 where expense_id='"+uid(221)+"';")
run(actor+'select '+c+';', '40001')
finish(p)
run(actor+'select '+c+';', 'P0001')
assert run("select count(*) from private.expense_correction_requests where request_id='"+uid(521)+"';") == '0'
print('PASS concurrent allocation write cannot bypass revision CAS or partially correct')

# Revocation commits while the correction is waiting on the canonical company
# key. Reauthorization after the key must see it before replay or mutation.
for target, label in [(10,'actor'),(11,'submitter')]:
    c = command(222,522)
    p = holder("select pg_advisory_xact_lock(hashtextextended('save_expense_atomic:"+uid(1)+"',0));\n"
      "update users set is_active=false where id='"+uid(target)+"';", pause=0.15)
    run(actor+'select '+c+';', '42501')
    finish(p)
    run("update users set is_active=true where id='"+uid(target)+"';")
    print('PASS '+label+' revocation during company-lock wait denies correction')

# Once authorized correction begins, actor, company, and submitter membership
# cannot change before its receipt/content transaction commits.
c = command(223,523)
p = holder(actor+'select '+c+';',pause=1)
for sql,label in [
    ("update users set is_active=false where id='"+uid(10)+"';",'actor'),
    ("update users set is_active=false where id='"+uid(11)+"';",'submitter'),
    ("update companies set deleted_at=now() where id='"+uid(1)+"';",'company')]:
    run("set lock_timeout='50ms';"+sql,'55P03')
    print('PASS '+label+' authority stays locked through correction commit')
finish(p)
assert run('select count(*) from private.expense_correction_scope;') == '0'
print('7 real contention checks passed')
