import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  path.join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260728160000_property_address_identity_boundary.sql"
  ),
  "utf8"
)
  .replace(/\s+/g, " ")
  .toLowerCase();

describe("property address identity migration", () => {
  it("defines one explicit property qualification boundary", () => {
    expect(sql).toContain(
      "create or replace function private.normalize_property_address"
    );
    expect(sql).toContain("p_include_unit boolean default true");
    expect(sql).toContain("canonicalize_address_text");
    expect(sql).toContain("post office box");
    expect(sql).toContain("rural route");
    expect(sql).toContain("concession");
    expect(sql).toContain("parcel");
  });

  it("routes legacy and email-conversion identities through the boundary", () => {
    expect(sql).toMatch(
      /create or replace function private\.normalize_address\(p text\)[\s\S]*?normalize_property_address\(p, true\)/
    );
    expect(sql).toMatch(
      /create or replace function private\.normalize_email_project_dedupe_address\([\s\S]*?normalize_property_address\(p_address, true\)/
    );
  });

  it("pins locality negatives, unit separation, and rural positives", () => {
    for (const value of [
      "victoria",
      "saanich cedar hill area",
      "victoria, bc v8w 1p6",
      "po box 123",
      "123 victoria",
      "2508883674 victoria",
      "20260728 main",
      "123 cedar",
      "2745 fernwood rd",
      "unit 2, 123 main street",
      "123 main st apt 3",
      "123 cedar way, victoria bc",
      "45 ridge trl, saanich bc",
      "9 garden cir, langford bc",
      "rr 2 site 4 box 19",
      "lot 12 concession 3",
    ]) {
      expect(sql).toContain(value);
    }
    expect(sql).toContain("locality entered property address identity");
    expect(sql).toContain("property address identity contract failed");
    expect(sql).toMatch(
      /substring\(\s*lower\(v_raw\) from '[^']*(?:apartment|suite|unit)/
    );
  });

  it("keeps internal functions unavailable through the Data API", () => {
    expect(sql).toMatch(
      /revoke all on function private\.normalize_property_address\(text, boolean\) from public, anon, authenticated, service_role/
    );
    expect(sql).toMatch(
      /revoke all on function private\.normalize_email_project_dedupe_address\(text\) from public, anon, authenticated, service_role/
    );
  });
});
