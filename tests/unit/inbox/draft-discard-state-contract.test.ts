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
  it("preserves draft history when a pending auto-send is cancelled through the guarded queue RPC", () => {
    expect(autoSendSource).toMatch(
      /rpcRow\("cancel_phase_c_auto_send",\s*\{[\s\S]*?p_company_id:\s*companyId/
    );
    expect(autoSendSource).not.toContain('.from("ai_draft_history")');
  });

  it("keeps completion and retry state transitions behind guarded Phase C queue RPCs", () => {
    expect(autoSendSource).toContain('rpcRow("complete_phase_c_auto_send"');
    expect(autoSendSource).toContain('rpcRow("retry_phase_c_auto_send"');
    expect(autoSendSource).not.toContain("markAutoSendDraftDiscarded");
  });

  it("stamps discard time in the authenticated auto-draft delete route", () => {
    expect(autoDraftRouteSource).toMatch(
      /\.from\("ai_draft_history"\)[\s\S]*?\.update\(\{\s*status:\s*"discarded",\s*discarded_at:/
    );
    expect(autoDraftRouteSource).toMatch(
      /\.update\(\{[\s\S]*?status:\s*"discarded"[\s\S]*?\.eq\("company_id", actor\.companyId\)[\s\S]*?\.eq\("user_id", actor\.userId\)[\s\S]*?\.eq\("status", "auto_drafted"\)/
    );
  });
});
