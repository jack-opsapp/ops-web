import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/20260607071000_notifications_dedupe_key_scope.sql"),
  "utf8"
);

describe("notifications dedupe key scope migration", () => {
  it("is transaction-wrapped and sentinel-guarded", () => {
    expect(sql.trim().startsWith("begin;")).toBe(true);
    expect(sql.trim().endsWith("commit;")).toBe(true);
    expect(sql).toContain("notifications_dedupe_key_scope_sentinel");
    expect(sql).toContain("raise exception");
  });

  it("dedupes unread unresolved notifications by dedupe_key when present", () => {
    expect(sql).toContain("drop index if exists public.idx_notifications_unread_dedup");
    expect(sql).toContain("create unique index if not exists idx_notifications_unread_dedup");
    expect(sql).toContain("coalesce(dedupe_key, title)");
    expect(sql).toContain("where is_read = false");
    expect(sql).toContain("and resolved_at is null");
  });

  it("keeps create_notification_if_new compatible with the expression index", () => {
    expect(sql).toContain("create or replace function public.create_notification_if_new");
    expect(sql.toLowerCase()).toContain("on conflict do nothing");
    expect(sql).not.toContain("ON CONFLICT (user_id, company_id, type, title)");
  });
});
