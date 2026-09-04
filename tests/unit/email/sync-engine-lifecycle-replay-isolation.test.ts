import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "src/lib/api/services/sync-engine.ts"),
  "utf8"
);

const runSync = source.slice(
  source.indexOf("async runSync("),
  source.indexOf("async retryPendingIngestionRecovery(")
);

describe("sync-engine lifecycle replay conflict isolation", () => {
  it("imports the typed classifier rather than matching strings inline", () => {
    expect(source).toContain("isLifecycleDecisionReplayConflict");
    expect(runSync).not.toContain('"lifecycle_decision_replay_conflict"');
  });

  it("isolates the conflict to one lead instead of adding it to acceptFailures", () => {
    const guard = runSync.indexOf(
      "isLifecycleDecisionReplayConflict(acceptError)"
    );
    const acceptFailuresPush = runSync.indexOf("acceptFailures.push({");
    expect(guard).toBeGreaterThan(-1);
    expect(acceptFailuresPush).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(acceptFailuresPush);
  });

  it("keeps the conflict visible in the cron result while letting the run finish", () => {
    const conflictBranch = runSync.slice(
      runSync.indexOf("isLifecycleDecisionReplayConflict(acceptError)")
    );
    const branchEnd = conflictBranch.indexOf("acceptFailures.push({");
    const branch = conflictBranch.slice(0, branchEnd);
    expect(branch).toContain("result.errors.push(");
    expect(branch).toContain("continue;");
    expect(branch).not.toContain("throw");
  });

  it("still fails closed for database pressure and every other accept failure", () => {
    expect(runSync).toContain(
      "if (isDatabasePressureError(acceptError)) throw acceptError;"
    );
    expect(runSync).toContain(
      "accept-to-project conversion failed before cursor advancement for"
    );
  });

  it("reaches the cursor checkpoint after the accept loop", () => {
    // runSync also checkpoints on an earlier deferred-summary return path, so
    // the boundary must be searched FROM the loop. A bare indexOf finds that
    // earlier call and would assert nothing about the accept path at all.
    const loop = runSync.indexOf(
      "for (const [evaluationKey, target] of activeLeadTargets)"
    );
    expect(loop).toBeGreaterThan(-1);
    const checkpoint = runSync.indexOf("await persistSyncCheckpoint();", loop);
    expect(checkpoint).toBeGreaterThan(loop);
  });
});
