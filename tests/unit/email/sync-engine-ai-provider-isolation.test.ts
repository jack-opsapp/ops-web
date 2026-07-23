import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// The sync-engine harness introspects the file as source text (it never
// executes the engine — see sync-engine-promotion-helper.test.ts and
// sync-engine-conversion-provenance.test.ts). These assertions guard the
// AI-provider failure-isolation contract: a provider outage in Steps 5–6 must
// defer AI enrichment and still reach persistSyncCheckpoint (cursor advances),
// while our own persistence failures and unknown errors keep holding the cursor.

const source = readFileSync(
  join(process.cwd(), "src/lib/api/services/sync-engine.ts"),
  "utf8"
);

// The runSync AI block: from the cycle-scoped outage flag to the end-of-cycle
// cursor advance (the LAST persistSyncCheckpoint, not the no-mail early return).
const aiBlockStart = source.indexOf(
  "let aiProviderOutage: unknown | null = null;"
);
const finalCheckpointIdx = source.lastIndexOf(
  "await persistSyncCheckpoint();"
);
const aiBlock = source.slice(aiBlockStart, finalCheckpointIdx);

describe("sync-engine AI-provider isolation — result shape", () => {
  it("adds aiProviderDeferred + leadScansDeferred to the interface and initializer", () => {
    const interfaceBlock = source.slice(
      source.indexOf("export interface SyncCycleResult {"),
      source.indexOf("class LifecyclePersistenceError")
    );
    expect(interfaceBlock).toContain("aiProviderDeferred: boolean;");
    expect(interfaceBlock).toContain("leadScansDeferred: number;");

    const initBlock = source.slice(
      source.indexOf("function emptyResult(): SyncCycleResult {"),
      source.indexOf("GMAIL_HISTORY_RECONCILIATION_OVERLAP_MS")
    );
    expect(initBlock).toContain("aiProviderDeferred: false,");
    expect(initBlock).toContain("leadScansDeferred: 0,");
  });

  it("imports the provider predicate and the operator-rail alert", () => {
    expect(source).toContain(
      'import { isAIProviderUnavailableError } from "./openai-monitoring";'
    );
    expect(source).toContain("reportOpenAIQuotaExhausted");
  });
});

describe("sync-engine AI-provider isolation — Step 5", () => {
  it("wraps reviewUnmatchedEmails and downgrades only provider errors", () => {
    const step5 = aiBlock.slice(
      aiBlock.indexOf("let aiResult = null;"),
      aiBlock.indexOf("if (aiResult) {")
    );
    expect(step5).toMatch(
      /let aiResult = null;\s*try \{\s*aiResult = await AISyncReviewer\.reviewUnmatchedEmails\(/
    );
    expect(step5).toContain("} catch (err) {");
    expect(step5).toContain("if (!isAIProviderUnavailableError(err)) throw err;");
    expect(step5).toContain("aiProviderOutage ??= err;");
  });

  it("gates the classifiedLeads loop on a truthy aiResult and defers on outage", () => {
    const handling = aiBlock.slice(
      aiBlock.indexOf("if (aiResult) {"),
      aiBlock.indexOf("for (const sentEmail of sentEmails)")
    );
    // Loop lives inside `if (aiResult)` — skipped entirely under an outage.
    expect(handling).toMatch(
      /if \(aiResult\) \{[\s\S]*for \(const classified of aiResult\.classifiedLeads\)/
    );
    // The outage branch durably defers and counts the deferral.
    expect(handling).toContain("} else if (aiProviderOutage) {");
    expect(handling).toContain("markUnmatchedThreadsPendingLeadScan(");
    expect(handling).toContain(
      "result.leadScansDeferred += unmatchedContexts.length;"
    );
    expect(handling.indexOf("aiResult.classifiedLeads")).toBeLessThan(
      handling.indexOf("else if (aiProviderOutage)")
    );
  });
});

describe("sync-engine AI-provider isolation — durable defer helper", () => {
  it("marks only non-contact-form, unpromoted threads and never throws", () => {
    const helperStart = source.indexOf(
      "async function markUnmatchedThreadsPendingLeadScan("
    );
    expect(helperStart).toBeGreaterThan(-1);
    const helperBody = source.slice(
      helperStart,
      source.indexOf("function openAIProviderErrorMetadata(")
    );
    // Only non-contact-form contexts have a durable email_threads row.
    expect(helperBody).toContain(
      "context.routingIdentity.isContactFormSubmission"
    );
    expect(helperBody).toContain("lead_scan_pending_at");
    // Never overwrite a thread another path already promoted.
    expect(helperBody).toContain('.is("opportunity_id", null)');
    // Body is wrapped so a marker-write failure is caught, never thrown.
    expect(helperBody).toMatch(/\{\s*try \{[\s\S]*\} catch \(err\) \{/);
  });
});

describe("sync-engine AI-provider isolation — Step 6", () => {
  it("skips evaluateStagesWithSummary when the provider is already down", () => {
    const step6 = aiBlock.slice(
      aiBlock.indexOf("let stageResults = null;"),
      aiBlock.indexOf("if (stageResults) {")
    );
    expect(step6).toMatch(
      /if \(!aiProviderOutage\) \{\s*try \{\s*stageResults = await AISyncReviewer\.evaluateStagesWithSummary\(/
    );
    expect(step6).toContain(
      "if (!isAIProviderUnavailableError(err)) throw err;"
    );
    expect(step6).toContain("aiProviderOutage ??= err;");
  });

  it("treats a deferred (not failed) summary refresh as an outage", () => {
    expect(aiBlock).toContain("if (summaryRefresh.failed.length > 0) {");
    expect(aiBlock).toMatch(
      /else if \(summaryRefresh\.deferred\.length > 0\) \{[\s\S]*aiProviderOutage \?\?= summaryRefresh\.deferred\[0\]\.error;/
    );
  });
});

describe("sync-engine AI-provider isolation — deterministic paths survive", () => {
  it("does not gate maybeAutoAdvanceOnAccept on the outage flag", () => {
    const acceptRegion = aiBlock.slice(
      aiBlock.indexOf("if (activeLeadTargets.size > 0) {"),
      aiBlock.indexOf("await maybeAutoAdvanceOnAccept({")
    );
    // No aiProviderOutage check stands between the accept gate and the call —
    // deterministic accept-to-project conversion runs even under an AI outage.
    expect(acceptRegion).not.toContain("aiProviderOutage");
  });
});

describe("sync-engine AI-provider isolation — safety-net catch order", () => {
  it("rethrows LifecyclePersistenceError before considering provider errors", () => {
    const catchOpenIdx = aiBlock.indexOf("} catch (aiErr) {");
    const innerCatch = aiBlock.slice(
      catchOpenIdx,
      aiBlock.indexOf("if (aiProviderOutage) {", catchOpenIdx)
    );
    const idxLifecycle = innerCatch.indexOf(
      "if (aiErr instanceof LifecyclePersistenceError) throw aiErr;"
    );
    const idxProvider = innerCatch.indexOf(
      "if (isAIProviderUnavailableError(aiErr)) {"
    );
    expect(idxLifecycle).toBeGreaterThan(-1);
    expect(idxProvider).toBeGreaterThan(-1);
    // Persistence failures propagate first (cursor holds); only then is a
    // provider outage downgraded to the flag; unknown errors still fail closed.
    expect(idxLifecycle).toBeLessThan(idxProvider);
    expect(innerCatch).toMatch(
      /if \(isAIProviderUnavailableError\(aiErr\)\) \{\s*aiProviderOutage \?\?= aiErr;\s*\} else \{\s*throw new LifecyclePersistenceError\(/
    );
  });
});

describe("sync-engine AI-provider isolation — cursor-advance regression guard", () => {
  it("reports the outage and sets the flag AFTER the catch and BEFORE the checkpoint", () => {
    // This is the exact 2026-07-22 bug: the outage handling must sit between the
    // AI try/catch and persistSyncCheckpoint so the Gmail cursor still advances.
    expect(source).toMatch(
      /if \(aiProviderOutage\) \{\s*await reportAIProviderOutageOnce\(aiProviderOutage\);\s*result\.aiProviderDeferred = true;/
    );
    const catchOpenIdx = source.indexOf("} catch (aiErr) {");
    const reportIdx = source.indexOf(
      "await reportAIProviderOutageOnce(aiProviderOutage);"
    );
    const flagIdx = source.indexOf("result.aiProviderDeferred = true;");
    expect(catchOpenIdx).toBeGreaterThan(-1);
    expect(finalCheckpointIdx).toBeGreaterThan(-1);
    expect(reportIdx).toBeGreaterThan(catchOpenIdx);
    expect(flagIdx).toBeGreaterThan(reportIdx);
    expect(flagIdx).toBeLessThan(finalCheckpointIdx);
    expect(reportIdx).toBeLessThan(finalCheckpointIdx);
  });

  it("fires the alert with the platform sync key and email_sync workload, best-effort", () => {
    const reporterBody = source.slice(
      source.indexOf("async function reportAIProviderOutageOnce("),
      source.indexOf("// ─── Service ─")
    );
    expect(reporterBody).toContain('keySource: "OPENAI_API_KEY_SYNC"');
    expect(reporterBody).toContain('workload: "email_sync"');
    // Never throws into the cycle: the whole call is wrapped.
    expect(reporterBody).toMatch(/try \{[\s\S]*\} catch \(reportErr\) \{/);
  });
});
