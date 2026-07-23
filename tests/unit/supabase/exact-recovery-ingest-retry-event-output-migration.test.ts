import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const originalMigrationPath = join(
  process.cwd(),
  "supabase/migrations/20260722120000_guarded_exact_email_message_reparent.sql"
);
const repairMigrationPath = join(
  process.cwd(),
  "supabase/migrations/20260723093000_exact_recovery_ingest_retry_event_output.sql"
);

const originalSource = readFileSync(originalMigrationPath, "utf8").toLowerCase();
const repairSource = existsSync(repairMigrationPath)
  ? readFileSync(repairMigrationPath, "utf8").toLowerCase()
  : "";

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function registerFunction(source: string): string {
  const normalized = source.toLowerCase();
  const start = normalized.indexOf(
    "create or replace function public.register_exact_message_recovery_work_as_system"
  );
  if (start < 0) return "";
  const end = normalized.indexOf("$function$;", start);
  if (end < 0) return "";
  return compact(normalized.slice(start, end + "$function$;".length));
}

const originalFunction = registerFunction(originalSource);
const repairedFunction = registerFunction(repairSource);

const workLock = compact(`
  select work.* into v_work
  from private.email_exact_message_recovery_work work
  where work.company_id = p_company_id
    and work.connection_id = p_connection_id
    and work.provider_message_id = p_provider_message_id
    and work.abandoned_at is null
  for update;
`);

const ingestEventOutputGuard = compact(`
  if v_work.action = 'ingest'
    and v_work.correspondence_event_id is not null
  then
    select event.* into v_event
    from public.opportunity_correspondence_events event
    where event.id = v_work.correspondence_event_id
      and event.company_id = p_company_id
      and event.connection_id = p_connection_id
      and event.provider_thread_id = p_provider_thread_id
      and event.provider_message_id = p_provider_message_id
      and event.activity_id is not distinct from v_work.activity_id
      and event.opportunity_id is not distinct from v_work.opportunity_id
      and event.opportunity_projection_applied is true
      and event.direction = 'inbound'
      and event.party_role = 'customer'
      and event.is_meaningful is true
    for share;
    if not found then
      raise exception 'recovery_ingest_persisted_event_identity_changed'
        using errcode = '40001';
    end if;
  end if;
`);

const unconditionalEventComparison = compact(`
  or v_work.correspondence_event_id is distinct from
    p_correspondence_event_id
`);

const actionScopedEventComparison = compact(`
  or (
    p_action <> 'ingest'
    and v_work.correspondence_event_id is distinct from
      p_correspondence_event_id
  )
`);

describe("exact recovery ingest retry event output repair", () => {
  it("accepts an ingest work row's guarded persisted event while keeping non-ingest retries exact", () => {
    expect(repairedFunction).toContain(ingestEventOutputGuard);
    expect(repairedFunction).toContain(actionScopedEventComparison);
    expect(repairedFunction).not.toContain(unconditionalEventComparison);
    expect(repairedFunction).toContain(
      "if p_action = 'ingest' then if p_attachment_required or p_repair_required or p_source_opportunity_id is not null or p_target_opportunity_id is not null or p_correspondence_event_id is not null"
    );
  });

  it("preserves the complete authorization and identity contract around the narrow retry repair", () => {
    const expected = originalFunction
      .replace(workLock, `${workLock} ${ingestEventOutputGuard}`)
      .replace(unconditionalEventComparison, actionScopedEventComparison);

    expect(repairedFunction).toBe(expected);
  });

  it("remains transactional and service-role only", () => {
    const executable = repairSource.replace(/--[^\n]*/g, "").trim();
    expect(executable.startsWith("begin;")).toBe(true);
    expect(repairSource.trim().endsWith("commit;")).toBe(true);
    expect(repairedFunction).toContain(
      "if (select auth.role()) is distinct from 'service_role' then"
    );
    expect(compact(repairSource)).toMatch(
      /revoke all on function public\.register_exact_message_recovery_work_as_system\([^)]*\) from public, anon, authenticated, service_role/
    );
    expect(compact(repairSource)).toMatch(
      /grant execute on function public\.register_exact_message_recovery_work_as_system\([^)]*\) to service_role/
    );
  });
});
