import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.join(process.cwd(), "src/lib/api/services/sync-engine.ts"),
  "utf8"
);

const acceptanceWrapper = source.slice(
  source.indexOf("async function maybeAutoAdvanceOnAccept"),
  source.indexOf("async function createTerminalFlagNotification")
);

describe("sync-engine Won conversion provenance", () => {
  it("does not authorize conversion from a model-only likely-won label", () => {
    expect(source).not.toMatch(/sourcePath:\s*"email_likely_won"/i);
    expect(source).not.toMatch(/decision:\s*"likely_won"/i);
    expect(source).toContain("evaluateOpportunityAcceptance({");
    expect(source).toContain("createTerminalFlagNotification(");
  });

  it("selects deterministic persisted customer evidence, separate from synthetic evaluation keys", () => {
    expect(source).toMatch(
      /evaluateOpportunityAcceptance\(\{[\s\S]*?providerThreadId:\s*target,[\s\S]*?opportunityId,[\s\S]*?connection/i
    );
    expect(source).not.toMatch(
      /provider_thread_id:\s*(?:evaluationKey|sourceThreadId)/i
    );
    expect(source).not.toMatch(/conversionEvidenceByEvaluationKey\.set/i);
  });

  it("does not make engine-created lost deferrals inert before reevaluation", () => {
    expect(acceptanceWrapper).toContain(
      "shouldEvaluateOpportunityCommercialOutcome"
    );
    expect(acceptanceWrapper).not.toMatch(
      /\[\s*["']won["']\s*,\s*["']lost["']\s*,\s*["']discarded["']\s*\]/
    );
  });
});
