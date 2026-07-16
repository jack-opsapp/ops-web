import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(
    process.cwd(),
    "src/app/api/integrations/email/analyze-continue/route.ts"
  ),
  "utf8"
);

describe("email analysis completion notification", () => {
  it("uses the trusted server seam after final requester authorization", () => {
    expect(source).toContain("createTrustedNotifications");
    expect(source).toMatch(
      /authorizeEmailAnalysisJobContinuation[\s\S]*?createTrustedNotifications/
    );
    expect(source).toContain(
      "recipientUserIds: [completionAccess.actorUserId]"
    );
    expect(source).toContain("companyId: completionAccess.companyId");
    expect(source).toContain("pipeline-analysis-complete:${jobId}");
    expect(source).not.toMatch(
      /\.from\(["']notifications["']\)[\s\S]{0,120}\.insert\(/
    );
  });
});
