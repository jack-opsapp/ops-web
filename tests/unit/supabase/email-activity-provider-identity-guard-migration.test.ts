import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260721126000_email_activity_provider_identity_guard.sql"
);

function sql(): string {
  return existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
}

describe("email activity provider identity guard migration", () => {
  it("fails closed when a new email activity omits mailbox or provider identity", () => {
    const source = sql();

    expect(source).toMatch(
      /create or replace function public\.require_email_activity_provider_identity\(\)\s*returns trigger/i
    );
    expect(source).toMatch(/if new\.type::text = 'email'/i);
    expect(source).toMatch(/new\.email_connection_id is null/i);
    expect(source).toMatch(
      /nullif\(btrim\(new\.email_message_id\), ''\) is null/i
    );
    expect(source).toMatch(
      /nullif\(btrim\(new\.email_thread_id\), ''\) is null/i
    );
    expect(source).toMatch(/using errcode = '23514'/i);
    expect(source).toMatch(
      /new\.email_message_id is distinct from btrim\(new\.email_message_id\)/i
    );
    expect(source).toMatch(
      /new\.email_thread_id is distinct from btrim\(new\.email_thread_id\)/i
    );
  });

  it("proves the mailbox belongs to the activity company without casting legacy text", () => {
    const source = sql();

    expect(source).toMatch(
      /from public\.email_connections connection[\s\S]*join public\.companies company[\s\S]*company\.id::text = connection\.company_id[\s\S]*connection\.id = new\.email_connection_id/i
    );
    expect(source).toMatch(
      /v_connection_company_id is distinct from new\.company_id/i
    );
    expect(source).not.toMatch(/connection\.company_id::uuid/i);
  });

  it("guards future inserts and provider-identity rewrites without validating legacy rows", () => {
    const source = sql();

    expect(source).toMatch(
      /create trigger activities_require_provider_identity_on_insert\s+before insert on public\.activities/i
    );
    expect(source).toMatch(
      /create trigger activities_require_provider_identity_on_identity_update\s+before update of[\s\S]*email_connection_id[\s\S]*email_message_id[\s\S]*email_thread_id[\s\S]*on public\.activities/i
    );
    expect(source).not.toMatch(/update\s+public\.activities/i);
    expect(source).not.toMatch(/validate constraint/i);
  });

  it("allows only the exact one-time quarantine rewrite", () => {
    const source = sql();

    expect(source).toMatch(
      /if tg_op = 'UPDATE'[\s\S]*old\.type::text = 'email'[\s\S]*new\.email_connection_id is not distinct from old\.email_connection_id[\s\S]*new\.company_id is not distinct from old\.company_id[\s\S]*new\.email_message_id is not distinct from old\.email_message_id[\s\S]*new\.email_thread_id = 'legacy:' \|\| old\.email_thread_id[\s\S]*return new/i
    );
    expect(source).toMatch(
      /new\.email_thread_id = 'legacy:' \|\| old\.email_thread_id/i
    );
    expect(source).toMatch(
      /left\(old\.email_thread_id, length\('legacy:'\)\) <> 'legacy:'/i
    );
    expect(source).not.toMatch(/like\s+'legacy:%'[\s\S]*return new/i);
    expect(source).toMatch(
      /v_request_role is distinct from 'service_role'[\s\S]*email activity quarantine requires trusted service transport/i
    );
  });

  it("makes established provider identity and email type immutable", () => {
    const source = sql();

    expect(source).toMatch(
      /if old\.type::text = 'email'[\s\S]*new\.type::text is distinct from 'email'[\s\S]*email activity type is immutable/i
    );
    expect(source).toMatch(
      /if old\.type::text is distinct from 'email'[\s\S]*new\.type::text = 'email'[\s\S]*email activity type is immutable/i
    );
    expect(source).toMatch(
      /new\.company_id is distinct from old\.company_id[\s\S]*or new\.email_connection_id is distinct from old\.email_connection_id[\s\S]*or new\.email_message_id is distinct from old\.email_message_id[\s\S]*or new\.email_thread_id is distinct from old\.email_thread_id[\s\S]*email activity provider identity is immutable/i
    );
  });

  it("allows a null-connection legacy claim only with unchanged identity and deterministic mailbox proof", () => {
    const source = sql();

    expect(source).toMatch(
      /old\.email_connection_id is null[\s\S]*new\.email_connection_id is not null[\s\S]*new\.company_id is not distinct from old\.company_id[\s\S]*new\.email_message_id is not distinct from old\.email_message_id[\s\S]*new\.email_thread_id is not distinct from old\.email_thread_id/i
    );
    expect(source).toMatch(
      /from public\.opportunity_correspondence_events event[\s\S]*event\.activity_id = old\.id[\s\S]*event\.connection_id is not null/i
    );
    expect(source).toMatch(
      /count\(distinct event\.connection_id\)[\s\S]*into v_event_connection_count, v_event_connection_id/i
    );
    expect(source).toMatch(
      /if v_event_connection_count > 1[\s\S]*conflicting connection evidence/i
    );
    expect(source).toMatch(
      /if v_event_connection_count = 1[\s\S]*v_event_connection_id is distinct from new\.email_connection_id[\s\S]*legacy email activity belongs to another mailbox[\s\S]*else[\s\S]*v_legacy_claim_proven := true/i
    );
    expect(source).toMatch(
      /from public\.opportunity_email_threads link[\s\S]*link\.opportunity_id = old\.opportunity_id[\s\S]*link\.thread_id = old\.email_thread_id[\s\S]*link\.connection_id = new\.email_connection_id/i
    );
    expect(source).toMatch(
      /from public\.email_threads thread[\s\S]*thread\.company_id = old\.company_id[\s\S]*thread\.connection_id = new\.email_connection_id[\s\S]*thread\.provider_thread_id = old\.email_thread_id/i
    );
    expect(source).toMatch(
      /legacy email activity mailbox ownership is unproven/i
    );
    expect(source).toMatch(
      /old\.email_connection_id is null[\s\S]*v_request_role is distinct from 'service_role'[\s\S]*legacy email activity claim requires trusted service transport/i
    );
  });

  it("indexes authoritative correspondence-event proof for forward volume", () => {
    const source = sql();

    expect(source).toMatch(
      /create index if not exists opportunity_correspondence_events_activity_connection_idx[\s\S]*on public\.opportunity_correspondence_events\s*\(company_id, activity_id, connection_id\)[\s\S]*where connection_id is not null/i
    );
  });

  it("keeps the trigger function unavailable as an application RPC", () => {
    const source = sql();

    expect(source).toMatch(/security definer/i);
    expect(source).toMatch(/set search_path = public, pg_temp/i);
    expect(source).toMatch(
      /revoke all on function public\.require_email_activity_provider_identity\(\)\s+from public, anon, authenticated, service_role/i
    );
  });
});
