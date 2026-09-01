import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260829000100_lead_classification_review_borderline_reason.sql"
);

function migration(): string {
  return readFileSync(migrationPath, "utf8");
}

describe("lead classification review borderline reason migration", () => {
  it("replaces the review_reason check on the canonical constraint name", () => {
    const sql = migration();

    expect(sql).toMatch(
      /alter table public\.lead_classification_reviews\s+drop constraint if exists lead_classification_reviews_review_reason_check/i
    );
    expect(sql).toMatch(
      /alter table public\.lead_classification_reviews\s+add constraint lead_classification_reviews_review_reason_check/i
    );
  });

  it("admits the borderline band without invalidating any existing reason", () => {
    const sql = migration();

    for (const reason of [
      "feedback_boundary",
      "duplicate_feedback",
      "neutral_feedback",
      "positive_feedback_conflict",
      "borderline_confidence",
    ]) {
      expect(sql).toContain(`'${reason}'`);
    }
  });

  it("is additive only — it never rewrites or deletes review rows", () => {
    const sql = migration();

    expect(sql).not.toMatch(/delete\s+from\s+public\.lead_classification_reviews/i);
    expect(sql).not.toMatch(/update\s+public\.lead_classification_reviews/i);
    expect(sql).not.toMatch(/drop\s+table/i);
  });
});
