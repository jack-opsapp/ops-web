import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = join(process.cwd(), "supabase/migrations");
const migrationName = readdirSync(migrationsDir).find((name) =>
  name.endsWith("_phase_c_lead_intelligence_workload.sql")
);
const migrationPath = join(migrationsDir, migrationName ?? "missing.sql");
const source = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8")
  : "";

describe("Phase C lead intelligence workload migration", () => {
  it("creates one opportunity-scoped dirty marker atomically from meaningful correspondence", () => {
    expect(source).toContain(
      "create table if not exists public.opportunity_phase_c_work"
    );
    expect(source).toMatch(/opportunity_id uuid not null primary key/i);
    expect(source).toContain("required_event_id uuid not null");
    expect(source).toContain("required_event_at timestamptz not null");
    expect(source).toContain(
      "create or replace function private.enqueue_opportunity_phase_c_work"
    );
    expect(source).toMatch(
      /after insert or update of is_meaningful, opportunity_projection_applied[\s\S]*?on public\.opportunity_correspondence_events/i
    );
    expect(source).toMatch(
      /new\.is_meaningful[\s\S]*?new\.opportunity_projection_applied/i
    );
    expect(source).toMatch(
      /on conflict \(opportunity_id\)[\s\S]*?where \(excluded\.required_event_at, excluded\.required_event_id\)[\s\S]*?>[\s\S]*?\(opportunity_phase_c_work\.required_event_at, opportunity_phase_c_work\.required_event_id\)/i
    );
  });

  it("claims due work with a bounded lease and never drops a newer dirty marker", () => {
    expect(source).toContain(
      "create or replace function public.claim_opportunity_phase_c_work"
    );
    expect(source).toMatch(/for update skip locked/i);
    expect(source).toContain("lease_owner");
    expect(source).toContain("lease_expires_at");
    expect(source).toContain("attempt_count = work.attempt_count + 1");
    expect(source).toContain(
      "create or replace function public.acknowledge_opportunity_phase_c_component"
    );
    expect(source).toContain(
      "work.required_event_id = p_expected_required_event_id"
    );
    expect(source).toContain("'superseded'::text");
    expect(source).toContain(
      "create or replace function public.fail_opportunity_phase_c_work"
    );
    expect(source).toContain("next_attempt_at");
    expect(source).toContain("last_error_code");
    expect(source).toContain("last_error_message");
    expect(source).toContain("component_errors jsonb not null");
    expect(source).toMatch(
      /component_errors = work\.component_errors[\s\S]*?\|\| coalesce\(p_component_errors/i
    );
    expect(source).toMatch(
      /component_errors = work\.component_errors - p_component/i
    );
  });

  it("requires every material component to acknowledge the exact event before work completes", () => {
    for (const column of [
      "summary_completed_event_id",
      "lifecycle_completed_event_id",
      "commercial_completed_event_id",
      "event_handoff_completed_event_id",
    ]) {
      expect(source).toContain(column);
    }
    expect(source).toMatch(
      /summary_completed_event_id = work\.required_event_id[\s\S]*?lifecycle_completed_event_id = work\.required_event_id[\s\S]*?commercial_completed_event_id = work\.required_event_id[\s\S]*?event_handoff_completed_event_id = work\.required_event_id/i
    );
  });

  it("persists immutable evidence and reason before a lifecycle decision can be applied", () => {
    expect(source).toContain(
      "create table if not exists public.opportunity_lifecycle_decisions"
    );
    expect(source).toContain("proposed_stage text");
    expect(source).toContain("confidence numeric");
    expect(source).toContain("evidence_event_ids uuid[] not null");
    expect(source).toContain("evidence_message_ids text[] not null");
    expect(source).toContain("reason text not null");
    expect(source).toContain("status text not null default 'proposed'");
    expect(source).toContain(
      "create or replace function private.protect_opportunity_lifecycle_decision_evidence"
    );
    expect(source).toContain("lifecycle_decision_evidence_is_immutable");
    expect(source).toContain(
      "create or replace function public.record_opportunity_lifecycle_decision"
    );
    expect(source).toContain(
      "create or replace function public.settle_opportunity_lifecycle_decision"
    );
    expect(source).toMatch(
      /grant execute on function public\.settle_opportunity_lifecycle_decision[\s\S]*?to service_role/i
    );
  });

  it("replaces the permanent manual freeze with a source-event correction boundary", () => {
    expect(source).toContain(
      "add column if not exists stage_manual_boundary_event_id uuid"
    );
    expect(source).toContain(
      "add column if not exists stage_manual_boundary_at timestamptz"
    );
    expect(source).toContain(
      "create or replace function private.capture_opportunity_manual_stage_boundary"
    );
    expect(source).toContain(
      "create or replace function public.apply_phase_c_opportunity_stage_decision"
    );
    expect(source).toMatch(
      /from public\.opportunity_lifecycle_decisions decision[\s\S]*?for update/i
    );
    expect(source).toMatch(
      /v_source_event_at > v_opportunity\.stage_manual_boundary_at[\s\S]*?v_decision\.source_event_id > v_opportunity\.stage_manual_boundary_event_id/i
    );
    expect(source).toContain("'manual_correction_is_newer'::text");
    expect(source).toContain("stage_manually_set = false");
    expect(source).toContain("'stage_regression_blocked'::text");
  });

  it("uses durable review decisions for ambiguous identity, authority, or acceptance", () => {
    expect(source).toContain("decision_kind text not null");
    expect(source).toMatch(
      /status in \('proposed', 'applied', 'skipped', 'review', 'failed'\)/i
    );
    expect(source).toContain("review_reason text");
    expect(source).toContain("review_required_at timestamptz");
    expect(source).toContain("opportunity_lifecycle_decisions_review_idx");
  });

  it("defines one canonical idempotent bilateral-event envelope and no provider booking", () => {
    expect(source).toContain(
      "create table if not exists public.phase_c_bilateral_event_handoffs"
    );
    expect(source).toContain("idempotency_key text not null unique");
    expect(source).toContain("proposal_event_id uuid not null");
    expect(source).toMatch(/acceptance_event_id uuid\s+references/i);
    expect(source).toMatch(
      /status <> 'ready'[\s\S]*?acceptance_event_id is not null[\s\S]*?proposal_event_id <> acceptance_event_id/i
    );
    expect(source).toContain("event_timezone text");
    expect(source).toContain("attendees jsonb not null default '[]'::jsonb");
    expect(source).toMatch(
      /status in \('ready', 'review', 'consumed', 'cancelled'\)/i
    );
    expect(source).not.toMatch(
      /insert into public\.(site_visits|calendar_events)/i
    );
    expect(source).not.toMatch(/google_calendar_sync_queue/i);
  });

  it("keeps all workload, decision, and handoff mutation service-role only", () => {
    for (const table of [
      "opportunity_phase_c_work",
      "opportunity_lifecycle_decisions",
      "phase_c_bilateral_event_handoffs",
    ]) {
      expect(source).toContain(
        `alter table public.${table} enable row level security`
      );
      expect(source).toMatch(
        new RegExp(
          `revoke all on table public\\.${table} from public, anon, authenticated`,
          "i"
        )
      );
    }
    expect(source).toMatch(
      /revoke all on function public\.claim_opportunity_phase_c_work[\s\S]*?from public, anon, authenticated/i
    );
    expect(source).toMatch(
      /grant execute on function public\.claim_opportunity_phase_c_work[\s\S]*?to service_role/i
    );
    expect(source).toContain("coalesce(auth.role(), '') <> 'service_role'");
  });

  it("adds indexes for the due queue, review queue, and source evidence foreign keys", () => {
    expect(source).toContain("opportunity_phase_c_work_due_idx");
    expect(source).toContain("opportunity_lifecycle_decisions_review_idx");
    expect(source).toContain("phase_c_bilateral_event_handoffs_ready_idx");
    expect(source).toContain(
      "opportunity_lifecycle_decisions_source_event_idx"
    );
    expect(source).toContain(
      "phase_c_bilateral_event_handoffs_proposal_event_idx"
    );
    expect(source).toContain(
      "phase_c_bilateral_event_handoffs_acceptance_event_idx"
    );
  });
});
