import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260713203000_scope_email_provider_identities.sql"
);

function sql(): string {
  return readFileSync(migrationPath, "utf8");
}

describe("scoped email provider identity migration", () => {
  it("keeps the same mailbox address isolated by provider", () => {
    const source = sql();

    expect(source).not.toMatch(
      /drop index if exists public\.idx_gmail_connections_company_email/i
    );
    expect(source).toMatch(
      /create unique index[\s\S]*?on public\.email_connections\s*\(company_id, provider, email\)/i
    );
    expect(source).toMatch(
      /group by company_id, provider, lower\(btrim\(email\)\)[\s\S]*?having count\(\*\) > 1[\s\S]*?raise exception/i
    );
    expect(source).toMatch(
      /group by company_id, lower\(btrim\(email\)\)[\s\S]*?having count\(\*\) > 1[\s\S]*?temporary legacy company\/mailbox identity/i
    );
    expect(source).toMatch(
      /create or replace function public\.normalize_email_connection_email\(\)[\s\S]*?new\.email := lower\(btrim\(new\.email\)\)[\s\S]*?create trigger email_connections_normalize_email[\s\S]*?before insert or update of email/i
    );
    expect(source).toMatch(
      /update public\.email_connections[\s\S]*?set email = lower\(btrim\(email\)\)/i
    );
    expect(source).toMatch(
      /add constraint email_connections_email_normalized_check[\s\S]*?email = lower\(btrim\(email\)\)/i
    );
  });

  it("adds an owner token for conditional sync-lease renewal and release", () => {
    expect(sql()).toMatch(
      /alter table public\.email_connections[\s\S]*?add column if not exists sync_lock_owner uuid/i
    );
  });

  it("stores only a unique digest of the Microsoft 365 webhook secret", () => {
    expect(sql()).toMatch(
      /add column if not exists webhook_client_state_hash text/i
    );
    expect(sql()).toMatch(
      /create unique index[\s\S]*?on public\.email_connections \(webhook_client_state_hash\)[\s\S]*?where webhook_client_state_hash is not null/i
    );
  });

  it("stores a coherent durable Gmail history-recovery checkpoint", () => {
    const source = sql();

    expect(source).toMatch(
      /add column if not exists history_recovery_anchor timestamptz/i
    );
    expect(source).toMatch(
      /add column if not exists history_recovery_page_token text/i
    );
    expect(source).toMatch(
      /add column if not exists history_recovery_target_token text/i
    );
    expect(source).toMatch(
      /history_recovery_target_token is null[\s\S]*?history_recovery_anchor is null[\s\S]*?history_recovery_page_token is null[\s\S]*?or[\s\S]*?history_recovery_target_token is not null[\s\S]*?history_recovery_anchor is not null/i
    );
  });

  it("stores the mailbox connection on email activities", () => {
    expect(sql()).toMatch(
      /alter table public\.activities[\s\S]*?add column if not exists email_connection_id uuid[\s\S]*?references public\.email_connections\(id\) on delete restrict/i
    );
  });

  it("adds scoped provider-message uniqueness without breaking the old application", () => {
    const source = sql();

    expect(source).not.toMatch(
      /drop index if exists public\.activities_email_message_id_unique/i
    );
    expect(source).toMatch(
      /create unique index[\s\S]*?on public\.activities\s*\(company_id, email_connection_id, email_message_id\)[\s\S]*?email_connection_id is not null/i
    );
  });

  it("rejects cross-company provider-thread ownership at the database boundary", () => {
    const source = sql();

    expect(source).toMatch(
      /opportunity_email_threads link[\s\S]*?email_connections connection[\s\S]*?opportunities opportunity[\s\S]*?connection\.company_id is distinct from opportunity\.company_id[\s\S]*?raise exception/i
    );
    expect(source).toMatch(
      /function public\.require_same_company_opportunity_email_thread\(\)[\s\S]*?v_connection_company_id[\s\S]*?v_opportunity_company_id[\s\S]*?is distinct from[\s\S]*?create trigger opportunity_email_threads_same_company[\s\S]*?before insert or update of opportunity_id, connection_id/i
    );
  });

  it("keeps the first provider-thread opportunity owner immutable during rolling deploy", () => {
    expect(sql()).toMatch(
      /tg_op = 'UPDATE'[\s\S]*?old\.opportunity_id is distinct from new\.opportunity_id[\s\S]*?raise exception 'opportunity email thread ownership is immutable'/i
    );
  });

  it("defers the connection-enforcement trigger until the post-deploy contract migration", () => {
    const source = sql();

    expect(source).not.toMatch(/require_email_activity_connection/i);
    expect(source).not.toMatch(
      /create trigger activities_require_email_connection_insert/i
    );
  });
});
