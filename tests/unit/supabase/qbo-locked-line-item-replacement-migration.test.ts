import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/20260607172000_qbo_locked_line_item_replacement.sql"),
  "utf8"
);

describe("qbo locked line-item replacement migration", () => {
  it("serializes QuickBooks line replacement per invoice or estimate parent", () => {
    expect(sql).toContain("qbo_locked_line_item_replacement_sentinel");
    expect(sql).toContain("create or replace function public.replace_qbo_line_items_locked");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("hashtextextended");
    expect(sql).toContain("for update");
  });

  it("replaces line items without inserting generated totals or mutating parents", () => {
    expect(sql).toContain("delete from public.line_items");
    expect(sql).toContain("insert into public.line_items");
    const insertColumnBlock = sql.match(/insert into public\.line_items \(([\s\S]*?)\)\s*select/i)?.[1] ?? "";
    expect(insertColumnBlock).not.toContain("line_total");
    expect(sql).toContain("p_invoice_id");
    expect(sql).toContain("p_estimate_id");
  });

  it("keeps the replacement RPC service-role only", () => {
    expect(sql).toContain("revoke all on function public.replace_qbo_line_items_locked");
    expect(sql).toContain("from public, anon, authenticated");
    expect(sql).toContain("grant execute on function public.replace_qbo_line_items_locked");
    expect(sql).toContain("to service_role");
  });
});
