import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.join(process.cwd(), "src/lib/api/services/sync-engine.ts"),
  "utf8"
);

describe("sync-engine likely-won conversion provenance", () => {
  it("selects and forwards the locked assignment snapshot", () => {
    expect(source).toMatch(/select\([^)]*stage[^)]*assignment_version[^)]*\)/i);
    expect(source).toMatch(
      /expectedAssignmentVersion:\s*opportunity\?\.assignment_version/i
    );
  });

  it("uses the actorless email_likely_won contract with real provider evidence", () => {
    expect(source).toMatch(/sourcePath:\s*"email_likely_won"/i);
    expect(source).toMatch(/decidedBy:\s*null/i);
    expect(source).toMatch(/connection_id:\s*connection\.id/i);
    expect(source).toMatch(
      /provider_thread_id:\s*evidence\.provider_thread_id/i
    );
    expect(source).toMatch(
      /provider_message_id:\s*evidence\.provider_message_id/i
    );
    expect(source).toMatch(/decision:\s*"likely_won"/i);
    expect(source).not.toMatch(
      /sourcePath:\s*"won_dialog"[\s\S]{0,500}terminalFlag\s*===\s*"likely_won"/i
    );
  });

  it("selects deterministic persisted customer evidence, separate from synthetic evaluation keys", () => {
    expect(source).toMatch(
      /providerMessageIdsByEvaluationKey[\s\S]*?candidateMessageIds\.add\(email\.id\)/i
    );
    expect(source).toMatch(
      /from\("opportunity_correspondence_events"\)[\s\S]*?\.eq\("direction",\s*"inbound"\)[\s\S]*?\.eq\("party_role",\s*"customer"\)[\s\S]*?\.eq\("is_meaningful",\s*true\)[\s\S]*?\.in\("provider_message_id",\s*\[\.\.\.candidateProviderMessageIds\]\)/i
    );
    expect(source).toMatch(
      /\.order\("occurred_at",\s*\{\s*ascending:\s*false\s*\}\)[\s\S]*?\.order\("id",\s*\{\s*ascending:\s*false\s*\}\)/i
    );
    expect(source).not.toMatch(
      /provider_thread_id:\s*(?:evaluationKey|sourceThreadId)/i
    );
    expect(source).not.toMatch(/conversionEvidenceByEvaluationKey\.set/i);
  });
});
