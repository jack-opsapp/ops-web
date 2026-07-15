import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260713205000_email_outbound_learning_queue.sql"
);
const sql = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8")
  : "";
const compactSql = sql.replace(/\s+/g, " ");

describe("email outbound learning queue migration", () => {
  it("creates a transaction-wrapped, service-role-only durable queue", () => {
    expect(existsSync(migrationPath)).toBe(true);
    expect(sql.trim().startsWith("begin;")).toBe(true);
    expect(sql.trim().endsWith("commit;")).toBe(true);
    expect(sql).toContain("create table public.email_outbound_learning_queue");
    expect(sql).toContain(
      "unique (company_id, connection_id, provider_message_id)"
    );
    expect(sql).toContain(
      "alter table public.email_outbound_learning_queue enable row level security"
    );
    expect(sql).toContain(
      "revoke all on table public.email_outbound_learning_queue from public, anon, authenticated, service_role"
    );
  });

  it("stores every durable payload, retry, lease, and audit field", () => {
    for (const fragment of [
      "company_id text not null",
      "connection_id uuid not null",
      "provider_message_id text not null",
      "provider_thread_id text",
      "user_id text not null",
      "from_email text",
      "to_emails text[]",
      "subject text",
      "authored_body text not null",
      "clean_body text not null",
      "opportunity_id uuid",
      "draft_history_id uuid",
      "follow_up_draft_id uuid",
      "draft_delivery_channel text",
      "apply_learning boolean",
      "apply_full_body_learning boolean",
      "draft_correction_facts jsonb",
      "writing_sample jsonb",
      "memory_extraction jsonb",
      "draft_outcome jsonb",
      "preparation_version text",
      "prepared_at timestamptz",
      "applied_at timestamptz",
      "occurred_at timestamptz",
      "status text not null default 'pending'",
      "attempts integer not null default 0",
      "next_attempt_at timestamptz not null default now()",
      "lease_token uuid",
      "lease_expires_at timestamptz",
      "last_error text",
      "completed_lease_token uuid",
      "created_at timestamptz not null default now()",
      "updated_at timestamptz not null default now()",
    ]) {
      expect(sql).toContain(fragment);
    }
    expect(sql).toContain(
      "check (status in ('pending', 'leased', 'completed', 'failed'))"
    );
    expect(sql).toContain("email_outbound_learning_queue_due_idx");
    expect(sql).toContain("email_outbound_learning_queue_stale_lease_idx");
    expect(sql).toContain("email_outbound_learning_queue_connection_idx");
    expect(sql).toContain("email_outbound_learning_queue_opportunity_idx");
    expect(sql).toContain("email_outbound_learning_queue_draft_history_idx");
    expect(sql).toContain("email_outbound_learning_queue_follow_up_draft_idx");
  });

  it("enqueues idempotently while allowing one authoritative provenance enrichment", () => {
    const enqueue = sql.slice(
      sql.indexOf(
        "create or replace function public.enqueue_email_outbound_learning"
      ),
      sql.indexOf(
        "create or replace function public.claim_email_outbound_learning"
      )
    );

    expect(enqueue).toContain(
      "on conflict (company_id, connection_id, provider_message_id)"
    );
    expect(enqueue).toContain("perform pg_advisory_xact_lock(");
    expect(enqueue).toContain("'email-outbound:' || p_company_id");
    expect(enqueue).toContain(
      "provider_thread_id = coalesce(nullif(email_outbound_learning_queue.provider_thread_id, ''), excluded.provider_thread_id)"
    );
    expect(enqueue).toContain(
      "else coalesce(nullif(email_outbound_learning_queue.authored_body, ''), excluded.authored_body)"
    );
    expect(enqueue).toContain(
      "else coalesce(nullif(email_outbound_learning_queue.clean_body, ''), excluded.clean_body)"
    );
    expect(enqueue).not.toContain("p_body_text");
    expect(enqueue).not.toContain("status = excluded.status");
    expect(enqueue).toContain("c.company_id = p_company_id");
    expect(enqueue).toContain("p_draft_history_id uuid default null");
    expect(enqueue).toContain("p_follow_up_draft_id uuid default null");
    expect(enqueue).toContain("p_opportunity_id uuid default null");
    expect(enqueue).toContain("p_draft_delivery_channel text default null");
    expect(enqueue).toContain("v_draft.mailbox_draft_id is null");
    expect(enqueue).toContain("d.company_id::text = p_company_id");
    expect(enqueue).toContain("f.company_id::text = p_company_id");
    expect(enqueue).toContain("u.deleted_at is null");
    expect(enqueue).toContain("coalesce(u.is_active, true)");
    expect(enqueue).toContain(
      "email_outbound_learning_queue.draft_delivery_channel is null and excluded.draft_delivery_channel is not null"
    );
    expect(enqueue).toContain("lease_token = case");
    expect(enqueue).toContain("lease_expires_at = case");
    expect(enqueue).toContain(
      "v_existing_queue public.email_outbound_learning_queue%rowtype"
    );
    expect(enqueue).toContain("v_provenance_enrichment boolean := false");
    expect(enqueue).toContain(
      "subject = case when v_provenance_enrichment then excluded.subject"
    );
    expect(enqueue).toContain(
      "authored_body = case when v_provenance_enrichment then excluded.authored_body"
    );
    expect(enqueue).toContain(
      "clean_body = case when v_provenance_enrichment then excluded.clean_body"
    );
    expect(enqueue).not.toContain("writing_sample = excluded.writing_sample");
    expect(enqueue).not.toContain(
      "memory_extraction = excluded.memory_extraction"
    );
    expect(enqueue).toContain("v_provider_thread_id text := nullif(");
    expect(enqueue).toContain("v_draft.thread_id <> v_provider_thread_id");
    expect(enqueue).toContain("v_provider_thread_id is not null");
    expect(enqueue).toContain(
      "v_row.provider_thread_id is distinct from v_provider_thread_id"
    );
    expect(enqueue).toContain(
      "(v_draft_history_id is not null or v_follow_up_draft_id is not null)"
    );
    expect(enqueue).toContain(
      "v_row.subject is distinct from coalesce(p_subject, '')"
    );
    expect(enqueue).not.toContain(
      "when email_outbound_learning_queue.status = 'completed'"
    );
  });

  it("claims atomically with skip locked and recovers stale leases", () => {
    const claim = sql.slice(
      sql.indexOf(
        "create or replace function public.claim_email_outbound_learning"
      ),
      sql.indexOf(
        "create or replace function public.prepare_email_outbound_learning"
      )
    );

    expect(claim).toContain("for update skip locked");
    expect(claim).toContain("status = 'leased'");
    expect(claim).toContain("lease_expires_at <= now()");
    expect(claim).toContain("lease_token = gen_random_uuid()");
    expect(claim).toContain("attempts = q.attempts + 1");
    expect(claim).toContain("make_interval(secs => v_lease_seconds)");
    expect(claim).toContain("q.attempts < q.max_attempts");
    expect(claim).toContain("terminalized as (");
    expect(claim).toContain("last_failed_at = now()");
    expect(claim).toContain("select * from terminalized");
    expect(claim).toContain("union all");
    expect(claim).toContain("select * from claimed");
  });

  it("persists prepared extraction and atomically applies receipts, effects, and completion", () => {
    const prepare = sql.slice(
      sql.indexOf(
        "create or replace function public.prepare_email_outbound_learning"
      ),
      sql.indexOf(
        "create or replace function public.apply_email_outbound_learning"
      )
    );
    const apply = sql.slice(
      sql.indexOf(
        "create or replace function public.apply_email_outbound_learning"
      ),
      sql.indexOf(
        "create or replace function public.retry_email_outbound_learning"
      )
    );
    const retry = sql.slice(
      sql.indexOf(
        "create or replace function public.retry_email_outbound_learning"
      ),
      sql.indexOf(
        "create or replace function public.defer_email_outbound_learning"
      )
    );
    const defer = sql.slice(
      sql.indexOf(
        "create or replace function public.defer_email_outbound_learning"
      ),
      sql.indexOf(
        "revoke all on function public.enqueue_email_outbound_learning"
      )
    );

    for (const rpc of [prepare, apply, retry]) {
      expect(rpc).toContain("status = 'leased'");
      expect(rpc).toContain("lease_token = p_lease_token");
      expect(rpc).toContain("lease_expires_at > now()");
    }
    expect(prepare).toContain("p_apply_learning boolean");
    expect(prepare).toContain("p_apply_full_body_learning boolean");
    expect(prepare).toContain("p_draft_correction_facts jsonb");
    expect(prepare).toMatch(
      /if p_apply_learning and not exists \([\s\S]*?feature_key = 'phase_c'[\s\S]*?then\s+raise exception 'outbound learning phase_c feature is disabled';/
    );
    expect(prepare).toContain("apply_learning = p_apply_learning");
    expect(prepare).toContain(
      "apply_full_body_learning = p_apply_full_body_learning"
    );
    expect(prepare).toContain(
      "p_apply_full_body_learning and v_job.learning_authority <> 'operator_authored'"
    );
    expect(prepare).toContain(
      "writing_sample = coalesce(writing_sample, p_writing_sample)"
    );
    expect(prepare).toContain(
      "memory_extraction = coalesce(memory_extraction, p_memory_extraction)"
    );
    expect(prepare).toContain(
      "draft_outcome = coalesce(draft_outcome, p_draft_outcome)"
    );
    expect(prepare).toContain(
      "draft_correction_facts = p_draft_correction_facts"
    );
    expect(apply).toContain("if v_job.apply_learning then");
    expect(apply).toContain("if v_job.apply_full_body_learning then");
    expect(compactSql).toContain(
      "writing_sample_id uuid references public.email_outbound_writing_samples(id) on delete cascade"
    );
    expect(compactSql).not.toContain(
      "writing_sample_id uuid not null references public.email_outbound_writing_samples(id) on delete cascade"
    );
    expect(apply).not.toContain("feature_key = 'phase_c'");
    expect(apply).toContain(
      "insert into public.email_outbound_writing_samples"
    );
    expect(apply).toContain(
      "insert into public.email_outbound_memory_evidence"
    );
    expect(apply).toContain("insert into public.agent_writing_profiles");
    expect(apply).toContain("update public.agent_memories");
    expect(apply).toContain("insert into public.agent_memories");
    expect(apply).toContain("insert into public.agent_knowledge_graph");
    expect(apply).toContain("update public.ai_draft_history d");
    expect(apply).toContain("update public.opportunity_follow_up_drafts f");
    expect(apply).toContain(
      "v_follow_up.ai_draft_history_id is distinct from v_effective_draft_id"
    );
    expect(apply).not.toMatch(
      /v_follow_up\.ai_draft_history_id is not null\s+and v_follow_up\.ai_draft_history_id is distinct from v_effective_draft_id/
    );
    expect(apply).toContain(
      "edit_distance = (v_draft_outcome ->> 'editDistance')::integer"
    );
    expect(apply).toContain("changes_made = v_draft_outcome -> 'changesMade'");
    expect(apply).toContain(
      "when v_job.draft_delivery_channel = 'mailbox' then 'sent_from_mailbox'"
    );
    expect(apply).toContain(
      "sent_provider_message_id = coalesce(d.sent_provider_message_id, v_job.provider_message_id)"
    );
    expect(apply).toContain(
      "sent_without_changes = (v_draft_outcome ->> 'sentWithoutChanges')::boolean"
    );
    expect(apply).toContain("subject_source = case");
    expect(apply).toContain("draft_history_id = coalesce");
    expect(apply).toContain("follow_up_draft_id = coalesce");
    expect(apply).toContain("status = 'completed'");
    expect(apply).toContain("applied_at = coalesce(q.applied_at, now())");
    expect(apply).not.toContain("http");
    expect(apply).not.toContain("openai");
    expect(retry).toContain("least(3600");
    expect(retry).toContain("power(2::numeric");
    expect(retry).toContain(
      "status = case when attempts >= max_attempts then 'failed' else 'pending' end"
    );
    expect(retry).toContain("if v_row.status = 'completed' then");
    expect(apply).toContain(
      "v_job.completed_lease_token is distinct from p_lease_token"
    );
    expect(retry).toContain(
      "v_row.completed_lease_token is distinct from p_lease_token"
    );
    expect(defer).toContain("attempts = greatest(0, attempts - 1)");
    expect(defer).toContain("p_delay_seconds integer default 900");
  });

  it("uses provider-scoped receipts and revalidates tenant, connection, user, and feature gate", () => {
    expect(sql).toContain("create table public.email_outbound_writing_samples");
    expect(sql).toContain("create table public.email_outbound_memory_evidence");
    expect(sql).toContain(
      "unique (company_id, connection_id, provider_message_id)"
    );
    expect(sql).toContain(
      "unique (company_id, connection_id, provider_message_id, evidence_kind, evidence_key)"
    );
    expect(sql).toContain("length(evidence_key) <= 200");
    expect(sql).toContain("length(v_fact_json ->> 'evidenceKey') > 200");
    expect(sql).toContain("length(v_edge_json ->> 'evidenceKey') > 200");
    expect(sql).toContain("c.company_id = v_job.company_id");
    expect(sql).toContain("c.type = 'company'");
    expect(sql).toContain("or c.user_id = v_job.user_id");
    expect(sql).toContain("u.id::text = v_job.user_id");
    expect(sql).toContain("u.company_id::text = v_job.company_id");
    expect(sql).toContain("coalesce(u.is_active, true)");
    expect(sql).toContain("u.deleted_at is null");
    expect(sql).toContain("o.company_id::text = v_job.company_id");
    expect(sql).toContain("feature_key = 'phase_c'");
    expect(sql).toContain("enabled is true");
    expect(sql).toContain("m.user_id is not distinct from v_job.user_id");
    expect(sql).toContain("for update");
    expect(sql).toContain("order by prepared_fact.value ->> 'evidenceKey'");
    expect(sql).toContain("order by edge.value ->> 'evidenceKey'");
  });

  it("applies newly prepared evidence when a completed receipt is upgraded with draft provenance", () => {
    const apply = sql.slice(
      sql.indexOf(
        "create or replace function public.apply_email_outbound_learning"
      ),
      sql.indexOf(
        "create or replace function public.retry_email_outbound_learning"
      )
    );

    const profileReceiptUpdate = apply.indexOf(
      "update public.email_outbound_writing_samples r"
    );
    const receiptGuardEnd = apply.indexOf("  end if;", profileReceiptUpdate);
    const factLoop = apply.indexOf("  for v_fact in");
    expect(profileReceiptUpdate).toBeGreaterThan(-1);
    expect(receiptGuardEnd).toBeGreaterThan(profileReceiptUpdate);
    expect(factLoop).toBeGreaterThan(receiptGuardEnd);
    expect(apply).toMatch(
      /for v_edge in[\s\S]*?end loop;\s*update public\.email_outbound_learning_queue q\s*set applied_at = coalesce\(q\.applied_at, now\(\)\)/
    );
    expect(apply).not.toContain("elsif v_job.applied_at is null then");
  });

  it("clears stale prepared extraction on enrichment while preserving immutable completed receipts", () => {
    const enqueue = sql.slice(
      sql.indexOf(
        "create or replace function public.enqueue_email_outbound_learning"
      ),
      sql.indexOf(
        "create or replace function public.claim_email_outbound_learning"
      )
    );

    const conflictUpdate = enqueue.slice(enqueue.indexOf("do update set"));
    for (const field of ["writing_sample", "memory_extraction"]) {
      expect(conflictUpdate).toMatch(
        new RegExp(
          `${field} = case\\s+when v_provenance_enrichment\\s+and not exists \\(\\s+select 1\\s+from public\\.email_outbound_writing_samples receipt\\s+where receipt\\.queue_id = email_outbound_learning_queue\\.id\\s+\\)\\s+then null\\s+else email_outbound_learning_queue\\.${field}\\s+end`
        )
      );
    }
    expect(conflictUpdate).toContain("apply_learning = case");
    expect(conflictUpdate).toContain("draft_correction_facts = case");
    expect(conflictUpdate).toContain("draft_outcome = case");
  });

  it("provides sanitized terminal-failure diagnostics and an audited requeue path", () => {
    expect(sql).toContain("email_outbound_learning_queue_failed_idx");
    expect(sql).toContain(
      "create or replace function public.diagnose_email_outbound_learning"
    );
    expect(sql).toContain(
      "create or replace function public.requeue_failed_email_outbound_learning"
    );
    const diagnostics = sql.slice(
      sql.indexOf(
        "create or replace function public.diagnose_email_outbound_learning"
      ),
      sql.indexOf(
        "create or replace function public.requeue_failed_email_outbound_learning"
      )
    );
    expect(diagnostics).not.toContain("authored_body");
    expect(diagnostics).not.toContain("clean_body");
    expect(diagnostics).not.toContain("q.writing_sample");
    expect(diagnostics).not.toContain("q.memory_extraction");
    expect(diagnostics).toContain("p_before_sort_at timestamptz default null");
    expect(diagnostics).toContain("p_before_id uuid default null");
    expect(diagnostics).toContain(
      "(p_before_sort_at is null) is distinct from (p_before_id is null)"
    );
    expect(diagnostics).toContain("if v_status = 'failed' then");
    expect(diagnostics).toContain(
      "(q.last_failed_at, q.id) < (p_before_sort_at, p_before_id)"
    );
    expect(diagnostics).toContain("order by q.last_failed_at desc, q.id desc");
    expect(diagnostics).toContain(
      "(q.created_at, q.id) < (p_before_sort_at, p_before_id)"
    );
    expect(diagnostics).toContain("order by q.created_at desc, q.id desc");
    expect(sql).toContain(
      "on public.email_outbound_learning_queue (last_failed_at desc, id desc)"
    );
    expect(sql).toContain(
      "on public.email_outbound_learning_queue (company_id, last_failed_at desc, id desc)"
    );
    expect(sql).toContain("requeue_count = q.requeue_count + 1");
    expect(sql).toContain("last_terminal_error");
    expect(sql).toContain("last_requeue_reason");
  });

  it("allows only narrow service-role RPC execution and no direct queue or receipt DML", () => {
    for (const table of [
      "email_outbound_learning_queue",
      "email_outbound_writing_samples",
      "email_outbound_memory_evidence",
    ]) {
      expect(sql).toContain(
        `revoke all on table public.${table} from public, anon, authenticated, service_role`
      );
    }
    expect(sql).not.toContain(
      "grant select, insert, update, delete on table public.email_outbound_learning_queue to service_role"
    );
    expect(sql).toContain("email_outbound_writing_samples_queue_idx");
    expect(sql).toContain("email_outbound_writing_samples_connection_idx");
    expect(sql).toContain("email_outbound_writing_samples_profile_idx");
    expect(sql).toContain("email_outbound_memory_evidence_queue_idx");
    expect(sql).toContain("email_outbound_memory_evidence_writing_sample_idx");
    expect(sql).toContain("email_outbound_memory_evidence_connection_idx");
    expect(sql).toContain("email_outbound_memory_evidence_memory_idx");
    expect(sql).toContain("email_outbound_memory_evidence_graph_idx");
  });

  it("exposes privileged RPCs only to service_role", () => {
    for (const signature of [
      "enqueue_email_outbound_learning(text, uuid, text, text, text, text, text[], text, text, text, timestamptz, uuid, uuid, uuid, text)",
      "claim_email_outbound_learning(integer, integer)",
      "prepare_email_outbound_learning(uuid, uuid, boolean, boolean, jsonb, jsonb, jsonb, jsonb, text)",
      "apply_email_outbound_learning(uuid, uuid)",
      "retry_email_outbound_learning(uuid, uuid, text)",
      "defer_email_outbound_learning(uuid, uuid, text, integer)",
      "diagnose_email_outbound_learning(text, text, integer, timestamptz, uuid)",
      "requeue_failed_email_outbound_learning(uuid, text)",
    ]) {
      expect(sql).toContain(
        `revoke all on function public.${signature} from public, anon, authenticated, service_role`
      );
      expect(sql).toContain(
        `grant execute on function public.${signature} to service_role`
      );
    }
  });

  it("binds each applied draft to one immutable provider message", () => {
    expect(sql).toContain(
      "alter table public.ai_draft_history add column if not exists sent_provider_message_id text"
    );
    expect(sql).toContain(
      "create unique index if not exists ai_draft_history_sent_provider_message_unique"
    );
    expect(sql).toContain(
      "v_draft.sent_provider_message_id <> v_job.provider_message_id"
    );
    expect(sql).not.toContain("changes_made ->> 'providerMessageId'");
  });

  it("deduplicates memory evidence by normalized full content and hardens definer namespaces", () => {
    expect(sql).not.toContain("lower(left(m.content, 50))");
    expect(compactSql).toContain(
      "lower(regexp_replace(btrim(m.content), '[[:space:]]+', ' ', 'g'))"
    );
    expect(compactSql).toMatch(
      /lower\(regexp_replace\(\s*btrim\(v_fact_json ->> 'content'\), '\[\[:space:\]\]\+', ' ', 'g'\s*\)\)/
    );
    expect(sql).not.toContain("set search_path = public");
    expect(sql).toContain("::extensions.vector(1536)");
  });
});
