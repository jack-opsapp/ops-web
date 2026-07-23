import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// The sync-engine harness introspects the file as source text (it never executes
// the 165KB engine — see sync-engine-promotion-helper.test.ts and
// sync-engine-ai-provider-isolation.test.ts). These assertions guard the drain
// sweep: when the AI provider recovers, `retryPendingLeadScans` must replay the
// deferred (lead_scan_pending_at-marked) threads through the SAME classify→promote
// path the live cycle uses, clear the marker on resolution, and — on a fresh
// provider outage — leave the remaining markers in place for the next run.

const source = readFileSync(
  join(process.cwd(), "src/lib/api/services/sync-engine.ts"),
  "utf8"
);

const methodStart = source.indexOf("async retryPendingLeadScans(");
const syncEngineObjectStart = source.indexOf("export const SyncEngine = {");
// Bounded to the method: from its declaration to the next SyncEngine method.
const methodBody = source.slice(
  methodStart,
  source.indexOf("async sweepStaleLeads(")
);

describe("sync-engine pending-lead-scan drain sweep — surface", () => {
  it("defines retryPendingLeadScans as a SyncEngine method", () => {
    expect(methodStart).toBeGreaterThan(-1);
    expect(syncEngineObjectStart).toBeGreaterThan(-1);
    // A method on the object (declared after `export const SyncEngine = {`),
    // callable by the cron beside sweepStaleLeads / retryDirtyClassifications.
    expect(methodStart).toBeGreaterThan(syncEngineObjectStart);
  });

  it("returns the { scanned, promoted, cleared, errors } summary shape", () => {
    const signature = source.slice(
      methodStart,
      source.indexOf("const limit = Math", methodStart)
    );
    expect(signature).toContain("options?: { limit?: number }");
    expect(signature).toContain("scanned: number;");
    expect(signature).toContain("promoted: number;");
    expect(signature).toContain("cleared: number;");
    expect(signature).toContain("errors: string[];");
  });
});

describe("sync-engine pending-lead-scan drain sweep — bounded selection", () => {
  it("selects lead_scan_pending_at-marked, opportunity_id-null threads, bounded and oldest-first", () => {
    expect(methodBody).toContain('.from("email_threads")');
    // Positive deferral flag — never inferred from a null opportunity alone.
    expect(methodBody).toContain('.not("lead_scan_pending_at", "is", null)');
    expect(methodBody).toContain('.is("opportunity_id", null)');
    // Oldest marker first so a persistent backlog still drains fairly.
    expect(methodBody).toMatch(
      /\.order\("lead_scan_pending_at", \{ ascending: true \}\)/
    );
    // Bounded batch (default ~50, clamped) — never an unbounded rescan.
    expect(methodBody).toMatch(/options\?\.limit \?\? 50/);
    expect(methodBody).toContain("Math.min(");
    expect(methodBody).toContain(".limit(limit)");
  });

  it("rebuilds runSync's per-connection context via the same helpers", () => {
    // No divergent context-rebuild: the exact seam runSync uses.
    expect(methodBody).toContain("EmailService.getConnection(");
    expect(methodBody).toContain("EmailService.getProvider(");
    expect(methodBody).toContain("createEmailConnectionSyncLockRenewer(");
    // Active-connection guard mirrors runSync's own early return.
    expect(methodBody).toContain('connection.status !== "active"');
  });
});

describe("sync-engine pending-lead-scan drain sweep — replays the live path", () => {
  it("re-drives each thread through processInboundEmail then the shared promotion helper", () => {
    // Fetch the conversation and take its latest inbound message (mirrors
    // evaluateStagesWithSummary's provider.fetchThread + runSync's direction
    // partition) before deterministic ingestion.
    expect(methodBody).toContain("provider.fetchThread(");
    expect(methodBody).toContain("resolvePersistedEmailDirection(");
    expect(methodBody).toContain("processInboundEmail(");
    // The classify→promote sequence is identical to runSync Step 5 — one
    // reviewer call, then the ONE shared promotion implementation per lead.
    expect(methodBody).toContain("AISyncReviewer.reviewUnmatchedEmails(");
    expect(methodBody).toMatch(
      /for \(const classified of aiResult\.classifiedLeads\) \{\s*await promoteClassifiedUnmatchedLead\(\{/
    );
  });
});

describe("sync-engine pending-lead-scan drain sweep — marker lifecycle", () => {
  it("clears the marker when a thread is resolved (promoted or matched by another path)", () => {
    // Delegates the clear to the id-scoped helper; success paths clear + count.
    expect(methodBody).toContain("clearLeadScanPendingMarker(supabase, thread.id)");
    expect(methodBody).toContain("outcome.cleared += 1;");

    const clearHelper = source.slice(
      source.indexOf("async function clearLeadScanPendingMarker("),
      source.indexOf("function openAIProviderErrorMetadata(")
    );
    expect(clearHelper).toContain(".update({ lead_scan_pending_at: null })");
    // Scoped by primary key — never disturbs another thread's marker.
    expect(clearHelper).toContain('.eq("id", threadId)');
  });

  it("leaves markers in place on a provider outage and never throws out of the sweep", () => {
    const outageBranchStart = methodBody.indexOf(
      "if (isAIProviderUnavailableError(threadError)) {"
    );
    expect(outageBranchStart).toBeGreaterThan(-1);
    const outageBranch = methodBody.slice(
      outageBranchStart,
      methodBody.indexOf("break;", outageBranchStart)
    );
    // The outage branch records the error and breaks to the next connection …
    expect(outageBranch).toContain("outcome.errors.push");
    // … it does NOT clear the marker (the deferral survives to retry next run).
    expect(outageBranch).not.toContain("clearLeadScanPendingMarker");
    // A provider outage breaks out of the connection's thread loop rather than
    // throwing — the sweep always returns its summary.
    expect(methodBody.indexOf("break;", outageBranchStart)).toBeGreaterThan(-1);
  });
});
