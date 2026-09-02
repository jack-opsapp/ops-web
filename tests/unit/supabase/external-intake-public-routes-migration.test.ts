import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260727103000_external_intake_public_routes.sql"
);
const source = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8").toLowerCase()
  : "";

const callableFunctions = [
  "get_external_intake_config_as_system",
  "get_external_intake_submission_status_as_system",
  "list_external_intake_email_correlation_sources_as_system",
  "resolve_external_intake_email_correlation_as_system",
  "claim_external_intake_post_commit_outbox_as_system",
  "complete_external_intake_post_commit_outbox_as_system",
  "retry_external_intake_post_commit_outbox_as_system",
] as const;

describe("external intake public routes migration", () => {
  it("revalidates credentials and commits an audit base for public config and status reads", () => {
    expect(source).toContain(
      "private.insert_external_api_authenticated_audit_base("
    );
    expect(source).toContain("private.require_external_intake_credential(");
    expect(source).toMatch(
      /get_external_intake_submission_status_as_system[\s\S]*?submission\.company_id = p_company_id[\s\S]*?submission\.principal_id = p_principal_id/
    );
    expect(source).toContain("external_intake_attachment_state(intent.state)");
  });

  it("leases bounded post-commit work without returning contact evidence", () => {
    expect(source).toContain("for update skip locked");
    expect(source).toContain("lease_expires_at");
    expect(source).toContain("'work', submission.original_work");
    expect(source).toContain(
      "'serviceaddress', submission.original_service_address"
    );
    expect(source).toContain("'answers', submission.ordered_answers");
    const claimFunction = source.match(
      /create or replace function public\.claim_external_intake_post_commit_outbox_as_system[\s\S]*?\nend;\n\$function\$;/
    )?.[0];
    expect(claimFunction).toBeTruthy();
    expect(claimFunction).not.toContain("original_contact");
  });

  it("binds correlation to one active company mailbox and revalidates the immutable submission mapping", () => {
    expect(source).toMatch(
      /when count\(\*\) = 1 then \(array_agg\(connection\.id order by connection\.id\)\)\[1\]/
    );
    expect(source).toMatch(
      /connection\.id = p_mailbox_id[\s\S]*?connection\.type::text = 'company'[\s\S]*?connection\.status = 'active'/
    );
    expect(source).toMatch(
      /submission\.id = p_submission_id[\s\S]*?submission\.source_id = p_source_id[\s\S]*?submission\.opportunity_id = p_opportunity_id/
    );
  });

  it("keeps every callable boundary service-role-only", () => {
    for (const functionName of callableFunctions) {
      expect(source).toContain(
        `create or replace function public.${functionName}`
      );
      expect(source).toMatch(
        new RegExp(
          `revoke all on function public\\.${functionName}[\\s\\S]*?from public, anon, authenticated, service_role`
        )
      );
      expect(source).toMatch(
        new RegExp(
          `grant execute on function public\\.${functionName}[\\s\\S]*?to service_role`
        )
      );
    }
  });
});
