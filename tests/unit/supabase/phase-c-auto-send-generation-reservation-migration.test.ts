import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const baseMigrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260807213219_phase_c_auto_send_source_fence.sql"
);
const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260809183000_phase_c_auto_send_generation_reservations.sql"
);
const baseSql = existsSync(baseMigrationPath)
  ? readFileSync(baseMigrationPath, "utf8").toLowerCase()
  : "";
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

describe("Phase C auto-send generation reservation forward migration", () => {
  it("keeps the shipped source-fence migration immutable", () => {
    expect(existsSync(baseMigrationPath)).toBe(true);
    expect(baseSql).not.toContain("phase_c_auto_send_generation_reservations");
    expect(baseSql).not.toContain(
      "reserve_phase_c_auto_send_generation_as_system"
    );
    expect(baseSql).not.toContain("p_generation_token uuid");
  });

  it("installs the reservation contract only through a later migration", () => {
    expect(existsSync(migrationPath)).toBe(true);
    expect(sql.trim().startsWith("begin;")).toBe(true);
    expect(sql.trim().endsWith("commit;")).toBe(true);
    expect(compact).toContain(
      "create table private.phase_c_auto_send_generation_reservations"
    );
    expect(compact).toContain("arguments_hash text not null");
    expect(compact).toContain("generation_token uuid not null");
    expect(compact).toContain("generation_lease_expires_at timestamptz");
    expect(compact).not.toContain(
      "lock table public.pending_auto_sends in share row exclusive mode"
    );
    expect(compact).toContain(
      "company_id uuid not null references public.agent_control_plane_tenant_roots(company_id) on delete cascade"
    );
    expect(
      functionBody("public.reserve_phase_c_auto_send_generation_as_system")
    ).toContain("insert into public.agent_control_plane_tenant_roots");
    expect(compact).toContain(
      "insert into public.agent_control_plane_tenant_roots (company_id) select distinct fence.company_id from private.phase_c_auto_send_source_fences fence"
    );
    expect(compact).toContain(
      "drop constraint phase_c_auto_send_source_fences_company_id_fkey"
    );
    expect(compact).toContain(
      "add constraint phase_c_auto_send_source_fences_company_id_fkey foreign key (company_id) references public.agent_control_plane_tenant_roots(company_id) on delete cascade"
    );
  });

  it("retires the callable 28-argument overload before granting the fenced replacement", () => {
    expect(compact).toMatch(
      /revoke all on function public\.schedule_phase_c_auto_send_fenced\( text, uuid, uuid, bigint, uuid, uuid, uuid, uuid, text, text, text\[\], text\[\], text, text, text, text, text, uuid, text, text, uuid, text, text, timestamptz, text, uuid, text, integer \) from public, anon, authenticated, service_role;/
    );
    expect(compact).toMatch(
      /drop function public\.schedule_phase_c_auto_send_fenced\( text, uuid, uuid, bigint, uuid, uuid, uuid, uuid, text, text, text\[\], text\[\], text, text, text, text, text, uuid, text, text, uuid, text, text, timestamptz, text, uuid, text, integer \);/
    );
    expect(compact).toMatch(
      /grant execute on function public\.schedule_phase_c_auto_send_fenced\( text, uuid, uuid, bigint, uuid, uuid, uuid, uuid, text, text, text\[\], text\[\], text, text, text, text, text, uuid, text, text, uuid, text, text, timestamptz, text, uuid, text, integer, uuid, text \) to service_role;/
    );
  });

  it("recovers an expired source reservation across an assignment handoff", () => {
    const reserve = functionBody(
      "public.reserve_phase_c_auto_send_generation_as_system"
    );

    expect(reserve).toContain(
      "or ( reservation.company_id = p_company_id and reservation.connection_id = p_connection_id"
    );
    expect(reserve).toContain(
      "order by (reservation.idempotency_key = p_idempotency_key) desc"
    );
    expect(reserve).toContain("set idempotency_key = p_idempotency_key");
    expect(reserve).toContain("actor_user_id = p_actor_user_id");
    expect(reserve).toContain("assignment_version = p_assignment_version");
    expect(reserve).toContain("assignment_event_id = p_assignment_event_id");
    expect(reserve).toContain(
      "reservation.generation_lease_expires_at <= clock_timestamp()"
    );
    expect(reserve).toContain("'disposition', 'in_progress'");
    expect(reserve).toContain("'disposition', 'acquired'");
  });

  it("filters every operator identity while retaining exact external recipients", () => {
    const identity = functionBody("private.phase_c_email_is_operator_identity");
    const reserve = functionBody(
      "public.reserve_phase_c_auto_send_generation_as_system"
    );

    expect(identity).toContain("from public.email_connections connection");
    expect(identity).toContain(
      "where connection.company_id = p_company_id::text"
    );
    expect(identity).not.toContain("connection.id = p_connection_id");
    expect(identity).toContain("from public.companies company");
    expect(identity).toContain("from public.users company_user");
    expect(identity).toContain("from public.user_email_aliases alias");
    expect(identity).toContain("alias.status = 'verified'");
    expect(reserve).toContain(
      "from unnest(canonical_to) with ordinality recipient(email, ordinality) where not private.phase_c_email_is_operator_identity"
    );
    expect(reserve).toContain(
      "from unnest(canonical_cc) with ordinality recipient(email, ordinality) where not private.phase_c_email_is_operator_identity"
    );
    expect(reserve).toContain("if cardinality(canonical_to) = 0 then");
  });

  it("fails closed when provider occurrence time cannot order the latest source", () => {
    const reserve = functionBody(
      "public.reserve_phase_c_auto_send_generation_as_system"
    );
    const schedule = functionBody("public.schedule_phase_c_auto_send_fenced");
    const validate = functionBody(
      "public.validate_phase_c_auto_send_source_for_delivery"
    );
    const trigger = functionBody(
      "private.enforce_phase_c_auto_send_source_delivery_fence"
    );

    expect(reserve).toContain(
      "count(*) over (partition by activity.created_at)"
    );
    expect(reserve).toContain("phase_c_auto_send_source_ambiguous");
    expect(schedule).toContain(
      "count(*) over (partition by activity.created_at)"
    );
    expect(schedule).toContain("phase_c_auto_send_source_ambiguous");
    expect(validate).toContain("v_latest_timestamp_count = 1");
    expect(trigger).toContain("v_latest_timestamp_count is distinct from 1");
  });
});
