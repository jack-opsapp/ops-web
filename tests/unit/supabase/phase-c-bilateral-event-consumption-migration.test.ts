import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = join(process.cwd(), "supabase/migrations");
const migrationName = readdirSync(migrationsDir).find((name) =>
  name.endsWith("_phase_c_bilateral_event_consumption.sql")
);
const migrationPath = join(migrationsDir, migrationName ?? "missing.sql");
const source = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8")
  : "";

describe("Phase C bilateral-event consumption migration", () => {
  it("adds an expiring lease, bounded retry state, and terminal notification readback", () => {
    expect(source).toContain("lease_owner text");
    expect(source).toContain("lease_expires_at timestamptz");
    expect(source).toContain("attempt_count integer");
    expect(source).toContain("next_attempt_at timestamptz");
    expect(source).toContain("notification_sent_at timestamptz");
    expect(source).toContain(
      "create or replace function public.claim_phase_c_bilateral_event_handoffs"
    );
    expect(source).toMatch(/for update skip locked/i);
    expect(source).toContain(
      "create or replace function public.fail_phase_c_bilateral_event_handoff"
    );
    expect(source).toContain(
      "create or replace function public.acknowledge_phase_c_bilateral_event_handoff"
    );
  });

  it("atomically rechecks every authority and ambiguity boundary before insert", () => {
    expect(source).toContain(
      "create or replace function public.consume_phase_c_bilateral_event_handoff"
    );
    expect(source).toContain("calendar_create_permission_missing");
    expect(source).toContain("event_owner_identity_mismatch");
    expect(source).toContain("event_attendees_unresolved");
    expect(source).toContain("event_timezone_unresolved");
    expect(source).toContain("event_location_unresolved");
    expect(source).toContain("event_time_conflict");
    expect(source).toContain("handoff_cancelled");
    expect(source).toMatch(
      /from public\.phase_c_bilateral_event_handoffs[\s\S]*?for update/i
    );
    expect(source).toMatch(
      /insert into public\.site_visits[\s\S]*?returning id into v_visit_id/i
    );
  });

  it("stores one source handoff on the canonical appointment and rejects duplicates", () => {
    expect(source).toContain("appointment_handoff_id uuid");
    expect(source).toContain("appointment_kind text");
    expect(source).toContain("appointment_title text");
    expect(source).toContain("appointment_location text");
    expect(source).toContain("appointment_attendees jsonb");
    expect(source).toMatch(
      /unique index[\s\S]*?site_visits_phase_c_handoff_key[\s\S]*?appointment_handoff_id/i
    );
    expect(source).toContain("canonical_event_kind = 'site_visit'");
    expect(source).toContain("status = 'consumed'");
  });

  it("preserves lead lifecycle and existing provider synchronization side effects", () => {
    expect(source).toContain("'site_visit_scheduled'");
    expect(source).toContain("perform public.move_opportunity_stage");
    expect(source).not.toContain(
      "insert into public.google_calendar_sync_queue"
    );
  });

  it("keeps all new functions service-role only with a pinned search path", () => {
    expect(source).toContain("coalesce(auth.role(), '') <> 'service_role'");
    expect(source).toMatch(/security definer[\s\S]*?set search_path = ''/i);
    expect(source).toMatch(
      /revoke all on function public\.consume_phase_c_bilateral_event_handoff[\s\S]*?from public, anon, authenticated/i
    );
    expect(source).toMatch(
      /grant execute on function public\.consume_phase_c_bilateral_event_handoff[\s\S]*?to service_role/i
    );
  });
});
