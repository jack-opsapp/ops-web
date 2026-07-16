import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Phase C dashboard widget data boundary", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/components/dashboard/widgets/phase-c-autonomy-widget.tsx"),
    "utf8"
  );

  it("loads the actor-scoped server aggregate and never queries protected email tables", () => {
    expect(source).toContain("/api/agent/phase-c-week-summary");
    expect(source).not.toContain("requireSupabase");
    expect(source).not.toMatch(/\.from\(["'](?:pending_auto_sends|ai_draft_history|email_threads|email_connections)["']\)/);
  });
});
