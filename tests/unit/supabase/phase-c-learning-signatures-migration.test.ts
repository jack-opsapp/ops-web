import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260713210000_phase_c_learning_signatures.sql"
);
const sql = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8")
  : "";
const compactSql = sql.replace(/\s+/g, " ");
const queueMigrationPath = join(
  process.cwd(),
  "supabase/migrations/20260713205000_email_outbound_learning_queue.sql"
);
const queueSql = existsSync(queueMigrationPath)
  ? readFileSync(queueMigrationPath, "utf8")
  : "";
const compactQueueSql = queueSql.replace(/\s+/g, " ");
const databaseTypesPath = join(
  process.cwd(),
  "src/lib/types/database.types.ts"
);
const databaseTypes = existsSync(databaseTypesPath)
  ? readFileSync(databaseTypesPath, "utf8")
  : "";

describe("Phase C learning and email signature migration", () => {
  it("is a transaction-wrapped additive migration", () => {
    expect(existsSync(migrationPath)).toBe(true);
    expect(sql.trim().startsWith("begin;")).toBe(true);
    expect(sql.trim().endsWith("commit;")).toBe(true);
    expect(sql).not.toContain(
      "drop table public.email_outbound_learning_queue"
    );
  });

  it("creates a tenant-safe, service-role-only signature store", () => {
    for (const fragment of [
      "create table public.email_signatures",
      "company_id uuid not null",
      "connection_id uuid not null",
      "scope_user_id uuid",
      "source text not null",
      "check (source in ('ops', 'gmail_send_as', 'microsoft_confirmed'))",
      "content_html text",
      "content_text text",
      "content_hash text not null",
      "provider_identity text",
      "active boolean not null default true",
      "fetched_at timestamptz",
      "confirmed_at timestamptz",
      "created_by uuid",
      "updated_by uuid",
      "created_at timestamptz not null default now()",
      "updated_at timestamptz not null default now()",
      "create trigger email_signatures_tenant_integrity",
      "email_signatures_active_scope_source_unique",
      "alter table public.email_signatures enable row level security",
      "revoke all on table public.email_signatures from public, anon, authenticated, service_role",
      "grant select, insert, update, delete on table public.email_signatures to service_role",
    ]) {
      expect(compactSql.toLowerCase()).toContain(fragment.toLowerCase());
    }
    expect(sql).toContain(
      "email signature connection does not belong to company"
    );
    expect(sql).toContain(
      "email signature scope user does not belong to company"
    );
    expect(sql).toContain("email signature content contains unsafe markup");
    expect(sql).toContain("content_hash ~ '^[0-9a-f]{64}$'");
    expect(sql).toContain("nulls not distinct");
  });

  it("adds queue authority/profile fields and exposes one unambiguous enqueue RPC", () => {
    expect(sql).toContain(
      "add column if not exists profile_type text not null default 'general'"
    );
    expect(sql).toContain(
      "add column if not exists learning_authority text not null default 'autonomous'"
    );
    expect(sql).toContain(
      "add column if not exists apply_full_body_learning boolean"
    );
    expect(compactSql).toMatch(
      /learning_authority in \(\s*'operator_authored',\s*'operator_approved',\s*'autonomous'\s*\)/
    );
    expect(compactSql).toContain(
      "learning_authority <> 'autonomous' or apply_learning is not true"
    );
    expect(compactSql).toMatch(
      /alter function public\.enqueue_email_outbound_learning\(\s*text,\s*uuid,\s*text,\s*text,\s*text,\s*text,\s*text\[\],\s*text,\s*text,\s*text,\s*timestamptz,\s*uuid,\s*uuid,\s*uuid,\s*text\s*\) rename to enqueue_email_outbound_learning_legacy_internal/
    );
    expect(sql).toContain("p_profile_type text default 'general'");
    expect(sql).toContain("p_learning_authority text default 'autonomous'");
    expect(sql).toContain(
      "grant execute on function public.enqueue_email_outbound_learning(text, uuid, text, text, text, text, text[], text, text, text, timestamptz, uuid, uuid, uuid, text, text, text) to service_role"
    );
    expect(compactSql).toContain(
      "revoke all on function public.enqueue_email_outbound_learning_legacy_internal"
    );
    expect(sql).toContain("v_verified_authority text := 'autonomous'");
    expect(sql).toContain(
      "v_verified_authority_rank > v_existing_authority_rank"
    );
    expect(sql).toContain("and q.profile_type = 'general'");
  });

  it("keeps queue CHECK creation non-conflicting across the 2050 to 2100 chain", () => {
    expect(compactQueueSql).toContain(
      "profile_type text not null default 'general' check (btrim(profile_type) <> '' and length(profile_type) <= 64)"
    );
    expect(compactQueueSql).toMatch(
      /learning_authority text not null default 'autonomous' check \( learning_authority in \( 'operator_authored', 'operator_approved', 'autonomous' \) \)/
    );
    expect(compactSql).toContain(
      "add column if not exists profile_type text not null default 'general' check (btrim(profile_type) <> '' and length(profile_type) <= 64)"
    );
    expect(compactSql).toMatch(
      /add column if not exists learning_authority text not null default 'autonomous' check \( learning_authority in \( 'operator_authored', 'operator_approved', 'autonomous' \) \)/
    );
    expect(compactSql).not.toContain(
      "add constraint email_outbound_learning_queue_profile_type_check"
    );
    expect(compactSql).not.toContain(
      "add constraint email_outbound_learning_queue_authority_check"
    );
  });

  it("derives human learning authority from database-verifiable send provenance", () => {
    const enqueue = sql.slice(
      sql.indexOf(
        "create or replace function public.enqueue_email_outbound_learning("
      ),
      sql.indexOf("-- Each human edit contributes one immutable evidence row")
    );

    expect(enqueue).toContain("from public.activities a");
    expect(enqueue).toContain("a.email_connection_id = p_connection_id");
    expect(enqueue).toContain("a.email_message_id = p_provider_message_id");
    expect(enqueue).toContain("a.direction = 'outbound'");
    expect(enqueue).toContain("v_activity.created_by::text = v_row.user_id");
    expect(enqueue).toContain(
      "v_activity.draft_history_id = v_row.draft_history_id"
    );
    expect(enqueue).toContain("from public.pending_auto_sends pas");
    expect(enqueue).toContain("pas.status in ('pending', 'sent')");
    expect(enqueue).toContain("v_connection.type = 'individual'");
    expect(enqueue).toContain("v_connection.user_id = v_row.user_id");
    expect(enqueue).toContain("lower(btrim(v_connection.email))");
    expect(enqueue).toContain("lower(btrim(v_user.email))");
    expect(enqueue).not.toContain("then v_learning_authority");
    expect(enqueue).not.toContain("v_incoming_authority_rank");
  });

  it("promotes repeated human edits exactly once at explicit thresholds", () => {
    expect(sql).toContain("create table public.email_outbound_edit_evidence");
    expect(sql).toContain("create table public.email_outbound_edit_promotions");
    expect(sql).toContain("unique (queue_id, evidence_kind, evidence_key)");
    expect(sql).toContain(
      "unique (company_id, user_id, profile_type, evidence_kind, evidence_key)"
    );
    expect(sql).toContain(
      "create or replace function public.promote_email_outbound_edit_learning"
    );
    expect(compactSql).toMatch(
      /v_job\.learning_authority not in \(\s*'operator_authored',\s*'operator_approved'\s*\)/
    );
    expect(compactSql).toContain(
      "when v_change.evidence_kind in ( 'greeting', 'closing', 'substitution', 'subject' ) then 3 else 5"
    );
    expect(sql).toContain(
      "jsonb_array_elements(v_job.draft_outcome -> 'changesMade')"
    );
    expect(sql).toContain(
      "on conflict (queue_id, evidence_kind, evidence_key) do nothing"
    );
    expect(sql).toContain(
      "on conflict (company_id, user_id, profile_type, evidence_kind, evidence_key) do nothing"
    );
    expect(sql).toContain("if v_evidence_count < v_threshold then");
    expect(sql).toContain("limit 20");
    expect(sql).toContain(
      "grant execute on function public.promote_email_outbound_edit_learning(uuid) to service_role"
    );
    expect(compactSql).toContain(
      "alter function public.apply_email_outbound_learning(uuid, uuid) rename to apply_email_outbound_learning_legacy_internal"
    );
    expect(sql).toContain(
      "perform public.promote_email_outbound_edit_learning(p_job_id)"
    );
    expect(sql).toContain(
      "revoke all on function public.apply_email_outbound_learning_legacy_internal(uuid, uuid) from public, anon, authenticated, service_role"
    );
  });

  it("separates DB-verified full-body learning from operator-approved edit evidence", () => {
    expect(compactSql).toContain(
      "apply_full_body_learning is not true or learning_authority = 'operator_authored'"
    );
    expect(compactSql).toContain(
      "apply_full_body_learning is not true or apply_learning is true"
    );
    expect(compactSql).toContain(
      "alter column writing_sample_id drop not null"
    );
  });

  it("learns operator new-thread subjects separately and never learns reply prefixes", () => {
    expect(compactSql).toContain(
      "check ( subject_source is null or subject_source in ( 'thread', 'operator', 'configured', 'generated', 'learned', 'fallback' ) )"
    );
    expect(sql).toContain("AI-generated or learned new-thread subject");
    expect(sql).toContain(
      "add column if not exists subject_preferences jsonb not null default '{}'::jsonb"
    );
    expect(compactSql).toContain(
      "v_job.learning_authority in ('operator_authored', 'operator_approved')"
    );
    expect(sql).toContain("v_draft.source_message_id is null");
    expect(compactSql).toContain(
      "v_draft.id is null and v_job.draft_history_id is null and v_job.learning_authority = 'operator_authored'"
    );
    expect(compactSql).toMatch(
      /v_job\.learning_authority = 'operator_approved' and not coalesce\( \(v_job\.draft_outcome ->> 'subjectEdited'\)::boolean, false \)/
    );
    expect(sql).toContain("coalesce(v_original_subject, '') = ''");
    expect(sql).toContain("v_final_subject !~* '^(re|fw|fwd)\\s*:'");
    expect(sql).toContain("'subject'");
    expect(sql).toContain("subject_preferences");
    expect(sql).toContain("'preferred_patterns'");
    expect(sql).not.toContain("'recent_exact'");
  });

  it("de-identifies learned subjects and never stores a lead's exact subject as a reusable candidate", () => {
    const promote = sql.slice(
      sql.indexOf(
        "create or replace function public.promote_email_outbound_edit_learning"
      ),
      sql.indexOf(
        "revoke all on function public.promote_email_outbound_edit_learning"
      )
    );

    expect(sql).toContain(
      "create or replace function private.replace_email_subject_literal"
    );
    for (const placeholder of [
      "{contact}",
      "{company}",
      "{address}",
      "{project}",
      "{email}",
      "{number}",
    ]) {
      expect(promote).toContain(`'${placeholder}'`);
    }
    expect(promote).toContain("from public.opportunities o");
    expect(promote).toContain("from public.clients c");
    expect(promote).toContain("and v_opportunity.id is not null");
    expect(compactSql).toContain("v_client.name, '{company}'");
    expect(promote).toContain("from regexp_split_to_table(");
    expect(sql).toContain("v_search_from := v_position");
    expect(promote).toContain("v_subject_pattern := regexp_replace(");
    expect(promote).toContain(
      "'[[:alnum:]._%+-]+@[[:alnum:].-]+\\.[[:alpha:]]{2,}'"
    );
    expect(promote).toContain("'[[:digit:]]+'");
    expect(compactSql).toContain(
      "'subject', 'subject', null::text, v_subject_pattern, v_subject_pattern"
    );
    expect(promote).not.toContain("'recent_exact'");
  });

  it("keeps subject preference counts and examples current after first promotion", () => {
    const promote = sql.slice(
      sql.indexOf(
        "create or replace function public.promote_email_outbound_edit_learning"
      ),
      sql.indexOf(
        "revoke all on function public.promote_email_outbound_edit_learning"
      )
    );

    expect(promote).toContain(
      "if v_promotion_id is null and v_evidence.evidence_kind <> 'subject' then"
    );
    expect(promote).toContain(
      "update public.email_outbound_edit_promotions promotion"
    );
    expect(promote.replace(/\s+/g, " ")).toMatch(
      /evidence_count = greatest\(\s*promotion\.evidence_count,\s*v_evidence_count\s*\)/
    );
    expect(promote).toContain(
      "if v_promotion_id is not null then\n      v_promotions_inserted := v_promotions_inserted + 1;"
    );
  });

  it("preserves completed legacy learning receipts while failing closed for unfinished jobs", () => {
    const backfillStart = sql.indexOf(
      "update public.email_outbound_learning_queue"
    );
    const backfill = sql.slice(
      backfillStart,
      sql.indexOf(
        "alter table public.email_outbound_learning_queue",
        backfillStart
      )
    );

    expect(backfill).toContain("and status <> 'completed'");
    expect(compactSql).toContain(
      "status = 'completed' and applied_at is not null and completed_at is not null"
    );
  });

  it("hardens signature markup and verifies the canonical content hash in the database", () => {
    expect(sql).toContain("&#([0-9]+|x[0-9a-f]+);");
    expect(sql).toContain("&[a-z][a-z0-9]+;");
    expect(sql).toContain("url[[:space:]]*\\(");
    expect(sql).toContain("expression[[:space:]]*\\(");
    expect(sql).toContain("@import");
    expect(sql).toContain("behavior[[:space:]]*:");
    expect(sql).toContain("-moz-binding[[:space:]]*:");
    expect(sql).toContain("extensions.digest(");
    expect(compactSql).toMatch(
      /convert_to\(\s*coalesce\(new\.content_html, ''\) \|\| chr\(0\) \|\| coalesce\(new\.content_text, ''\), 'UTF8'\s*\)/
    );
    expect(sql).toContain(
      "email signature content hash does not match canonical content"
    );
    expect(sql).not.toContain("set search_path = public");
    expect(sql).not.toContain("set search_path = public, extensions");
    expect(sql).not.toMatch(/(^|[^.])digest\(/m);
  });

  it("supports keyed notification creation and atomically opens or resolves signature prompts", () => {
    expect(sql).toContain("p_dedupe_key text default null");
    expect(sql).toContain("deep_link_type");
    expect(sql).toContain("dedupe_key");
    expect(sql).toContain(
      "create or replace function public.sync_email_signature_notification"
    );
    expect(sql).toContain("'email_signature_required'");
    expect(sql).toContain(
      "Add a signature so OPS includes it in drafts from this inbox."
    );
    expect(sql).not.toContain(
      "Add a signature before OPS drafts email from this inbox."
    );
    expect(compactSql).toContain(
      "'email-signature:' || p_connection_id::text || ':' || p_scope_user_id::text"
    );
    expect(sql).toContain(
      "'/settings?section=email&connection=' || p_connection_id::text"
    );
    expect(sql).toContain("'email_signature'");
    expect(sql).toContain("persistent");
    expect(sql).toContain("resolved_at = now()");
    expect(sql).toContain("resolution_reason = 'signature_available'");
    expect(sql).toContain(
      "grant execute on function public.sync_email_signature_notification(uuid, uuid, uuid) to service_role"
    );
  });

  it("matches runtime signature precedence and keeps notification helpers service-role-only", () => {
    const sync = sql.slice(
      sql.indexOf(
        "create or replace function public.sync_email_signature_notification"
      ),
      sql.indexOf(
        "revoke all on function public.sync_email_signature_notification"
      )
    );

    expect(sync).toContain("nullif(btrim(s.content_html), '') is not null");
    expect(sync).toContain("nullif(btrim(s.content_text), '') is not null");
    expect(sync).toContain("s.source = 'ops'");
    expect(sync).toContain("s.scope_user_id = p_scope_user_id");
    expect(sync).toContain("s.scope_user_id is null");
    expect(sync).toContain("s.source <> 'ops'");
    expect(sync.replace(/\s+/g, " ")).toContain(
      "lower(btrim(s.provider_identity)) = lower(btrim(v_connection.email))"
    );
    expect(compactSql).toContain(
      "grant execute on function public.create_notification_if_new( text, text, text, text, text, boolean, text, text, text, text, text ) to service_role"
    );
    expect(compactSql).not.toContain("to anon, authenticated, service_role");
  });

  it("atomically reassigns one active Phase C mailbox draft and preserves audit history", () => {
    expect(sql).toContain(
      "create or replace function public.reassign_phase_c_mailbox_draft"
    );
    expect(sql).toContain("p_expected_old_draft_history_id uuid default null");
    expect(sql).toContain("p_subject text default null");
    expect(sql).toContain("perform pg_advisory_xact_lock(");
    expect(sql).toContain("for update");
    expect(sql).toContain("d.origin = 'phase_c'");
    expect(sql).toContain("d.status in ('drafted', 'auto_drafted')");
    expect(sql).toContain("status = 'superseded'");
    expect(sql).toContain("discarded_at = coalesce(d.discarded_at, now())");
    expect(sql).toContain("ai_draft_history_one_active_mailbox_draft_unique");
    expect(compactSql).toContain(
      "where status = 'auto_drafted' and mailbox_draft_id is not null and connection_id is not null"
    );
    expect(sql).toContain("'superseded_count', v_superseded_count");
    expect(sql).not.toMatch(/set[\s\S]{0,300}subject_source\s*=/);
    expect(compactSql).toContain(
      "grant execute on function public.reassign_phase_c_mailbox_draft(uuid, uuid, text, uuid, text, uuid, text) to service_role"
    );
    expect(databaseTypes).toContain("reassign_phase_c_mailbox_draft:");
    expect(databaseTypes).toContain(
      "p_expected_old_draft_history_id?: string | null"
    );
  });

  it("replaces active signatures transactionally while retaining inactive revisions", () => {
    const replace = sql.slice(
      sql.indexOf("create or replace function public.replace_email_signature"),
      sql.indexOf(
        "create or replace function public.reassign_phase_c_mailbox_draft"
      )
    );

    expect(replace).toContain("returns public.email_signatures");
    expect(replace).toContain("perform pg_advisory_xact_lock(");
    expect(replace).toContain("for update");
    expect(replace).toContain("update public.email_signatures s");
    expect(replace).toContain("set active = false");
    expect(replace).toContain("insert into public.email_signatures");
    expect(replace).toContain("returning * into v_signature");
    expect(compactSql).toContain(
      "grant execute on function public.replace_email_signature(uuid, uuid, uuid, text, text, text, text, text, timestamptz, timestamptz, uuid) to service_role"
    );
    expect(databaseTypes).toContain("replace_email_signature:");
    expect(databaseTypes).toContain("p_actor_user_id: string | null");
    expect(databaseTypes).toContain(
      'Returns: Database["public"]["Tables"]["email_signatures"]["Row"]'
    );
  });
});
