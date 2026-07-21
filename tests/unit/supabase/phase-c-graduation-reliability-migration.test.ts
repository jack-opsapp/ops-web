import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260721125000_phase_c_graduation_reliability.sql"
);
const sql = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8").toLowerCase()
  : "";

function functionBody(name: string): string {
  const start = sql.indexOf(`create or replace function ${name}`);
  if (start < 0) return "";
  const next = sql.indexOf("create or replace function ", start + 1);
  return sql.slice(start, next < 0 ? undefined : next);
}

describe("Phase C graduation reliability migration", () => {
  it("adds a mailbox-scoped human accuracy bridge", () => {
    const body = functionBody("public.get_human_draft_accuracy_as_system");
    expect(body).toContain("p_connection_id uuid");
    expect(body).toContain("queue.connection_id = p_connection_id");
    expect(body).toContain("queue.user_id = p_actor_user_id::text");
    expect(body).toContain("queue.learning_authority = 'operator_approved'");
    expect(body).toContain("auth.role() is distinct from 'service_role'");
  });

  it("never attributes an individual mailbox to anyone except its canonical OPS owner", () => {
    const accuracy = functionBody("public.get_human_draft_accuracy_as_system");
    const list = functionBody(
      "public.list_phase_c_graduation_actor_scopes_as_system"
    );
    const complete = functionBody(
      "public.complete_phase_c_graduation_scope_check_as_system"
    );
    const prompt = functionBody(
      "public.record_phase_c_graduation_prompt_as_system"
    );

    for (const body of [accuracy, list, complete, prompt]) {
      expect(body).toContain("connection.type::text <> 'individual'");
      expect(body).toContain("btrim(coalesce(connection.user_id, ''))");
    }
  });

  it("rotates actor-mailbox scopes by durable attempt time instead of a fixed first page", () => {
    expect(sql).toContain("graduation_last_attempt_at");
    const list = functionBody(
      "public.list_phase_c_graduation_actor_scopes_as_system"
    );
    expect(list).toContain(
      "learning_authority in ('operator_authored', 'operator_approved')"
    );
    expect(list).toMatch(
      /order by\s+milestone\.graduation_last_attempt_at asc nulls first/
    );
    expect(list).not.toContain(
      "order by candidate.company_id, candidate.connection_id, candidate.actor_user_id"
    );
    expect(sql).toContain("email_outbound_learning_graduation_scope_idx");
  });

  it("indexes exact-mailbox accuracy reads before the queue grows", () => {
    expect(sql).toContain("email_outbound_learning_mailbox_accuracy_idx");
    expect(sql).toContain(
      "on public.email_outbound_learning_queue (\n    company_id,\n    connection_id,\n    user_id,\n    occurred_at desc nulls last"
    );
  });

  it("records success and retry state through a service-only completion RPC", () => {
    const complete = functionBody(
      "public.complete_phase_c_graduation_scope_check_as_system"
    );
    expect(complete).toContain("p_succeeded boolean");
    expect(complete).toContain("graduation_failure_count");
    expect(complete).toContain("graduation_next_attempt_at");
    expect(complete).toContain("auth.role() is distinct from 'service_role'");
    expect(sql).toContain(
      "grant execute on function public.complete_phase_c_graduation_scope_check_as_system"
    );
  });

  it("dedupes each category prompt for the lifetime of the actor-mailbox category", () => {
    expect(sql).toContain("notifications_phase_c_graduation_unique");
    expect(sql).toContain("dedupe_key like 'phase-c-graduation:%'");
    const prompt = functionBody(
      "public.record_phase_c_graduation_prompt_as_system"
    );
    expect(prompt).toContain("'phase-c-graduation:v1:'");
    expect(prompt).toContain("on conflict do nothing");
    expect(prompt).toContain("auth.role() is distinct from 'service_role'");
  });
});
