#!/usr/bin/env python3
"""Capture production's permission-override save path as a disposable fixture.

Writes, from READ-ONLY production metadata (no row data except product
configuration: the permission editor registry, the preset roles and their
permissions, and the agent read-domain registry):

  tests/sql/permission-overrides-fixture.sql   the save path, verbatim
  tests/sql/permission-overrides-fidelity.sql  md5 proof the harness matches

The save path is the execution closure of
public.apply_user_permission_overrides_as_system: every function it can reach
by calling (qualified or through its search_path) or by writing a row whose
trigger fires, every relation those functions read or write, the triggers that
can fire, the foreign keys between those relations, their indexes, defaults,
checks and grants. Object DDL is `pg_dump --schema-only` output; auth.role()
and auth.jwt() are pg_get_functiondef.

The save is written at its pre-repair definition (production from 2026-07-15
until ledger 20260918022722), rebuilt from the July migration that created it
and proved by md5, so scripts/test-permission-overrides-postgres.sh can
reproduce the outage and install the repair on top.

Usage (from the ops-web root; needs Homebrew postgresql@17):
  SUPABASE_DB_PASSWORD=... python3 scripts/capture-permission-overrides-fixture.py
The password falls back to SUPABASE_DB_PASSWORD in .env.local. Every
connection is read-only (default_transaction_read_only) and pg_dump gives up
rather than wait on a lock.
"""

import json
import os
import re
import subprocess
import sys
import tempfile
from collections import defaultdict, deque
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PG_BIN = Path(os.environ.get("OPS_TEST_PG_BIN", "/opt/homebrew/opt/postgresql@17/bin"))
DSN = "host=db.ijeekuhbatykdomumfjx.supabase.co port=5432 dbname=postgres user=postgres sslmode=require"
FIXTURE = ROOT / "tests/sql/permission-overrides-fixture.sql"
FIDELITY = ROOT / "tests/sql/permission-overrides-fidelity.sql"
JULY = ROOT / "supabase/migrations/20260715180900_internal_spec_permission_guard.sql"

ROOT_FUNCTION = "public.apply_user_permission_overrides_as_system"
RPC_IDENTITY = "public.apply_user_permission_overrides_as_system(uuid,uuid,jsonb,jsonb,text[],jsonb)"
RELEASED_MD5 = "74ca941e37b9813a30db902b52c91e13"  # production 2026-07-15 .. 2026-09-18
REPAIRED_MD5 = "8e1cb41e52232d3217024a68baed4e27"  # production since ledger 20260918022722
SCHEMAS = ("public", "private", "auth", "extensions")


def password() -> str:
    value = os.environ.get("SUPABASE_DB_PASSWORD")
    if value:
        return value
    env_file = ROOT / ".env.local"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            if line.startswith("SUPABASE_DB_PASSWORD="):
                return line.split("=", 1)[1].strip().strip('"')
    sys.exit("SUPABASE_DB_PASSWORD is not set (environment or .env.local)")


def read_only_env() -> dict:
    env = {k: v for k, v in os.environ.items() if not k.startswith("PG")}
    env["PGPASSWORD"] = password()
    env["PGOPTIONS"] = "-c default_transaction_read_only=on -c statement_timeout=300000"
    return env


def psql(*queries: str) -> str:
    command = [str(PG_BIN / "psql"), DSN, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1"]
    for query in queries:
        command += ["-c", query]
    return subprocess.run(command, env=read_only_env(), check=True, capture_output=True, text=True).stdout


def psql_rows(*queries: str) -> list:
    return [json.loads(line) for line in psql(*queries).splitlines() if line]


# ── Read production (read-only) ─────────────────────────────────────────────

def export_catalog():
    functions = psql_rows(f"""
      select json_build_object(
        'oid', p.oid::bigint, 'schema', n.nspname, 'name', p.proname, 'kind', p.prokind,
        'signature', n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
        'lang', l.lanname, 'config', p.proconfig,
        'md5', case when l.lanname in ('sql', 'plpgsql') and p.prokind in ('f', 'p') then md5(pg_get_functiondef(p.oid)) end,
        'def', case when l.lanname in ('sql', 'plpgsql') and p.prokind in ('f', 'p') then pg_get_functiondef(p.oid) end)::text
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_language l on l.oid = p.prolang
      where n.nspname in {SCHEMAS}""")
    triggers = psql_rows("""
      select json_build_object('table', n.nspname || '.' || c.relname, 'name', t.tgname,
        'fn_oid', t.tgfoid::bigint, 'tgtype', t.tgtype, 'enabled', t.tgenabled, 'def', pg_get_triggerdef(t.oid))::text
      from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
      where not t.tgisinternal and n.nspname in ('public', 'private', 'auth')""")
    # pg_dump labels a FUNCTION block by its argument types and the function's
    # ACL block by its named identity arguments, both formatted under an empty
    # search_path; key the dump blocks exactly the same way.
    labels = {row["oid"]: row for row in psql_rows("set search_path = ''", f"""
      select json_build_object('oid', p.oid::bigint,
        'identity', n.nspname || '.' || p.proname || '(' || coalesce((
          select string_agg(pg_catalog.format_type(a.typ, null), ',' order by a.ord)
            from unnest(p.proargtypes::oid[]) with ordinality as a(typ, ord)), '') || ')',
        'acl_identity', n.nspname || '.' || p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')')::text
      from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname in {SCHEMAS}""")}
    for f in functions:
        f["identity"] = labels[f["oid"]]["identity"]
        f["acl_identity"] = labels[f["oid"]]["acl_identity"]
    return functions, triggers


def export_reference_data() -> str:
    return psql("""
      select format('insert into private.lead_permission_editor_registry (permission, scopes) values (%L, %L);', permission, scopes)
        from private.lead_permission_editor_registry order by permission collate "C"
      """, """
      select format('insert into public.roles (id, name, hierarchy, created_at, description, is_preset, company_id, updated_at) values (%L, %L, %s, %L, %L, %L, null, %L);',
                    id, name, hierarchy, created_at, description, is_preset, updated_at)
        from public.roles where company_id is null order by hierarchy, id""", """
      select format('insert into public.role_permissions (id, role_id, permission, scope, created_at) values (%L, %L, %L, %L, %L);', rp.id, rp.role_id, rp.permission, rp.scope, rp.created_at)
        from public.role_permissions rp join public.roles r on r.id = rp.role_id where r.company_id is null
       order by rp.role_id, rp.permission collate "C", rp.id""", """
      select format('insert into private.agent_read_domains (domain) values (%L);', domain)
        from private.agent_read_domains order by domain collate "C"
      """)


def export_reference_fingerprints() -> dict:
    return psql_rows("""select json_build_object(
      'registry', (select json_build_array(count(*), md5(string_agg(permission || '=' || array_to_string(scopes, ','), ';' order by permission collate "C"))) from private.lead_permission_editor_registry),
      'preset_roles', (select json_build_array(count(*), md5(string_agg(id::text || '|' || name || '|' || hierarchy || '|' || is_preset, ';' order by id))) from public.roles where company_id is null),
      'preset_permissions', (select json_build_array(count(*), md5(string_agg(rp.role_id::text || '|' || rp.permission || '|' || rp.scope, ';' order by rp.role_id, rp.permission collate "C", rp.scope collate "C"))) from public.role_permissions rp join public.roles r on r.id = rp.role_id where r.company_id is null),
      'read_domains', (select json_build_array(count(*), md5(string_agg(domain, ';' order by domain collate "C"))) from private.agent_read_domains),
      'rpc_md5', (select md5(pg_get_functiondef('""" + RPC_IDENTITY + """'::regprocedure))),
      'extensions', (select json_object_agg(e.extname, n.nspname || ' ' || e.extversion) from pg_extension e join pg_namespace n on n.oid = e.extnamespace),
      'collation', (select json_build_array(datlocprovider, datlocale) from pg_database where datname = current_database())
    )::text""")[0]


def dump_schema(workdir: Path) -> str:
    archive = workdir / "schema.pgc"
    subprocess.run(
        [str(PG_BIN / "pg_dump"), DSN, "--schema-only", "--format=custom", "--lock-wait-timeout=5000",
         "--schema=public", "--schema=private", f"--file={archive}"],
        env=read_only_env(), check=True,
    )
    plain = workdir / "schema.sql"
    subprocess.run([str(PG_BIN / "pg_restore"), f"--file={plain}", str(archive)], check=True)
    # newline="" keeps CR bytes: a few production bodies carry CRLF line endings.
    with open(plain, newline="") as handle:
        return handle.read()


# ── The execution closure ───────────────────────────────────────────────────

HEADER = re.compile(r"^--\n-- Name: (?P<name>.*?); Type: (?P<type>.*?); Schema: (?P<schema>.*?); Owner: (?P<owner>.*?)\n--\n", re.M)
CALL = re.compile(r'(?<![A-Za-z0-9_.$"])((?:public|private|auth|extensions)\.)?([A-Za-z_][A-Za-z0-9_]*)\s*\(', re.I)
WRITE = re.compile(r"\b(insert\s+into|update|delete\s+from|merge\s+into|truncate(?:\s+table)?)\s+(?:only\s+)?((?:public|private)\.)?([A-Za-z_][A-Za-z0-9_]*)", re.I)
READ = re.compile(r"\b(?:from|join)\s+(?:only\s+)?((?:public|private)\.)?([A-Za-z_][A-Za-z0-9_]*)\b(?!\s*\()", re.I)
ROWTYPE = re.compile(r"((?:public|private)\.)?([A-Za-z_][A-Za-z0-9_]*)(?:\.[A-Za-z_][A-Za-z0-9_]*)?%(?:row)?type", re.I)
QUALIFIED = re.compile(r"\b(public|private)\.([A-Za-z_][A-Za-z0-9_]*)\b(?!\s*\()", re.I)
NOT_RELATIONS = {"set", "only", "of", "each", "row", "statement", "lateral", "returning", "where", "using", "select"}


def strip_comments(sql: str) -> str:
    return re.sub(r"/\*.*?\*/", " ", re.sub(r"--[^\n]*", " ", sql), flags=re.S)


def split_blocks(dump: str) -> list:
    marks = list(HEADER.finditer(dump))
    blocks = []
    for i, m in enumerate(marks):
        end = marks[i + 1].start() if i + 1 < len(marks) else len(dump)
        sql = dump[m.start():end]
        if i + 1 == len(marks):
            sql = sql.split("--\n-- PostgreSQL database dump complete")[0]
        blocks.append({"name": m["name"], "type": m["type"], "schema": m["schema"], "sql": sql})
    return blocks


def trigger_ops(tgtype: int) -> set:
    return {op for bit, op in ((4, "INSERT"), (8, "DELETE"), (16, "UPDATE"), (32, "TRUNCATE")) if tgtype & bit}


TRIGGER_SHAPE = re.compile(
    r"^CREATE (?:CONSTRAINT )?TRIGGER \S+ (?P<timing>BEFORE|AFTER|INSTEAD OF) (?P<events>.+?) ON \S+ (?P<rest>.*?) EXECUTE FUNCTION ",
    re.S,
)
DISTINCT = re.compile(r"old\.(\w+) IS DISTINCT FROM new\.(\w+)")


def trigger_rule(definition: str) -> dict:
    """When PostgreSQL fires a trigger: its events, its UPDATE OF column list,
    and, for a WHEN that is only `old.c IS DISTINCT FROM new.c` tests joined
    by OR, the columns it watches (any other WHEN is treated as able to pass)."""
    m = TRIGGER_SHAPE.match(definition)
    events = {}
    for event in m["events"].split(" OR "):
        if event.startswith("UPDATE OF "):
            events["UPDATE"] = {c.strip().strip('"') for c in event[len("UPDATE OF "):].split(",")}
        else:
            events[event.strip()] = None
    watched = None
    when = re.search(r"\bWHEN \((.*)\)\s*$", m["rest"].strip(), re.S)
    if when:
        pairs = DISTINCT.findall(when.group(1))
        residue = DISTINCT.sub("", when.group(1))
        if pairs and all(a == b for a, b in pairs) and re.fullmatch(r"[\s()OR]*", residue):
            watched = {a for a, _ in pairs}
    return {"events": events, "watched": watched, "before_row": m["timing"] == "BEFORE" and "FOR EACH ROW" in m["rest"]}


def split_top_level(text: str) -> list:
    parts, current, depth, quote = [], [], 0, None
    for ch in text:
        if quote:
            if ch == quote:
                quote = None
        elif ch in ("'", '"'):
            quote = ch
        elif ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        elif ch == "," and depth == 0:
            parts.append("".join(current))
            current = []
            continue
        current.append(ch)
    parts.append("".join(current))
    return parts


SET_LIST_END = re.compile(r"(?<![A-Za-z0-9_])(where|from|returning)(?![A-Za-z0-9_])|;", re.I)


def set_list_columns(text: str, start: int) -> set:
    """Columns assigned by the SET list starting at text[start]."""
    depth, quote, i = 0, None, start
    while i < len(text):
        ch = text[i]
        if quote:
            if ch == quote:
                quote = None
        elif ch in ("'", '"'):
            quote = ch
        elif ch == "(":
            depth += 1
        elif ch == ")":
            if depth == 0:
                break
            depth -= 1
        elif depth == 0 and SET_LIST_END.match(text, i):
            break
        i += 1
    columns = set()
    for part in split_top_level(text[start:i]):
        tuple_target = re.match(r"\s*\(([^)]*)\)\s*=", part)
        if tuple_target:
            columns |= {c.strip().lower() for c in tuple_target.group(1).split(",")}
        else:
            single = re.match(r"\s*([A-Za-z_][A-Za-z0-9_]*)\s*=", part)
            if single:
                columns.add(single.group(1).lower())
    return columns


UPDATE_SET = re.compile(
    r"\bupdate\s+(?:only\s+)?((?:public|private)\.)?([A-Za-z_][A-Za-z0-9_]*)(?:\s+(?:as\s+)?(?!set\b)[A-Za-z_][A-Za-z0-9_]*)?\s+set\s+",
    re.I,
)
CONFLICT_SET = re.compile(r"\bdo\s+update\s+set\s+", re.I)
NEW_EDIT = re.compile(r"\bnew\.([A-Za-z_][A-Za-z0-9_]*)\s*:?=(?!=)", re.I)
NEW_REPLACED = re.compile(r"\bnew\s*:=", re.I)


def closure(functions: list, triggers: list, blocks: list) -> dict:
    by_oid = {f["oid"]: f for f in functions}
    by_name = defaultdict(list)
    for f in functions:
        if f["kind"] in ("f", "p"):  # aggregates (pgvector's sum) are never call targets here
            by_name[(f["schema"], f["name"])].append(f)
    relations = {f"{b['schema']}.{b['name']}" for b in blocks if b["type"] in ("TABLE", "VIEW")}
    types = {f"{b['schema']}.{b['name']}" for b in blocks if b["type"] in ("TYPE", "DOMAIN")}
    relation_blocks = defaultdict(list)
    for b in blocks:
        if b["type"] in ("TABLE", "VIEW"):
            relation_blocks[f"{b['schema']}.{b['name']}"].append(b)
        elif b["type"] in ("DEFAULT", "CONSTRAINT", "FK CONSTRAINT", "TRIGGER", "POLICY", "ROW SECURITY"):
            relation_blocks[f"{b['schema']}.{b['name'].split(' ')[0]}"].append(b)
        elif b["type"] == "INDEX":
            m = re.search(r"\bON\s+(?:ONLY\s+)?([a-z_]+)\.([a-z_0-9]+)", b["sql"])
            if m:
                b["relation"] = f"{m[1]}.{m[2]}"
                relation_blocks[b["relation"]].append(b)
    live_triggers = defaultdict(list)
    for t in triggers:
        if t["enabled"] != "D":
            t["rule"] = trigger_rule(t["def"])
            live_triggers[t["table"]].append(t)

    def search_path(f):
        for setting in f.get("config") or []:
            if setting.startswith("search_path="):
                return [p.strip().strip('"').strip("'") for p in setting.split("=", 1)[1].split(",") if p.strip()]
        return ["public", "private", "extensions"]

    def resolve_function(schema, name, f):
        if schema:
            return by_name.get((schema, name), [])
        return [g for s in search_path(f) if s in SCHEMAS for g in by_name.get((s, name), [])]

    def resolve_relation(schema, name, f):
        candidates = [schema] if schema else [s for s in search_path(f) if s in ("public", "private")]
        return [f"{s}.{name}" for s in candidates if f"{s}.{name}" in relations]

    seen, fired, tables, typeset = {}, {}, set(), set()
    writes = defaultdict(set)  # relation -> operations the save path performs on it
    assigned = defaultdict(set)  # relation -> columns its UPDATE / ON CONFLICT SET lists name
    rewritten = defaultdict(set)  # relation -> columns BEFORE ROW triggers change on NEW
    before_on = defaultdict(set)  # trigger function oid -> relations it runs BEFORE ROW on
    queue = deque((f["oid"], "root") for f in functions if f["signature"].startswith(ROOT_FUNCTION + "("))

    def add_relation(rel):
        if rel in tables:
            return
        tables.add(rel)
        for b in relation_blocks.get(rel, []):
            if b["type"] in ("POLICY", "ROW SECURITY", "TRIGGER", "FK CONSTRAINT"):
                continue
            text = strip_comments(b["sql"])
            for m in re.finditer(r"\b(public|private|auth)\.([A-Za-z_][A-Za-z0-9_]*)\s*\(", text):
                queue.extend((g["oid"], f"{b['type']} of {rel}") for g in by_name.get((m[1], m[2]), []))
            for m in QUALIFIED.finditer(text):
                if f"{m[1]}.{m[2]}" in types:
                    typeset.add(f"{m[1]}.{m[2]}")

    def can_fire(t, rel):
        rule = t["rule"]
        for op in writes[rel]:
            if op not in rule["events"]:
                continue
            if op == "UPDATE":
                columns = rule["events"]["UPDATE"]
                # UPDATE OF fires only when the statement's SET list names a column.
                if columns is not None and not columns & assigned[rel]:
                    continue
                watched = rule["watched"]
                if watched is not None and "*" not in rewritten[rel] and not watched & (assigned[rel] | rewritten[rel]):
                    continue
            return True
        return False

    def refire(rel):
        for t in live_triggers.get(rel, []):
            key = (rel, t["name"])
            if key in fired or not can_fire(t, rel):
                continue
            fired[key] = t
            if t["rule"]["before_row"]:
                before_on[t["fn_oid"]].add(rel)
                if t["fn_oid"] in seen:
                    note_new_edits(t["fn_oid"], rel)
            queue.append((t["fn_oid"], f"trigger {t['name']} on {rel}"))

    def note_new_edits(oid, rel):
        text = strip_comments(by_oid[oid].get("def") or "")
        edits = {m.group(1).lower() for m in NEW_EDIT.finditer(text)}
        if NEW_REPLACED.search(text):
            edits.add("*")
        if not edits <= rewritten[rel]:
            rewritten[rel] |= edits
            refire(rel)

    while queue:
        oid, why = queue.popleft()
        if oid in seen:
            continue
        f = by_oid[oid]
        seen[oid] = why
        text = strip_comments(f.get("def") or "")
        for m in CALL.finditer(text):
            schema = m.group(1)[:-1].lower() if m.group(1) else None
            queue.extend((g["oid"], f["signature"]) for g in resolve_function(schema, m.group(2).lower(), f) if g["oid"] != oid)
        for pattern in (READ, ROWTYPE):
            for m in pattern.finditer(text):
                schema = m.group(1)[:-1].lower() if m.group(1) else None
                if m.group(2).lower() not in NOT_RELATIONS:
                    for rel in resolve_relation(schema, m.group(2).lower(), f):
                        add_relation(rel)
        for m in QUALIFIED.finditer(text + " " + f["signature"]):
            name = f"{m[1].lower()}.{m[2].lower()}"
            if name in types:
                typeset.add(name)
            elif name in relations:
                add_relation(name)
        touched = set()
        for m in WRITE.finditer(text):
            verb = m.group(1).lower().split()[0]
            schema = m.group(2)[:-1].lower() if m.group(2) else None
            if m.group(3).lower() in NOT_RELATIONS:
                continue
            for rel in resolve_relation(schema, m.group(3).lower(), f):
                add_relation(rel)
                ops = {{"insert": "INSERT", "update": "UPDATE", "delete": "DELETE", "merge": "INSERT", "truncate": "TRUNCATE"}[verb]}
                if verb == "insert":
                    statement_end = text.find(";", m.start())
                    conflict = CONFLICT_SET.search(text, m.start(), statement_end if statement_end > 0 else len(text))
                    if conflict:
                        ops.add("UPDATE")
                        assigned[rel] |= set_list_columns(text, conflict.end())
                if verb == "merge":
                    ops |= {"UPDATE", "DELETE"}
                    assigned[rel].add("*")
                writes[rel] |= ops
                touched.add(rel)
        for m in UPDATE_SET.finditer(text):
            schema = m.group(1)[:-1].lower() if m.group(1) else None
            for rel in resolve_relation(schema, m.group(2).lower(), f):
                assigned[rel] |= set_list_columns(text, m.end())
                touched.add(rel)
        for rel in touched:
            refire(rel)
        for rel in before_on.get(oid, ()):
            note_new_edits(oid, rel)

    return {
        "functions": [by_oid[o] for o in sorted(seen, key=lambda o: by_oid[o]["signature"])],
        "tables": tables,
        "types": typeset,
        "triggers": [fired[k] for k in sorted(fired)],
        "relation_blocks": relation_blocks,
    }


# ── Fixture ─────────────────────────────────────────────────────────────────

ARGS = re.compile(r",\s+")


def dump_key(schema: str, header_name: str) -> str:
    name, args = header_name[:header_name.index("(")], header_name[header_name.index("(") + 1:-1]
    return f"{schema}.{name}({ARGS.sub(',', args)})"


def select_blocks(blocks: list, path: dict) -> list:
    keys = {f["identity"] for f in path["functions"]}
    acl_keys = {ARGS.sub(",", f["acl_identity"]) for f in path["functions"]}
    trigger_keys = {f"{t['table']} {t['name']}" for t in path["triggers"]}
    tables = path["tables"]

    def fk_target(sql):
        m = re.search(r"REFERENCES\s+([a-z_]+)\.([a-z_0-9]+)", sql)
        return f"{m[1]}.{m[2]}" if m else None

    chosen = []
    for b in blocks:
        kind, schema, name = b["type"], b["schema"], b["name"]
        keep = (
            (kind == "FUNCTION" and dump_key(schema, name) in keys)
            or (kind == "ACL" and name.startswith("FUNCTION ") and ARGS.sub(",", f"{schema}.{name[len('FUNCTION '):]}") in acl_keys)
            or (kind == "ACL" and name.startswith("TABLE ") and f"{schema}.{name[len('TABLE '):]}" in tables)
            or (kind == "TABLE" and f"{schema}.{name}" in tables)
            or (kind in ("DEFAULT", "CONSTRAINT") and f"{schema}.{name.split(' ')[0]}" in tables)
            or (kind == "FK CONSTRAINT" and f"{schema}.{name.split(' ')[0]}" in tables and fk_target(b["sql"]) in tables)
            or (kind == "INDEX" and b.get("relation") in tables)
            or (kind == "TRIGGER" and f"{schema}.{name}" in trigger_keys)
            or (kind in ("TYPE", "DOMAIN") and f"{schema}.{name}" in path["types"])
        )
        if keep:
            chosen.append(b)
    dumped = {dump_key(b["schema"], b["name"]) for b in chosen if b["type"] == "FUNCTION"}
    missing = sorted(keys - dumped - {"auth.role()", "auth.jwt()"})
    if missing:
        sys.exit(f"closure functions missing from the dump: {missing}")
    return chosen


CR_BODY = re.compile(r"(CREATE FUNCTION [^\n]*\n(?:[^\n]*\n)*?\s*AS )(\$[A-Za-z_]*\$)(.*?)\2;", re.S)


def spell_cr_bodies(sql: str) -> str:
    """Bodies with CR bytes become E'' literals: the file stays LF-only while
    the catalog definition stays byte-identical (fidelity proves the md5)."""
    def spell(m):
        if "\r" not in m.group(3):
            return m.group(0)
        literal = m.group(3).replace("\\", "\\\\").replace("'", "''").replace("\r", "\\r").replace("\n", "\\n")
        return f"{m.group(1)}E'{literal}';"
    spelled = CR_BODY.sub(spell, sql)
    if "\r" in spelled:
        sys.exit("a CR byte survived outside a function body")
    return spelled


def rewind_save(body: str) -> str:
    """Put the save back to the July text production ran until the repair."""
    july = JULY.read_text()
    start = july.lower().index("create or replace function public.apply_user_permission_overrides_as_system")
    b0 = july.index("$function$", start) + len("$function$")
    released = july[b0:july.index("$function$", b0)]
    head = body.index("-- Name: apply_user_permission_overrides_as_system(uuid, uuid, jsonb, jsonb, text[], jsonb); Type: FUNCTION; Schema: public;")
    j = body.index("AS $", head)
    tag_end = body.index("$", j + 4) + 1
    tag = body[j + 3:tag_end]
    k = body.index(tag, tag_end)
    if "cleared(permission)" not in body[tag_end:k] or "unnest(p_clear) permission" not in released:
        sys.exit("unexpected save definitions; the rewind no longer applies")
    return body[:tag_end] + released + body[k:]


def schema_blocks(blocks: list, name: str, kind: str) -> str:
    return next(b["sql"] for b in blocks if b["name"] == name and b["type"] == kind)


def write_fixture(dump: str, blocks: list, chosen: list, functions: list, reference: str) -> None:
    settings = dump[dump.index("SET statement_timeout = 0;"):dump.index("\n--\n-- Name: public; Type: SCHEMA")].strip()
    auth = {f["signature"]: f["def"] for f in functions if f["schema"] == "auth"}
    body = spell_cr_bodies(rewind_save("".join(b["sql"] for b in chosen)))
    with open(FIXTURE, "w", newline="") as handle:
        handle.write("".join([
        """\\set ON_ERROR_STOP on
-- Disposable PostgreSQL 17 fixture for the permission-override save path.
-- Never apply to an OPS database. Generated by
-- scripts/capture-permission-overrides-fixture.py from read-only production
-- metadata (project ijeekuhbatykdomumfjx); loaded by
-- scripts/test-permission-overrides-postgres.sh and proven by
-- tests/sql/permission-overrides-fidelity.sql.
--
-- Contents: the execution closure of
-- public.apply_user_permission_overrides_as_system as production runs it:
-- every function the save can reach (called, or fired as a trigger by a row
-- it writes), every table those functions read or write, the triggers that
-- can fire, the foreign keys between those tables, their indexes, defaults,
-- checks and grants. Object DDL is verbatim `pg_dump --schema-only`;
-- auth.role() and auth.jwt() are verbatim pg_get_functiondef.
--
-- The save itself is written as production ran it from 2026-07-15 until
-- ledger 20260918022722 (md5 """ + RELEASED_MD5 + """), rebuilt from
-- supabase/migrations/20260715180900_internal_spec_permission_guard.sql, so the
-- harness reproduces the 42702 and installs the repair on top the way
-- production did. update_timestamp()'s production body carries CRLF line
-- endings and is spelled as an E'' literal to keep this file LF-only.
--
-- Left out on purpose: row-level security. Every object on this path is owned
-- by postgres, which has BYPASSRLS in production, and every function runs as
-- that owner, so no policy is evaluated during a save. Triggers that cannot
-- fire during a save (INSERT-only triggers on opportunities, for example) are
-- left out along with the functions only they reach.

-- ── PostgREST identities, with production's attributes ───────────────────
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
do $$ begin create role authenticator login noinherit; exception when duplicate_object then null; end $$;
grant anon, authenticated, service_role to authenticator;

-- ── pg_dump session settings ─────────────────────────────────────────────
""",
        settings, "\n\n",
        "-- ── Schemas ──────────────────────────────────────────────────────────────\n",
        schema_blocks(blocks, "private", "SCHEMA"),
        schema_blocks(blocks, "SCHEMA public", "ACL"),
        schema_blocks(blocks, "SCHEMA private", "ACL"),
        "CREATE SCHEMA auth;\n\n",
        "-- Production installs pg_trgm 1.6 in public; three discovery indexes on the\n",
        "-- save path's tables use its operator class.\n",
        "CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public VERSION '1.6';\n\n",
        "-- ── auth helpers (verbatim pg_get_functiondef) ──────────────────────────\n",
        auth["auth.role()"].rstrip(), ";\n\n",
        auth["auth.jwt()"].rstrip(), ";\n\n",
        "-- ── Save-path objects (verbatim pg_dump) ────────────────────────────────\n",
        body,
        "\n-- ── Reference data (product configuration, not customer data) ──────────\n",
        "-- The permission editor registry the save validates against, the preset\n",
        "-- roles and their permissions, and the agent read-domain registry the\n",
        "-- revision triggers require.\n",
        "SELECT pg_catalog.set_config('search_path', '', false);\n",
        reference,
        ]))


def sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def write_fidelity(path: dict, fingerprints: dict) -> None:
    functions = ",\n    ".join(
        f"({sql_literal(f['signature'])}, {sql_literal(RELEASED_MD5 if f['signature'].startswith(ROOT_FUNCTION + '(') else f['md5'])})"
        for f in path["functions"]
    )
    triggers = ",\n      ".join(f"({sql_literal(t['def'])})" for t in path["triggers"])
    registry, roles, grants, domains = (fingerprints[k] for k in ("registry", "preset_roles", "preset_permissions", "read_domains"))
    FIDELITY.write_text(f"""\\set ON_ERROR_STOP on
-- Proves the permission-override harness template matches production's save
-- path, as read from project ijeekuhbatykdomumfjx (read-only) by
-- scripts/capture-permission-overrides-fixture.py: every function by
-- md5(pg_get_functiondef), the save at its pre-repair definition; every
-- trigger that can fire during a save, and no other; the save's grants; the
-- PostgREST identities; the collation the save's canonical-order checks sort
-- by; and the reference data. Run on the template BEFORE the migration under
-- test. Any drift fails the harness instead of weakening the proof.

do $permission_overrides_fidelity$
declare
  v_mismatch text;
begin
  select expected.signature into v_mismatch
  from (values
    {functions}
  ) as expected(signature, production_md5)
  left join lateral (
    select p.oid from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname || '.' || p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')' = expected.signature
  ) live on true
  where live.oid is null
     or pg_catalog.md5(pg_catalog.pg_get_functiondef(live.oid)) <> expected.production_md5
  limit 1;
  if v_mismatch is not null then
    raise exception 'permission override fidelity: function differs from production: %', v_mismatch;
  end if;

  if (select count(*)
        from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'private', 'auth')
         and not exists (select 1 from pg_catalog.pg_depend d where d.classid = 'pg_catalog.pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')) <> {len(path['functions'])} then
    raise exception 'permission override fidelity: the template defines functions production''s save path does not reach';
  end if;

  select coalesce(pg_catalog.string_agg(difference, E'\\n'), '') into v_mismatch from (
    (select definition as difference from (values
      {triggers}
    ) as production(definition)
    except
    select pg_catalog.pg_get_triggerdef(t.oid) from pg_catalog.pg_trigger t where not t.tgisinternal)
    union all
    (select pg_catalog.pg_get_triggerdef(t.oid) from pg_catalog.pg_trigger t where not t.tgisinternal
    except
    select definition from (values
      {triggers}
    ) as production(definition))
  ) differences;
  if v_mismatch <> '' then
    raise exception 'permission override fidelity: triggers differ from production:%', E'\\n' || v_mismatch;
  end if;

  if (select p.proacl::text from pg_catalog.pg_proc p where p.oid = '{RPC_IDENTITY}'::regprocedure)
       is distinct from '{{postgres=X/postgres,service_role=X/postgres}}' then
    raise exception 'permission override fidelity: the save''s grants differ from production';
  end if;

  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticator' and rolcanlogin and not rolinherit)
     or not exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role' and rolbypassrls and not rolcanlogin)
     or (select count(*) from pg_catalog.pg_auth_members m join pg_catalog.pg_roles r on r.oid = m.roleid
          where m.member = 'authenticator'::regrole and r.rolname in ('anon', 'authenticated', 'service_role')) <> 3 then
    raise exception 'permission override fidelity: PostgREST identities differ from production';
  end if;

  if (select datlocprovider::text || ' ' || datlocale from pg_catalog.pg_database where datname = pg_catalog.current_database())
       is distinct from 'i en-US' then
    raise exception 'permission override fidelity: the database must sort like production (ICU en-US)';
  end if;

  if (select count(*) || ' ' || md5(string_agg(permission || '=' || array_to_string(scopes, ','), ';' order by permission collate "C")) from private.lead_permission_editor_registry)
       is distinct from '{registry[0]} {registry[1]}'
     or (select count(*) || ' ' || md5(string_agg(id::text || '|' || name || '|' || hierarchy || '|' || is_preset, ';' order by id)) from public.roles where company_id is null)
       is distinct from '{roles[0]} {roles[1]}'
     or (select count(*) || ' ' || md5(string_agg(rp.role_id::text || '|' || rp.permission || '|' || rp.scope, ';' order by rp.role_id, rp.permission collate "C", rp.scope collate "C")) from public.role_permissions rp join public.roles r on r.id = rp.role_id where r.company_id is null)
       is distinct from '{grants[0]} {grants[1]}'
     or (select count(*) || ' ' || md5(string_agg(domain, ';' order by domain collate "C")) from private.agent_read_domains)
       is distinct from '{domains[0]} {domains[1]}' then
    raise exception 'permission override fidelity: reference data differs from production';
  end if;
end
$permission_overrides_fidelity$;

select 'save path fidelity: {len(path['functions'])} functions and {len(path['triggers'])} triggers match production';
""")


def main() -> None:
    fingerprints = export_reference_fingerprints()
    if fingerprints["rpc_md5"] != REPAIRED_MD5:
        sys.exit(
            f"production's save is {fingerprints['rpc_md5']}, not the repaired {REPAIRED_MD5}: "
            "a later migration changed it. Capture before that migration or extend rewind_save()."
        )
    if fingerprints["collation"] != ["i", "en-US"]:
        sys.exit(f"production's collation changed: {fingerprints['collation']}")
    functions, triggers = export_catalog()
    with tempfile.TemporaryDirectory(prefix="ops-overrides-capture.") as workdir:
        dump = dump_schema(Path(workdir))
    blocks = split_blocks(dump)
    path = closure(functions, triggers, blocks)
    chosen = select_blocks(blocks, path)
    write_fixture(dump, blocks, chosen, functions, export_reference_data())
    write_fidelity(path, fingerprints)
    print(f"{len(path['functions'])} functions, {len(path['tables'])} tables, {len(path['triggers'])} triggers")
    print(f"wrote {FIXTURE.relative_to(ROOT)} and {FIDELITY.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
