import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260715181800_sendgrid_email_events_idempotency.sql"
  ),
  "utf8"
).toLowerCase();
const normalizedSql = sql.replace(/\s+/g, " ");

describe("SendGrid email event idempotency migration", () => {
  it("replaces the partial index with an inferable unique index", () => {
    expect(sql).toContain("drop index if exists public.uq_email_events_idempotency");
    expect(normalizedSql).toContain(
      'create unique index uq_email_events_idempotency on public.email_events (sg_message_id, event, "timestamp")'
    );
    expect(sql).not.toContain("where sg_message_id is not null");
  });

  it("fails closed if the canonical index shape is not installed", () => {
    expect(sql).toContain("sendgrid email event idempotency index is missing");
    expect(sql).toContain("indpred is null");
    expect(sql).toContain("indisunique");
    expect(sql).toContain("indisvalid");
    expect(sql).toContain("indisready");
    expect(sql).toContain("indnullsnotdistinct");
    expect(sql).toContain("indnkeyatts = 3");
    expect(sql).toContain("indnatts = 3");
    expect(sql).toContain(
      "pg_catalog.pg_get_indexdef(i.indexrelid, 1, true) = 'sg_message_id'"
    );
    expect(sql).toContain(
      "pg_catalog.pg_get_indexdef(i.indexrelid, 2, true) = 'event'"
    );
    expect(sql).toContain(
      `pg_catalog.pg_get_indexdef(i.indexrelid, 3, true) = '"timestamp"'`
    );
  });
});
