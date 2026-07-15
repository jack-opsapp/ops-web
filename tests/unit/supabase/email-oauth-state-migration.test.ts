import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = fs.readFileSync(
  path.join(
    process.cwd(),
    "supabase/migrations/20260713204000_one_time_email_oauth_state.sql"
  ),
  "utf8"
);

describe("one-time email OAuth state migration", () => {
  it("stores only nonce digests behind service-role-only RLS", () => {
    expect(sql).toMatch(/create table public\.email_oauth_states/i);
    expect(sql).toMatch(/nonce_hash text primary key/i);
    expect(sql).toMatch(/enable row level security/i);
    expect(sql).toMatch(
      /revoke all on table public\.email_oauth_states from public, anon, authenticated/i
    );
    expect(sql).toMatch(
      /grant select, insert, update, delete on public\.email_oauth_states to service_role/i
    );
  });

  it("atomically deletes and returns exactly one unexpired provider-bound state", () => {
    expect(sql).toMatch(/function public\.consume_email_oauth_state/i);
    expect(sql).toMatch(/delete from public\.email_oauth_states/i);
    expect(sql).toMatch(/state\.provider = p_provider/i);
    expect(sql).toMatch(/state\.expires_at > clock_timestamp\(\)/i);
    expect(sql).toMatch(
      /returning[\s\S]*state\.company_id[\s\S]*state\.user_id/i
    );
    expect(sql).toMatch(
      /returning[\s\S]*state\.connection_id[\s\S]*state\.expected_email/i
    );
    expect(sql).toMatch(
      /revoke all on function public\.consume_email_oauth_state\(text, text\) from public, anon, authenticated/i
    );
    expect(sql).toMatch(
      /grant execute on function public\.consume_email_oauth_state\(text, text\) to service_role/i
    );
  });

  it("requires every alert nonce to name one connection and expected mailbox", () => {
    expect(sql).toMatch(
      /connection_id uuid[\s\S]*references public\.email_connections\(id\)/i
    );
    expect(sql).toMatch(/expected_email text/i);
    expect(sql).toMatch(
      /source = 'alert'[\s\S]*connection_id is not null[\s\S]*expected_email is not null/i
    );
    expect(sql).toMatch(
      /source = 'wizard'[\s\S]*connection_id is null[\s\S]*expected_email is null/i
    );
  });
});
