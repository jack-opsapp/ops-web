import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(
    process.cwd(),
    "src/app/(dashboard)/calibration/_components/section-milestones.tsx"
  ),
  "utf8"
);

describe("calibration milestone browser boundary", () => {
  it("refreshes actor-scoped milestones only through the authenticated deck route", () => {
    expect(source).toContain("useCalibrationDeck");
    expect(source).not.toContain("getSupabaseClient");
    expect(source).not.toContain("email_connections");
    expect(source).not.toContain("postgres_changes");
    expect(source).not.toContain(".channel(");
  });
});
