import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/app/api/cron/phase-c-graduation-check/route.ts"),
  "utf8"
);

describe("Phase C graduation sweep reliability", () => {
  it("retries both post-learning milestone checks in strict mode", () => {
    expect(source).toContain(
      "AutonomyMilestoneService.checkMilestonesAfterSync"
    );
    expect(source).toContain(
      "AutonomyMilestoneService.checkMilestonesAfterDraftFeedback"
    );
    expect(source.match(/throwOnError: true/g)).toHaveLength(2);
  });

  it("atomically claims actor-mailbox scopes and lease-fences every completion", () => {
    expect(source).toContain(
      '"claim_phase_c_graduation_actor_scopes_as_system"'
    );
    expect(source).toContain(
      '"complete_phase_c_graduation_scope_check_as_system"'
    );
    expect(source).toContain("p_lease_token: scope.lease_token");
    expect(source).toContain("p_succeeded: succeeded");
    expect(source).toContain("completeScope(supabase, scope, true, null)");
    expect(source).toMatch(/completeScope\([\s\S]*scope,[\s\S]*false,/);
  });

  it("uses the lifetime-deduped category prompt RPC", () => {
    expect(source).toContain('"record_phase_c_graduation_prompt_as_system"');
    expect(source).toContain("buildPhaseCGraduationActionUrl(");
    expect(source).toContain("scope.connection_id");
    expect(source).toContain("category");
    expect(source).not.toContain("NotificationService.create");
  });

  it("imports category labels only from a server-safe library", () => {
    expect(source).toContain("@/lib/email/email-thread-category-metadata");
    expect(source).not.toContain("@/components/ops/inbox/category-chip");
  });

  it("returns a non-success response when completion bookkeeping remains incomplete", () => {
    expect(source).toContain("bookkeepingFailed > 0");
    expect(source).toMatch(/bookkeepingFailed > 0[\s\S]*status:\s*500/);
  });
});
