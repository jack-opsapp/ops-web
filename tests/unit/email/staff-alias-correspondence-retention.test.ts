import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import {
  ingestionOperatorIdentityFromAuthoritative,
  isPendingStaffAlias,
} from "@/lib/email/email-ingestion-routing";

// Execute the actual private production function with bounded effects. Loading
// all of SyncEngine would initialize unrelated providers and model clients.
const file = ts.createSourceFile("sync-engine.ts", readFileSync(
  "src/lib/api/services/sync-engine.ts", "utf8"
), ts.ScriptTarget.Latest, true);
function compileFunction(name: string) {
  const declaration = file.statements.find((node) =>
    ts.isFunctionDeclaration(node) && node.name?.text === name
  );
  if (!declaration) throw new Error(`${name} declaration missing`);
  return ts.transpileModule(declaration.getText(file), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
}
const compiled = compileFunction("processSentEmail");
const reconciliation = compileFunction("reconcileUnlinkedOutboundEmail");

function harness(options: { pending?: boolean; existing?: boolean } = {}) {
  const email = {
    id: "message-1", threadId: "thread-1", from: "Customer <customer@example.net>",
    to: ["office@example.com"], cc: [], bodyText: "Tuesday works.",
  };
  const connection = { id: "connection-1", companyId: "company-1", email: "office@example.com" };
  const member = {
    userId: "staff-1", registeredEmail: connection.email, fullName: "Alex Morgan",
    phone: "2025550119", verifiedAliases: new Set<string>(),
    pendingAliases: new Set(options.pending ? ["customer@example.net"] : []),
    rejectedAliases: new Set<string>(),
  };
  const operator = {
    emails: new Set([connection.email]), domains: new Set<string>(),
    phones: new Set<string>(), addresses: new Set<string>(), companyName: "Example",
    staffMembers: [member],
  };
  const effects = {
    normalizeProviderBackedEmailForSync: (value: unknown) => value,
    withAuthoritativeProviderDeliveryTimestamp: (value: unknown) => value,
    getCachedOperatorIdentity: async () => operator,
    requireSupabase: () => ({}),
    emailWithAuthoritativeExternalRecipients: () => ({ to: [], cc: [] }),
    syncIngestionOperatorIdentity: () => ingestionOperatorIdentityFromAuthoritative({
      connectionEmail: connection.email, operator,
    }),
    isPendingStaffAlias,
    captureProviderDeliveryBeforeMutableIngest: vi.fn(async () => undefined),
    findExistingProviderActivity: vi.fn(async () => options.existing ? { id: "activity-1" } : null),
    createActivity: vi.fn(async () => true),
    learnFromOutboundEmail: vi.fn(async () => { throw new Error("Unexpected staff learning"); }),
    LifecyclePersistenceError: Error,
    isEmailWorkRoutingReceipt: () => false,
    loadProviderThreadOpportunity: vi.fn(async () => { throw new Error("Unexpected lead matching"); }),
  };
  const process = new Function(...Object.keys(effects), `${compiled}\nreturn processSentEmail;`)(...Object.values(effects));
  const reconcile = new Function(...Object.keys(effects), `${reconciliation}\nreturn reconcileUnlinkedOutboundEmail;`)(...Object.values(effects));
  const result = { activitiesCreated: 0, needsReview: 0, newLeads: 0, matched: 0 };
  const candidate = {
    userId: member.userId, email: "customer@example.net",
    evidence: { fullName: member.fullName, phone: member.phone, registeredEmailRecipient: true },
  };
  return {
    effects, result, email, connection, candidate,
    run: (newCandidate = false, sameCyclePending = false) => process(
      email, connection, {}, new Map(), result, async () => {}, "lease-1", undefined,
      newCandidate ? candidate : null, sameCyclePending,
    ),
    reconcile: () => reconcile(email, connection, {}, new Map(), result, "lease-1", async () => {}),
  };
}

describe("pending staff identity correspondence retention", () => {
  it.each(["new candidate", "persisted pending", "same-cycle pending"])(
    "retains %s addressed only to the operator, without learning or creating a lead", async (kind) => {
      const h = harness({ pending: kind === "persisted pending" });
      await h.run(kind === "new candidate", kind === "same-cycle pending");
      expect(h.effects.captureProviderDeliveryBeforeMutableIngest).toHaveBeenCalledOnce();
      expect(h.effects.createActivity).toHaveBeenCalledWith(h.email, h.connection, null, "outbound", {
        matchNeedsReview: true, matchConfidence: "staff_alias_pending", skipThreadState: true,
      });
      expect(h.effects.learnFromOutboundEmail).not.toHaveBeenCalled();
      expect(h.result).toEqual({ activitiesCreated: 1, needsReview: 1, newLeads: 0, matched: 0 });
    }
  );

  it("does not duplicate or reassign an already persisted activity on replay", async () => {
    const h = harness({ pending: true, existing: true });
    await h.run();
    expect(h.effects.createActivity).not.toHaveBeenCalled();
    expect(h.effects.learnFromOutboundEmail).not.toHaveBeenCalled();
    expect(h.result.activitiesCreated).toBe(0);
  });

  it.each(["rejected write", "no receipt"])("holds the cursor on %s", async (failure) => {
    const h = harness({ pending: true });
    if (failure === "rejected write") h.effects.createActivity.mockRejectedValueOnce(new Error("storage unavailable"));
    else h.effects.createActivity.mockResolvedValueOnce(false);
    await expect(h.run()).rejects.toThrow();
    expect(h.result.activitiesCreated).toBe(0);
  });

  it("still skips ordinary authoritative internal mail before learning", async () => {
    const h = harness();
    await h.run();
    expect(h.effects.createActivity).not.toHaveBeenCalled();
    expect(h.effects.captureProviderDeliveryBeforeMutableIngest).not.toHaveBeenCalled();
    expect(h.effects.learnFromOutboundEmail).not.toHaveBeenCalled();
  });

  it("keeps a same-cycle review receipt detached in the later reconciliation pass", async () => {
    const h = harness();
    await h.run(true);
    h.effects.findExistingProviderActivity.mockResolvedValue({
      id: "activity-1", match_confidence: "staff_alias_pending",
    } as never);
    await h.reconcile();
    expect(h.effects.loadProviderThreadOpportunity).not.toHaveBeenCalled();
    expect(h.result.newLeads).toBe(0);
  });

  it("holds legacy unlinked activities when their sender has a pending identity", async () => {
    const h = harness({ pending: true, existing: true });
    await h.reconcile();
    expect(h.effects.loadProviderThreadOpportunity).not.toHaveBeenCalled();
  });
});
