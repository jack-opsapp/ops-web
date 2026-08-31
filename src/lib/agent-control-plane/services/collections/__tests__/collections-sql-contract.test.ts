import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260831140000_agent_collections_vertical.sql"
  ),
  "utf8"
);
const normalized = migration.replace(/\s+/g, " ");

describe("collections vertical SQL contract", () => {
  it("preflights every trusted dependency and is transaction atomic", () => {
    expect(normalized).toContain("begin;");
    expect(normalized).toContain("commit;");
    for (const relation of [
      "public.agent_actions",
      "public.clients",
      "public.companies",
      "public.notifications",
      "public.sub_clients",
      "private.agent_mcp_rate_limit_buckets",
      "private.agent_provider_delivery_sources",
      "private.mcp_oauth_clients",
      "private.mcp_oauth_grants",
    ]) {
      expect(migration).toContain(`'${relation}'`);
    }
  });

  it("keeps all collections ledgers private and browser-inaccessible", () => {
    for (const table of [
      "agent_collections_runs",
      "agent_collections_change_sets",
      "agent_collections_confirmations",
      "agent_collections_receipts",
    ]) {
      expect(normalized).toContain(
        `alter table private.${table} enable row level security;`
      );
      expect(normalized).toContain(
        `revoke all on table private.${table} from public, anon, authenticated, service_role;`
      );
      expect(migration).not.toMatch(
        new RegExp(`create\\s+policy[^;]+private\\.${table}`, "i")
      );
    }
  });

  it("binds every statement to the current tenant, v10/v4 grant, scopes, and all-scope permissions", () => {
    for (const fragment of [
      "auth.role() is distinct from 'service_role'",
      "grant_record.user_id = p_actor_user_id",
      "grant_record.company_id = p_company_id",
      "grant_record.client_id = p_oauth_client_id",
      "grant_record.revision = p_grant_revision",
      "grant_record.scopes = p_granted_scope_ceiling",
      "grant_record.revoked_at is null",
      "grant_record.exposure_revision = '2026-08-31.mcp-exposure.v4'",
      "grant_record.consent_catalog_revision = client_record.consent_catalog_revision",
      "v_required_scopes <@ grant_record.scopes",
      "authority.effective_permissions @> v_required_permissions",
      "'2026-08-31.capability-manifest.v10'",
    ]) {
      expect(normalized).toContain(fragment);
    }
    for (const permission of [
      "clients.view",
      "email.view",
      "invoices.view",
      "reports.view",
    ]) {
      expect(migration).toContain(
        `jsonb_build_object('permission', '${permission}', 'scope', 'all')`
      );
    }
  });

  it("proves exact recipient ownership and refuses shared identities", () => {
    for (const fragment of [
      "client.id = (recipient ->> 'contact_id')::uuid",
      "client.id = (recipient ->> 'customer_id')::uuid",
      "sub_client.id = (recipient ->> 'contact_id')::uuid",
      "sub_client.client_id = (recipient ->> 'customer_id')::uuid",
      "client.company_id = p_company_id",
      "sub_client.company_id = p_company_id",
      "lower(btrim(client.email)) = recipient ->> 'recipient_address'",
      "lower(btrim(sub_client.email)) = recipient ->> 'recipient_address'",
      "v_shared_count > 1",
      "'recipient_shared'",
    ]) {
      expect(normalized).toContain(fragment);
    }
  });

  it("fails correspondence closed for unreadable or recently delivered messages", () => {
    for (const fragment of [
      "source.normalization_status = 'normalized'",
      "nullif(btrim(source.normalized_plain_text), '') is not null",
      "source.normalization_revision = 'ops.correspondence.normalized-text.v2'",
      "'correspondence_unavailable'",
      "'correspondence_recent_outbound'",
      "'correspondence_recent_inbound'",
      "v_latest_direction = 'outbound' and v_latest_delivered_at > p_end_at - interval '7 days'",
      "v_latest_direction = 'inbound' and v_latest_delivered_at > p_end_at - interval '3 days'",
    ]) {
      expect(normalized).toContain(fragment);
    }
    expect(normalized).not.toContain("normalized_plain_text',");
  });

  it("persists one immutable approval per ready debtor and none for blocked debtors", () => {
    for (const fragment of [
      "debtor #>> '{draft,kind}' not in ('prepared', 'blocked')",
      "continue when debtor #>> '{draft,kind}' = 'blocked'",
      "'approve_collections_draft'",
      "'context_source', 'collections'",
      "'preview_sha256', 'sha256:' || v_preview_hash",
      "v_expires_at := statement_timestamp() + interval '3 days'",
      "extensions.digest(convert_to(v_preview::text, 'UTF8'), 'sha256')",
      "unique (company_id, actor_user_id, oauth_client_id, idempotency_key)",
      "AGENT_COLLECTIONS_IDEMPOTENCY_CONFLICT",
      "v_existing.result_snapshot || jsonb_build_object( 'receipt', (v_existing.result_snapshot -> 'receipt') || jsonb_build_object('replayed', true) )",
    ]) {
      expect(normalized).toContain(fragment);
    }
  });

  it("commits only the exact single-use preview and returns replay-safe truthful receipts", () => {
    for (const fragment of [
      "source.user_id = p_actor_user_id",
      "source.id = (action.action_data ->> 'change_set_id')::uuid",
      "source.preview_hash = substring(p_preview_sha256 from 8)",
      "change_set.consumed_at is not null",
      "change_set.expires_at <= statement_timestamp()",
      "action.status is distinct from 'pending'",
      "source.idempotency_key = p_idempotency_key",
      "return receipt.result || jsonb_build_object('replayed', true)",
      "'effect', 'collections_draft_approved_inside_ops'",
      "'messages_sent', 0",
      "'money_moved', false",
      "'financial_documents_issued', 0",
      "'receipt_sha256', 'sha256:' || v_receipt_hash",
      "'Draft approved inside OPS only. No message sent. No money moved. No financial document issued.'",
    ]) {
      expect(normalized).toContain(fragment);
    }
  });

  it("rejects coherently without consuming an approval receipt", () => {
    for (const fragment of [
      "create or replace function public.reject_agent_collections_draft_as_actor",
      "set rejected_at = statement_timestamp()",
      "set status = 'rejected'",
      "'effect', 'left_open_inside_ops'",
      "'messages_sent', 0",
      "'money_moved', false",
      "'financial_documents_issued', 0",
    ]) {
      expect(normalized).toContain(fragment);
    }
  });

  it("contains no delivery, payment, financial-document, or legal mutation path", () => {
    expect(migration).not.toMatch(
      /\b(insert|update|delete)\s+(into\s+)?public\.(approved_action_email_intents|email_actions|email_send_intents|payments|invoices|estimates|credit_notes|legal_[a-z_]+)/i
    );
    expect(migration).not.toMatch(/\b(sendgrid|mailgun|resend|stripe)\b/i);
  });

  it("uses a separate atomic 6/6/30 v4 prepare limiter", () => {
    for (const fragment of [
      "create or replace function public.consume_agent_collections_prepare_rate_limit_as_system",
      "v_actor_limit constant integer := 6",
      "v_grant_limit constant integer := 6",
      "v_company_limit constant integer := 30",
      "p_capability_id is distinct from 'prepare_collections'",
      "p_policy_id is distinct from 'mcp-collections-prepare:2026-08-31.v1'",
      "for update",
      "grant execute on function public.consume_agent_collections_prepare_rate_limit_as_system",
    ]) {
      expect(normalized).toContain(fragment);
    }
  });

  it("exposes only six pinned service-role RPCs", () => {
    for (const functionName of [
      "resolve_agent_collections_timezone_as_system",
      "inspect_agent_collections_correspondence_as_system",
      "persist_agent_collections_as_system",
      "commit_agent_collections_draft_as_actor",
      "reject_agent_collections_draft_as_actor",
      "consume_agent_collections_prepare_rate_limit_as_system",
    ]) {
      expect(normalized).toContain(
        `create or replace function public.${functionName}`
      );
      expect(normalized).toContain(
        `revoke all on function public.${functionName}`
      );
      expect(normalized).toContain(
        "from public, anon, authenticated, service_role;"
      );
      expect(normalized).toContain(
        `grant execute on function public.${functionName}`
      );
    }
    expect(
      migration.match(
        /set search_path = pg_catalog, public, private, extensions, pg_temp/g
      )
    ).toHaveLength(7);
  });
});
