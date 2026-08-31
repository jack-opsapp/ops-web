import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const sql = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260831033000_ios_analytics_contract_metadata.sql"
  ),
  "utf8"
)

describe("versioned iOS analytics ingest migration", () => {
  it("keeps the public wrapper unprivileged and delegates to the protected boundary", () => {
    expect(sql).toMatch(
      /create or replace function analytics_ingest\.append_analytics_events\([\s\S]*p_schema_version smallint,[\s\S]*p_environment text[\s\S]*security definer[\s\S]*set search_path = ''/
    )
    expect(sql).toMatch(
      /create or replace function public\.append_analytics_events\([\s\S]*security invoker[\s\S]*analytics_ingest\.append_analytics_events/
    )
    expect(sql).not.toMatch(
      /create or replace function public\.append_analytics_events\([\s\S]*security definer/
    )
  })

  it("validates and persists version and environment after canonical identity resolution", () => {
    expect(sql).toMatch(/p_schema_version is distinct from 1/)
    expect(sql).toMatch(/'production', 'preview', 'development', 'test'/)
    expect(sql).toMatch(/stored\.user_id = v_user_id/)
    expect(sql).toMatch(/stored\.platform = 'ios'/)
    expect(sql).toMatch(/schema_version = p_schema_version/)
    expect(sql).toMatch(/environment = p_environment/)
  })

  it("preserves the established authenticated, validated, idempotent append path", () => {
    expect(sql).toMatch(
      /v_result := analytics_ingest\.append_analytics_events\(\s*p_events,\s*p_expected_subject\s*\)/
    )
    expect(sql).toMatch(/auth\.jwt\(\) ->> 'sub'/)
    expect(sql).toMatch(/stored\.id in \([\s\S]*jsonb_array_elements\(p_events\)/)
  })
})
