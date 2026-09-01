import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Bug 63ff8830: the email-sync cycle published its durable checkpoint only
 * after the entire processing pipeline, so Vercel's unsignalled 300s kill
 * landed mid-pipeline and lost both the checkpoint and the workload lease —
 * four 504s replayed the same Gmail history range and the cursor stalled.
 *
 * These are structural invariants over runSync, in the same style as
 * sync-engine-ingestion-recovery-wiring.test.ts: the ordering guarantees are
 * what make the fix correct, and ordering is exactly what a mocked cycle is
 * worst at proving. Behavioural coverage of the primitives themselves lives in
 * tests/unit/services/invocation-deadline.test.ts and
 * tests/unit/email/gmail-provider-defer-remainder.test.ts.
 */
const source = readFileSync(
  join(process.cwd(), "src/lib/api/services/sync-engine.ts"),
  "utf8"
);

const runSyncBody = source.slice(
  source.indexOf("  async runSync("),
  source.indexOf("  async retryPendingIngestionRecovery(")
);

function indexIn(haystack: string, needle: string): number {
  const at = haystack.indexOf(needle);
  expect(at, `expected to find ${JSON.stringify(needle)}`).toBeGreaterThan(-1);
  return at;
}

describe("sync-engine invocation-deadline checkpointing", () => {
  it("carries the deferral flag on the cycle result and defaults it to false", () => {
    expect(source).toContain("deadlineDeferred: boolean;");
    const empty = source.slice(
      indexIn(source, "function emptyResult(): SyncCycleResult {"),
      indexIn(source, "interface EmailIngestionRecoveryRow")
    );
    expect(empty).toContain("deadlineDeferred: false,");
  });

  it("accepts an optional deadline and never acts on one that was not passed", () => {
    expect(runSyncBody).toContain(
      "options: { deadline?: InvocationDeadline } = {}"
    );
    // Every gate reads through optional chaining, so a caller that passes no
    // deadline gets byte-identical behaviour to before this change.
    const gates = runSyncBody.match(/options\.deadline\?\.expired\(/g) ?? [];
    expect(gates).toHaveLength(4);
    expect(runSyncBody).not.toMatch(/options\.deadline\.expired\(/);
  });

  it("SP-A: refuses to start a cycle it cannot finish, before any provider work", () => {
    const gate = indexIn(
      runSyncBody,
      "if (options.deadline?.expired(EMAIL_SYNC_MIN_CONNECTION_BUDGET_MS)) {"
    );
    const firstRecovery = indexIn(runSyncBody, "reconcileExpiredMailboxHistory(");
    const firstFetch = indexIn(runSyncBody, "provider.fetchNewEmailsSince(");
    expect(gate).toBeLessThan(firstRecovery);
    expect(gate).toBeLessThan(firstFetch);
    // Leaving the connection untouched is the whole point: no cursor write of
    // any kind may precede this return.
    const guarded = runSyncBody.slice(gate, gate + 220);
    expect(guarded).toContain("result.deadlineDeferred = true;");
    expect(guarded).toContain("return result;");
    expect(guarded).not.toContain("persistEmailConnection");
  });

  it("SP-B: stops admitting messages with the post-loop reserve intact and owes the rest", () => {
    const loopHead = indexIn(
      runSyncBody,
      "for (const [index, item] of processingQueue.entries()) {"
    );
    const gate = indexIn(
      runSyncBody,
      "if (options.deadline?.expired(EMAIL_SYNC_POST_LOOP_RESERVE_MS)) {"
    );
    // Scoped to the loop: earlier lease renewals belong to the webhook drain.
    const leaseInLoop = runSyncBody.indexOf(
      "await renewSyncLeaseIfNeeded();",
      loopHead
    );
    expect(leaseInLoop).toBeGreaterThan(-1);
    // The gate is the first thing in the loop body — checked before any work
    // for this item, including the lease renewal.
    expect(gate).toBeGreaterThan(loopHead);
    expect(gate).toBeLessThan(leaseInLoop);

    const guarded = runSyncBody.slice(gate, gate + 320);
    expect(guarded).toContain("processingQueue.slice(index)");
    expect(guarded).toContain("deferredProviderMessageIds.push(remaining.email.id);");
    expect(guarded).toContain("result.deadlineDeferred = true;");
    expect(guarded).toContain("break;");
  });

  it("declares the remainder accumulator before the checkpoint closure reads it", () => {
    const declaration = indexIn(
      runSyncBody,
      "const deferredProviderMessageIds: string[] = [];"
    );
    const closure = indexIn(runSyncBody, "const persistSyncCheckpoint = async () => {");
    const loopFill = indexIn(
      runSyncBody,
      "deferredProviderMessageIds.push(remaining.email.id);"
    );
    expect(declaration).toBeLessThan(closure);
    expect(declaration).toBeLessThan(loopFill);
  });

  it("hands the unprocessed remainder back through the Gmail cursor", () => {
    const closure = runSyncBody.slice(
      indexIn(runSyncBody, "const persistSyncCheckpoint = async () => {"),
      indexIn(runSyncBody, "await renewSyncLeaseIfNeeded(true);")
    );
    expect(closure).toContain('provider.providerType === "gmail"');
    expect(closure).toContain(
      "deferGmailBatchRemainder(newSyncToken, deferredProviderMessageIds)"
    );
    // Non-Gmail providers, and remainders past the cursor's caps, replay the
    // pre-fetch range instead of advancing past unprocessed mail.
    expect(closure).toContain("providerTokenForCheckpoint = deferredToken ?? syncToken ?? null;");
    expect(closure).toContain("providerTokenForCheckpoint === null");
    expect(closure).toContain("LifecyclePersistenceError");
    // The token that gets encoded is the deferral-aware one, never the raw
    // post-fetch token.
    expect(closure).toContain("providerToken: providerTokenForCheckpoint,");
    expect(closure).not.toContain("providerToken: newSyncToken,");
  });

  it("a deadline remainder forces a checkpoint and an incomplete provider snapshot", () => {
    const closure = runSyncBody.slice(
      indexIn(runSyncBody, "const persistSyncCheckpoint = async () => {"),
      indexIn(runSyncBody, "await renewSyncLeaseIfNeeded(true);")
    );
    const pending = closure.slice(
      indexIn(closure, "result.continuationPending ="),
      indexIn(closure, "if (result.continuationPending) {")
    );
    expect(pending).toContain("isEmailSyncContinuationPending(historyId)");
    expect(pending).toContain("webhookDrainPending");
    expect(pending).toContain("deferredProviderMessageIds.length > 0");

    const snapshot = closure.slice(
      indexIn(closure, "providerSnapshotComplete:"),
      indexIn(closure, "clearRecovery:")
    );
    expect(snapshot).toContain("!isProviderSyncContinuationPending(historyId)");
    expect(snapshot).toContain("!webhookDrainPending");
    expect(snapshot).toContain("deferredProviderMessageIds.length === 0");

    // Completion is still the only branch that advances last_synced_at, and it
    // stays behind the pending check.
    expect(
      indexIn(closure, "if (result.continuationPending) {")
    ).toBeLessThan(indexIn(closure, "persistEmailConnectionSyncCompletion({"));
  });

  it("SP-C: defers classification through the one existing marker path", () => {
    const gate = indexIn(
      runSyncBody,
      "const deadlineStopsAIStages =\n          options.deadline?.expired(EMAIL_SYNC_AI_STAGE_RESERVE_MS) === true;"
    );
    const guarded = runSyncBody.slice(gate, gate + 700);
    expect(guarded).toContain("if (deadlineStopsAIStages && unmatchedContexts.length > 0) {");
    expect(guarded).toContain("await markUnmatchedThreadsPendingLeadScan(");
    expect(guarded).toContain("result.leadScansDeferred += unmatchedContexts.length;");
    // The classifier is skipped, not called with a shortened budget.
    expect(guarded).toContain("} else if (!deadlineStopsAIStages) {");

    // Exactly one place in the whole engine writes the deferral marker column,
    // so the deadline path cannot drift from the provider-outage path.
    const markerWrites = source.match(/lead_scan_pending_at: new Date\(\)/g) ?? [];
    expect(markerWrites).toHaveLength(1);
  });

  it("SP-C: stage evaluation and the pending-summary refresh both stand down", () => {
    expect(runSyncBody).toContain(
      "if (deadlineStopsAIStages) {\n            result.deadlineDeferred = true;\n          } else if (!aiProviderOutage) {"
    );
    expect(runSyncBody).toContain(
      "const deadlineStopsSummaryRefresh =\n          options.deadline?.expired(EMAIL_SYNC_AI_STAGE_RESERVE_MS) === true;"
    );
    expect(runSyncBody).toContain(
      "pendingLeadSummaryOpportunityIds.length > 0 &&\n          !deadlineStopsSummaryRefresh"
    );
  });

  it("AI-stage deferral alone never freezes the cursor", () => {
    const closure = runSyncBody.slice(
      indexIn(runSyncBody, "const persistSyncCheckpoint = async () => {"),
      indexIn(runSyncBody, "await renewSyncLeaseIfNeeded(true);")
    );
    // Skipped AI work is owned by durable markers and the continuation
    // envelope, so it must not appear in the checkpoint-vs-completion decision.
    expect(closure).not.toContain("deadlineDeferred");
    expect(closure).not.toContain("deadlineStopsAIStages");
  });
});
