import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("email analysis stage handoff contract", () => {
  it("hands Phase A to Phase B through a durable dispatch with no shared lease owner", () => {
    const route = source("src/app/api/integrations/email/analyze/route.ts");

    expect(route).toContain("preparePhaseBDispatch");
    expect(route).toContain("dispatchPhaseBContinuation");
    expect(route).not.toMatch(/analyze-continue[\s\S]{0,500}lockOwner/);
    expect(route).not.toContain("lockTransferred");
  });

  it("claims a fresh Phase B mailbox lease and durably accepts the exact dispatch", () => {
    const route = source(
      "src/app/api/integrations/email/analyze-continue/route.ts"
    );

    expect(route).toContain("acquireEmailConnectionSyncLock");
    expect(route).not.toContain("acquireOrAdoptEmailConnectionSyncLock");
    expect(route).not.toContain("providedLockOwner");
    expect(route).toContain("acceptPhaseBDispatch");
  });

  it("prepares Phase C before releasing Phase B and dispatches without sharing a lease owner", () => {
    const route = source(
      "src/app/api/integrations/email/analyze-continue/route.ts"
    );
    const prepare = route.indexOf("await preparePhaseCDispatch");
    const release = route.indexOf(
      "await releaseEmailConnectionSyncLock",
      prepare
    );
    const dispatch = route.indexOf("await dispatchPhaseCEntry", release);

    expect(prepare).toBeGreaterThan(-1);
    expect(release).toBeGreaterThan(prepare);
    expect(dispatch).toBeGreaterThan(release);
    expect(route.slice(prepare, dispatch + 80)).not.toContain("lockOwner,");
  });

  it("keeps the job open for Phase C and only publishes Phase B completion when Phase C is skipped", () => {
    const route = source(
      "src/app/api/integrations/email/analyze-continue/route.ts"
    );

    expect(route).toContain("persistPhaseBResult");
    expect(route).toMatch(
      /phaseCDisposition === "skipped"[\s\S]{0,300}publishAnalysisCompletion/
    );
    expect(route).not.toMatch(
      /async function runPhaseB[\s\S]*?complete_email_analysis_job_as_system/
    );
  });

  it("uses provider-native abortable deadlines instead of a non-aborting Promise.race", () => {
    const route = source(
      "src/app/api/integrations/email/analyze-continue/route.ts"
    );

    expect(route).not.toContain("fetchWithTimeout");
    expect(route).not.toContain("Promise.race");
    expect(route).toMatch(
      /provider\.fetchThread\(providerThreadId,\s*\{[\s\S]{0,180}deadlineAt:/
    );
  });
});
