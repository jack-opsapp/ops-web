import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260715160500_lead_assignment_scoped_rls.sql"
);

const source = readFileSync(migrationPath, "utf8");

function body(name: string): string {
  const marker = `create or replace function ${name}`;
  const lower = source.toLowerCase();
  const start = lower.lastIndexOf(marker);
  expect(start, `${name} missing`).toBeGreaterThanOrEqual(0);
  const next = lower.indexOf(
    "create or replace function ",
    start + marker.length
  );
  return next === -1 ? source.slice(start) : source.slice(start, next);
}

describe("lead conversion authorization migration", () => {
  it("blocks legacy manage fallback for every same-company granular override row", () => {
    const compatibility = body("private.should_use_pipeline_manage_compat");
    expect(compatibility).toMatch(/public\.user_permission_overrides/i);
    expect(compatibility).toMatch(/upo\.user_id = p_actor_user_id/i);
    expect(compatibility).toMatch(/upo\.company_id = p_actor_company_id/i);
    expect(compatibility).toMatch(/upo\.permission = p_permission/i);
    expect(compatibility).not.toMatch(
      /not upo\.granted or upo\.scope is not null/i
    );
  });

  it("adds private actor-aware project helpers with fixed definer paths and no runtime grants", () => {
    for (const action of ["view", "edit", "link_opportunity_to"]) {
      const name = `private.user_can_${action}_project`;
      expect(source).toMatch(
        new RegExp(
          `create or replace function ${name.replaceAll(".", "\\.")}\\(\\s*p_actor_user_id uuid,\\s*p_project_id uuid\\s*\\) returns boolean`,
          "i"
        )
      );
      expect(body(name)).toMatch(/stable security definer/i);
      expect(body(name)).toMatch(
        /set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'/i
      );
      expect(source).toMatch(
        new RegExp(
          `revoke all on function ${name.replaceAll(".", "\\.")}\\(uuid, uuid\\)\\s+from public, anon, authenticated, service_role`,
          "i"
        )
      );
    }
  });

  it("keeps assigned project view broader than edit and never treats project metadata as membership", () => {
    const view = body("private.user_can_view_project");
    const edit = body("private.user_can_edit_project");
    expect(view).toMatch(/public\.project_tasks[\s\S]*?team_member_ids/i);
    expect(view).toMatch(/public\.project_notes[\s\S]*?mentioned_user_ids/i);
    expect(edit).toMatch(/public\.project_tasks[\s\S]*?team_member_ids/i);
    expect(edit).not.toMatch(/project_notes|mentioned_user_ids/i);
    expect(view + edit).not.toMatch(/projects\.created_by|p\.created_by/i);
    expect(view + edit).not.toMatch(/p\.team_member_ids/i);
    expect(body("private.user_can_link_opportunity_to_project")).toMatch(
      /user_can_view_project[\s\S]*?user_can_edit_project/i
    );
  });

  it("accepts only exact relational email evidence and malformed UUIDs fail closed", () => {
    const validator = body(
      "private.valid_actorless_opportunity_conversion_evidence"
    );
    expect(validator).toMatch(/p_source_path = 'email_accept'/i);
    expect(validator).toMatch(/p_source_path = 'email_likely_won'/i);
    expect(validator).toMatch(/private\.try_parse_uuid/i);
    expect(validator).toMatch(/public\.email_connections/i);
    expect(validator).toMatch(/sync_enabled is true[\s\S]*?status = 'active'/i);
    expect(validator).toMatch(/public\.email_threads/i);
    expect(validator).toMatch(/public\.opportunity_correspondence_events/i);
    expect(validator).toMatch(/provider_message_id/i);
    expect(validator).toMatch(/event\.direction = 'inbound'/i);
    expect(validator).toMatch(/event\.party_role = 'customer'/i);
    expect(validator).toMatch(/event\.is_meaningful is true/i);
    expect(validator).not.toMatch(
      /email_connections[^;]*\.email\s*=|users[^;]*\.email/i
    );
  });

  it("overrides conversion after locking with canonical human and system authorization", () => {
    const conversion = body("public.convert_opportunity_to_project");
    const lock = conversion.search(
      /from public\.opportunities[\s\S]*?for update/i
    );
    const humanAuth = conversion.search(
      /private\.user_can_convert_opportunity\(\s*v_actor_user_id,\s*p_opportunity_id/i
    );
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(humanAuth).toBeGreaterThan(lock);
    expect(conversion).toMatch(
      /p_source_path not in \('won_dialog', 'approval_queue'\)/i
    );
    expect(conversion).toMatch(
      /p_source_path not in \('email_accept', 'email_likely_won'\)/i
    );
    expect(conversion).toMatch(
      /p_expected_assignment_version is null[\s\S]*?< 0/i
    );
    expect(conversion).toMatch(/assignment_snapshot_mismatch/i);
    expect(conversion).toMatch(/snapshot_mismatch/i);
    expect(conversion).toMatch(/project_link_unavailable/i);
    expect(conversion).toMatch(/project_accessible/i);
    expect(conversion).toMatch(/assigned_to/i);
    expect(conversion).toMatch(/assignment_version/i);
  });

  it("rechecks actorless manual-stage protection after the opportunity lock", () => {
    const conversion = body("public.convert_opportunity_to_project");
    const lock = conversion.search(
      /from public\.opportunities[\s\S]*?for update/i
    );
    const manualGuard = conversion.search(
      /v_actor_user_id is null[\s\S]*?stage_manually_set[\s\S]*?'manual_stage_override'/i
    );
    const core = conversion.search(
      /private\.execute_opportunity_conversion_core/i
    );

    expect(lock).toBeGreaterThanOrEqual(0);
    expect(manualGuard).toBeGreaterThan(lock);
    expect(core).toBeGreaterThan(manualGuard);
  });

  it("replaces the old preflight overload with actor-scoped, project-authorized output", () => {
    expect(source).toMatch(
      /drop function if exists public\.get_conversion_preflight\(uuid, uuid\)/i
    );
    expect(source).toMatch(
      /create or replace function public\.get_conversion_preflight\(\s*p_opportunity_id uuid,\s*p_company_id uuid default null[^,]*,\s*p_actor_user_id uuid default null/i
    );
    const preflight = body("public.get_conversion_preflight");
    expect(preflight).toMatch(/security definer/i);
    expect(preflight).toMatch(/private\.user_can_convert_opportunity/i);
    expect(preflight).toMatch(/private\.user_can_view_project/i);
    expect(preflight).toMatch(/private\.user_can_link_opportunity_to_project/i);
    expect(preflight).toMatch(/'assignment_version'/i);
    expect(preflight).toMatch(/'already_converted'/i);
    expect(preflight).toMatch(/'project_accessible'/i);
    expect(preflight).not.toMatch(
      /client_id\s*=\s*[^\n]*or|client_id[^;]*authoriz/i
    );
    expect(source).toMatch(
      /revoke all on function public\.get_conversion_preflight\(uuid, uuid, uuid\)[\s\S]*?grant execute[\s\S]*?to authenticated, service_role/i
    );
  });

  it("short-circuits inaccessible linked-project preflight before sibling discovery", () => {
    const preflight = body("public.get_conversion_preflight");
    const recovery = preflight.search(
      /if v_project_id is not null\s+and not v_project_accessible\s+then[\s\S]*?'existing_linked_project', null[\s\S]*?'duplicate_candidates', '\[\]'::jsonb[\s\S]*?'other_client_projects', '\[\]'::jsonb[\s\S]*?return/i
    );
    const siblingDiscovery = preflight.search(
      /select coalesce\(jsonb_agg\(candidate\.payload/i
    );

    expect(recovery).toBeGreaterThanOrEqual(0);
    expect(siblingDiscovery).toBeGreaterThan(recovery);
  });

  it("does not staff projects or generated tasks", () => {
    const conversion = body("public.convert_opportunity_to_project");
    expect(conversion).not.toMatch(
      /array\[\s*v_actor_user_id|array\[\s*p_decided_by/i
    );
    expect(conversion).not.toMatch(/team_member_ids\s*=\s*array\[[^\]]+\]/i);
  });
});
