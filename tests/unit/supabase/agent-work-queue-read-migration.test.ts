import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const NAME = "20260829110001_agent_work_queue_read.sql";
const BODY = readFileSync(
  join(
    process.cwd(),
    "src/lib/agent-control-plane/services/p2/work-queue/sql/agent_work_queue_read.body.sql"
  ),
  "utf8"
);
const MIGRATION = readFileSync(
  join(process.cwd(), "supabase/migrations", NAME),
  "utf8"
);
const SQL = BODY.toLowerCase().replace(/\s+/g, " ");
const RUNTIME = readFileSync(
  join(process.cwd(), "tests/sql/agent-work-queue-reads-runtime.sql"),
  "utf8"
).toLowerCase();
const REPLAY = readFileSync(
  join(process.cwd(), "tests/sql/agent-work-queue-reads-replay-runtime.sql"),
  "utf8"
).toLowerCase();

describe("P2 work queue read SQL", () => {
  it("byte-matches its sole generated reservation", () => {
    expect(
      readdirSync(join(process.cwd(), "supabase/migrations")).filter((name) =>
        name.endsWith("_agent_work_queue_read.sql")
      )
    ).toEqual([NAME]);
    expect(MIGRATION).toBe(BODY);
    expect(SQL).toContain("task 17 canonical work-queue read body");
  });

  it("uses one service-only outer RPC and only the seven frozen private projections", () => {
    expect(
      SQL.match(/create or replace function public\.read_agent_/g) ?? []
    ).toHaveLength(1);
    expect(SQL).toContain("public.read_agent_work_queue_as_system");
    expect(SQL).toContain("private.agent_p2_work_queue_attention_v1");
    for (const helper of [
      "agent_p2_task_attention_v1",
      "agent_p2_legacy_lead_attention_v1",
      "agent_p2_legacy_correspondence_attention_v1",
      "agent_p2_legacy_schedule_attention_v1",
      "agent_p2_sales_document_attention_v1",
      "agent_p2_payment_attention_v1",
      "agent_p2_expense_attention_v1",
    ])
      expect(SQL).toContain(helper);
    expect(SQL).toContain("auth.role() is distinct from 'service_role'");
    expect(SQL).toContain("security definer");
    expect(SQL).toContain("set search_path = ''");
  });

  it("implements real match review, exact commitment facts, global keyset, proofs, and 25/26/501 bounds", () => {
    for (const marker of [
      "public.activities",
      "match_needs_review",
      "public.email_threads",
      "next_commitment_due_at",
      "has_unresolved_commitments",
      "p_after_priority",
      "p_after_attention_at",
      "p_after_source",
      "p_after_id",
      "p_page_fetch_limit",
      "p_source_limit",
      "ops_proof:v1:",
      "ops_evidence:v1:",
      "source_revisions",
    ])
      expect(SQL).toContain(marker);
    expect(SQL).toContain(
      'order by priority, attention_at, source collate "c", id'
    );
    expect(SQL).toContain("private.agent_p2_work_queue_expected_source_v1");
    expect(SQL).toContain("agent_work_queue_preauthorization_failed");
    expect(SQL).toContain("default_component_omitted");
    expect(SQL).toContain("agent_work_queue_revision_vector_incomplete");
    expect(SQL).toContain("source_slices");
    expect(SQL).toContain("agent_work_queue_duplicate_queue_ref");
    expect(SQL).toContain("ranking_revision");
    expect(SQL).toContain("cursor_predecessor");
    expect(SQL).toContain("item_limit");
    expect(SQL).toContain("agent_p2_optional_canonical_text");
    expect(SQL).toContain("jsonb_strip_nulls");
    expect(SQL).not.toContain("select thread.*");
    expect(SQL).not.toContain("select activity.*");
    expect(SQL).toContain("provider_thread_id = activity.email_thread_id");
    expect(SQL).toContain(
      "agent_read_domain_uuid_from_text(activity.project_id)"
    );
    expect(SQL).toContain(
      "p_registered_permission_keys,v_permissions ->> 'calendar.view', v_permissions ->> 'projects.view',v_permissions ->> 'tasks.view', v_read_at,25"
    );
  });

  it("pins hostile, zero-read, privacy, ACL, source-bound, stale, keyset, and replay proofs", () => {
    for (const marker of [
      "work_queue_all_nine_sources",
      "work_queue_explicit_denial_zero_read",
      "work_queue_default_warning_zero_signal",
      "work_queue_match_review_unlinked_safe",
      "work_queue_correspondence_private_fields_absent",
      "work_queue_keyset_no_duplicates",
      "work_queue_helper_exactly_25_or_hidden_26_failed",
      "work_queue_global_bounded_union_26_failed",
      "work_queue_page2_signed_read_at_window_failed",
      "work_queue_page2_frozen_union_or_duplicate_failed",
      "work_queue_schedule_scope_order_invalid",
      "work_queue_malformed_legacy_project_was_accepted",
      "work_queue_infinite_commitment_was_accepted",
      "work_queue_missing_revision_was_accepted",
      "work_queue_stale_revision_was_accepted",
      "work_queue_source_501_fails_closed",
      "work_queue_stale_revision_fails_closed",
      "work_queue_email_ownership_stale_was_accepted",
      "work_queue_opportunity_assignment_stale_was_accepted",
      "work_queue_project_membership_stale_was_accepted",
      "work_queue_correspondence_projection_stale_was_accepted",
      "work_queue_expense_admin_group_parity_failed",
      "'reason_code','overdue'",
      "work_queue_duplicate_queue_ref_was_accepted",
      "work_queue_hidden_job_invalid_commitment_leaked",
      "work_queue_hidden_job_invalid_match_leaked",
      "work_queue_service_only_acl",
      "runtime_requires_postgresql_17",
    ])
      expect(RUNTIME).toContain(marker);
    for (const marker of [
      "task17_forward_ledger",
      "task17_replay_sources",
      "task17_replay_read",
      "task17_function_acl_stable",
    ])
      expect(REPLAY).toContain(marker);
  });
});
