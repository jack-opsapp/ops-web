import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260722121000_unanswered_lead_local_system_handoff_idempotency.sql"
);

function migrationSource(): string {
  return readFileSync(migrationPath, "utf8");
}

function compact(value: string): string {
  return value.replace(/\s+/g, " ").toLowerCase();
}

describe("unanswered-lead local system-handoff idempotency migration", () => {
  it("creates a service-only expiring generation claim keyed to exact source provenance", () => {
    const sql = compact(migrationSource());

    expect(sql).toContain(
      "create table if not exists public.unanswered_lead_local_draft_generation_claims"
    );
    expect(sql).toContain(
      "primary key (company_id, opportunity_id, source_event_id)"
    );
    expect(sql).toContain(
      "claim_token uuid not null default gen_random_uuid()"
    );
    expect(sql).toContain("expires_at timestamptz not null");
    expect(sql).toContain(
      "alter table public.unanswered_lead_local_draft_generation_claims enable row level security"
    );
    expect(sql).toContain(
      "alter table public.unanswered_lead_local_draft_generation_claims force row level security"
    );
    expect(sql).toMatch(
      /revoke all on table public\.unanswered_lead_local_draft_generation_claims from public, anon, authenticated/
    );
    expect(sql).toMatch(
      /grant select, insert, update, delete on table public\.unanswered_lead_local_draft_generation_claims to service_role/
    );
  });

  it("prevents duplicate system-handoff drafts for one exact source event", () => {
    const sql = compact(migrationSource());

    expect(sql).toMatch(
      /create unique index if not exists opportunity_follow_up_drafts_system_handoff_source_event_uidx on public\.opportunity_follow_up_drafts \(company_id, opportunity_id, source_event_id\) where origin = 'system_handoff' and source_event_id is not null/
    );
  });

  it("stores service-only audited exact-message projections for recovered forwards", () => {
    const sql = compact(migrationSource());

    expect(sql).toContain(
      "create table if not exists public.unanswered_lead_message_projections"
    );
    expect(sql).toContain(
      "primary key (company_id, opportunity_id, source_event_id)"
    );
    expect(sql).toContain("manifest_sha256 text not null");
    expect(sql).toContain("entry_sha256 text not null");
    expect(sql).toContain(
      "alter table public.unanswered_lead_message_projections force row level security"
    );
    expect(sql).toMatch(
      /revoke all on table public\.unanswered_lead_message_projections from public, anon, authenticated/
    );
    expect(sql).toMatch(
      /grant select on table public\.unanswered_lead_message_projections to service_role/
    );
    expect(sql).not.toMatch(
      /grant[^;]*insert[^;]*on table public\.unanswered_lead_message_projections/
    );
  });

  it("projects only an authorized exact persisted-customer message and makes exact retries idempotent", () => {
    const sql = compact(migrationSource());
    const projection = sql.slice(
      sql.indexOf(
        "create or replace function public.project_unanswered_lead_recovery_message"
      ),
      sql.indexOf(
        "create or replace function public.persist_unanswered_lead_local_system_handoff"
      )
    );

    expect(projection).toContain(
      "create or replace function public.project_unanswered_lead_recovery_message"
    );
    expect(projection).toContain(
      "public.authorize_opportunity_action_as_system( p_actor_user_id, p_opportunity_id, 'edit' )"
    );
    expect(projection).toContain(
      "public.authorize_email_inbox_action_as_system( p_actor_user_id, p_connection_id, p_opportunity_id, 'view' )"
    );
    expect(projection).toMatch(
      /source_event\.activity_id = p_source_activity_id[\s\S]*?source_event\.provider_thread_id = p_source_provider_thread_id[\s\S]*?source_event\.provider_message_id = p_source_provider_message_id/
    );
    expect(projection).toContain(
      "private.opportunity_sender_is_persisted_customer( p_company_id, p_opportunity_id, v_source_event.from_email )"
    );
    expect(projection).toContain("'status', 'already_exists'");
    expect(projection).toContain("'status', 'created'");
    expect(sql).toMatch(
      /revoke all on function public\.project_unanswered_lead_recovery_message[\s\S]*?from public, anon, authenticated/
    );
  });

  it("claims only under service role and returns existing drafts before spending on generation", () => {
    const sql = compact(migrationSource());

    expect(sql).toContain(
      "create or replace function public.claim_unanswered_lead_local_draft_generation"
    );
    expect(sql).toContain("auth.role() is distinct from 'service_role'");
    expect(sql).toMatch(
      /from public\.opportunity_follow_up_drafts draft[\s\S]*?draft\.origin = 'system_handoff'[\s\S]*?draft\.source_event_id = p_source_event_id[\s\S]*?'existing_draft'/
    );
    expect(sql).toMatch(
      /delete from public\.unanswered_lead_local_draft_generation_claims claim[\s\S]*?claim\.expires_at <= now\(\)/
    );
    expect(sql).toContain(
      "on conflict (company_id, opportunity_id, source_event_id) do nothing"
    );
    expect(sql).toContain("'generation_in_progress'");
    expect(sql).toMatch(
      /revoke all on function public\.claim_unanswered_lead_local_draft_generation[\s\S]*?from public, anon, authenticated/
    );
    expect(sql).toMatch(
      /grant execute on function public\.claim_unanswered_lead_local_draft_generation[\s\S]*?to service_role/
    );
  });

  it("releases only the exact token and never mutates provider or opportunity state", () => {
    const sql = compact(migrationSource());
    const release = sql.slice(
      sql.indexOf(
        "create or replace function public.release_unanswered_lead_local_draft_generation"
      ),
      sql.indexOf(
        "create or replace function public.persist_unanswered_lead_local_system_handoff"
      )
    );

    expect(release).toContain(
      "create or replace function public.release_unanswered_lead_local_draft_generation"
    );
    expect(release).toMatch(
      /claim\.company_id = p_company_id[\s\S]*?claim\.opportunity_id = p_opportunity_id[\s\S]*?claim\.source_event_id = p_source_event_id[\s\S]*?claim\.claim_token = p_claim_token/
    );
    expect(release).not.toContain("update public.opportunities");
    expect(release).not.toContain(
      "insert into public.opportunity_follow_up_drafts"
    );
    expect(release).not.toContain("provider_draft_id");
    expect(release).not.toContain("gmail");
  });

  it("atomically persists only an authorized current local system-handoff draft", () => {
    const sql = compact(migrationSource());

    expect(sql).toContain(
      "create or replace function public.persist_unanswered_lead_local_system_handoff"
    );
    expect(sql).toContain(
      "public.authorize_opportunity_action_as_system( p_actor_user_id, p_opportunity_id, 'edit' )"
    );
    expect(sql).toContain(
      "public.authorize_email_inbox_action_as_system( p_actor_user_id, p_connection_id, p_opportunity_id, 'view' )"
    );
    expect(sql).toMatch(
      /from public\.opportunities opportunity[\s\S]*?for update/
    );
    expect(sql).toContain(
      "opportunity.stage_manually_set is distinct from p_expected_stage_manually_set"
    );
    expect(sql).toContain(
      "opportunity.assignment_version is distinct from p_expected_assignment_version"
    );
    expect(sql).toContain(
      "opportunity.assigned_to is distinct from p_expected_assigned_to"
    );
    expect(sql).toContain("p_expected_workstream is distinct from 'sales'");
    expect(sql).toMatch(
      /v_opportunity\.source_metadata[\s\S]*?'email_workstream'[\s\S]*?<> 'sales'/
    );
    expect(sql).toMatch(
      /source_event\.activity_id = p_source_activity_id[\s\S]*?source_event\.provider_message_id = p_source_provider_message_id[\s\S]*?source_event\.provider_thread_id = p_source_provider_thread_id/
    );
    expect(sql).toContain(
      "lower(btrim(source_event.from_email)) = lower(btrim(p_recipient_email))"
    );
    expect(sql).toContain(
      "private.opportunity_sender_is_persisted_customer( p_company_id, p_opportunity_id, v_source_event.from_email )"
    );
    expect(sql).toMatch(
      /p_provider_thread_id is null[\s\S]*?from public\.unanswered_lead_message_projections projection[\s\S]*?projection\.workstream = 'sales'[\s\S]*?projection\.response_disposition = 'reply_required'[\s\S]*?projection\.conversation_scope = 'message'/
    );
    expect(sql).toMatch(
      /p_provider_thread_id is not null[\s\S]*?from public\.email_threads thread[\s\S]*?thread\.primary_category in \('lead', 'client', 'customer'\)[\s\S]*?awaiting_reply[\s\S]*?v_source_event\.from_email/
    );
    expect(sql).toMatch(
      /not exists \( select 1 from public\.opportunity_correspondence_events newer_inbound[\s\S]*?newer_inbound\.party_role = 'customer'/
    );
    expect(sql).toMatch(
      /not exists \( select 1 from public\.opportunity_correspondence_events later_outbound[\s\S]*?later_outbound\.party_role = 'ops'/
    );
    expect(sql).toMatch(
      /later_outbound\.party_role = 'ops'[\s\S]*?p_provider_thread_id is not null[\s\S]*?later_outbound\.provider_thread_id = p_source_provider_thread_id[\s\S]*?unnest\([\s\S]*?later_outbound\.to_emails[\s\S]*?later_outbound\.cc_emails[\s\S]*?v_source_event\.from_email/
    );
    expect(sql).toMatch(
      /insert into public\.opportunity_follow_up_drafts[\s\S]*?'system_handoff'[\s\S]*?'drafted'[\s\S]*?null/
    );
    expect(sql).toMatch(
      /alter table public\.opportunity_follow_up_drafts add column if not exists recipient_email text, add column if not exists recipient_name text/
    );
    expect(sql).toMatch(
      /insert into public\.opportunity_follow_up_drafts \([\s\S]*?recipient_email,[\s\S]*?recipient_name,[\s\S]*?\) values \([\s\S]*?lower\(btrim\(p_recipient_email\)\),[\s\S]*?nullif\(btrim\(p_recipient_name\), ''\)/
    );
    expect(sql).toContain("'status', 'already_exists'");
    expect(sql).toContain("'status', 'created'");
  });

  it("binds persistence to an available canonical AI draft and service role only", () => {
    const sql = compact(migrationSource());

    expect(sql).toMatch(
      /from public\.ai_draft_history ai_draft[\s\S]*?ai_draft\.origin = 'system_handoff'[\s\S]*?ai_draft\.status = 'drafted'/
    );
    expect(sql).toMatch(
      /revoke all on function public\.persist_unanswered_lead_local_system_handoff[\s\S]*?from public, anon, authenticated/
    );
    expect(sql).toMatch(
      /grant execute on function public\.persist_unanswered_lead_local_system_handoff[\s\S]*?to service_role/
    );
  });
});
