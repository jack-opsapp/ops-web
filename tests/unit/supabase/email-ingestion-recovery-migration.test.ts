import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260727020000_email_ingestion_recovery_queue.sql"
  ),
  "utf8"
)
  .replace(/\s+/g, " ")
  .toLowerCase();

describe("email ingestion recovery migration", () => {
  it("creates one service-only exact-message/provider-mutation queue", () => {
    expect(sql).toContain("create table public.email_ingestion_recovery_queue");
    expect(sql).toContain(
      "unique (connection_id, recovery_kind, operation_key)"
    );
    expect(sql).toContain(
      "on public.email_ingestion_recovery_queue ( company_id, available_at, created_at, id )"
    );
    expect(sql).toContain(
      "recovery_kind in ('lead_classification', 'provider_label_apply')"
    );
    expect(sql).toContain(
      "revoke all on table public.email_ingestion_recovery_queue from public, anon, authenticated, service_role"
    );
    expect(sql).toContain(
      "grant select, insert, update on table public.email_ingestion_recovery_queue to service_role"
    );
  });

  it("validates the live mailbox and configured label before enqueueing idempotent work", () => {
    expect(sql).toContain(
      "create or replace function public.enqueue_email_ingestion_recovery_as_system"
    );
    expect(sql).toContain("connection.status <> 'active'");
    expect(sql).toContain("connection.sync_enabled <> true");
    expect(sql).toContain(
      "connection.ops_label_id <> btrim(p_provider_label_id)"
    );
    expect(sql).toContain(
      "on conflict (connection_id, recovery_kind, operation_key) do update"
    );
  });

  it("claims only active-company work and fences every transition by lease holder", () => {
    expect(sql).toContain(
      "create or replace function public.claim_email_ingestion_recovery_as_system"
    );
    expect(sql).toContain(
      "create or replace function public.claim_email_ingestion_recovery_by_id_as_system"
    );
    expect(sql).toContain("candidate.company_id = any(p_company_ids)");
    expect(sql).toContain("work.company_id = any(p_company_ids)");
    expect(sql).toContain("for update of candidate skip locked");
    expect(sql).toContain(
      "create or replace function public.reauthorize_email_ingestion_recovery_as_system"
    );
    expect(sql).toContain("work.lease_holder = btrim(p_holder)");
    expect(sql).toContain("work.lease_expires_at > clock_timestamp()");
  });

  it("backs failures off, terminalizes exhausted jobs, and allows idempotent completion", () => {
    expect(sql).toContain(
      "create or replace function public.fail_email_ingestion_recovery_as_system"
    );
    expect(sql).toContain(
      "when work.attempts >= work.max_attempts then 'failed'"
    );
    expect(sql).toContain("power(2, least(work.attempts, 10)) * 60");
    expect(sql).toContain(
      "create or replace function public.complete_email_ingestion_recovery_as_system"
    );
    expect(sql).toContain("if work.status = 'completed'");
  });
});
