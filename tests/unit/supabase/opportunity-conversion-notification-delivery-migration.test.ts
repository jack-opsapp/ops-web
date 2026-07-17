import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260715181700_opportunity_conversion_notification_delivery.sql"
);

function sql(): string {
  expect(
    existsSync(migrationPath),
    "conversion delivery migration missing"
  ).toBe(true);
  return readFileSync(migrationPath, "utf8").toLowerCase();
}

function functionBody(source: string, name: string): string {
  const marker = `create or replace function ${name}`;
  const start = source.indexOf(marker);
  expect(start, `${name} missing`).toBeGreaterThanOrEqual(0);
  const next = source.indexOf(
    "create or replace function ",
    start + marker.length
  );
  return next === -1 ? source.slice(start) : source.slice(start, next);
}

describe("opportunity conversion notification delivery migration", () => {
  it("creates an immutable recipient-addressed delivery outbox keyed to the conversion event", () => {
    const source = sql();

    expect(source).toContain(
      "create table public.opportunity_conversion_notification_deliveries"
    );
    expect(source).toMatch(
      /conversion_event_id uuid not null references public\.opportunity_conversion_events \(id\) on delete restrict/
    );
    expect(source).toMatch(
      /recipient_user_id uuid not null references public\.users \(id\) on delete restrict/
    );
    expect(source).toMatch(/actor_user_id uuid references public\.users/);
    expect(source).toContain("assignment_version bigint not null");
    expect(source).toMatch(/unique \(conversion_event_id, recipient_user_id\)/);
    expect(source).toMatch(
      /alter table public\.opportunity_conversion_notification_deliveries\s+enable row level security/
    );
    expect(source).toMatch(
      /revoke all on table public\.opportunity_conversion_notification_deliveries[\s\S]*from public, anon, authenticated, service_role/
    );
    expect(source).toContain(
      "private.guard_opportunity_conversion_notification_delivery"
    );
    expect(source).toMatch(
      /raise exception 'conversion notification deliveries are immutable'/
    );
  });

  it("enqueues from the immutable conversion event while the canonical assignment snapshot still matches", () => {
    const source = sql();
    const enqueue = functionBody(
      source,
      "private.enqueue_opportunity_conversion_notification_delivery"
    );

    expect(source).toMatch(
      /create trigger opportunity_conversion_events_enqueue_notification[\s\S]*after insert on public\.opportunity_conversion_events/
    );
    expect(enqueue).toContain("new.event_type <> 'converted_to_project'");
    expect(enqueue).toMatch(
      /from public\.opportunities opportunity[\s\S]*for key share/
    );
    expect(enqueue).toContain(
      "opportunity.assignment_version is distinct from new.assignment_version"
    );
    expect(enqueue).toContain(
      "opportunity.project_ref is distinct from new.project_id"
    );
    expect(enqueue).toMatch(
      /from public\.projects project[\s\S]*project\.opportunity_ref is distinct from new\.opportunity_id/
    );
    expect(enqueue).toMatch(/if opportunity\.assigned_to is null[\s\S]*?then/);
    expect(enqueue).toMatch(
      /new\.actor_user_id is not null\s+and opportunity\.assigned_to = new\.actor_user_id/
    );
    expect(enqueue).toContain(
      "insert into public.opportunity_conversion_notification_deliveries"
    );
    expect(enqueue).toContain("new.actor_user_id");
    expect(enqueue).toContain("opportunity.assigned_to");
    expect(enqueue).toContain(
      "on conflict (conversion_event_id, recipient_user_id) do nothing"
    );
    expect(enqueue).not.toContain("email_connections");
    expect(enqueue).not.toMatch(/email|login/);
  });

  it("claims one fenced lease and derives copy plus navigation only after current access checks", () => {
    const claim = functionBody(
      sql(),
      "public.claim_opportunity_conversion_notification_deliveries"
    );

    expect(claim).toContain("auth.role() is distinct from 'service_role'");
    expect(claim).toContain("for update of candidate skip locked");
    expect(claim).toContain(
      "user_row.company_id is distinct from delivery.company_id"
    );
    expect(claim).toContain("user_row.deleted_at is not null");
    expect(claim).toContain("not coalesce(user_row.is_active, false)");
    expect(claim).toContain("private.user_can_view_opportunity(");
    expect(claim).toContain("private.user_can_view_project(");
    expect(claim).toContain("'lead converted'");
    expect(claim).toContain("'lead converted to project'");
    expect(claim).toContain("'/dashboard?openproject='");
    expect(claim).toContain("'/pipeline?opportunityid='");
    expect(claim).toContain("'view project'");
    expect(claim).toContain("'view lead'");
    expect(claim).toContain("'lead_converted'");
    expect(claim).toContain("'project'");
    expect(claim).toContain("'lead'");
    expect(claim).toContain("on conflict do nothing");
    expect(claim).toContain("v_lease_token := gen_random_uuid()");
  });

  it("serializes access checks in canonical company-first lock order", () => {
    const source = sql();
    const claim = functionBody(
      source,
      "public.claim_opportunity_conversion_notification_deliveries"
    );
    const complete = functionBody(
      source,
      "public.complete_opportunity_conversion_notification_delivery"
    );

    for (const body of [claim, complete]) {
      const companyKey = body.indexOf("into v_company_id");
      const advisory = body.indexOf(
        "private.lock_lead_assignment_company(v_company_id)"
      );
      const companyRow = body.indexOf("from public.companies company");
      const deliveryLock = body.indexOf("for update", companyRow);
      const opportunityLock = body.indexOf(
        "from public.opportunities opportunity_row",
        deliveryLock
      );
      const projectLock = body.indexOf(
        "from public.projects project_row",
        deliveryLock
      );

      expect(companyKey).toBeGreaterThanOrEqual(0);
      expect(advisory).toBeGreaterThan(companyKey);
      expect(companyRow).toBeGreaterThan(advisory);
      expect(deliveryLock).toBeGreaterThan(companyRow);
      expect(opportunityLock).toBeGreaterThan(deliveryLock);
      expect(projectLock).toBeGreaterThan(deliveryLock);
      expect(body.slice(opportunityLock, projectLock)).toContain("for share");
      expect(body.slice(projectLock)).toContain("for share");
      expect(body).not.toContain("conversion delivery company is unavailable");
    }
  });

  it("keeps the rail authoritative while project-update preferences gate push only", () => {
    const claim = functionBody(
      sql(),
      "public.claim_opportunity_conversion_notification_deliveries"
    );

    expect(claim).toContain("preferences.user_id = delivery.recipient_user_id");
    expect(claim).toContain("preferences.company_id = delivery.company_id");
    expect(claim).not.toContain(
      "preferences.user_id = delivery.recipient_user_id::text"
    );
    expect(claim).not.toContain(
      "preferences.company_id = delivery.company_id::text"
    );
    expect(claim).toContain("v_project_id := delivery.project_id::text");
    expect(claim).toContain("'{project_updates,push}'");
    expect(claim).toContain("v_wants_push");
    expect(claim).toContain(
      "v_should_push := v_wants_push and coalesce(preference.push_enabled, true)"
    );
    expect(claim).not.toContain("v_wants_email");
    expect(claim).not.toContain("disposition = 'no_action'");
  });

  it("rechecks the leased recipient and exact notification proof before completion", () => {
    const complete = functionBody(
      sql(),
      "public.complete_opportunity_conversion_notification_delivery"
    );

    expect(complete).toContain("auth.role() is distinct from 'service_role'");
    expect(complete).toContain("for update");
    expect(complete).toContain("lease_token is distinct from p_lease_token");
    expect(complete).toContain("private.user_can_view_opportunity(");
    expect(complete).toContain("private.user_can_view_project(");
    expect(complete).toContain("public.notifications");
    expect(complete).toContain("notification_id");
    expect(complete).toContain("conversion-notification-delivery:");
    expect(complete).toContain(
      "expected_project_id := delivery.project_id::text"
    );
    expect(complete).toContain("resolved_at = now()");
    expect(complete).toContain(
      "resolution_reason = 'conversion_delivery_suppressed'"
    );
  });

  it("persists bounded retries and exposes worker mutations only to service role", () => {
    const source = sql();
    const fail = functionBody(
      source,
      "public.fail_opportunity_conversion_notification_delivery"
    );

    expect(fail).toContain("auth.role() is distinct from 'service_role'");
    expect(fail).toContain("lease_token is distinct from p_lease_token");
    expect(fail).toContain("p_retryable");
    expect(fail).toContain("max_attempts");
    expect(fail).toContain("power(");
    expect(fail).toContain("terminal_at");

    for (const signature of [
      "claim_opportunity_conversion_notification_deliveries(uuid, integer)",
      "complete_opportunity_conversion_notification_delivery(uuid, uuid, text)",
      "fail_opportunity_conversion_notification_delivery(uuid, uuid, text, boolean)",
    ]) {
      expect(source).toContain(`revoke all on function public.${signature}`);
      expect(source).toContain(
        `grant execute on function public.${signature} to service_role`
      );
    }
  });
});
