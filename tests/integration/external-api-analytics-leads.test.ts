import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("external analytics lead route contract", () => {
  const route = readFileSync(
    resolve(process.cwd(), "src/app/v1/analytics/leads/route.ts"),
    "utf8"
  );

  it("uses the protected analytics boundary and fixed response serializer", () => {
    expect(route).toContain('route: "/v1/analytics/leads"');
    expect(route).toContain('requiredCredentialClass: "analytics"');
    expect(route).toContain('requiredScopes: ["analytics.leads.read"]');
    expect(route).toContain("createLeadFeedResponse");
    expect(route).toContain("getExternalLeadFeed");
  });
});
