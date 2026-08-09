import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATION_SUFFIX = "_agent_correspondence_evidence_read.sql";
const SIGNATURE =
  "public.read_agent_correspondence_evidence_as_system( text, uuid, uuid, text, text, text, text, text, text, text[] )";

function migrationSql(): string {
  const directory = join(process.cwd(), "supabase/migrations");
  const matches = readdirSync(directory)
    .filter((file) => file.endsWith(MIGRATION_SUFFIX))
    .sort();
  expect(matches).toHaveLength(1);
  return readFileSync(join(directory, matches[0]!), "utf8").toLowerCase();
}

function compactSql(): string {
  return migrationSql()
    .replace(/\s+/g, " ")
    .replace(/\(\s+/g, "( ")
    .replace(/\s+\)/g, " )");
}

describe("agent correspondence evidence read migration", () => {
  it("is transactional and depends on the actor and immutable-turn foundations", () => {
    const sql = migrationSql();
    expect(sql).toMatch(/(?:^|\n)begin;\s/);
    expect(sql.trim().endsWith("commit;")).toBe(true);
    expect(sql).toContain(
      "private.resolve_agent_actor_authority(uuid,uuid,text[])"
    );
    expect(sql).toContain(
      "private.agent_user_can_access_entity(uuid,uuid,text,uuid,text)"
    );
    expect(sql).toContain(
      "private.user_can_view_inbox_connection(uuid,uuid,uuid,uuid)"
    );
    expect(sql).toContain("public.job_conversation_turns");
    expect(sql).toContain("public.job_conversation_anchors");
  });

  it("pins the security-definer execution environment and canonical request ID", () => {
    const compact = compactSql();
    expect(compact).toContain(
      "language plpgsql stable security definer set search_path = pg_catalog, public, private, pg_temp"
    );
    expect(compact).toContain(
      "p_request_id is distinct from btrim(p_request_id)"
    );
    expect(compact).toContain("length(p_request_id) = 0");
    expect(compact).toContain("length(p_request_id) > 256");
  });

  it("reloads current authority and requires the exact snapshot and inbox scope", () => {
    const compact = compactSql();
    expect(compact).toContain(
      "from private.resolve_agent_actor_authority( p_actor_user_id, p_company_id, array['inbox.view']::text[] ) authority"
    );
    expect(compact).toContain(
      "authority.permission_snapshot_revision = p_permission_snapshot_revision"
    );
    expect(compact).toContain("authority.inbox_scope = p_inbox_scope");
    expect(compact).toContain(
      "permission.value ->> 'permission' = 'inbox.view'"
    );
  });

  it("pins the exact capability identity and OAuth scope", () => {
    const compact = compactSql();
    expect(compact).toContain(
      "p_capability_id is distinct from 'get_correspondence_evidence'"
    );
    expect(compact).toContain("'get_correspondence_evidence:2026-08-07.v1'");
    expect(compact).toContain("'2026-08-07.capability-manifest.v1'");
    expect(compact).toContain("'ops.correspondence.read'");
    expect(compact).toContain("cardinality(p_evidence_ids) > 20");
  });

  it("intersects tenant, requested IDs, and current job visibility in the final statement", () => {
    const compact = compactSql();
    expect(compact).toContain("turn.company_id = p_company_id");
    expect(compact).toContain("turn.id::text = any(p_evidence_ids)");
    expect(compact).toContain("anchor.company_id = turn.company_id");
    expect(compact).toContain("anchor.conversation_id = turn.conversation_id");
    expect(compact).toMatch(
      /anchor\.anchor_kind = 'opportunity'[\s\S]*?private\.agent_user_can_access_entity\([\s\S]*?'opportunity'[\s\S]*?'view'/
    );
    expect(compact).toMatch(
      /anchor\.anchor_kind = 'project'[\s\S]*?private\.agent_user_can_access_entity\([\s\S]*?'project'[\s\S]*?'view'/
    );
  });

  it("enforces current own or assigned inbox scope against the source connection", () => {
    const compact = compactSql();
    expect(compact).toMatch(
      /and private\.user_can_view_inbox_connection\( p_actor_user_id, p_company_id, turn\.source_connection_id, \( select inbox_anchor\.opportunity_id from public\.job_conversation_anchors inbox_anchor where inbox_anchor\.company_id = turn\.company_id and inbox_anchor\.conversation_id = turn\.conversation_id and inbox_anchor\.anchor_kind = 'opportunity' \) \)/
    );
  });

  it("returns only immutable turn content and immutable attachment evidence IDs", () => {
    const compact = compactSql();
    expect(compact).toContain("turn.normalized_plain_text");
    expect(compact).toContain("turn.original_content_hash");
    expect(compact).toContain("turn.attachment_evidence_ids");
    expect(compact).not.toContain("join public.email_attachments");
    expect(compact).not.toContain("public.activities");
    expect(compact).toContain("turn.subject");
    expect(compact).not.toContain("null::text");
    expect(compact).toContain("turn.side");
    expect(compact).toContain("turn.participant_id");
    expect(compact).toContain("turn.participant_resolution_status");
    expect(compact).toContain("turn.direction");
    expect(compact).toContain("turn.source_activity_id");
    expect(compact).toContain("turn.source_correspondence_event_id");
    expect(compact).toContain("turn.recipient_identities");
    expect(compact).toContain("turn.cc_recipient_identities");
    expect(compact).toContain("'filename', null");
    expect(compact).not.toContain("'filename', attachment.evidence_id");
    expect(compact).not.toContain("p_source_kind");
    expect(compact).not.toContain("p_trust");
  });

  it("applies the latest append-only redaction overlays before any prompt projection", () => {
    const compact = compactSql();
    expect(compact).toContain("public.job_conversation_redaction_events");
    expect(compact).toMatch(
      /redaction_kind = 'content_redacted'[\s\S]*?order by redaction\.created_at desc, redaction\.id desc[\s\S]*?limit 1/
    );
    expect(compact).toMatch(
      /redaction_kind = 'attachment_redacted'[\s\S]*?order by redaction\.created_at desc, redaction\.id desc[\s\S]*?limit 1/
    );
    expect(compact).toMatch(
      /redaction_kind = 'participant_pseudonymized'[\s\S]*?order by redaction\.created_at desc, redaction\.id desc[\s\S]*?limit 1/
    );
    expect(compact).toContain("'[content redacted]'::text");
    expect(compact).toContain("'[]'::jsonb");
    expect(compact).toContain("'[participant redacted]'::text");
    expect(compact).toContain("'[subject redacted]'::text");
    expect(compact).toContain("redaction_kinds text[]");
    expect(compact).toContain("'ops.redacted-source-version.v1:'");
    expect(compact).toContain("extensions.digest(");
    expect(compact).toMatch(
      /when content_redaction\.id is not null[\s\S]*?attachment_redaction\.id is not null[\s\S]*?participant_redaction\.id is not null[\s\S]*?then 'sha256:' \|\| encode/
    );
  });

  it("bounds canonical attachments and returns deterministic UTC chronology", () => {
    const compact = compactSql();
    expect(compact).toContain(
      "char_length( turn.source_connection_id::text || ':' || turn.provider_message_id ) <= 512"
    );
    expect(compact).toContain(
      "cardinality(turn.attachment_evidence_ids) <= 100"
    );
    expect(compact).toContain(
      "attachment.evidence_id is distinct from btrim(attachment.evidence_id)"
    );
    expect(compact).toContain("length(attachment.evidence_id) > 512");
    expect(compact).toContain("count(distinct attachment.evidence_id)");
    expect(compact).toContain("= cardinality(turn.attachment_evidence_ids)");
    expect(compact).toContain("order by attachment.evidence_id");
    expect(compact).toContain("turn.delivered_at at time zone 'utc'");
    expect(compact).toContain('\'yyyy-mm-dd"t"hh24:mi:ss.ms"z"\'');
    expect(compact).toContain("order by turn.delivered_at, turn.id");
  });

  it("enforces evidence-read bounds at durable turn ingestion, not only at read time", () => {
    const compact = compactSql();
    expect(compact).toContain(
      "add constraint job_conversation_turns_source_version_id_length_check"
    );
    expect(compact).toContain(
      "char_length( source_connection_id::text || ':' || provider_message_id ) <= 512"
    );
    expect(compact).toContain(
      "add constraint job_conversation_turns_participant_id_length_check"
    );
    expect(compact).toContain("char_length(participant_id) <= 512");
    expect(compact).toContain(
      "add constraint job_conversation_turns_evidence_body_length_check"
    );
    expect(compact).toContain("octet_length(normalized_plain_text) <= 8388608");
    expect(compact).toContain(
      "add constraint job_conversation_turns_attachment_count_check"
    );
    expect(compact).toContain("cardinality(attachment_evidence_ids) <= 100");
    expect(compact).toMatch(
      /private\.agent_prompt_identity_array_is_canonical\(\s*attachment_evidence_ids, 100\s*\)/
    );
    expect(compact).toMatch(
      /private\.agent_prompt_identity_array_is_canonical\(\s*recipient_identities, 100\s*\)/
    );
    expect(compact).toMatch(
      /private\.agent_prompt_identity_array_is_canonical\(\s*cc_recipient_identities, 100\s*\)/
    );
    expect(compact).toContain(
      "private.agent_prompt_text_is_safe(provider_message_id, false)"
    );
    expect(compact).toContain(
      "private.agent_prompt_text_is_safe(normalized_plain_text, true)"
    );
    expect(compact).toContain('v_value collate "c" <= v_previous collate "c"');
    expect(compact).toContain('order by attachment.evidence_id collate "c"');
  });

  it("is service-role only", () => {
    const compact = compactSql();
    expect(compact).toContain("auth.role() is distinct from 'service_role'");
    expect(compact).toContain(
      `revoke all on function ${SIGNATURE} from public, anon, authenticated, service_role`
    );
    expect(compact).toContain(
      `grant execute on function ${SIGNATURE} to service_role`
    );
    expect(compact).not.toContain(
      `grant execute on function ${SIGNATURE} to authenticated`
    );
  });
});
