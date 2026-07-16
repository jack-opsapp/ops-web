import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/lib/api/services/calibration-service.ts"),
  "utf8"
);
const mailboxScopeSource = readFileSync(
  resolve(process.cwd(), "src/lib/email/calibration-mailbox-scope.ts"),
  "utf8"
);

function block(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  expect(start, `missing ${startMarker}`).toBeGreaterThan(-1);
  expect(end, `missing ${endMarker}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("calibration user scope", () => {
  it("passes the authenticated OPS actor through every writing-profile projection", () => {
    const deck = block("async getDeckState(", "async getFirstRunState(");
    const corpus = block("async getCorpusState(", "async getConfigState(");
    const milestones = block(
      "async getMilestonesState(",
      "// \u2500\u2500\u2500 Utilities"
    );

    expect(deck).toContain("this.getCorpusState(companyId, userId)");
    expect(corpus).toContain("userId: string");
    expect(corpus).toContain('.eq("user_id", userId)');
    expect(milestones).toContain('.eq("user_id", userId)');
  });

  it("reads the persisted snake-case category autonomy contract", () => {
    const config = block("async getConfigState(", "async getActivityState(");
    const milestones = block(
      "async getMilestonesState(",
      "// \u2500\u2500\u2500 Utilities"
    );

    expect(mailboxScopeSource).toContain("settings.category_autonomy");
    expect(config).toContain("aggregateCalibrationConnectionConfig(");
    expect(milestones).toContain("aggregateCalibrationConnectionConfig(");
    expect(mailboxScopeSource).not.toContain("settings.categoryAutonomy");
  });
});
