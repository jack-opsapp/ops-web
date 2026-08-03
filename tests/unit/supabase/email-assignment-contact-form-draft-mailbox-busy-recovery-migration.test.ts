import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationsDirectory = join(process.cwd(), "supabase/migrations");
const migrationName = readdirSync(migrationsDirectory).find((name) =>
  name.endsWith("_keep_contact_form_mailbox_busy_retryable.sql")
);
const sql = migrationName
  ? readFileSync(join(migrationsDirectory, migrationName), "utf8").toLowerCase()
  : "";
const compact = sql.replace(/\s+/g, " ");

describe("contact-form draft mailbox-aware wait migration", () => {
  it("records one durable mailbox wait without adding a claimable queue status", () => {
    expect(migrationName).toBeDefined();
    expect(sql.trim().startsWith("begin;")).toBe(true);
    expect(sql.trim().endsWith("commit;")).toBe(true);
    expect(compact).toContain(
      "alter table public.email_assignment_contact_form_draft_queue add column if not exists mailbox_busy_since timestamptz"
    );
    expect(compact).toContain(
      "create index if not exists email_assignment_contact_form_draft_mailbox_wait_idx"
    );
    expect(compact).toContain("mailbox_busy_since is not null");
    expect(compact).not.toContain("'waiting_mailbox'");
  });

  it("checks the canonical private lease and rolling-deploy mirror for the physical mailbox", () => {
    const helperStart = compact.indexOf(
      "create or replace function private.email_assignment_contact_form_draft_mailbox_is_busy"
    );
    const claimStart = compact.indexOf(
      "create or replace function public.claim_email_assignment_contact_form_drafts"
    );
    const helper = compact.slice(helperStart, claimStart);

    expect(helperStart).toBeGreaterThan(-1);
    expect(claimStart).toBeGreaterThan(helperStart);
    expect(helper).toContain("private.email_provider_mailbox_sync_leases");
    expect(helper).toContain("extensions.digest");
    expect(helper).toContain("lease.expires_at > clock_timestamp()");
    expect(helper).toContain("mirror.provider = target.provider");
    expect(helper).toContain("mirror.email = target.email");
    expect(helper).toContain("mirror.sync_lock_owner is not null");
    expect(helper).toContain(
      "mirror.sync_in_progress_at > clock_timestamp() - make_interval(secs => 600)"
    );
    expect(helper).toContain(
      "revoke all on function private.email_assignment_contact_form_draft_mailbox_is_busy( uuid ) from public, anon, authenticated, service_role"
    );
  });

  it("marks blocked work before claim and excludes it from the bounded worker batch", () => {
    const claimStart = compact.indexOf(
      "create or replace function public.claim_email_assignment_contact_form_drafts"
    );
    const failStart = compact.indexOf(
      "create or replace function public.fail_email_assignment_contact_form_draft_as_system"
    );
    const claim = compact.slice(claimStart, failStart);
    const candidateStart = claim.indexOf("with candidate as (");
    const candidate = claim.slice(candidateStart);

    expect(claimStart).toBeGreaterThan(-1);
    expect(failStart).toBeGreaterThan(claimStart);
    expect(claim).toContain(
      "set status = 'retrying', mailbox_busy_since = coalesce( queue.mailbox_busy_since, clock_timestamp() )"
    );
    expect(claim).toContain(
      "last_error = 'email_assignment_contact_form_draft_mailbox_busy'"
    );
    expect(claim).toContain(
      "private.email_assignment_contact_form_draft_mailbox_is_busy( queue.connection_id )"
    );
    expect(candidateStart).toBeGreaterThan(-1);
    expect(candidate).toContain(
      "and not private.email_assignment_contact_form_draft_mailbox_is_busy( queue.connection_id )"
    );
    expect(candidate).toContain("attempts = queue.attempts + 1");
  });

  it("preserves the first wait timestamp when an acquisition race reports mailbox busy", () => {
    const failStart = compact.indexOf(
      "create or replace function public.fail_email_assignment_contact_form_draft_as_system"
    );
    const repairStart = compact.lastIndexOf(
      "update public.email_assignment_contact_form_draft_queue work set status = 'retrying'"
    );
    const failure = compact.slice(failStart, repairStart);

    expect(failStart).toBeGreaterThan(-1);
    expect(failure).toContain(
      "v_mailbox_busy := btrim(p_error) = 'email_assignment_contact_form_draft_mailbox_busy'"
    );
    const uncertainProviderFence = failure.indexOf(
      "when queue.provider_create_started_at is not null then 'reconciliation_required'"
    );
    const mailboxBusyRetry = failure.indexOf(
      "when v_mailbox_busy then 'retrying'"
    );
    const ordinaryAttemptCeiling = failure.indexOf(
      "when queue.attempts >= 8 then 'failed'"
    );

    expect(uncertainProviderFence).toBeGreaterThan(-1);
    expect(mailboxBusyRetry).toBeGreaterThan(uncertainProviderFence);
    expect(ordinaryAttemptCeiling).toBeGreaterThan(mailboxBusyRetry);
    expect(failure).toContain(
      "mailbox_busy_since = case when v_mailbox_busy then coalesce(queue.mailbox_busy_since, clock_timestamp()) else null end"
    );
  });

  it("opens one persistent alert after an hour and resolves it when waiting ends", () => {
    expect(compact).toContain(
      "create unique index if not exists notifications_email_assignment_draft_mailbox_wait_open_uidx"
    );
    expect(compact).toContain(
      "dedupe_key like 'email-assignment-draft-mailbox-wait:%'"
    );
    expect(compact).toContain(
      "queue.mailbox_busy_since <= clock_timestamp() - make_interval(hours => 1)"
    );
    expect(compact).toContain("'draft waiting for mailbox'");
    expect(compact).toContain(
      "'one lead reply has waited over an hour. ops will resume when the mailbox is clear.'"
    );
    expect(compact).toContain("'email-assignment-draft-mailbox-wait:'");
    expect(compact).toMatch(
      /insert into public\.notifications[\s\S]*?'system'[\s\S]*?'draft waiting for mailbox'[\s\S]*?false,[\s\S]*?true,[\s\S]*?'\/pipeline'[\s\S]*?'review lead'/
    );
    expect(compact).toContain(
      "create or replace function private.resolve_email_assignment_contact_form_draft_mailbox_wait_notification"
    );
    expect(compact).toContain("resolved_at = clock_timestamp()");
    expect(compact).toContain(
      "resolution_reason = 'mailbox_draft_wait_cleared'"
    );
    expect(compact).toContain(
      "create trigger email_assignment_contact_form_draft_mailbox_wait_notification_resolution"
    );
  });

  it("returns only exact pre-provider historical contention failures to the wait lifecycle", () => {
    const repairStart = compact.lastIndexOf(
      "update public.email_assignment_contact_form_draft_queue work set status = 'retrying'"
    );
    const repair = compact.slice(repairStart);

    expect(repairStart).toBeGreaterThan(-1);
    expect(repair).toContain("mailbox_busy_since = coalesce(");
    expect(repair).toContain("where work.status = 'failed'");
    expect(repair).toContain("work.provider_create_attempt_id is null");
    expect(repair).toContain("work.provider_create_started_at is null");
    expect(repair).toContain(
      "btrim(work.last_error) = 'email_assignment_contact_form_draft_mailbox_busy'"
    );
    expect(repair).toContain("lease_holder = null");
    expect(repair).toContain("lease_expires_at = null");
    expect(repair).not.toContain("opportunity_id =");
    expect(repair).not.toContain("update public.ai_draft_history");
  });

  it("keeps every public queue RPC service-only", () => {
    expect(compact).toContain(
      "coalesce(auth.jwt() ->> 'role', '') <> 'service_role'"
    );
    expect(compact).toContain(
      "revoke all on function public.claim_email_assignment_contact_form_drafts( text, integer, integer ) from public, anon, authenticated, service_role"
    );
    expect(compact).toContain(
      "grant execute on function public.claim_email_assignment_contact_form_drafts( text, integer, integer ) to service_role"
    );
    expect(compact).toContain(
      "revoke all on function public.fail_email_assignment_contact_form_draft_as_system( uuid, text, text ) from public, anon, authenticated, service_role"
    );
    expect(compact).toContain(
      "grant execute on function public.fail_email_assignment_contact_form_draft_as_system( uuid, text, text ) to service_role"
    );
  });
});
