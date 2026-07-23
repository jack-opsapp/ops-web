import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "src/lib/api/services/sync-engine.ts"),
  "utf8"
);

// The Step-5 unmatched-lead promotion body was extracted into a reusable
// module-scoped helper so the live sync cycle and the deferred lead-scan drain
// sweep share exactly one promotion implementation. These are source-text
// assertions (the sync-engine harness introspects the file, it does not execute
// the engine), guarding the extraction seam against silent re-inlining.

const syncEngineObjectStart = source.indexOf("export const SyncEngine = {");
const helperStart = source.indexOf(
  "async function promoteClassifiedUnmatchedLead("
);
const loopStart = source.indexOf(
  "for (const classified of aiResult.classifiedLeads)"
);
const loopBody = source.slice(
  loopStart,
  source.indexOf("result.newLeads += aiResult.newLeadsClassified;", loopStart)
);
const helperRegion = source.slice(helperStart, syncEngineObjectStart);

describe("sync-engine unmatched-lead promotion helper", () => {
  it("defines a module-scoped promoteClassifiedUnmatchedLead helper", () => {
    expect(helperStart).toBeGreaterThan(-1);
    expect(syncEngineObjectStart).toBeGreaterThan(-1);
    // Module-scoped ⇒ declared before the SyncEngine object, callable by both
    // runSync and the (later) drain sweep.
    expect(helperStart).toBeLessThan(syncEngineObjectStart);
    expect(source).toContain("interface PromoteClassifiedUnmatchedLeadParams");
  });

  it("delegates the classifiedLeads loop to the helper as a single call", () => {
    // Loop body is exactly the delegated call — no inlined promotion logic.
    expect(source).toMatch(
      /for \(const classified of aiResult\.classifiedLeads\) \{\s*await promoteClassifiedUnmatchedLead\(\{/
    );
    // The call forwards the closed-over values it used to reference directly.
    expect(loopBody).toMatch(
      /await promoteClassifiedUnmatchedLead\(\{[\s\S]*?classified,[\s\S]*?connection,[\s\S]*?profile,[\s\S]*?result,[\s\S]*?unmatchedContextByIdentity,[\s\S]*?supabase,[\s\S]*?followUpDaysCache,[\s\S]*?renewSyncLeaseIfNeeded,[\s\S]*?\}\)/
    );
  });

  it("moves the promotion internals out of the loop and into the helper", () => {
    // The persistence internals no longer live inline in the loop body …
    expect(loopBody).not.toContain("EmailMatchingServiceV2.match(");
    expect(loopBody).not.toContain("LifecyclePersistenceError");
    expect(loopBody).not.toContain("createOpportunity(");
    // … they live in the helper, with the exact same error wrapping preserved.
    expect(helperRegion).toContain("EmailMatchingServiceV2.match(");
    expect(helperRegion).toContain("throw new LifecyclePersistenceError(");
    expect(helperRegion).toContain(
      "failed to persist AI-classified lead ${classified.clientEmail}:"
    );
  });
});
