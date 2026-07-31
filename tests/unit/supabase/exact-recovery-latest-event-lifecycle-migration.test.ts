import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260729170000_exact_recovery_latest_event_lifecycle.sql"
);
const migrationExists = existsSync(migrationPath);
const source = migrationExists ? readFileSync(migrationPath, "utf8") : "";
const compact = source.toLowerCase().replace(/\s+/g, " ");

describe("latest-event exact-recovery lifecycle guard", () => {
  it("allows a passive exact latest event only when a prior meaningful projection remains", () => {
    expect(migrationExists).toBe(true);
    expect(compact).toContain(
      "create or replace function private.assert_exact_message_lifecycle_recomputable"
    );
    expect(compact).toContain("event.id <> v_context_event_id");
    expect(compact).toContain("into v_projected_latest_event_id");
    expect(compact).toContain(
      "v_state.last_meaningful_event_id is not distinct from v_context_event_id"
    );
    expect(compact).toContain(
      "v_state.last_meaningful_at is not distinct from v_context_event_occurred_at"
    );
    expect(compact).toContain(
      "v_state.last_meaningful_direction is not distinct from v_context_event_direction"
    );
    expect(compact).toContain(
      "v_projected_latest_event_id is not null"
    );
    expect(compact).toContain(
      "v_latest_active_notification_created_at is null"
    );
  });

  it("preserves the non-passive, active-notification, and historical-event fail-closed fences", () => {
    for (const guard of [
      "v_state.unanswered_follow_up_count <> 0",
      "v_state.second_follow_up_sent_at is not null",
      "v_state.operator_follow_up_miss_at is not null",
      "v_state.stale_status is not null",
      "v_state.stale_status_at is not null",
      "v_state.protected_until is not null",
      "from public.opportunity_follow_up_drafts draft",
      "from public.opportunity_lifecycle_action_audit action",
      "action.status = 'applied'",
      "exact_recovery_lifecycle_not_reconstructible",
    ]) {
      expect(compact).toContain(guard);
    }
    expect(compact).toContain(
      "private.exact_recovery_notification_history_is_inert("
    );
    expect(compact).toContain(
      "v_latest_event_id is distinct from v_context_event_id"
    );
    expect(compact).toContain(
      "v_state.last_meaningful_event_id is not distinct from v_latest_event_id"
    );
  });

  it("keeps the helper inaccessible and the migration transactional", () => {
    const executable = source.replace(/--[^\n]*/g, "").trim().toLowerCase();
    expect(executable.startsWith("begin;")).toBe(true);
    expect(executable.endsWith("commit;")).toBe(true);
    expect(compact).toMatch(
      /revoke all on function private\.assert_exact_message_lifecycle_recomputable\(\s*uuid,\s*uuid\s*\) from public, anon, authenticated, service_role/
    );
    expect(compact).toContain(
      "lock table public.opportunity_lifecycle_action_audit, public.opportunity_lifecycle_state, public.opportunity_follow_up_drafts, public.notifications in share row exclusive mode"
    );
  });
});
