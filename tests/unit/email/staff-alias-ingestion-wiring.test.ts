import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("authoritative staff aliases across ingestion paths", () => {
  it.each([
    [
      "live sync and recovery",
      "src/lib/api/services/sync-engine.ts",
    ],
    [
      "historical Gmail import",
      "src/app/api/integrations/gmail/historical-import/route.ts",
    ],
    ["analysis Phase A", "src/app/api/integrations/email/analyze/route.ts"],
    [
      "analysis Phase B",
      "src/app/api/integrations/email/analyze-continue/route.ts",
    ],
    [
      "analysis memory",
      "src/app/api/integrations/email/analyze-memory/route.ts",
    ],
  ])("%s uses authoritative authorship", (_label, path) => {
    const body = source(path);
    expect(body).toContain("resolvePersistedEmailAuthorship");
    expect(body).toContain("staffAliasCandidate");
  });

  it.each([
    ["live sync", "src/lib/api/services/sync-engine.ts"],
    [
      "historical Gmail import",
      "src/app/api/integrations/gmail/historical-import/route.ts",
    ],
    ["analysis Phase A", "src/app/api/integrations/email/analyze/route.ts"],
    [
      "analysis Phase B",
      "src/app/api/integrations/email/analyze-continue/route.ts",
    ],
    [
      "analysis memory",
      "src/app/api/integrations/email/analyze-memory/route.ts",
    ],
  ])("%s persists strongly corroborated aliases for audit", (_label, path) => {
    expect(source(path)).toContain("persistStaffEmailAliasCandidate");
  });

  it("recovery can correct queued customer classification to outbound", () => {
    const body = source("src/lib/api/services/sync-engine.ts");
    const recovery = body.slice(
      body.indexOf("async retryPendingIngestionRecovery("),
      body.indexOf("async retryPendingLeadScans(")
    );
    expect(recovery).toContain('if (exact.direction === "outbound")');
    expect(recovery).toContain("await processSentEmail(");
    expect(recovery).toContain("exact.staffAliasCandidate");
  });

  it("approved imports reject exact and pending staff identities before writes", () => {
    const body = source("src/app/api/integrations/email/import/route.ts");
    const guard = body.indexOf("const pendingStaffAliases");
    const loop = body.indexOf("for (let i = 0; i < sortedLeads.length; i++)");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(loop);
    expect(body).toContain("authoritativeOperator.emails.has(email)");
    expect(body).toContain("pendingStaffAliases.has(email)");
    expect(body).toContain("authoritativeOperator.domains.has(domain)");
  });
});
