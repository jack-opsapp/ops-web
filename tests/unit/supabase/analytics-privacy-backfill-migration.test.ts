import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260831070000_scrub_legacy_analytics_properties.sql"
  ),
  "utf8"
).toLowerCase();

describe("legacy analytics privacy backfill", () => {
  it("removes only unsafe properties and preserves each event row", () => {
    expect(sql).toContain("from jsonb_each(event.properties) as property");
    expect(sql).toMatch(
      /public\.analytics_properties_are_safe\(\s*jsonb_build_object\(property\.key, property\.value\)\s*\)/
    );
    expect(sql).toContain("update public.analytics_events as event");
    expect(sql).toContain("set properties = sanitized.properties");
    expect(sql).not.toContain("delete from public.analytics_events");
  });

  it("validates the privacy constraint after the scrub", () => {
    expect(sql).toContain(
      "validate constraint analytics_events_properties_privacy_check"
    );
  });
});
