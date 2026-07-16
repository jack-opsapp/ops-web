import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/app/api/inbox/phase-c-backfill/route.ts"),
  "utf8"
);

describe("Phase C backfill actor boundary", () => {
  it("requires a canonical authenticated OPS actor instead of caller-supplied cron identity", () => {
    expect(source).toContain("resolveEmailRouteActor(request)");
    expect(source).not.toContain("isCronAuth");
    expect(source).not.toContain('searchParams.get("companyId")');
    expect(source).not.toContain('searchParams.get("userId")');
  });

  it("applies the canonical inbox and lead intersection before selecting work", () => {
    expect(source).toContain("resolveEmailInboxListAccess");
    expect(source).toContain("buildEmailThreadListAuthorizationFilter");
    expect(source).toContain("resolveEmailOpportunityAccess");
    expect(source).toContain("applyAuthorizationFilter");
  });

  it("attributes every learned memory to the authenticated actor, never the connector owner", () => {
    expect(source).toContain("const memoryUserId = actor.userId");
    expect(source).not.toContain("connection.userId ??");
    expect(source).not.toContain("resolvedUserId");
  });
});
