import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.join(
  process.cwd(),
  "docs/migrations/20260713205000_contract_email_provider_identities.sql"
);

function sql(): string {
  return readFileSync(migrationPath, "utf8");
}

describe("post-deploy email provider identity contract migration", () => {
  it("is explicitly ordered after the compatible application deploy", () => {
    expect(sql()).toMatch(
      /held outside[\s\S]*supabase\/migrations[\s\S]*post-deploy/i
    );
  });

  it("removes the provider-agnostic connection and message identities", () => {
    const source = sql();

    expect(source).toMatch(
      /drop index if exists public\.idx_gmail_connections_company_email/i
    );
    expect(source).toMatch(
      /drop index if exists public\.activities_email_message_id_unique/i
    );
  });

  it("requires future provider-backed activities to carry a same-company connection", () => {
    const source = sql();

    expect(source).toMatch(
      /if new\.type = 'email'[\s\S]*?new\.email_message_id is not null[\s\S]*?new\.email_connection_id is null[\s\S]*?raise exception/i
    );
    expect(source).toMatch(
      /before insert or update of email_connection_id, company_id, type, email_message_id[\s\S]*?on public\.activities[\s\S]*?require_email_activity_connection/i
    );
    expect(source).toMatch(
      /select connection\.company_id[\s\S]*?connection\.id = new\.email_connection_id[\s\S]*?v_connection_company_id is distinct from new\.company_id[\s\S]*?raise exception/i
    );
  });
});
