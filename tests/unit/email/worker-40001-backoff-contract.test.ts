import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// 2026-07-22 outage contract: no worker may retry a SQLSTATE 40001
// ('meaningful correspondence projection pending') immediately or without a
// cap, and one wedged opportunity may never starve the rest of its batch.
// These are source contracts in the house sync-engine style because the
// engine module is too heavy to import under vitest.

const syncEngineSource = readFileSync(
  path.join(process.cwd(), "src/lib/api/services/sync-engine.ts"),
  "utf8"
);
const leadSummarySource = readFileSync(
  path.join(process.cwd(), "src/lib/api/services/lead-summary-service.ts"),
  "utf8"
);
const acceptanceWrapper = syncEngineSource.slice(
  syncEngineSource.indexOf("async function maybeAutoAdvanceOnAccept"),
  syncEngineSource.indexOf("async function createTerminalFlagNotification")
);

describe("sync-engine 40001 backoff and batch isolation", () => {
  it("imports the shared serialization retry helper", () => {
    expect(syncEngineSource).toContain(
      'import { withSerializationRetry } from "@/lib/supabase/serialization-retry";'
    );
  });

  it("retries the whole accept evaluation under withSerializationRetry, never the bare RPC", () => {
    expect(acceptanceWrapper).toMatch(
      /withSerializationRetry\(\s*\(\)\s*=>\s*evaluateOpportunityAcceptance\(\{/
    );
    // Evidence must be re-derived per attempt; a bare same-args RPC retry
    // would replay a stale high-water mark.
    expect(acceptanceWrapper).not.toMatch(/\.rpc\(/);
  });

  it("isolates each opportunity in the accept batch and aggregates failures after the loop", () => {
    const loopStart = syncEngineSource.indexOf("const acceptFailures");
    expect(loopStart).toBeGreaterThan(-1);
    const loop = syncEngineSource.slice(loopStart, loopStart + 2400);
    expect(loop).toMatch(
      /try\s*\{\s*await maybeAutoAdvanceOnAccept\(\{[\s\S]*?\}\);\s*\}\s*catch/
    );
    expect(loop).toContain("acceptFailures.push(");
    expect(loop).toMatch(
      /if \(acceptFailures\.length > 0\)\s*\{\s*throw new LifecyclePersistenceError\(/
    );
    // Cursor semantics are preserved: an exhausted retry still fails the
    // cycle before cursor advancement (the 60s guard bound makes the replay
    // self-healing), it just no longer aborts the batch mid-loop.
    expect(loop).toContain("before cursor advancement");
  });
});

describe("lead-summary 40001 backoff", () => {
  it("wraps only the snapshot commit in withSerializationRetry, never model generation", () => {
    expect(leadSummarySource).toContain(
      'import { withSerializationRetry } from "@/lib/supabase/serialization-retry";'
    );
    const commitStart = leadSummarySource.indexOf(
      "async function commitLeadSummarySnapshot"
    );
    expect(commitStart).toBeGreaterThan(-1);
    const commitBody = leadSummarySource.slice(
      commitStart,
      leadSummarySource.indexOf("export interface TargetedLeadSummaryRefreshResult")
    );
    expect(commitBody).toMatch(
      /withSerializationRetry\(\s*async \(\) => \{[\s\S]*?"commit_lead_summary_snapshot"/
    );
    expect(commitBody).not.toContain("generateLeadSummary(");
  });

  it("preserves the PostgREST SQLSTATE across the summary-write re-wrap", () => {
    expect(leadSummarySource).toMatch(
      /Object\.assign\(\s*new Error\(`summary write failed:[\s\S]*?\{ code: \(error as \{ code\?: string \}\)\.code \}/
    );
  });
});
