import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260730162648_pipeline_follow_up_reliability.sql"
  ),
  "utf8"
);
const hardeningSql = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260730162910_pipeline_follow_up_reliability_acl_and_fk_indexes.sql"
  ),
  "utf8"
);
const conflictTargetRepairPath = join(
  process.cwd(),
  "supabase/migrations/20260730220000_fix_manual_outbound_follow_up_conflict_target.sql"
);

function reconciliationFunction(sqlText: string): string {
  const start = sqlText.indexOf(
    "create or replace function public.reconcile_manual_outbound_follow_up_cycle_as_system("
  );
  const end = sqlText.indexOf("\nrevoke all on function", start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return sqlText.slice(start, end).replace(/\s+/g, " ").trim();
}

describe("pipeline follow-up reliability migration", () => {
  it("adds an exact, service-only commercial-outcome recovery identity", () => {
    expect(sql).toContain("add column opportunity_id uuid");
    expect(sql).toContain("'commercial_outcome'");
    expect(sql).toContain("commercial_outcome_recovery_authorization_changed");
    expect(sql).toContain("commercial_outcome_recovered");
    expect(sql).toContain("service_role_required");
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("revoke all on table");
  });

  it("idempotently satisfies only a canonical meaningful manual outbound cycle", () => {
    expect(sql).toContain(
      "create table public.opportunity_manual_outbound_cycle_receipts"
    );
    expect(sql).toContain(
      "reconcile_manual_outbound_follow_up_cycle_as_system"
    );
    expect(sql).toContain("candidate.source = 'sync_activity'");
    expect(sql).toContain("candidate.direction = 'outbound'");
    expect(sql).toContain("candidate.party_role = 'ops'");
    expect(sql).toContain("candidate.is_meaningful = true");
    expect(sql).toContain("candidate.opportunity_projection_applied = true");
    expect(sql).toContain("thread.opportunity_id = opportunity.id");
    expect(sql).toContain("event.occurred_at >= opportunity.next_follow_up_at");
    expect(sql).toContain("follow_up_after_days");
    expect(sql).toContain("on conflict (correspondence_event_id) do nothing");
  });

  it("rechecks the current cycle at the prepared-to-sending database boundary", () => {
    expect(sql).toContain("LEAD_FOLLOW_UP_CYCLE_ALREADY_SATISFIED");
    expect(sql).toContain(
      "source_event.occurred_at >= opportunity.next_follow_up_at"
    );
    expect(sql).toContain(
      "opportunity.next_follow_up_at < opportunity.stage_entered_at"
    );
    expect(sql).toContain(
      "opportunity.last_outbound_at >= opportunity.next_follow_up_at"
    );
  });

  it("revokes direct trigger execution and covers every new foreign key", () => {
    expect(hardeningSql).toContain(
      "revoke all on function private.guard_template_follow_up_cycle()"
    );
    expect(hardeningSql).toContain(
      "email_ingestion_recovery_queue_opportunity_idx"
    );
    expect(hardeningSql).toContain(
      "opportunity_manual_outbound_cycle_receipts_correspondence_idx"
    );
    expect(hardeningSql).toContain(
      "opportunity_manual_outbound_cycle_receipts_activity_idx"
    );
  });

  it("targets the exact receipt constraint without colliding with the RPC output name", () => {
    expect(
      existsSync(conflictTargetRepairPath),
      "the forward repair migration must exist"
    ).toBe(true);
    const repairSql = readFileSync(conflictTargetRepairPath, "utf8");

    expect(repairSql).toContain(
      "on conflict on constraint opportunity_manual_outbound_cycle_r_correspondence_event_id_key do nothing"
    );
    expect(repairSql).not.toContain(
      "on conflict (correspondence_event_id) do nothing"
    );
    const expectedFunction = reconciliationFunction(sql).replace(
      "on conflict (correspondence_event_id) do nothing",
      "on conflict on constraint opportunity_manual_outbound_cycle_r_correspondence_event_id_key do nothing"
    );
    expect(reconciliationFunction(repairSql)).toBe(expectedFunction);
    expect(repairSql).toContain(
      "from public, anon, authenticated, service_role"
    );
    expect(repairSql).toContain("to service_role");
  });
});
