import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260721050404_openai_quota_notification_contract.sql"
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
    const hardening = readFileSync(
      notificationHardeningPath,
      "utf8"
    ).toLowerCase();
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
      /returns table\s*\(\s*notification_id uuid,\s*created boolean,\s*incident_version bigint\s*\)/
    );
    expect(identity).toMatch(
      /insert into public\.notifications as notification[\s\S]*?on conflict do nothing[\s\S]*?returning notification\.id/
    );
  });

  it("adds a nonnegative incident generation to durable notifications", () => {
    const source = migrationSql();

    expect(source).toMatch(
      /alter table public\.notifications[\s\S]*?add column if not exists incident_version bigint not null default 0/
    );
    expect(source).toMatch(
      /add constraint notifications_incident_version_nonnegative[\s\S]*?check \(incident_version >= 0\)/
    );
    expect(source).toMatch(
      /create unique index if not exists notifications_openai_quota_open_unique[\s\S]*?on public\.notifications \(\s*user_id,\s*company_id,\s*type,\s*dedupe_key\s*\)[\s\S]*?where type = 'ai_provider_quota'[\s\S]*?and resolved_at is null/
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
    expect(identity).toMatch(
      /raise exception 'notification recipient is unavailable'/
    );
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

  it("serializes quota observations and increments the exact open generation", () => {
    const identity = functionDefinition(
      migrationSql(),
      "public.create_notification_if_new_with_identity"
    );
    const lock = identity.indexOf("perform pg_catalog.pg_advisory_xact_lock");
    const touch = identity.indexOf(
      "set incident_version = notification.incident_version + 1"
    );
    const insert = identity.indexOf("insert into public.notifications");

    expect(identity).toMatch(
      /if v_type = 'ai_provider_quota' then[\s\S]*?private\.openai_quota_notification_lock_key\(\s*p_user_id,\s*p_company_id,\s*v_dedupe_key\s*\)/
    );
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(lock).toBeLessThan(touch);
    expect(lock).toBeLessThan(insert);
    expect(identity).toMatch(
      /set incident_version = notification\.incident_version \+ 1,\s*is_read = false[\s\S]*?notification\.type = 'ai_provider_quota'[\s\S]*?notification\.dedupe_key = v_dedupe_key[\s\S]*?notification\.resolved_at is null[\s\S]*?returning notification\.id, notification\.incident_version/
    );
    expect(
      identity.match(
        /set incident_version = notification\.incident_version \+ 1,\s*is_read = false/g
      )
    ).toHaveLength(2);
    expect(identity.match(/and notification\.is_read = false/g)).toHaveLength(
      1
    );
    expect(identity).toMatch(
      /insert into public\.notifications as notification \([\s\S]*?incident_version[\s\S]*?case when v_type = 'ai_provider_quota' then 1 else 0 end/
    );
  });

  it("uses the same transaction lock and expected generation for exact recovery", () => {
    const resolver = functionDefinition(
      migrationSql(),
      "public.resolve_openai_quota_notification_as_system"
    );
    const lock = resolver.indexOf("perform pg_catalog.pg_advisory_xact_lock");
    const update = resolver.indexOf("update public.notifications");

    expect(resolver).toMatch(
      /p_notification_id uuid,[\s\S]*?p_user_id uuid,[\s\S]*?p_company_id uuid,[\s\S]*?p_dedupe_key text,[\s\S]*?p_expected_incident_version bigint/
    );
    expect(resolver).toMatch(/returns boolean/);
    expect(resolver).toMatch(
      /private\.openai_quota_notification_lock_key\(\s*p_user_id,\s*p_company_id,\s*v_dedupe_key\s*\)/
    );
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(lock).toBeLessThan(update);
    expect(resolver).toMatch(
      /update public\.notifications[\s\S]*?set[\s\S]*?is_read = true[\s\S]*?resolved_at = clock_timestamp\(\)[\s\S]*?resolved_by = null[\s\S]*?resolution_reason = 'provider_quota_recovered'/
    );
    expect(resolver).toMatch(
      /notification\.id = p_notification_id[\s\S]*?notification\.user_id = p_user_id::text[\s\S]*?notification\.company_id = p_company_id::text[\s\S]*?notification\.type = 'ai_provider_quota'[\s\S]*?notification\.dedupe_key = v_dedupe_key[\s\S]*?notification\.incident_version = p_expected_incident_version[\s\S]*?notification\.resolved_at is null/
    );
    expect(resolver).not.toContain("and notification.is_read = false");
    expect(resolver).not.toMatch(/\bemail\b/);
  });

  it("keeps stale recovery open and lets a post-recovery observation create generation one", () => {
    const source = migrationSql();
    const identity = functionDefinition(
      source,
      "public.create_notification_if_new_with_identity"
    );
    const resolver = functionDefinition(
      source,
      "public.resolve_openai_quota_notification_as_system"
    );

    expect(identity).toMatch(
      /set incident_version = notification\.incident_version \+ 1[\s\S]*?return query select v_notification_id, false, v_incident_version/
    );
    expect(resolver).toContain(
      "notification.incident_version = p_expected_incident_version"
    );
    expect(resolver).toContain("return v_updated = 1");
    expect(identity).toMatch(
      /notification\.resolved_at is null[\s\S]*?insert into public\.notifications[\s\S]*?case when v_type = 'ai_provider_quota' then 1 else 0 end/
    );
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

    const lockKey = functionDefinition(
      source,
      "private.openai_quota_notification_lock_key"
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
      /revoke all on function public\.resolve_openai_quota_notification_as_system\(uuid, uuid, uuid, text, bigint\) from public, anon, authenticated, service_role;/
    );
    expect(source).toMatch(
      /grant execute on function public\.resolve_openai_quota_notification_as_system\(uuid, uuid, uuid, text, bigint\) to service_role;/
    );
    expect(lockKey).toContain("set search_path = pg_catalog, pg_temp");
    expect(lockKey).toContain("hashtextextended");
    expect(source).toMatch(
      /revoke all on function private\.openai_quota_notification_lock_key\(uuid, uuid, text\) from public, anon, authenticated, service_role;/
    );
  });

  it("publishes the two service RPCs in generated database types", () => {
    const types = readFileSync(databaseTypesPath, "utf8");

    expect(types).toContain("create_notification_if_new_with_identity:");
    expect(types).toContain("resolve_openai_quota_notification_as_system:");
    expect(types).toMatch(
      /create_notification_if_new_with_identity:[\s\S]*?Returns: \{[\s\S]*?created: boolean[\s\S]*?incident_version: number[\s\S]*?notification_id: string/
    );
    expect(types).toMatch(
      /resolve_openai_quota_notification_as_system:[\s\S]*?p_notification_id: string[\s\S]*?p_user_id: string[\s\S]*?p_company_id: string[\s\S]*?p_dedupe_key: string[\s\S]*?p_expected_incident_version: number[\s\S]*?Returns: boolean/
    );
    expect(types).toMatch(
      /notifications: \{[\s\S]*?Row: \{[\s\S]*?incident_version: number/
    );
  });
});
