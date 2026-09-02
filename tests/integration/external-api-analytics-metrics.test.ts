import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("external analytics metrics route contract", () => {
  const route = readFileSync(
    resolve(process.cwd(), "src/app/v1/analytics/metrics/route.ts"),
    "utf8"
  );

  it("uses the protected analytics boundary and fixed metrics serializer", () => {
    expect(route).toContain('route: "/v1/analytics/metrics"');
    expect(route).toContain('requiredCredentialClass: "analytics"');
    expect(route).toContain('requiredScopes: ["analytics.leads.read"]');
    expect(route).toContain("createMetricsResponse");
    expect(route).toContain("getExternalLeadMetrics");
  });

  it("rejects duplicate and unknown query parameters before execution", () => {
    expect(route).toContain("allowedParameters");
    expect(route).toContain("z.array(z.never()).parse(unknown)");
    expect(route).toContain("optionalScalar");
    expect(route).toContain('parameters.getAll("metric")');
    expect(route).toContain('parameters.getAll("group_by")');
  });
});
