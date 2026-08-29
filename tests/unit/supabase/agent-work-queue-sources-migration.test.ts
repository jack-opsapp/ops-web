import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const NAME = "20260829110000_agent_work_queue_sources.sql";
const BODY = readFileSync(
  join(
    process.cwd(),
    "src/lib/agent-control-plane/services/p2/work-queue/sql/agent_work_queue_sources.body.sql"
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

describe("P2 work queue source SQL", () => {
  it("byte-matches its sole generated reservation", () => {
    expect(
      readdirSync(join(process.cwd(), "supabase/migrations")).filter((name) =>
        name.endsWith("_agent_work_queue_sources.sql")
      )
    ).toEqual([NAME]);
    expect(MIGRATION).toBe(BODY);
    expect(SQL).toContain("task 17 canonical work-queue source body");
    expect(SQL).toContain("begin;");
    expect(SQL.trim().endsWith("commit;")).toBe(true);
  });

  it("fences every queue-only fact and no durable operational queues", () => {
    for (const marker of [
      "activities_bump_agent_work_queue_revision",
      "email_threads_bump_agent_work_queue_revision",
      "opportunities_bump_agent_work_queue_revision",
      "match_needs_review",
      "next_commitment_due_at",
      "has_unresolved_commitments",
      "next_follow_up_at",
      "operator_action_required_at",
      "assigned_to",
      "email_connections_bump_agent_work_queue_revision",
      "projects_bump_agent_work_queue_revision",
      "project_tasks_bump_agent_work_queue_revision",
      "project_notes_bump_agent_work_queue_revision",
      "provider_thread_id",
      "subject",
      "latest_snippet",
      "last_message_at",
      "unread_count",
      "snoozed_until",
      "team_member_ids",
      "mentioned_user_ids",
      "'work_queue'",
    ])
      expect(SQL).toContain(marker);
    for (const forbidden of [
      "nightly",
      "lease",
      "retry_count",
      "audit_log",
      "job_queue",
    ])
      expect(SQL).not.toContain(forbidden);
  });

  it("adds only two new direct-source indexes and pins the frozen lead bound", () => {
    expect(BODY.match(/^create index idx_/gm) ?? []).toHaveLength(2);
    expect(SQL.match(/drop index if exists public\.idx_/g) ?? []).toHaveLength(
      2
    );
    expect(SQL).toContain("opportunities_agent_p2_legacy_attention_idx");
    expect(SQL).toContain("agent_read_domain_uuid_from_text(text)");
    expect(SQL).toContain("v_old_project_company_id");
    expect(SQL).toContain("v_new_project_company_id");
    for (const marker of [
      "work_queue_sources_bump",
      "work_queue_old_new_company_fanout",
      "work_queue_irrelevant_update_no_bump",
      "work_queue_match_review_index",
      "work_queue_commitment_index",
      "work_queue_legacy_lead_bound_index",
      "work_queue_source_private_acl",
      "runtime_requires_postgresql_17",
      "work_queue_email_ownership_stale_was_accepted",
      "work_queue_opportunity_assignment_stale_was_accepted",
      "work_queue_project_membership_stale_was_accepted",
      "work_queue_correspondence_projection_stale_was_accepted",
    ])
      expect(RUNTIME).toContain(marker);
  });
});
