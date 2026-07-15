import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const autoSendSource = readFileSync(
  join(process.cwd(), "src/lib/api/services/auto-send-service.ts"),
  "utf8"
);
const autoDraftRouteSource = readFileSync(
  join(process.cwd(), "src/app/api/integrations/email/auto-drafts/route.ts"),
  "utf8"
);

describe("AI draft discard state", () => {
  it("stamps discard time and company scope when a pending auto-send is cancelled", () => {
    expect(autoSendSource).toMatch(
      /\.from\("ai_draft_history"\)[\s\S]*?\.update\(\{\s*status:\s*"discarded",\s*discarded_at:/
    );
    expect(autoSendSource).toMatch(
      /\.from\("ai_draft_history"\)[\s\S]*?\.eq\("id", draftHistoryId\)[\s\S]*?\.eq\("company_id", companyId\)/
    );
  });

  it("retires the linked draft for every auto-send cancellation path", () => {
    const discardCalls =
      autoSendSource.match(/markAutoSendDraftDiscarded\(/g) ?? [];
    // One helper declaration plus manual cancellation, inactive subscription,
    // and disabled-auto-send call sites.
    expect(discardCalls).toHaveLength(4);
  });

  it("stamps discard time in the authenticated auto-draft delete route", () => {
    expect(autoDraftRouteSource).toMatch(
      /\.from\("ai_draft_history"\)[\s\S]*?\.update\(\{\s*status:\s*"discarded",\s*discarded_at:/
    );
    expect(autoDraftRouteSource).toMatch(
      /\.update\(\{[\s\S]*?status:\s*"discarded"[\s\S]*?\.eq\("company_id", companyId\)[\s\S]*?\.eq\("status", "auto_drafted"\)/
    );
  });
});
