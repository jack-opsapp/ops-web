import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260715181500_project_status_authorization_outbox.sql"
  ),
  "utf8"
).toLowerCase();

describe("project status authorization and lifecycle outbox migration", () => {
  it("blocks direct archive writes without the dedicated permission", () => {
    expect(source).toContain("create policy project_archive_write_scope");
    expect(source).toMatch(
      /status <> 'archived'[\s\S]*?has_permission\([\s\S]*?'projects\.archive'[\s\S]*?'all'/
    );
    expect(source).toMatch(
      /change_project_status[\s\S]*?p_new_status = 'archived'[\s\S]*?'projects\.archive'/
    );
  });

  it("offers a service-only actor-aware status bridge", () => {
    expect(source).toContain(
      "create or replace function public.resolve_project_status_notification_as_system"
    );
    expect(source).toMatch(
      /resolve_project_status_notification_as_system[\s\S]*?event\.actor_user_id = p_actor_user_id[\s\S]*?project\.status_version = event\.project_status_version/
    );
    const resolverStart = source.indexOf(
      "create or replace function public.resolve_project_status_notification_as_system("
    );
    const resolverEnd = source.indexOf(
      "revoke all on function public.resolve_project_status_notification_as_system",
      resolverStart
    );
    const resolver = source.slice(resolverStart, resolverEnd);
    expect(resolver).not.toContain(
      "private.user_can_edit_project(p_actor_user_id, p_project_id)"
    );
    expect(resolver).toContain(
      "private.user_can_view_project(\n            recipient.id,\n            project.id"
    );
    expect(source).toMatch(
      /grant execute on function public\.resolve_project_status_notification_as_system\(uuid, uuid, uuid\)[\s\S]*?to service_role/
    );
    expect(source).toContain(
      "create or replace function public.change_project_status_as_system"
    );
    expect(source).toContain(
      "private.user_can_edit_project(p_actor_user_id, p_project_id)"
    );
    const serviceBridgeStart = source.lastIndexOf(
      "create or replace function public.change_project_status_as_system("
    );
    const serviceBridgeEnd = source.indexOf(
      "revoke all on function public.change_project_status_as_system",
      serviceBridgeStart
    );
    const serviceBridge = source.slice(serviceBridgeStart, serviceBridgeEnd);
    expect(serviceBridge).toContain(
      "private.user_can_edit_project(p_actor_user_id, p_project_id)"
    );
    expect(serviceBridge).not.toContain(
      "private.current_user_can_edit_project("
    );
    expect(source).toMatch(
      /select \* into v_project[\s\S]*?for update;[\s\S]*?private\.user_can_edit_project\(p_actor_user_id, p_project_id\)[\s\S]*?projects\.archive/
    );
    expect(source).toMatch(
      /change_project_status_as_system\([\s\S]*?p_expected_updated_at timestamptz,[\s\S]*?p_expected_status text[\s\S]*?v_project\.updated_at is distinct from p_expected_updated_at[\s\S]*?v_project\.status is distinct from p_expected_status/
    );
    expect(serviceBridge).toContain(
      "private.lock_lead_assignment_company(v_company_id)"
    );
  });

  it("queues every real status transition in the mutation transaction", () => {
    expect(source).toContain(
      "create table if not exists public.project_status_lifecycle_outbox"
    );
    expect(source).toContain("after update of status on public.projects");
    expect(source).toContain("when (old.status is distinct from new.status)");
    expect(source).toContain(
      "insert into public.project_status_lifecycle_outbox"
    );
    expect(source).toContain("project_status_version bigint not null");
    expect(source).toContain("private.bump_project_status_version()");
    expect(source).not.toContain("unique (project_id, project_updated_at)");
    expect(source).not.toContain(
      "on conflict (project_id, project_updated_at) do nothing"
    );
    expect(source).toContain("project_notes_status_lifecycle_event_unique");
    expect(source).toContain("project_notes_guard_status_lifecycle");
    expect(source).toContain("notifications_project_status_event_unique");
    expect(source).toContain("agent_actions_project_status_event_unique");
    expect(source).toMatch(
      /v_project\.status is not distinct from p_new_status[\s\S]*?'changed', false/
    );
    expect(source).toMatch(/'changed', true/);
  });

  it("uses leased service-only claim, complete, and retry operations", () => {
    expect(source).toContain("for update skip locked");
    expect(source).toContain("claim_project_status_lifecycle_events");
    expect(source).toContain("complete_project_status_lifecycle_event");
    expect(source).toContain("fail_project_status_lifecycle_event");
    expect(source).toContain("event.attempts < 10");
    expect(source).toContain(
      "terminalize_expired_project_status_lifecycle_events"
    );
    expect(source).toContain("get diagnostics v_terminalized = row_count");
  });
});
