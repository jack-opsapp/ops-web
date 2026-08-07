import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const checkpointSql = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260731203000_email_sync_terminal_checkpoint.sql"
  ),
  "utf8"
);

const providerSnapshotSql = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260805151056_email_provider_snapshot_health.sql"
  ),
  "utf8"
);

const hotfixSql = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260731183127_fix_manual_outbound_follow_up_lifecycle_conflict_target.sql"
  ),
  "utf8"
);

describe("email sync terminal checkpoint migration", () => {
  it("adds an owner-fenced nonterminal checkpoint without advancing last_synced_at", () => {
    expect(checkpointSql).toMatch(
      /create or replace function public\.persist_email_connection_sync_checkpoint_as_system/i
    );
    expect(checkpointSql).toMatch(/history_id\s*=\s*p_history_id/i);
    const updateBody = checkpointSql.match(
      /update public\.email_connections[\s\S]*?get diagnostics v_updated_count/i
    )?.[0];
    expect(updateBody).toBeTruthy();
    expect(updateBody).not.toMatch(/last_synced_at\s*=/i);
    expect(checkpointSql).toMatch(
      /private\.email_provider_mailbox_sync_leases[\s\S]*?owner_id\s*=\s*p_owner_id[\s\S]*?expires_at\s*>\s*v_written_at/i
    );
  });

  it("records provider progress without falsely completing derived summary work", () => {
    expect(providerSnapshotSql).toMatch(
      /add column if not exists provider_snapshot_at timestamptz/i
    );
    expect(providerSnapshotSql).toMatch(
      /persist_email_connection_sync_checkpoint_as_system\([\s\S]*?p_provider_snapshot_complete boolean/i
    );
    expect(providerSnapshotSql).toMatch(
      /persist_email_connection_sync_checkpoint_as_system\(\s*p_connection_id uuid,\s*p_owner_id uuid,\s*p_history_id text,\s*p_clear_recovery boolean default false,\s*p_provider_snapshot_complete boolean default false\s*\)/i
    );
    expect(providerSnapshotSql).toMatch(
      /provider_snapshot_at\s*=\s*case[\s\S]*?p_provider_snapshot_complete[\s\S]*?v_written_at/i
    );
    const checkpointUpdate = providerSnapshotSql.match(
      /create or replace function public\.persist_email_connection_sync_checkpoint_as_system[\s\S]*?get diagnostics v_updated_count/i
    )?.[0];
    expect(checkpointUpdate).toBeTruthy();
    expect(checkpointUpdate).not.toMatch(/last_synced_at\s*=/i);
  });

  it("keeps provider progress owner-fenced, service-role only, and terminally monotonic", () => {
    expect(providerSnapshotSql).toMatch(
      /private\.email_provider_mailbox_sync_leases[\s\S]*?owner_id\s*=\s*p_owner_id[\s\S]*?expires_at\s*>\s*v_written_at/i
    );
    expect(providerSnapshotSql).toMatch(
      /revoke all on function public\.persist_email_connection_sync_checkpoint_as_system\([\s\S]*?from public, anon, authenticated, service_role/i
    );
    expect(providerSnapshotSql).toMatch(
      /grant execute on function public\.persist_email_connection_sync_checkpoint_as_system\([\s\S]*?to service_role/i
    );
    expect(providerSnapshotSql).toMatch(
      /persist_email_connection_sync_completion_as_system[\s\S]*?provider_snapshot_at\s*=\s*greatest\([\s\S]*?v_written_at/i
    );
  });

  it("keeps the checkpoint service-role only with a fixed search path", () => {
    expect(checkpointSql).toMatch(/security definer/i);
    expect(checkpointSql).toMatch(
      /set search_path to 'pg_catalog', 'pg_temp'/i
    );
    expect(checkpointSql).toMatch(
      /revoke all on function public\.persist_email_connection_sync_checkpoint_as_system[\s\S]*?from public, anon, authenticated, service_role/i
    );
    expect(checkpointSql).toMatch(
      /grant execute on function public\.persist_email_connection_sync_checkpoint_as_system[\s\S]*?to service_role/i
    );
  });

  it("records exact repository parity for the deployed conflict-target hotfix", () => {
    expect(hotfixSql).toContain(
      "public.reconcile_manual_outbound_follow_up_cycle_as_system(uuid,uuid,uuid)"
    );
    expect(hotfixSql).not.toContain(
      "uuid,uuid,text,text,timestamptz,text,text,text,text[],text[],text"
    );
    expect(hotfixSql).toContain(
      "on conflict on constraint opportunity_lifecycle_state_pkey do update"
    );
    expect(hotfixSql).not.toMatch(/on conflict \(opportunity_id\)/i);
    expect(hotfixSql).toMatch(
      /revoke all on function[\s\S]*?from public, anon, authenticated, service_role[\s\S]*?grant execute[\s\S]*?to service_role/i
    );
  });
});
