import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260721124000_global_email_provider_mailbox_sync_lease.sql"
);

function sql(): string {
  return existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
}

describe("global email provider mailbox sync lease migration", () => {
  it("keeps the cross-company mailbox lease private and identity opaque", () => {
    const source = sql();

    expect(source).toMatch(
      /create table private\.email_provider_mailbox_sync_leases/i
    );
    expect(source).toMatch(/mailbox_identity_hash\s+bytea\s+primary key/i);
    expect(source).toMatch(
      /connection_id\s+uuid[\s\S]*?references public\.email_connections\s*\(id\)\s+on delete set null/i
    );
    expect(source).not.toMatch(/on delete cascade/i);
    expect(source).toMatch(/owner_id\s+uuid\s+not null/i);
    expect(source).toMatch(/lease_seconds\s+integer\s+not null/i);
    expect(source).not.toMatch(/\bcompany_id\b/);
    expect(source).not.toMatch(/\bmailbox_email\b/);
    expect(source).toMatch(
      /revoke all on table private\.email_provider_mailbox_sync_leases\s+from public, anon, authenticated, service_role/i
    );
  });

  it("claims one canonical provider mailbox atomically and preserves the connection API", () => {
    const source = sql();

    expect(source).toMatch(
      /create or replace function public\.acquire_email_connection_sync_lock_as_system\(\s*p_connection_id uuid,\s*p_lease_seconds integer default 600\s*\)\s*returns uuid/i
    );
    expect(source).toMatch(/security definer/i);
    expect(source).toMatch(/set search_path = pg_catalog, pg_temp/i);
    expect(source).toMatch(
      /v_provider\s*:=\s*lower\(btrim\(v_connection\.provider\)\)/i
    );
    expect(source).toMatch(
      /v_email\s*:=\s*lower\(btrim\(v_connection\.email\)\)/i
    );
    expect(source).toMatch(
      /v_connection\.provider\s+is distinct from v_provider[\s\S]*?v_connection\.email\s+is distinct from v_email/i
    );
    expect(source).toMatch(
      /v_connection\.sync_enabled is not true[\s\S]*?v_connection\.status not in \('active', 'setup_incomplete'\)/i
    );
    expect(source).toMatch(
      /extensions\.digest\([\s\S]*?convert_to\(v_provider, 'UTF8'\)[\s\S]*?decode\('00', 'hex'\)[\s\S]*?convert_to\(v_email, 'UTF8'\)[\s\S]*?'sha256'[\s\S]*?\)/i
    );
    expect(source).not.toContain("chr(0)");
    expect(source).toMatch(
      /from private\.email_provider_mailbox_sync_leases[\s\S]*?where mailbox_identity_hash = v_mailbox_identity_hash[\s\S]*?for update/i
    );
    expect(source).toMatch(
      /insert into private\.email_provider_mailbox_sync_leases[\s\S]*?on conflict do nothing[\s\S]*?returning owner_id into v_acquired_owner/i
    );
    expect(source).toMatch(
      /update private\.email_provider_mailbox_sync_leases[\s\S]*?set[\s\S]*?owner_id = v_owner_id[\s\S]*?where mailbox_identity_hash = v_mailbox_identity_hash/i
    );
    expect(source).toMatch(
      /update public\.email_connections[\s\S]*?set sync_in_progress_at = v_claimed_at,[\s\S]*?sync_lock_owner = v_owner_id[\s\S]*?where id = p_connection_id/i
    );
  });

  it("renews and releases only the exact live owner without leaking holder identity", () => {
    const source = sql();

    expect(source).toMatch(
      /create or replace function public\.renew_email_connection_sync_lock_as_system\([\s\S]*?p_connection_id uuid,[\s\S]*?p_owner_id uuid,[\s\S]*?p_lease_seconds integer default 600[\s\S]*?\) returns boolean/i
    );
    expect(source).toMatch(
      /where connection_id = p_connection_id[\s\S]*?and owner_id = p_owner_id[\s\S]*?for update/i
    );
    expect(source).toMatch(/v_lease\.expires_at <= v_renewed_at/i);
    expect(source).toMatch(
      /v_connection\.sync_lock_owner is distinct from p_owner_id/i
    );
    expect(source).toMatch(
      /v_connection_mailbox_identity_hash\s+is distinct from v_lease\.mailbox_identity_hash/i
    );

    expect(source).toMatch(
      /create or replace function public\.release_email_connection_sync_lock_as_system\([\s\S]*?p_connection_id uuid,[\s\S]*?p_owner_id uuid[\s\S]*?\) returns boolean/i
    );
    expect(source).toMatch(
      /delete from private\.email_provider_mailbox_sync_leases[\s\S]*?where owner_id = p_owner_id[\s\S]*?connection_id = p_connection_id[\s\S]*?or connection_id is null[\s\S]*?returning owner_id into v_released_owner/i
    );
    expect(source).toMatch(
      /update public\.email_connections[\s\S]*?set sync_in_progress_at = null,[\s\S]*?sync_lock_owner = null[\s\S]*?where id = p_connection_id[\s\S]*?and sync_lock_owner = p_owner_id/i
    );
    expect(source).toMatch(
      /revoke all on function public\.renew_email_connection_sync_lock_as_system\([\s\S]*?from public, anon, authenticated, service_role/i
    );
    expect(source).toMatch(
      /revoke all on function public\.release_email_connection_sync_lock_as_system\([\s\S]*?from public, anon, authenticated, service_role/i
    );
    expect(source).toMatch(
      /grant execute on function public\.renew_email_connection_sync_lock_as_system\([\s\S]*?to service_role/i
    );
    expect(source).toMatch(
      /grant execute on function public\.release_email_connection_sync_lock_as_system\([\s\S]*?to service_role/i
    );
  });

  it("cleans the matching private lease when a rolling old worker directly clears its public mirror", () => {
    const source = sql();

    expect(source).toMatch(
      /create or replace function private\.release_legacy_email_connection_sync_lock\(\)\s+returns trigger[\s\S]*?security definer[\s\S]*?set search_path = pg_catalog, pg_temp/i
    );
    expect(source).toMatch(
      /old\.sync_lock_owner is not null[\s\S]*?new\.sync_lock_owner is null[\s\S]*?new\.sync_in_progress_at is null/i
    );
    expect(source).toMatch(
      /delete from private\.email_provider_mailbox_sync_leases[\s\S]*?connection_id = old\.id[\s\S]*?owner_id = old\.sync_lock_owner/i
    );
    expect(source).toMatch(
      /create trigger email_connections_release_legacy_provider_mailbox_lease\s+after update of sync_lock_owner, sync_in_progress_at\s+on public\.email_connections[\s\S]*?execute function private\.release_legacy_email_connection_sync_lock\(\)/i
    );
    expect(source).toMatch(
      /revoke all on function private\.release_legacy_email_connection_sync_lock\(\)\s+from public, anon, authenticated, service_role/i
    );
  });

  it("atomically owner-fences sync recovery and completion checkpoints", () => {
    const source = sql();

    expect(source).toMatch(
      /create or replace function public\.persist_email_connection_recovery_checkpoint_as_system\([\s\S]*?p_connection_id uuid,[\s\S]*?p_owner_id uuid,[\s\S]*?p_anchor timestamptz,[\s\S]*?p_page_token text,[\s\S]*?p_target_token text[\s\S]*?\) returns boolean/i
    );
    expect(source).toMatch(
      /create or replace function public\.persist_email_connection_sync_completion_as_system\([\s\S]*?p_connection_id uuid,[\s\S]*?p_owner_id uuid,[\s\S]*?p_last_synced_at timestamptz,[\s\S]*?p_history_id text,[\s\S]*?p_clear_recovery boolean default false[\s\S]*?\) returns boolean/i
    );
    expect(source).toMatch(
      /from private\.email_provider_mailbox_sync_leases as lease[\s\S]*?connection_id = p_connection_id[\s\S]*?owner_id = p_owner_id[\s\S]*?expires_at > v_written_at[\s\S]*?for update/i
    );
    expect(source).toMatch(
      /update public\.email_connections[\s\S]*?history_recovery_anchor = p_anchor[\s\S]*?history_recovery_page_token = p_page_token[\s\S]*?history_recovery_target_token = p_target_token[\s\S]*?sync_lock_owner = p_owner_id/i
    );
    expect(source).toMatch(
      /update public\.email_connections[\s\S]*?last_synced_at = p_last_synced_at[\s\S]*?history_id = p_history_id[\s\S]*?sync_lock_owner = p_owner_id/i
    );
  });

  it("publishes Gmail historical-import completion and cursor in one owner-fenced transaction", () => {
    const source = sql();

    expect(source).toMatch(
      /create or replace function public\.complete_gmail_import_job_as_system\([\s\S]*?p_connection_id uuid,[\s\S]*?p_owner_id uuid,[\s\S]*?p_job_id uuid,[\s\S]*?p_history_id text,[\s\S]*?p_processed integer,[\s\S]*?p_matched integer,[\s\S]*?p_unmatched integer,[\s\S]*?p_needs_review integer,[\s\S]*?p_clients_created integer,[\s\S]*?p_leads_created integer,[\s\S]*?p_completed_at timestamptz[\s\S]*?\) returns boolean/i
    );
    expect(source).toMatch(
      /from private\.email_provider_mailbox_sync_leases as lease[\s\S]*?connection_id = p_connection_id[\s\S]*?owner_id = p_owner_id[\s\S]*?expires_at > v_completed_at[\s\S]*?for update/i
    );
    expect(source).toMatch(
      /from public\.email_connections as connection[\s\S]*?connection\.id = p_connection_id[\s\S]*?connection\.sync_lock_owner = p_owner_id[\s\S]*?for update/i
    );
    expect(source).toMatch(
      /update public\.gmail_import_jobs[\s\S]*?status = 'completed'[\s\S]*?where id = p_job_id[\s\S]*?and connection_id = p_connection_id[\s\S]*?and status = 'running'/i
    );
    expect(source).toMatch(
      /if v_job\.status = 'completed'[\s\S]*?v_job\.processed = p_processed[\s\S]*?v_job\.leads_created is not distinct from p_leads_created[\s\S]*?v_connection_history_id is not distinct from p_history_id[\s\S]*?return true/i
    );
    expect(source).toMatch(
      /update public\.email_connections[\s\S]*?set history_id = p_history_id[\s\S]*?where id = p_connection_id[\s\S]*?and sync_lock_owner = p_owner_id/i
    );
  });

  it("keeps every checkpoint RPC service-only", () => {
    const source = sql();

    for (const functionName of [
      "persist_email_connection_recovery_checkpoint_as_system",
      "persist_email_connection_sync_completion_as_system",
      "complete_gmail_import_job_as_system",
    ]) {
      expect(source).toMatch(
        new RegExp(
          `revoke all on function public\\.${functionName}\\([\\s\\S]*?from public, anon, authenticated, service_role`,
          "i"
        )
      );
      expect(source).toMatch(
        new RegExp(
          `grant execute on function public\\.${functionName}\\([\\s\\S]*?to service_role`,
          "i"
        )
      );
    }
  });
});
