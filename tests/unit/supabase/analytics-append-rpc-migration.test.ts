import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260813171000_append_analytics_events_rpc.sql"
);
const sql = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8").toLowerCase()
  : "";

describe("append analytics events RPC migration", () => {
  it("exposes an invoker wrapper over one private privileged append boundary", () => {
    expect(sql).toMatch(
      /create or replace function analytics_ingest\.append_analytics_events\(\s*p_events jsonb,\s*p_expected_subject text\s*\)[\s\S]*returns jsonb[\s\S]*language plpgsql[\s\S]*security definer[\s\S]*set search_path = ''/
    );
    expect(sql).toMatch(
      /create or replace function public\.append_analytics_events\(\s*p_events jsonb,\s*p_expected_subject text\s*\)[\s\S]*returns jsonb[\s\S]*language sql[\s\S]*security invoker[\s\S]*set search_path = ''[\s\S]*analytics_ingest\.append_analytics_events\(p_events, p_expected_subject\)/
    );
    expect(sql).not.toMatch(
      /create or replace function public\.append_analytics_events\(\s*p_events jsonb,\s*p_expected_subject text\s*\)[\s\S]*security definer/
    );
    expect(sql).toMatch(
      /revoke all on function analytics_ingest\.append_analytics_events\(jsonb, text\)\s+from public, anon, authenticated/
    );
    expect(sql).toMatch(
      /grant execute on function analytics_ingest\.append_analytics_events\(jsonb, text\)\s+to anon, authenticated/
    );
    expect(sql).toMatch(
      /revoke all on function public\.append_analytics_events\(jsonb, text\)\s+from public, anon, authenticated/
    );
    expect(sql).toMatch(
      /grant execute on function public\.append_analytics_events\(jsonb, text\)\s+to anon, authenticated/
    );
    expect(sql).not.toMatch(
      /grant[^;]*(update|delete)[^;]*public\.analytics_events[^;]*(anon|authenticated)/
    );
    expect(sql).not.toMatch(/grant usage on schema private to anon, authenticated/);
    expect(sql).toMatch(/grant usage on schema analytics_ingest to anon, authenticated/);
    expect(sql).toContain(
      "alter default privileges in schema analytics_ingest revoke execute on functions from public"
    );
  });

  it("authorizes signed Firebase subjects without trusting role claims or auth.uid", () => {
    expect(sql).toContain("auth.jwt() ->> 'sub'");
    expect(sql).toMatch(/from public\.users(?:\s+as)?\s+u/);
    expect(sql).toMatch(
      /u\.auth_id = v_subject\s+or\s+u\.firebase_uid = v_subject/
    );
    expect(sql).toContain("u.deleted_at is null");
    expect(sql).toContain("u.is_active is true");
    expect(sql).toContain("count(*) over ()");
    expect(sql).not.toContain("auth.uid()");
    expect(sql).not.toMatch(/auth\.jwt\(\)\s*->>\s*'role'/);
    expect(sql).toMatch(/p_expected_subject[\s\S]*is distinct from v_subject[\s\S]*analytics_subject_changed/);
  });

  it("validates a bounded batch before inserting any rows", () => {
    expect(sql).toContain("pg_catalog.jsonb_typeof(p_events) <> 'array'");
    expect(sql).toContain("v_received > 50");
    expect(sql).toContain("pg_catalog.octet_length(p_events::text) > 262144");
    expect(sql).toContain("private.analytics_value_is_valid");
    expect(sql).not.toContain("pg_catalog.pg_input_is_valid");
    expect(sql).toContain("'screen_view'");
    expect(sql).toContain("'feature_use'");
    expect(sql).toMatch(
      /if exists\s*\([\s\S]*pg_catalog\.jsonb_array_elements\(p_events\)[\s\S]*raise exception 'analytics_event_invalid'/
    );
  });

  it("stamps canonical identity and makes replay a successful no-op", () => {
    expect(sql).toMatch(
      /insert into public\.analytics_events\s*\([\s\S]*user_id,[\s\S]*company_id,[\s\S]*role,[\s\S]*plan,[\s\S]*platform[\s\S]*\)[\s\S]*v_user_id,[\s\S]*v_company_id,[\s\S]*v_role,[\s\S]*v_plan,[\s\S]*'ios'/
    );
    expect(sql).not.toMatch(/event\s*->>\s*'(role|plan|platform)'/);
    expect(sql).toContain("on conflict (id) do nothing");
    expect(sql).toMatch(/v_chargeable[\s\S]*not exists[\s\S]*public\.analytics_events/);
    expect(sql).toContain("consume_analytics_event_quota(v_user_id, v_chargeable)");
    expect(sql).toContain("get diagnostics v_inserted = row_count");
    expect(sql).toMatch(
      /pg_catalog\.jsonb_build_object\([\s\S]*'received',[\s\S]*'inserted',[\s\S]*'duplicates'/
    );
  });

  it("keeps shipped upsert clients behind an authenticated POST-only read bridge", () => {
    expect(sql).toMatch(
      /create or replace function private\.analytics_events_request_matches_identity\(\s*p_user_id uuid,\s*p_company_id uuid\s*\)[\s\S]*security definer[\s\S]*set search_path = ''/
    );
    expect(sql).toMatch(/u\.id = p_user_id/);
    expect(sql).toMatch(/p_company_id is not distinct from u\.company_id/);
    expect(sql).toMatch(
      /create policy analytics_events_legacy_post_returning_select[\s\S]*for select[\s\S]*to anon, authenticated[\s\S]*private\.analytics_events_request_matches_identity\(user_id, company_id\)[\s\S]*pg_catalog\.current_setting\('request\.method', true\) = 'post'/
    );
    expect(sql).toContain("pg_catalog.current_setting('request.path', true)");
    expect(sql).toContain("'/analytics_events'");
    expect(sql).toMatch(
      /create policy analytics_events_legacy_client_insert[\s\S]*for insert[\s\S]*to anon, authenticated[\s\S]*with check \([\s\S]*private\.analytics_events_request_matches_identity\(user_id, company_id\)[\s\S]*pg_catalog\.current_setting\('request\.method', true\) = 'post'[\s\S]*pg_catalog\.current_setting\('request\.path', true\)[\s\S]*\)/
    );
    expect(sql).toMatch(
      /grant select, insert on table public\.analytics_events\s+to anon, authenticated/
    );
    expect(sql).toContain("cleanup gate");
    expect(sql).toContain("zero supported clients");
    expect(sql).toContain("must be proven on a supabase branch");
  });

  it("canonicalizes compatible legacy rows and skips stale or trigger-validatable invalid ones", () => {
    expect(sql).toMatch(
      /create or replace function private\.prepare_legacy_analytics_event\(\)[\s\S]*returns trigger[\s\S]*security definer[\s\S]*set search_path = ''/
    );
    expect(sql).toMatch(
      /create trigger analytics_events_prepare_legacy_insert[\s\S]*before insert on public\.analytics_events[\s\S]*execute function private\.prepare_legacy_analytics_event\(\)/
    );
    expect(sql).toMatch(/new\.user_id is not null[\s\S]*new\.user_id <> v_user_id[\s\S]*return null/);
    expect(sql).toMatch(
      /new\.company_id is not null[\s\S]*new\.company_id is distinct from v_company_id[\s\S]*return null/
    );
    expect(sql).toMatch(/new\.user_id := v_user_id/);
    expect(sql).toMatch(/new\.company_id := v_company_id/);
    expect(sql).toMatch(/new\.event_name[\s\S]*return null/);
    expect(sql).toMatch(/new\.properties[\s\S]*return null/);
  });

  it("supports a canonical active user whose company is null", () => {
    expect(sql).toMatch(/p_company_id is not distinct from u\.company_id/);
    expect(sql).not.toMatch(/p_company_id is not null[\s\S]*count\(\*\) = 1/);
  });

  it("rejects non-null event identity that differs from the signed subject", () => {
    expect(sql).toMatch(
      /event \? 'user_id'[\s\S]*event -> 'user_id' <> 'null'::jsonb[\s\S]*\(event ->> 'user_id'\)::uuid is distinct from v_user_id/
    );
    expect(sql).toMatch(
      /event \? 'company_id'[\s\S]*event -> 'company_id' <> 'null'::jsonb[\s\S]*\(event ->> 'company_id'\)::uuid is distinct from v_company_id/
    );
  });

  it("enforces shared per-user quota and bounded event data on both ingestion paths", () => {
    expect(sql).toContain("create table if not exists private.analytics_event_hourly_quota");
    expect(sql).toMatch(
      /create or replace function private\.consume_analytics_event_quota\([\s\S]*p_user_id uuid[\s\S]*p_event_count integer[\s\S]*returns boolean[\s\S]*security definer/
    );
    expect(sql.match(/private\.consume_analytics_event_quota\(/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(sql).toContain("analytics_quota_exceeded");
    expect(sql).toContain("interval '90 days'");
    expect(sql).toContain("interval '5 minutes'");
    expect(sql).toContain("pg_catalog.octet_length((event -> 'properties')::text) > 16384");
    expect(sql).toContain("pg_catalog.length(event ->> 'event_name') > 160");
  });
});
