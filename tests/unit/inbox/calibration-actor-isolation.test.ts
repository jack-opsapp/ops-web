import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const service = readFileSync(
  resolve(process.cwd(), "src/lib/api/services/calibration-service.ts"),
  "utf8"
);

function block(startMarker: string, endMarker: string): string {
  const start = service.indexOf(startMarker);
  const end = service.indexOf(endMarker, start + startMarker.length);
  expect(start, `missing ${startMarker}`).toBeGreaterThan(-1);
  expect(end, `missing ${endMarker}`).toBeGreaterThan(start);
  return service.slice(start, end);
}

describe("calibration actor isolation", () => {
  it("scopes recent events and activity content to the authenticated OPS actor", () => {
    const recent = block("async getRecentEvents(", "async getActivityLog(");
    const activity = block("async getActivityLog(", "// ─── Per-tile queries");

    for (const source of [recent, activity]) {
      expect(source).toContain("userId: string");
      expect(source).toContain('.eq("user_id", userId)');
      expect(source).toContain('.eq("requested_by_user_id", userId)');
    }
  });

  it("builds inputs, corpus, and activity only from the actor's durable rows", () => {
    const inputs = block("async getInputsState(", "async getCorpusState(");
    const corpus = block("async getCorpusState(", "async getConfigState(");
    const activity = block(
      "async getActivityState(",
      "async getMilestonesState("
    );

    expect(inputs).toContain("userId: string");
    expect(inputs).toContain('.eq("requested_by_user_id", userId)');
    expect(inputs).toContain('.eq("user_id", userId)');
    expect(corpus).toContain("getFactSparkline(companyId, userId)");
    expect(corpus).not.toContain('.from("graph_entities")');
    expect(activity).toContain("userId: string");
    expect(activity).toContain('.eq("requested_by_user_id", userId)');
    expect(activity).toContain('.eq("user_id", userId)');
  });

  it("keeps readiness domain metrics actor-scoped", () => {
    const milestones = block("async getMilestonesState(", "// ─── Utilities");
    expect(milestones).toContain('.eq("requested_by_user_id", userId)');
    expect(milestones).toContain("deriveProjectsStatus(companyId, userId)");
    expect(milestones).toContain("deriveInvoiceStatus(companyId, userId)");
    expect(milestones).toContain("deriveScheduleStatus(companyId, userId)");
  });
});

describe("calibration route authorization", () => {
  for (const route of ["recent", "activity", "first-run"]) {
    it(`${route} resolves the canonical inbox/pipeline intersection`, () => {
      const source = readFileSync(
        resolve(process.cwd(), `src/app/api/calibration/${route}/route.ts`),
        "utf8"
      );
      expect(source).toContain("resolveEmailInboxListAccess");
      expect(source).toContain("userId: auth.id");
      expect(source).toContain("companyId: auth.companyId");
      expect(source).toContain("if (!access.allowed)");
    });
  }
});
