import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATION_NAME = "20260829081501_agent_payment_read.sql";
const BODY_PATH = join(
  process.cwd(),
  "src/lib/agent-control-plane/services/p2/payments/sql/agent_payment_read.body.sql"
);
const MIGRATION_PATH = join(
  process.cwd(),
  "supabase/migrations",
  MIGRATION_NAME
);
const RUNTIME_PATH = join(
  process.cwd(),
  "tests/sql/agent-payment-reads-runtime.sql"
);
const REPLAY_PATH = join(
  process.cwd(),
  "tests/sql/agent-payment-reads-replay-runtime.sql"
);
const FINANCIAL_TOMBSTONE_PATH = join(
  process.cwd(),
  "supabase/migrations/20260830150000_agent_mcp_financial_tombstones.sql"
);

function read(path: string) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function compact(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function tagged(sql: string, tag: string) {
  const delimiter = `$${tag}$`;
  const start = sql.indexOf(delimiter);
  if (start < 0) return "";
  const bodyStart = start + delimiter.length;
  const end = sql.indexOf(delimiter, bodyStart);
  return end < 0 ? "" : sql.slice(bodyStart, end);
}

function replaceExactly(
  source: string,
  oldFragment: string,
  newFragment: string,
  expectedCount: number
) {
  const count = source.split(oldFragment).length - 1;
  if (count !== expectedCount || newFragment === "") return "";
  return source.split(oldFragment).join(newFragment);
}

function definition(sql: string, name: string) {
  const marker = `create or replace function ${name}(`;
  const start = sql.lastIndexOf(marker);
  if (start < 0) return "";
  const tail = sql.slice(start);
  const delimiter = /\bas\s+(\$[a-z0-9_]*\$)/.exec(tail)?.[1];
  if (!delimiter) return "";
  const end = tail.indexOf(`${delimiter};`);
  return end < 0 ? "" : tail.slice(0, end + delimiter.length + 1);
}

const BODY = read(BODY_PATH);
const MIGRATION = read(MIGRATION_PATH);
const FINANCIAL_TOMBSTONE = read(FINANCIAL_TOMBSTONE_PATH);
const ORDERED_MIGRATION = replaceExactly(
  MIGRATION,
  "       select pg_catalog.array_agg(scope.value order by scope.value)",
  '       select pg_catalog.array_agg(\n         scope.value order by scope.value collate "C"\n       )',
  1
);
const TOMBSTONED_MIGRATION = replaceExactly(
  ORDERED_MIGRATION,
  tagged(FINANCIAL_TOMBSTONE, "old_payment"),
  tagged(FINANCIAL_TOMBSTONE, "new_payment"),
  1
);
const SQL = BODY.toLowerCase();
const COMPACT = compact(BODY);
const CONTEXT = compact(
  definition(SQL, "private.agent_p2_payment_read_context_v1")
);
const SOURCE = compact(definition(SQL, "private.agent_p2_payment_source_v1"));
const AUTHORITY = compact(
  definition(SQL, "private.agent_p2_payment_authorized_path_v1")
);
const LIST = compact(definition(SQL, "private.agent_p2_payment_list_v1"));
const ATTENTION = compact(
  definition(SQL, "private.agent_p2_payment_attention_v1")
);
const PUBLIC_READ = compact(
  definition(SQL, "public.read_agent_payments_as_system")
);
const RUNTIME = compact(read(RUNTIME_PATH));
const REPLAY = compact(read(REPLAY_PATH));
const RESERVED = readdirSync(join(process.cwd(), "supabase/migrations")).filter(
  (name) => name.endsWith("_agent_payment_read.sql")
);

describe("P2 payment read SQL", () => {
  it("matches its immutable reservation plus the ordered tombstone repairs", () => {
    expect(RESERVED).toEqual([MIGRATION_NAME]);
    expect(BODY).not.toBe("");
    expect(FINANCIAL_TOMBSTONE).not.toBe("");
    expect(MIGRATION).not.toBe(BODY);
    expect(TOMBSTONED_MIGRATION).toBe(BODY);
    expect(SQL).toMatch(/(?:^|\n)begin;\s/);
    expect(SQL.trim().endsWith("commit;")).toBe(true);
    expect(SQL).toContain("task 15 canonical payment read body");
    expect(SQL).toContain("do $prerequisites$");
    expect(SQL).toContain("do $postflight$");
  });

  it("defines fixed private source/list/attention helpers and one service-only RPC", () => {
    for (const value of [
      CONTEXT,
      SOURCE,
      AUTHORITY,
      LIST,
      ATTENTION,
      PUBLIC_READ,
    ]) {
      expect(value).not.toBe("");
      expect(value).toContain("stable");
      expect(value).toContain("set search_path = ''");
    }
    for (const value of [CONTEXT, SOURCE, AUTHORITY, LIST, ATTENTION]) {
      expect(value).toContain("security invoker");
    }
    expect(PUBLIC_READ).toContain("security definer");
    expect(PUBLIC_READ).toContain(
      "auth.role() is distinct from 'service_role'"
    );
    expect(
      COMPACT.match(/create or replace function public\.read_agent_/g)
    ).toHaveLength(1);
    expect(COMPACT).toContain(
      "grant execute on function public.read_agent_payments_as_system"
    );
    expect(COMPACT).not.toContain(
      "grant execute on function private.agent_p2_payment"
    );
  });

  it("re-proves payment OAuth, mandatory full finance, invoice/job authority, and three exact revisions", () => {
    expect(CONTEXT).toContain("private.mcp_oauth_grants");
    expect(CONTEXT).toContain("private.resolve_agent_actor_authority(");
    expect(CONTEXT).toContain("'ops.payments.read'");
    expect(CONTEXT).toContain("'finances.view'");
    expect(CONTEXT).toContain("'legacy_operational'");
    expect(CONTEXT).toContain("'payments'");
    expect(CONTEXT).toContain("'sales_documents'");
    expect(AUTHORITY).toContain("private.agent_user_can_access_entity(");
    expect(AUTHORITY).toContain("'opportunity'");
    expect(AUTHORITY).toContain("'project'");
    expect(AUTHORITY).toContain("'financescope' = 'all'");
    expect(COMPACT).not.toContain("finances.view' = 'assigned'");
    expect(COMPACT).not.toContain("finances.view' = 'own'");
  });

  it("uses strict positive money, normalized categories, 501/26/keyset sentinels, and atomic opaque proofs", () => {
    expect(SOURCE).toContain("private.agent_p2_sales_money_minor_or_null_v1(");
    expect(SOURCE).toContain("source.amount > 0");
    expect(SOURCE).toContain("source.voided_at > p_read_at");
    expect(LIST).toContain("v_context -> 'minor_exponent' = 'null'::jsonb");
    expect(ATTENTION).toContain(
      "v_context -> 'minor_exponent' = 'null'::jsonb"
    );
    expect(SOURCE).toContain("'method_category'");
    expect(SOURCE).toContain("'reconciliation_state'");
    expect(SOURCE).toContain("limit p_source_limit");
    expect(LIST).toContain("p_page_fetch_limit");
    expect(LIST).toContain("p_after_payment_date");
    expect(LIST).toContain("p_after_id");
    expect(LIST).toContain("source.payment_item is not null");
    expect(COMPACT).toContain("private.agent_p2_sales_hash_ref(");
    expect(COMPACT).toContain("ops_proof:v1:");
    expect(COMPACT).toContain("ops_evidence:v1:");
    expect(ATTENTION).toContain("'reconciliation_state'");
    expect(ATTENTION).toContain("'payment_count'");
    expect(ATTENTION).toContain("'amount'");
  });

  it("never projects payment references, providers, actors, raw methods, or instruments", () => {
    for (const forbidden of [
      "reference_number",
      "stripe_payment_intent",
      "created_by",
      "voided_by",
      "qb_id",
      "sage_id",
      "card_last_four",
      "bank_account",
      "check_number",
    ]) {
      expect(SOURCE).not.toContain(`'${forbidden}',`);
      expect(LIST).not.toContain(`'${forbidden}',`);
      expect(ATTENTION).not.toContain(`'${forbidden}',`);
    }
    expect(SOURCE).not.toContain("'payment_method',");
  });

  it("pins PG17 ACL, all|assigned paths, filters, keyset, 501, stale, privacy, attention, and replay proofs", () => {
    for (const marker of [
      "payment_all_and_assigned_visibility",
      "payment_finances_all_required",
      "payment_filters_and_normalization",
      "payment_future_void_fails_closed",
      "payment_unlike_currency_fails_closed",
      "payment_keyset_no_duplicates",
      "payment_source_501_fails_closed",
      "payment_stale_revision_fails_closed",
      "payment_private_fields_absent",
      "payment_attention_bounded",
      "payment_service_only_acl",
    ]) {
      expect(RUNTIME).toContain(marker);
    }
    for (const marker of [
      "task15_forward_ledger",
      "task15_replay_source",
      "task15_replay_read",
      "task15_function_acl_stable",
    ]) {
      expect(REPLAY).toContain(marker);
    }
  });
});
