import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATION = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260906050000_agent_customer_message_follow_up.sql"
  ),
  "utf8"
).toLowerCase();
const EXPOSURE = readFileSync(
  join(
    process.cwd(),
    "src/lib/agent-control-plane/registry/mcp-exposure-catalog.ts"
  ),
  "utf8"
);

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function functionDefinition(source: string, name: string): string {
  const marker = `create function ${name}(`;
  const start = source.lastIndexOf(marker);
  if (start < 0) return "";
  const remainder = source.slice(start);
  const delimiter = /\bas\s+(\$[a-z0-9_]*\$)/.exec(remainder)?.[1];
  if (!delimiter) return "";
  const end = remainder.indexOf(`${delimiter};`);
  return end < 0 ? "" : remainder.slice(0, end + delimiter.length + 1);
}

const SOURCE = compact(
  functionDefinition(MIGRATION, "private.agent_customer_message_source")
);
const PREPARE = compact(
  functionDefinition(
    MIGRATION,
    "public.prepare_agent_customer_message_as_system"
  )
);
const APPROVE = compact(
  functionDefinition(
    MIGRATION,
    "public.approve_agent_customer_message_as_actor"
  )
);
const REJECT = compact(
  functionDefinition(MIGRATION, "public.reject_agent_customer_message_as_actor")
);
const INTENT_GUARD = compact(
  functionDefinition(
    MIGRATION,
    "private.agent_customer_message_intent_is_current"
  )
);
const RECEIPT = compact(
  functionDefinition(
    MIGRATION,
    "private.refresh_agent_customer_message_receipt"
  )
);

describe("customer message database boundary", () => {
  it("installs a private, force-RLS proposal ledger with service-only RPCs", () => {
    expect(MIGRATION).toMatch(/^--[\s\S]*?\nbegin;/);
    expect(MIGRATION.trim().endsWith("commit;")).toBe(true);
    expect(compact(MIGRATION)).toContain(
      "alter table private.agent_customer_messages force row level security"
    );
    expect(compact(MIGRATION)).toContain(
      "revoke all on private.agent_customer_messages from public, anon, authenticated, service_role"
    );
    for (const signature of [
      "public.prepare_agent_customer_message_as_system( uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text,text,jsonb,timestamptz )",
      "public.approve_agent_customer_message_as_actor( uuid,uuid,uuid,uuid,text,text )",
      "public.reject_agent_customer_message_as_actor(uuid,uuid,uuid,text)",
    ]) {
      expect(compact(MIGRATION)).toContain(
        `grant execute on function ${signature} to service_role`
      );
    }
  });

  it("derives addressing from one latest inbound provider source and forbids attachments", () => {
    expect(SOURCE).toContain("activity.direction = 'inbound'");
    expect(SOURCE).toContain("connection.type::text = 'individual'");
    expect(SOURCE).toContain("connection.user_id = p_actor::text");
    expect(SOURCE).toContain("private.user_can_send_opportunity_inbox");
    expect(SOURCE).toContain("source.sender_identity");
    expect(SOURCE).toContain(
      "source.source_sha256 = p_request->>'expected_source_sha256'"
    );
    expect(SOURCE).toContain("not coalesce(activity.has_attachments, false)");
    expect(SOURCE).toContain("cardinality(source.attachment_evidence_ids) = 0");
    expect(SOURCE).toContain(
      "jsonb_array_length(source.attachment_descriptors) = 0"
    );
    expect(SOURCE).toContain("agent_customer_message_new_correspondence");
    expect(SOURCE).not.toContain("p_request->>'recipient'");
    expect(SOURCE).not.toContain("p_request->>'cc'");
    expect(SOURCE).not.toContain("p_request->>'bcc'");
  });

  it("seals one expiring preview and rechecks it before the human approval", () => {
    expect(PREPARE).toContain("interval '30 minutes'");
    expect(PREPARE).toContain("agent_customer_message_hash");
    expect(PREPARE).toContain(
      "one unresolved proposal per immutable inbound message"
    );
    expect(PREPARE).toContain(
      "'to',pg_catalog.jsonb_build_array(v_snapshot->>'recipient')"
    );
    expect(PREPARE).toContain("'cc','[]'::jsonb,'bcc','[]'::jsonb");
    expect(PREPARE).toContain("'attachment_ids','[]'::jsonb");
    expect(APPROVE).toContain(
      "private.agent_customer_message_reauthorize(v_message)"
    );
    expect(APPROVE).toContain("v_action.status <> 'pending'");
    expect(APPROVE).toContain(
      "v_action.action_data->'proposal' is distinct from v_message.proposal"
    );
    expect(APPROVE).toContain("private.agent_customer_message_source(");
    expect(APPROVE).toContain("status = 'approved'");
  });

  it("cancels only before a durable intent and rechecks exact send identity at provider claim", () => {
    expect(REJECT).toContain("approved_action_email_intents");
    expect(REJECT).toContain("agent_customer_message_cancellation_too_late");
    for (const identity of [
      "connection_id",
      "source_activity_id",
      "reply_provider_thread_id",
      "in_reply_to",
      "to_emails",
      "cc_emails",
      "subject",
      "authored_body",
    ]) {
      expect(INTENT_GUARD).toContain(identity);
    }
    expect(compact(MIGRATION)).toContain(
      "approved_action_email_intent_is_authorized_pre_customer_guard"
    );
    expect(INTENT_GUARD).toContain("private.agent_customer_message_source(");
  });

  it("keeps provider acceptance distinct from delivery and reconciliation", () => {
    expect(RECEIPT).toContain("when 'sending' then 'attempted'");
    expect(RECEIPT).toContain(
      "when 'provider_accepted' then 'provider_accepted'"
    );
    expect(RECEIPT).toContain("when 'reconciled' then 'reconciled_sent'");
    expect(RECEIPT).toContain("when 'delivery_unknown' then 'unknown'");
    expect(RECEIPT).toContain("'delivered_at',null");
  });

  it("leaves V14 active and V15 absent from the active exposure catalog", () => {
    expect(EXPOSURE).toContain(
      "export const ACTIVE_MCP_EXPOSURE_REVISION = MCP_EXPOSURE_V14.revision"
    );
    expect(EXPOSURE).not.toContain(
      "[MCP_EXPOSURE_V15.revision]: MCP_EXPOSURE_V15"
    );
    expect(MIGRATION).toContain("deliberately unseeded here");
    expect(MIGRATION).toContain("2026-09-06.mcp-consent-catalog.v10");
  });
});
