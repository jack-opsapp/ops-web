import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260714230000_email_attachment_persistence.sql"
  ),
  "utf8"
);

function extractFunction(functionName: string): string {
  const marker = `create or replace function public.${functionName}(`;
  const start = migration.indexOf(marker);
  expect(start, `missing SQL function: ${functionName}`).toBeGreaterThanOrEqual(
    0
  );
  const end = migration.indexOf("\n$$;", start);
  expect(end, `unterminated SQL function: ${functionName}`).toBeGreaterThan(
    start
  );
  return migration.slice(start, end + 4);
}

describe("durable email attachment persistence migration", () => {
  it("scopes attachment identity to the owning mailbox", () => {
    expect(migration).toMatch(
      /create unique index[\s\S]*on public\.email_attachments\s*\(\s*company_id\s*,\s*connection_id\s*,\s*message_id\s*,\s*attachment_id\s*\)/i
    );
    expect(migration).toMatch(/alter column connection_id set not null/i);
  });

  it("creates a durable exact-message scan queue and atomic claim function", () => {
    expect(migration).toContain(
      "create table if not exists public.email_attachment_scans"
    );
    expect(migration).toContain("claim_email_attachment_scans");
    expect(migration).toMatch(/for update\s+skip locked/i);
    expect(migration).toMatch(/unique\s*\(\s*activity_id\s*\)/i);
  });

  it("retries cost-once attachment inspection independently from file ingestion", () => {
    expect(migration).toContain(
      "create table if not exists public.email_attachment_inspection_jobs"
    );
    expect(migration).toContain("claim_email_attachment_inspection_jobs");
    expect(migration).toMatch(/unique\s*\(\s*email_attachment_id\s*\)/i);
    expect(migration).toMatch(
      /email_attachments_enqueue_inspection_job[\s\S]*after insert or update of ingest_status, attribution_status/i
    );
    expect(migration).toMatch(
      /claim_email_attachment_inspection_jobs[\s\S]*for update\s+skip locked/i
    );
  });

  it("enqueues every email activity, including provider false negatives", () => {
    expect(migration).toContain("enqueue_email_attachment_scan");
    expect(migration).toMatch(/new\.type\s*=\s*'email'/i);
    expect(migration).not.toMatch(/new\.has_attachments\s*=\s*true/i);
  });

  it("uses exact activity ownership and requeues attribution on reassignment", () => {
    expect(migration).toContain("activity_id");
    expect(migration).toContain("opportunity_id");
    expect(migration).toContain("attribution_status");
    expect(migration).toContain("requeue_email_attachment_attribution");

    const exactIdentity = extractFunction(
      "require_exact_email_attachment_identity"
    );
    expect(exactIdentity).toMatch(/from public\.activities[\s\S]*for share/i);
    expect(exactIdentity).toMatch(
      /new\.opportunity_id\s+is distinct from\s+v_activity\.opportunity_id/i
    );
    expect(exactIdentity).toMatch(/v_activity\.match_needs_review/i);
    expect(exactIdentity).toMatch(
      /old\.ingest_status\s*=\s*'stored'[\s\S]*new\.detected_mime_type\s*:=\s*old\.detected_mime_type/i
    );
  });

  it("replays cached inspection acceptance after a stored file is reattributed", () => {
    const enqueueInspection = extractFunction(
      "enqueue_email_attachment_inspection_job"
    );
    expect(enqueueInspection).toMatch(
      /old\.attribution_status\s+is distinct from\s+new\.attribution_status/i
    );
    expect(enqueueInspection).toMatch(/status\s*=\s*'pending'/i);
    expect(enqueueInspection).toMatch(/generation\s*=.*generation\s*\+\s*1/i);
    expect(enqueueInspection).not.toMatch(
      /where[\s\S]*status\s*=\s*'skipped'[\s\S]*skip_reason/i
    );
  });

  it("terminalizes exhausted scan and inspection queues with internal review notifications", () => {
    expect(migration).toMatch(
      /email_attachment_scans_status_check[\s\S]*'failed'/i
    );
    expect(migration).toMatch(
      /email_attachment_inspection_jobs_status_check[\s\S]*'failed'/i
    );
    expect(migration).toContain("notify_terminal_email_attachment_failure");
    expect(migration).toContain("email-attachment-scan-failed:");
    expect(migration).toContain("email-attachment-inspection-failed:");
    expect(migration).toMatch(
      /after update of status[\s\S]*email_attachment_scans[\s\S]*after update of status[\s\S]*email_attachment_inspection_jobs/i
    );
  });

  it("creates a private bucket and company-scoped RLS", () => {
    expect(migration).toMatch(
      /insert into storage\.buckets[\s\S]*'email-attachments'[\s\S]*false/i
    );
    expect(migration).toContain("email_attachment_scans_company_scope");
    expect(migration).toContain("email_attachments_company_scope");
    expect(migration).toMatch(
      /revoke all on public\.email_attachments from public, anon, authenticated/i
    );
    expect(migration).not.toMatch(
      /grant select on public\.email_attachments to authenticated/i
    );
    expect(migration).toMatch(
      /revoke all on function public\.refresh_email_activity_attachments\(uuid\)[\s\S]*from public, anon, authenticated/i
    );
  });

  it("backfills historical email activities without overwriting manual lead photos", () => {
    expect(migration).toMatch(
      /insert into public\.email_attachment_scans[\s\S]*from public\.activities/i
    );
    expect(migration).not.toMatch(
      /update\s+public\.opportunities[\s\S]*images\s*=/i
    );
  });

  it("creates one atomic operator notification for files OPS cannot copy", () => {
    expect(migration).toContain("exception_notified_at");
    expect(migration).toContain("notify_email_attachment_scan_exception");
    expect(migration).toContain("email-attachment-scan:");
    expect(migration).toMatch(
      /notify_email_attachment_scan_exception[\s\S]*for update[\s\S]*insert into public\.notifications[\s\S]*update public\.email_attachment_scans/i
    );
    expect(migration).toMatch(
      /revoke all on function public\.notify_email_attachment_scan_exception[\s\S]*from public, anon, authenticated/i
    );
  });

  it("atomically parks auth-failed mailboxes and persists a reconnect notification", () => {
    const markReconnect = extractFunction(
      "mark_email_attachment_connection_needs_reconnect"
    );
    expect(markReconnect).toMatch(
      /for update[\s\S]*update public\.email_connections[\s\S]*insert into public\.notifications/i
    );
    expect(markReconnect).toContain("email-attachment-reconnect:");
    expect(markReconnect).toMatch(/'system'/i);
    expect(markReconnect).toMatch(/persistent[\s\S]*true/i);
    expect(markReconnect).toContain("direct_recipient");
    expect(markReconnect).toContain("admin_recipients");
    expect(markReconnect).toContain("is_company_admin");
    expect(markReconnect).toContain("fallback_recipient");
    expect(markReconnect).toMatch(/on conflict do nothing/i);

    const resumeReconnect = extractFunction(
      "resume_email_attachment_scans_on_reconnect"
    );
    expect(resumeReconnect).toContain("email-attachment-reconnect:");
    expect(resumeReconnect).toContain(
      "resolution_reason = 'email_reconnected'"
    );
    expect(migration).toMatch(
      /revoke all on function public\.mark_email_attachment_connection_needs_reconnect[\s\S]*from public, anon, authenticated/i
    );
  });

  it("keeps the old identity during expand and holds its removal post-deploy", () => {
    expect(migration).not.toMatch(
      /drop constraint if exists email_attachments_company_id_message_id_attachment_id_key/i
    );
    const contract = readFileSync(
      resolve(
        process.cwd(),
        "docs/migrations/20260714231000_contract_email_attachment_identities.sql"
      ),
      "utf8"
    );
    expect(contract).toContain(
      "email_attachments_company_id_message_id_attachment_id_key"
    );
    expect(contract).toContain(
      "attachment_inspections_company_id_message_id_attachment_id_key"
    );
  });
});
