import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260901121000_trial_expiry_push_delivery_state.sql"
  ),
  "utf8"
).toLowerCase();

describe("trial expiry push delivery state migration", () => {
  it("gives the push leg its own durable outcome on the existing claim row", () => {
    expect(sql).toContain("alter table public.trial_expiry_notifications");
    expect(sql).toContain("push_status");
    expect(sql).toContain("push_attempts");
    expect(sql).toContain("push_last_error");
    expect(sql).toContain("push_last_attempt_at");
    expect(sql).toContain("default 'none'");
  });

  it("constrains push_status to exactly the six known outcomes", () => {
    expect(sql).toContain(
      "check (push_status in ('none','not_applicable','sent','skipped_quiet_hours','retry_eligible','failed'))"
    );
  });

  it("bounds the retry counter so a runaway loop cannot hide in the data", () => {
    expect(sql).toContain("push_attempts >= 0 and push_attempts <= 10");
  });

  it("adds columns only — the claim row itself is never released", () => {
    expect(sql).not.toContain("drop table");
    expect(sql).not.toContain("delete from public.trial_expiry_notifications");
    expect(sql).not.toContain("drop constraint");
  });
});
