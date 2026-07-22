import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = join(process.cwd(), "supabase/migrations");
const migrationFile =
  "20260722210000_atomic_correspondence_event_projection.sql";
const applyRpcMigration =
  "20260721142000_email_lifecycle_monotonic_stage_guards.sql";

const source = readFileSync(join(migrationsDir, migrationFile), "utf8");

describe("atomic correspondence-event projection migration", () => {
  it("defines the new RPC as plpgsql security definer with a pinned search_path", () => {
    expect(source).toContain(
      "create or replace function public.record_opportunity_correspondence_event("
    );
    expect(source).toContain("language plpgsql");
    expect(source).toContain("security definer");
    expect(source).toContain("set search_path to 'public', 'pg_temp'");
  });

  it("gates execution to the service role", () => {
    expect(source).toContain(
      "if coalesce(auth.role(), '') <> 'service_role' then"
    );
    expect(source).toContain("using errcode = '42501'");
  });

  it("locks the opportunity FOR UPDATE before touching the event table", () => {
    const opportunityLock = `perform 1
  from public.opportunities opportunity
  where opportunity.id = p_opportunity_id
    and opportunity.company_id = p_company_id
    and opportunity.deleted_at is null
  for update;`;
    expect(source).toContain(opportunityLock);
    expect(source).toContain(
      "raise exception 'opportunity_not_found' using errcode = 'P0002'"
    );

    const lockIdx = source.indexOf(opportunityLock);
    const dedupeSelectIdx = source.indexOf(
      "from public.opportunity_correspondence_events event"
    );
    const insertIdx = source.indexOf(
      "insert into public.opportunity_correspondence_events ("
    );
    expect(lockIdx).toBeGreaterThan(-1);
    // Both the dedupe read and the insert are event work; the lock precedes
    // them so insert + projection commit or roll back as one unit.
    expect(dedupeSelectIdx).toBeGreaterThan(lockIdx);
    expect(insertIdx).toBeGreaterThan(lockIdx);
  });

  it("mirrors the TS findProviderMessageEvent dedupe predicate", () => {
    expect(source).toContain("event.company_id = p_company_id");
    expect(source).toContain("event.provider_message_id = p_provider_message_id");
    expect(source).toContain(
      "(p_connection_id is null or event.connection_id = p_connection_id)"
    );
  });

  it("fails closed when a replay changes immutable provider ownership", () => {
    expect(source).toContain(
      "v_existing_opportunity_id is distinct from p_opportunity_id"
    );
    expect(source).toContain(
      "v_existing_activity_id is distinct from p_activity_id"
    );
    expect(source).toContain(
      "v_existing_connection_id is distinct from p_connection_id"
    );
    expect(source).toContain(
      "v_existing_provider_thread_id is distinct from p_provider_thread_id"
    );
    expect(source).toContain(
      "v_existing_direction is distinct from p_direction"
    );
    expect(source).toContain(
      "raise exception 'correspondence_provider_identity_conflict'"
    );
  });

  it("inserts opportunity_projection_applied true and never writes false", () => {
    // Assert against executable SQL only — the header prose is allowed to name
    // the `opportunity_projection_applied = false` state it forbids.
    const code = source.replace(/--[^\n]*/g, "");
    // The column is inserted (durable ⇒ projected) …
    expect(code).toMatch(
      /insert into public\.opportunity_correspondence_events \([\s\S]*?opportunity_projection_applied[\s\S]*?\)\s*values/i
    );
    // … and the only assignment of the flag anywhere is `= true` (the repair
    // flip). No code path may persist it false — that was the outage state.
    expect(code).toContain("opportunity_projection_applied = true");
    expect(code).not.toContain("opportunity_projection_applied = false");
    expect(code).not.toMatch(/opportunity_projection_applied\s*:?=\s*false/i);
  });

  it("reproduces the canonical counter/timestamp projection math", () => {
    expect(source).toContain(
      "correspondence_count = coalesce(opportunity.correspondence_count, 0) + 1"
    );
    expect(source).toContain(
      "+ case when v_projection_direction = 'inbound' then 1 else 0 end"
    );
    expect(source).toContain(
      "+ case when v_projection_direction = 'outbound' then 1 else 0 end"
    );
    // The manual-stage lock is preserved, matching the current apply RPC — an
    // inbound is evidence, never permission to erase an operator's pin.
    expect(source).toContain(
      "stage_manually_set = opportunity.stage_manually_set"
    );
  });

  it("returns created + event_id alongside the apply-RPC counter columns", () => {
    expect(source).toMatch(
      /returns table \([\s\S]*?created boolean,[\s\S]*?event_id uuid,[\s\S]*?correspondence_count integer,[\s\S]*?assignment_version bigint,[\s\S]*?last_message_direction text\s*\)/i
    );
  });

  it("revokes public/anon/authenticated and grants execute to service_role", () => {
    expect(source).toMatch(
      /revoke all on function public\.record_opportunity_correspondence_event\([\s\S]*?\) from public, anon, authenticated/i
    );
    expect(source).toMatch(
      /grant execute on function public\.record_opportunity_correspondence_event\([\s\S]*?\) to service_role/i
    );
    expect(source).toContain("comment on function");
  });

  it("wraps the definition in a single begin/commit like its siblings", () => {
    expect(source).toContain("\nbegin;\n");
    expect(source.trimEnd().endsWith("commit;")).toBe(true);
  });

  it("orders after the apply RPC it supersedes as the canonical write path", () => {
    const migrations = readdirSync(migrationsDir)
      .filter((name) => name.endsWith(".sql"))
      .sort();
    const applyIdx = migrations.indexOf(applyRpcMigration);
    const atomicIdx = migrations.indexOf(migrationFile);
    expect(applyIdx).toBeGreaterThan(-1);
    expect(atomicIdx).toBeGreaterThan(applyIdx);
  });
});
