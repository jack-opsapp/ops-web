import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260721129000_email_provider_mutation_attempts.sql"
);
const sql = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8").toLowerCase()
  : "";
const compact = sql.replace(/\s+/g, " ");

describe("durable email provider mutation attempts migration", () => {
  it("creates a service-RPC-only immutable operation ledger", () => {
    expect(sql.trim().startsWith("begin;")).toBe(true);
    expect(sql.trim().endsWith("commit;")).toBe(true);
    expect(compact).toContain(
      "create table public.email_provider_mutation_attempts"
    );
    expect(compact).toContain(
      "unique (connection_id_snapshot, operation_kind, operation_key)"
    );
    expect(compact).toContain(
      "connection_id uuid references public.email_connections(id) on delete set null"
    );
    expect(compact).not.toContain(
      "connection_id uuid not null references public.email_connections(id) on delete cascade"
    );
    expect(compact).toContain("connection_id_snapshot uuid not null");
    expect(compact).toContain("provider_snapshot text not null");
    expect(compact).toContain("mailbox_address_snapshot text not null");
    expect(compact).toContain(
      "revoke all on table public.email_provider_mutation_attempts from public, anon, authenticated, service_role"
    );
    expect(compact).not.toContain(
      "grant select, insert, update on table public.email_provider_mutation_attempts"
    );
    expect(compact).toContain("check (request_fingerprint ~ '^[0-9a-f]{64}$')");
  });

  it("derives company, mailbox type, and personal owner snapshots from the connection", () => {
    const prepare = sql.slice(
      sql.indexOf(
        "create or replace function public.prepare_email_provider_mutation_attempt"
      ),
      sql.indexOf(
        "create or replace function public.claim_email_provider_mutation_attempt"
      )
    );

    expect(prepare).toContain("from public.email_connections connection");
    expect(prepare).toContain(
      "private.email_provider_mutation_safe_uuid(connection.company_id)"
    );
    expect(prepare).toContain("v_connection_type = 'individual'");
    expect(prepare).toContain(
      "private.email_provider_mutation_safe_uuid(connection.user_id)"
    );
    expect(prepare).toContain("v_connection_type = 'company'");
    expect(prepare).toContain("v_owner_user_id := null");
    expect(prepare).toContain(
      "v_provider := lower(btrim(connection.provider::text))"
    );
    expect(prepare).toContain(
      "v_mailbox_address := lower(btrim(connection.email))"
    );
    expect(prepare).toContain("connection_id_snapshot");
    expect(prepare).toContain("provider_snapshot");
    expect(prepare).toContain("mailbox_address_snapshot");
    expect(prepare).toContain("actor_row.company_id = v_company_id");
    expect(prepare).toContain("coalesce(actor_row.is_active, false)");
    expect(prepare).toContain(
      "existing.actor_user_id is distinct from p_actor_user_id"
    );
    expect(prepare).toContain(
      "p_actor_user_id is distinct from v_owner_user_id"
    );
    expect(prepare).not.toContain("lower(actor.email)");
    expect(prepare).toContain("email_provider_mutation_key_conflict");
    expect(prepare).toContain("request_fingerprint");
  });

  it("claims only prepared or definitively rejected work and never reclaims unknown delivery", () => {
    const claim = sql.slice(
      sql.indexOf(
        "create or replace function public.claim_email_provider_mutation_attempt"
      ),
      sql.indexOf(
        "create or replace function public.mark_email_provider_mutation_accepted"
      )
    );

    expect(claim).toContain("for update");
    expect(claim).toContain(
      "existing.status not in ('prepared', 'provider_rejected')"
    );
    expect(claim).toContain("status = 'attempting'");
    expect(claim).toContain("actor.id = existing.actor_user_id");
    expect(claim).toContain("actor.company_id = existing.company_id");
    expect(claim).toContain("coalesce(actor.is_active, false)");
    expect(claim).toContain("actor.id = existing.owner_user_id_snapshot");
    expect(claim).toContain(
      "lower(btrim(connection_row.provider::text)) = existing.provider_snapshot"
    );
    expect(claim).toContain(
      "lower(btrim(connection_row.email)) = existing.mailbox_address_snapshot"
    );
    expect(claim).not.toContain("'reconciliation_required'");
    expect(claim).not.toContain("'provider_accepted'");
  });

  it("stores exact provider identity before reconciliation and guards conflicts", () => {
    expect(compact).toContain(
      "create or replace function public.mark_email_provider_mutation_accepted"
    );
    expect(compact).toContain("provider_resource_id");
    expect(compact).toContain("provider_secondary_resource_id");
    expect(compact).toContain("provider_result");
    expect(compact).toContain("email_provider_mutation_identity_conflict");
    expect(compact).toContain(
      "existing.provider_result <> '{}'::jsonb and v_result <> '{}'::jsonb and existing.provider_result is distinct from v_result"
    );
    expect(compact).toContain("status = 'reconciliation_required'");
    expect(compact).toContain("status = 'completed'");
  });

  it("grants every transition only through service-role RPCs", () => {
    for (const functionName of [
      "prepare_email_provider_mutation_attempt",
      "claim_email_provider_mutation_attempt",
      "mark_email_provider_mutation_accepted",
      "mark_email_provider_mutation_rejected",
      "mark_email_provider_mutation_reconciliation_required",
      "complete_email_provider_mutation_attempt",
    ]) {
      expect(compact).toContain(
        `revoke all on function public.${functionName}`
      );
      expect(compact).toContain(
        `grant execute on function public.${functionName}`
      );
    }
    expect(compact).toContain(
      "coalesce(auth.jwt() ->> 'role', '') <> 'service_role'"
    );
  });

  it("creates and resolves deduplicated content-free recovery notifications", () => {
    const notification = sql.slice(
      sql.indexOf(
        "create or replace function private.notify_email_provider_mutation_reconciliation"
      ),
      sql.indexOf(
        "revoke all on function private.notify_email_provider_mutation_reconciliation"
      )
    );
    const notificationCompact = notification.replace(/\s+/g, " ");

    expect(notification).toContain("new.status <> 'reconciliation_required'");
    expect(notification).toContain("new.status = 'completed'");
    expect(notification).toContain("set resolved_at = clock_timestamp()");
    expect(notification).toContain(
      "'email-provider-mutation-reconciliation:' || new.id::text"
    );
    expect(notification).toContain(
      "new.connection_type_snapshot = 'individual'"
    );
    expect(notification).toContain(
      "active_user.id = new.owner_user_id_snapshot"
    );
    expect(notification).toContain("new.connection_type_snapshot = 'company'");
    expect(notificationCompact).toContain(
      "public.has_permission( user_row.id, 'settings.integrations', 'all' )"
    );
    const companyBranch = notification.slice(
      notification.indexOf("new.connection_type_snapshot = 'company'")
    );
    expect(companyBranch).not.toContain("connection.user_id");
    expect(notification).not.toContain(
      "from public.email_connections connection_row"
    );
    expect(notification).toContain("draft placement needs review");
    expect(notification).toContain("email connection needs review");
  });
});
