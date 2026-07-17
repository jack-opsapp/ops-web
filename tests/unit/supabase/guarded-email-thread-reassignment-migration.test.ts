import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function migrationSql(): string {
  const directory = resolve(process.cwd(), "supabase/migrations");
  const filename = readdirSync(directory).find((entry) =>
    entry.endsWith("_guarded_email_thread_reassignment.sql")
  );
  expect(
    filename,
    "guarded email-thread reassignment migration is missing"
  ).toBeTruthy();
  return readFileSync(resolve(directory, filename!), "utf8");
}

describe("guarded email-thread reassignment migration", () => {
  it("keeps generic thread-owner updates immutable", () => {
    const sql = migrationSql();

    expect(sql).toMatch(
      /old\.opportunity_id is distinct from new\.opportunity_id[\s\S]*?opportunity email thread ownership is immutable/i
    );
    expect(sql).not.toMatch(
      /auth\.jwt\(\)[\s\S]{0,120}'role'[\s\S]{0,120}=\s*'service_role'[\s\S]{0,240}return new/i
    );
  });

  it("allows the guarded merge only with exact pending duplicate-review evidence", () => {
    const sql = migrationSql();

    expect(sql).toMatch(
      /alter function public\.execute_opportunity_merge_guarded\([\s\S]*?rename to execute_opportunity_merge_guarded_internal/i
    );
    expect(sql).toMatch(
      /create or replace function public\.execute_opportunity_merge_guarded\([\s\S]*?security definer/i
    );
    expect(sql).toMatch(
      /duplicate_reviews[\s\S]*?id\s*=\s*p_review_id[\s\S]*?entity_type\s*=\s*'opportunity'[\s\S]*?status\s*=\s*'pending'/i
    );
    expect(sql).toMatch(
      /entity_a_id[\s\S]*?p_winner_id[\s\S]*?p_loser_id[\s\S]*?entity_b_id/i
    );
    expect(sql).toContain("ops.email_thread_reassignment_mode");
    expect(sql).toContain("ops.email_thread_reassignment_review_id");
    expect(sql).toContain("ops.email_thread_reassignment_winner_id");
    expect(sql).toContain("ops.email_thread_reassignment_loser_id");
  });

  it("makes the renamed merge implementation unreachable to API roles", () => {
    const sql = migrationSql();

    expect(sql).toMatch(
      /revoke all on function public\.execute_opportunity_merge_guarded_internal\([\s\S]*?from public, anon, authenticated, service_role/i
    );
    expect(sql).toMatch(
      /grant execute on function public\.execute_opportunity_merge_guarded\([\s\S]*?to service_role/i
    );
    expect(sql).not.toMatch(
      /grant execute on function public\.execute_opportunity_merge_guarded_internal\([\s\S]*?to service_role/i
    );
  });

  it("creates one service-only atomic data-review reassignment RPC", () => {
    const sql = migrationSql();

    expect(sql).not.toMatch(/nullif\(connection\.company_id, ''\)::uuid/i);
    expect(
      sql.match(/company\.id::text = connection\.company_id/gi)
    ).toHaveLength(2);
    expect(sql).toMatch(
      /create or replace function public\.reassign_opportunity_email_thread_guarded\([\s\S]*?returns jsonb[\s\S]*?security definer/i
    );
    expect(sql).toMatch(
      /coalesce\(auth\.jwt\(\)\s*->>\s*'role',\s*''\)\s*<>\s*'service_role'/i
    );
    expect(sql).toMatch(
      /from public\.email_threads[\s\S]*?company_id\s*=\s*p_company_id[\s\S]*?connection_id\s*=\s*p_connection_id[\s\S]*?provider_thread_id\s*=\s*p_provider_thread_id[\s\S]*?for update/i
    );
    expect(sql).toMatch(
      /target opportunity is not a current owner of this thread/i
    );
    expect(sql).toMatch(/reassignment would cross client ownership/i);
    expect(sql).toMatch(
      /update public\.opportunity_email_threads[\s\S]*?set opportunity_id\s*=\s*p_target_opportunity_id/i
    );
    expect(sql).toMatch(
      /update public\.email_threads[\s\S]*?set opportunity_id\s*=\s*p_target_opportunity_id/i
    );
    expect(sql).toMatch(
      /update public\.activities[\s\S]*?set opportunity_id\s*=\s*p_target_opportunity_id/i
    );
    expect(sql).toMatch(
      /revoke all on function public\.reassign_opportunity_email_thread_guarded\([\s\S]*?from public, anon, authenticated/i
    );
    expect(sql).toMatch(
      /grant execute on function public\.reassign_opportunity_email_thread_guarded\([\s\S]*?to service_role/i
    );
  });
});
