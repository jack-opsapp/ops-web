/**
 * Approval-queue create_project parity with the canonical conversion path (P6).
 *
 * The approval queue's executeCreateProject used to (1) create a project with
 * the legacy `opportunity_id` text column and (2) write ONLY
 * opportunities.project_id (never the FK-backed project_ref) — the root cause
 * of the project_id-vs-project_ref drift. P6 routes an opportunity-sourced
 * proposal through ProjectConversionService so it writes the SAME four-column
 * contract + disposition as the Won-dialog path. These source-level regression
 * locks assert the wrong-column write is gone and the conversion service is the
 * link author.
 *
 * executeCreateProject is module-private, so this asserts against source — the
 * same pattern the duplicate-merge cron permission test uses.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.join(process.cwd(), "src/lib/api/services/approval-queue-service.ts"),
  "utf8"
);
const suggestionSource = readFileSync(
  path.join(
    process.cwd(),
    "src/lib/api/services/project-suggestion-service.ts"
  ),
  "utf8"
);

describe("approval-queue create_project — P6 conversion parity", () => {
  it("routes an opportunity-sourced proposal through ProjectConversionService", () => {
    expect(source).toContain("project-conversion-service");
    expect(source).toMatch(
      /ProjectConversionService\.convertOpportunityToProject\(/
    );
    // routed with the approval_queue source path.
    expect(source).toMatch(/sourcePath:\s*"approval_queue"/);
  });

  it("no longer writes the legacy-only opportunities.project_id link", () => {
    // The bespoke wrong-column write (the drift source) must be gone.
    expect(source).not.toMatch(
      /\.from\("opportunities"\)\s*\.update\(\{\s*project_id:/
    );
  });

  it("still creates a standalone project when there is no source opportunity", () => {
    // The non-conversion branch keeps the plain ProjectService.createProject.
    expect(source).toMatch(/else\s*\{[\s\S]*?ProjectService\.createProject\(/);
  });

  it("threads the executing reviewer and immutable proposal provenance", () => {
    expect(source).toMatch(/executeAction\([\s\S]*?reviewerUserId/i);
    expect(source).toMatch(/executeCreateProject\([\s\S]*?reviewerUserId/i);
    expect(source).toMatch(/decidedBy:\s*reviewerUserId/i);
    expect(source).toMatch(
      /expectedAssignmentVersion:\s*data\.source_assignment_version/i
    );
    expect(source).toMatch(/agent_action_id:\s*action\.id/i);
    expect(source).toMatch(/approval_mode:\s*"operator_approved"/i);
  });

  it("preserves source opportunity, assignment version, and thread across client edits", () => {
    for (const key of [
      "source_opportunity_id",
      "source_assignment_version",
      "source_thread_id",
    ]) {
      expect(source).toMatch(
        new RegExp(`${key}:\\s*(?:originalActionData|action\\.actionData)`, "i")
      );
    }
  });

  it("fails autonomous opportunity conversion before calling the conversion service", () => {
    expect(source).toMatch(
      /learningAuthority\s*===\s*"autonomous"[\s\S]*?autonomous opportunity conversion/i
    );
  });

  it("captures the exact opportunity assignment version when creating a proposal", () => {
    expect(suggestionSource).toMatch(
      /from\("opportunities"\)[\s\S]*?select\("assigned_to, assignment_version"\)[\s\S]*?eq\("id",\s*opportunityId\)/i
    );
    expect(suggestionSource).toContain("opportunity.assigned_to !== userId");
    expect(suggestionSource).toContain(
      "opportunity.assignment_version !== expectedAssignmentVersion"
    );
    expect(suggestionSource).toMatch(
      /source_assignment_version:\s*expectedAssignmentVersion/i
    );
  });
});
