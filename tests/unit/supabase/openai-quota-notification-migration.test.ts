import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260720120000_openai_quota_notification_contract.sql"
);
const notificationHardeningPath = join(
  process.cwd(),
  "supabase/migrations/20260715180500_notification_creation_hardening.sql"
);
const databaseTypesPath = join(
  process.cwd(),
  "src/lib/types/database.types.ts"
);

function migrationSql(): string {
  expect(
    existsSync(migrationPath),
    "OpenAI quota notification migration is missing"
  ).toBe(true);
  return existsSync(migrationPath)
    ? readFileSync(migrationPath, "utf8").toLowerCase()
    : "";
}

function functionDefinition(source: string, name: string): string {
  const marker = `create or replace function ${name}`;
  const start = source.indexOf(marker);
  expect(start, `${name} is missing`).toBeGreaterThanOrEqual(0);
  const next = source.indexOf(
    "create or replace function ",
    start + marker.length
  );
  return next === -1 ? source.slice(start) : source.slice(start, next);
}

describe("OpenAI quota notification migration", () => {
  it("preserves the existing boolean RPC and adds a sibling identity-returning RPC", () => {
    const source = migrationSql();
    const hardening = readFileSync(notificationHardeningPath, "utf8").toLowerCase();
    const identity = functionDefinition(
      source,
      "public.create_notification_if_new_with_identity"
    );

    expect(hardening).toContain(
      "create or replace function public.create_notification_if_new_with_status("
    );
    expect(source).not.toMatch(
      /drop function[^;]*create_notification_if_new_with_status/
    );
    expect(identity).toMatch(
      /p_user_id uuid,[\s\S]*?p_company_id uuid,[\s\S]*?p_type text,[\s\S]*?p_dedupe_key text default null/
    );
    expect(identity).toMatch(
      /returns table\s*\(\s*notification_id uuid,\s*created boolean\s*\)/
    );
    expect(identity).toMatch(
      /insert into public\.notifications[\s\S]*?on conflict do nothing[\s\S]*?returning id/
    );
  });

  it("validates canonical active same-company identity without using email", () => {
    const identity = functionDefinition(
      migrationSql(),
      "public.create_notification_if_new_with_identity"
    );

    expect(identity).toMatch(
      /from public\.users[\s\S]*?join public\.companies[\s\S]*?u\.id = p_user_id[\s\S]*?u\.company_id = p_company_id[\s\S]*?u\.deleted_at is null[\s\S]*?coalesce\(u\.is_active, false\)[\s\S]*?c\.deleted_at is null/
    );
    expect(identity).not.toMatch(/\bemail\b/);
    expect(identity).toMatch(/raise exception 'notification recipient is unavailable'/);
    expect(identity).toMatch(/errcode = '42501'/);
  });

  it("requires a nonblank dedupe key before attempting the insert", () => {
    const identity = functionDefinition(
      migrationSql(),
      "public.create_notification_if_new_with_identity"
    );
    const validation = identity.indexOf("if v_dedupe_key is null then");
    const insert = identity.indexOf("insert into public.notifications");

    expect(validation).toBeGreaterThanOrEqual(0);
    expect(validation).toBeLessThan(insert);
    expect(identity.slice(validation, insert)).toMatch(
      /raise exception 'notification dedupe key is required'[\s\S]*?errcode = '22023'/
    );
  });

  it("resolves only one exact open quota incident without impersonating a human", () => {
    const resolver = functionDefinition(
      migrationSql(),
      "public.resolve_openai_quota_notification_as_system"
    );

    expect(resolver).toMatch(
      /p_notification_id uuid,[\s\S]*?p_user_id uuid,[\s\S]*?p_company_id uuid,[\s\S]*?p_dedupe_key text/
    );
    expect(resolver).toMatch(/returns boolean/);
    expect(resolver).toMatch(
      /update public\.notifications[\s\S]*?set[\s\S]*?is_read = true[\s\S]*?resolved_at = clock_timestamp\(\)[\s\S]*?resolved_by = null[\s\S]*?resolution_reason = 'provider_quota_recovered'/
    );
    expect(resolver).toMatch(
      /notification\.id = p_notification_id[\s\S]*?notification\.user_id = p_user_id::text[\s\S]*?notification\.company_id = p_company_id::text[\s\S]*?notification\.type = 'ai_provider_quota'[\s\S]*?notification\.dedupe_key = btrim\(p_dedupe_key\)[\s\S]*?notification\.resolved_at is null/
    );
    expect(resolver).not.toMatch(/\bemail\b/);
  });

  it("keeps both functions service-only with locked search paths", () => {
    const source = migrationSql();
    const identity = functionDefinition(
      source,
      "public.create_notification_if_new_with_identity"
    );
    const resolver = functionDefinition(
      source,
      "public.resolve_openai_quota_notification_as_system"
    );

    for (const definition of [identity, resolver]) {
      expect(definition).toContain("security definer");
      expect(definition).toContain("set search_path = pg_catalog, pg_temp");
      expect(definition).toMatch(
        /coalesce\(auth\.jwt\(\) ->> 'role', ''\) <> 'service_role'/
      );
    }

    expect(source).toMatch(
      /revoke all on function public\.create_notification_if_new_with_identity\([\s\S]*?\) from public, anon, authenticated, service_role;/
    );
    expect(source).toMatch(
      /grant execute on function public\.create_notification_if_new_with_identity\([\s\S]*?\) to service_role;/
    );
    expect(source).toMatch(
      /revoke all on function public\.resolve_openai_quota_notification_as_system\(uuid, uuid, uuid, text\) from public, anon, authenticated, service_role;/
    );
    expect(source).toMatch(
      /grant execute on function public\.resolve_openai_quota_notification_as_system\(uuid, uuid, uuid, text\) to service_role;/
    );
  });

  it("publishes the two service RPCs in generated database types", () => {
    const types = readFileSync(databaseTypesPath, "utf8");

    expect(types).toContain("create_notification_if_new_with_identity:");
    expect(types).toContain("resolve_openai_quota_notification_as_system:");
    expect(types).toMatch(
      /create_notification_if_new_with_identity:[\s\S]*?Returns: \{[\s\S]*?created: boolean[\s\S]*?notification_id: string/
    );
    expect(types).toMatch(
      /resolve_openai_quota_notification_as_system:[\s\S]*?p_notification_id: string[\s\S]*?p_user_id: string[\s\S]*?p_company_id: string[\s\S]*?p_dedupe_key: string[\s\S]*?Returns: boolean/
    );
  });
});
