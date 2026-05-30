import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const scriptPath = path.join(
  process.cwd(),
  "scripts/lead-lifecycle-p5-3-repair.ts"
);

function scriptSource(): string {
  return readFileSync(scriptPath, "utf8");
}

describe("lead lifecycle P5-3 repair script", () => {
  it("writes the exact notification and draft-subject repair artifacts", () => {
    const source = scriptSource();

    expect(source).toContain(
      "/Users/jacksonsweet/Projects/OPS/docs/data-cleanup/lead-lifecycle-p5-3-notification-link-repair-dry-run-2026-05-29.md"
    );
    expect(source).toContain(
      "/Users/jacksonsweet/Projects/OPS/docs/data-cleanup/lead-lifecycle-p5-3-notification-link-repair-apply-2026-05-29.md"
    );
    expect(source).toContain(
      "/Users/jacksonsweet/Projects/OPS/docs/data-cleanup/lead-lifecycle-p5-3-draft-subject-repair-dry-run-2026-05-29.md"
    );
    expect(source).toContain(
      "/Users/jacksonsweet/Projects/OPS/docs/data-cleanup/lead-lifecycle-p5-3-draft-subject-repair-apply-2026-05-29.md"
    );
  });

  it("limits apply mode to notification repair and lifecycle draft subject repair", () => {
    const source = scriptSource();

    expect(source).toContain('from("notifications").update');
    expect(source).toContain('from("opportunity_follow_up_drafts").update');
    expect(source).not.toContain('from("opportunities").update');
    expect(source).not.toContain('from("clients").update');
    expect(source).not.toContain('from("activities").update');
    expect(source).not.toContain('from("email_threads").update');
    expect(source).not.toContain("createDraft(");
    expect(source).not.toContain("sendEmail(");
  });

  it("renders hard-stop proof for email, provider draft, guarded action, and opportunity-state boundaries", () => {
    const source = scriptSource();

    expect(source).toContain("Emails sent: no.");
    expect(source).toContain("Provider drafts created: no.");
    expect(source).toContain("Guarded destructive apply: no.");
    expect(source).toContain("Opportunity business state changed: no.");
    expect(source).toContain("P6 started: no.");
  });
});
