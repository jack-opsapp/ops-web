import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260807213219_phase_c_auto_send_source_fence.sql"
);
const sql = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8").toLowerCase()
  : "";
const compact = sql.replace(/\s+/g, " ");

function functionBody(name: string): string {
  const start = compact.indexOf(`create or replace function ${name}(`);
  if (start < 0) return "";
  const next = compact.indexOf("create or replace function ", start + 1);
  return compact.slice(start, next < 0 ? undefined : next);
}

describe("Phase C delayed auto-send source-fence migration", () => {
  it("persists one immutable source identity per queued send", () => {
    expect(existsSync(migrationPath)).toBe(true);
    expect(sql.trim().startsWith("begin;")).toBe(true);
    expect(sql.trim().endsWith("commit;")).toBe(true);
    expect(compact).toContain(
      "create table private.phase_c_auto_send_source_fences"
    );
    expect(compact).toContain(
      "pending_auto_send_id uuid primary key references public.pending_auto_sends(id)"
    );
    expect(compact).toContain(
      "source_activity_id uuid references public.activities(id)"
    );
    expect(compact).toContain("source_message_id text");
    expect(compact).toContain("generation_kind text not null");
    expect(compact).toContain("follow_up_sequence integer");
    expect(compact).toContain(
      "where generation_kind in ('conversation_reply', 'auto_follow_up')"
    );
  });

  it("serializes source-based scheduling and leaves the unfenced RPC private", () => {
    const schedule = functionBody("public.schedule_phase_c_auto_send_fenced");

    expect(schedule).toContain("pg_advisory_xact_lock");
    expect(schedule).toContain("hashtextextended");
    expect(schedule).toContain("p_generation_kind text");
    expect(schedule).toContain("p_source_activity_id uuid");
    expect(schedule).toContain("p_source_message_id text");
    expect(schedule).toContain("p_follow_up_sequence integer");
    expect(schedule).toContain("public.schedule_phase_c_auto_send(");
    expect(schedule).toContain(
      "insert into private.phase_c_auto_send_source_fences"
    );
    expect(compact).toMatch(
      /revoke all on function public\.schedule_phase_c_auto_send\([^;]+from public, anon, authenticated, service_role;/
    );
    expect(compact).toMatch(
      /grant execute on function public\.schedule_phase_c_auto_send_fenced\([^;]+to service_role;/
    );
    const preflight = functionBody(
      "public.find_phase_c_auto_send_by_identity_as_system"
    );
    expect(preflight).toContain("if not found then return null;");
  });

  it("checks the exact latest email activity at the database delivery transition", () => {
    const trigger = functionBody(
      "private.enforce_phase_c_auto_send_source_delivery_fence"
    );
    const validate = functionBody(
      "public.validate_phase_c_auto_send_source_for_delivery"
    );

    for (const body of [trigger, validate]) {
      expect(body).toContain("source_activity_id");
      expect(body).toContain("source_message_id");
      expect(body).toContain("from public.activities");
      expect(body).toContain("activity.email_connection_id");
      expect(body).toContain("activity.email_thread_id");
      expect(body).toContain(
        "order by activity.created_at desc, activity.id desc"
      );
    }
    expect(trigger).toContain("old.status = 'prepared'");
    expect(trigger).toContain("new.status = 'sending'");
    expect(trigger).toContain("email_send_phase_c_source_stale");
    expect(compact).toContain(
      "before update of status on public.email_send_intents"
    );
    expect(validate).toContain("p_lease_token uuid");
    expect(validate).toContain(
      "queue.lease_token is distinct from p_lease_token"
    );
    expect(validate).toContain("'current', v_current");
    expect(compact).toMatch(
      /grant execute on function public\.validate_phase_c_auto_send_source_for_delivery\([^;]+to service_role;/
    );
  });

  it("retires pre-migration delayed sends that cannot prove their source", () => {
    expect(compact).toContain(
      "lock table public.pending_auto_sends in share row exclusive mode"
    );
    expect(compact).toContain("phase_c_auto_send_source_fence_migration_busy");
    expect(compact).toContain("where queue.status = 'leased'");
    expect(compact).toContain("update public.pending_auto_sends queue");
    expect(compact).toContain("set status = 'cancelled'");
    expect(compact).toContain("phase_c_auto_send_source_fence_required");
    expect(compact).toContain("where queue.status in ('pending', 'leased')");
  });
});
