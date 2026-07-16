import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260715175000_email_interaction_atomic_writes.sql"
);
const sql = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8").toLowerCase()
  : "";
const compact = sql.replace(/\s+/g, " ");

function body(name: string, next?: string): string {
  const start = compact.indexOf(`create or replace function ${name}`);
  const end = next
    ? compact.indexOf(`create or replace function ${next}`, start + 1)
    : compact.length;
  return start < 0 ? "" : compact.slice(start, end < 0 ? compact.length : end);
}

describe("atomic email interaction writes migration", () => {
  it("defines one canonical locked lead and inbox intersection", () => {
    expect(sql.trim().startsWith("begin;")).toBe(true);
    expect(sql.trim().endsWith("commit;")).toBe(true);
    const helper = body(
      "private.user_can_edit_email_thread",
      "public.resolve_email_commitment_as_system"
    );
    expect(helper).toContain("from public.email_threads t");
    expect(helper).toContain("for share");
    expect(helper).toContain("from public.opportunity_email_threads link");
    expect(helper).toContain(
      "v_thread.opportunity_id is distinct from v_linked_opportunity_id"
    );
    expect(helper).toContain("private.user_can_edit_opportunity(");
    expect(helper).toContain("private.user_can_view_opportunity_inbox(");
    expect(helper).not.toContain("public.has_permission(");
    expect(helper).not.toContain("'pipeline.manage'");
    expect(helper).not.toContain("lower(u.email)");
  });

  it("resolves commitments only inside the locked authorization transaction", () => {
    const fn = body(
      "public.resolve_email_commitment_as_system",
      "public.answer_email_agent_question_as_system"
    );
    expect(fn).toContain(
      "coalesce(auth.jwt() ->> 'role', '') <> 'service_role'"
    );
    expect(fn).toContain("from public.agent_memories m");
    expect(fn).toContain("for update");
    expect(fn).toContain("private.user_can_edit_email_thread(");
    expect(fn).toContain("update public.agent_memories");
    expect(fn).toContain("resolved_at = p_resolved_at");
  });

  it("records and clears an agent question atomically against the locked payload", () => {
    const fn = body("public.answer_email_agent_question_as_system");
    expect(fn).toContain(
      "coalesce(auth.jwt() ->> 'role', '') <> 'service_role'"
    );
    expect(fn).toContain("from public.email_threads t");
    expect(fn).toContain("for update");
    expect(fn).toContain("private.user_can_edit_email_thread(");
    expect(fn).toContain("jsonb_array_elements");
    expect(fn).toContain("insert into public.agent_memories");
    expect(fn).toContain("category");
    expect(fn).toContain("'answered_question'");
    expect(fn).toContain("agent_blocking_question = null");
    expect(fn).toContain("agent_blocking_question = v_question");
  });

  it("keeps all entry points service-only and never writes assignment", () => {
    for (const [name, args] of [
      ["public.resolve_email_commitment_as_system", "uuid, uuid, timestamptz"],
      [
        "public.answer_email_agent_question_as_system",
        "uuid, uuid, text, text",
      ],
    ]) {
      expect(compact).toMatch(
        new RegExp(
          `revoke all on function ${name}\\(\\s*${args}\\s*\\) from public, anon, authenticated, service_role`
        )
      );
      expect(compact).toMatch(
        new RegExp(
          `grant execute on function ${name}\\(\\s*${args}\\s*\\) to service_role`
        )
      );
    }
    expect(compact).toContain(
      "revoke all on function private.user_can_edit_email_thread(uuid, uuid)"
    );
    expect(compact).not.toContain("update public.opportunities");
    expect(compact).not.toContain("set assigned_to");
  });
});
