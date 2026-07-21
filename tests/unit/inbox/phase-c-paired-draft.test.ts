/**
 * P4-C / P4-E — phase_c mailbox draft + auto_archive CUSTOMER hard-refuse.
 *
 * P4-C: after a successful doAutoDraft, the router places or updates a real
 * provider draft in the connected Gmail/M365 mailbox, then stamps
 * ai_draft_history(status='auto_drafted', mailbox_draft_id=...). These drafts
 * are review-only in the user's mailbox, not Inbox-local lifecycle rows.
 *
 * P4-E: doAutoArchive refuses CUSTOMER (defense beyond allowedLevelsFor), and
 * allowedLevelsFor('CUSTOMER') excludes auto_archive.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stub the AIDraft + mailbox + autonomy + autosend deps so doAutoDraft only
// exercises Phase C routing and provider draft placement.
const {
  generateDraftMock,
  accessResolverMock,
  createDraftMock,
  updateDraftMock,
  getConnectionMock,
  getProviderMock,
  resolveEmailSignatureMock,
  renderMailboxDraftWithSignatureMock,
  runWithEmailConnectionSyncLockMock,
  mailboxCheckpointMock,
  mutationExecuteMock,
} = vi.hoisted(() => ({
  generateDraftMock: vi.fn(),
  accessResolverMock: vi.fn(),
  createDraftMock: vi.fn(),
  updateDraftMock: vi.fn(),
  getConnectionMock: vi.fn(),
  getProviderMock: vi.fn(),
  resolveEmailSignatureMock: vi.fn(),
  renderMailboxDraftWithSignatureMock: vi.fn((body: string) => ({
    body: `${body}\n\nOwner signature`,
    contentType: "text" as const,
  })),
  runWithEmailConnectionSyncLockMock: vi.fn(),
  mailboxCheckpointMock: vi.fn(async () => undefined),
  mutationExecuteMock: vi.fn(),
}));
vi.mock("@/lib/api/services/ai-draft-service", () => ({
  AIDraftService: { generateDraft: generateDraftMock },
}));
vi.mock("@/lib/email/email-opportunity-access", () => ({
  resolveEmailOpportunityAccess: accessResolverMock,
}));
vi.mock("@/lib/api/services/email-service", () => ({
  EmailService: {
    getConnection: getConnectionMock,
    getProvider: getProviderMock,
  },
}));
vi.mock("@/lib/api/services/email-connection-sync-lock", () => ({
  runWithEmailConnectionSyncLock: runWithEmailConnectionSyncLockMock,
}));
vi.mock("@/lib/api/services/email-provider-mutation-attempt-service", () => ({
  buildEmailProviderMutationFingerprint: vi.fn(() => "fingerprint-1"),
  createEmailProviderMutationAttemptService: vi.fn(() => ({
    execute: mutationExecuteMock,
  })),
}));
vi.mock("@/lib/email/email-signature-runtime", () => ({
  resolveEmailSignatureForMessage: resolveEmailSignatureMock,
  renderMailboxDraftWithSignature: renderMailboxDraftWithSignatureMock,
}));
vi.mock("@/lib/api/services/autonomy-milestone-service", () => ({
  AutonomyMilestoneService: {
    getAutonomyLevel: vi.fn(async () => ({ level: 4 })),
  },
}));
vi.mock("@/lib/api/services/auto-send-service", () => ({
  AutoSendService: {
    isEnabled: vi.fn(async () => ({ enabled: false, settings: null })),
  },
}));
vi.mock("@/lib/api/services/email-thread-service", () => ({
  EmailThreadService: { archive: vi.fn(async () => ({ ok: true })) },
}));

// ── Supabase double — records inserts/updates by table ───────────────────────
interface DbState {
  inserts: Array<{ table: string; payload: Record<string, unknown> }>;
  updates: Array<{
    table: string;
    payload: Record<string, unknown>;
    filters: Record<string, unknown>;
  }>;
  priorMailboxDraftRows: Array<Record<string, unknown>>; // provider-draft idempotency
  // P4-A cost-guard fixtures.
  latestInboundMessageId: string | null; // activities latest inbound email_message_id
  latestInboundFilters: Record<string, unknown> | null;
  matchingHistoryRow: Record<string, unknown> | null; // ai_draft_history match on source_message_id
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }>;
}
let db: DbState;

vi.mock("@/lib/supabase/helpers", async () => {
  const actual = await vi.importActual<typeof import("@/lib/supabase/helpers")>(
    "@/lib/supabase/helpers"
  );
  function builder(table: string) {
    const filters: Record<string, unknown> = {};
    let op: "select" | "insert" | "update" = "select";
    let updatePayload: Record<string, unknown> | null = null;
    const chain: Record<string, unknown> = {};
    const ret = () => chain;
    chain.select = ret;
    chain.eq = (c: string, v: unknown) => {
      filters[c] = v;
      return chain;
    };
    chain.is = (c: string, v: unknown) => {
      filters[c] = v;
      return chain;
    };
    chain.in = (c: string, v: unknown) => {
      filters[c] = v;
      return chain;
    };
    chain.not = () => chain;
    chain.order = () => chain;
    chain.limit = () => chain;
    chain.insert = (p: Record<string, unknown>) => {
      op = "insert";
      db.inserts.push({ table, payload: p });
      return chain;
    };
    chain.update = (p: Record<string, unknown>) => {
      op = "update";
      updatePayload = p;
      return chain;
    };
    chain.maybeSingle = async () => {
      if (table === "activities") {
        // P4-A guard: latest inbound message id lookup.
        db.latestInboundFilters = { ...filters };
        return {
          data: db.latestInboundMessageId
            ? { email_message_id: db.latestInboundMessageId }
            : null,
          error: null,
        };
      }
      if (table === "ai_draft_history" && op === "select") {
        // P4-A guard: does a phase_c draft already cover this source_message_id?
        return { data: db.matchingHistoryRow, error: null };
      }
      if (table === "email_connections") {
        return { data: { user_id: "owner-1" }, error: null };
      }
      return { data: null, error: null };
    };
    chain.single = async () => {
      if (op === "insert") return { data: { id: `${table}-new` }, error: null };
      return { data: null, error: null };
    };
    chain.then = (resolve: (v: { data: unknown; error: null }) => void) => {
      if (op === "update") {
        db.updates.push({
          table,
          payload: updatePayload as Record<string, unknown>,
          filters: { ...filters },
        });
        resolve({ data: null, error: null });
        return;
      }
      if (table === "ai_draft_history" && op === "select") {
        resolve({ data: db.priorMailboxDraftRows, error: null });
        return;
      }
      resolve({ data: null, error: null });
    };
    return chain;
  }
  return {
    ...actual,
    requireSupabase: () => ({
      from: (t: string) => builder(t),
      rpc: async (name: string, args: Record<string, unknown>) => {
        db.rpcCalls.push({ name, args });
        return {
          data: {
            id: args.p_new_draft_history_id,
            mailbox_draft_id: args.p_mailbox_draft_id,
            status: "auto_drafted",
          },
          error: null,
        };
      },
    }),
  };
});

import { PhaseCAutonomyRouter } from "@/lib/api/services/phase-c-autonomy-router";
import { allowedLevelsFor } from "@/lib/api/services/phase-c-category-autonomy-service";
import type { EmailThread } from "@/lib/types/email-thread";

function thread(overrides: Partial<EmailThread> = {}): EmailThread {
  return {
    id: "thr-1",
    companyId: "co-1",
    connectionId: "conn-1",
    providerThreadId: "pt-1",
    primaryCategory: "CUSTOMER",
    subject: "Re: Quote",
    latestSenderEmail: "client@acme.com",
    latestDirection: "inbound",
    opportunityId: "opp-1",
    categoryManuallySet: false,
    participants: ["client@acme.com"],
    labels: [],
    messageCount: 1,
    lastMessageAt: new Date(),
    archivedAt: null,
    snoozedUntil: null,
    ...(overrides as object),
  } as unknown as EmailThread;
}

beforeEach(() => {
  db = {
    inserts: [],
    updates: [],
    priorMailboxDraftRows: [],
    latestInboundMessageId: null,
    latestInboundFilters: null,
    matchingHistoryRow: null,
    rpcCalls: [],
  };
  generateDraftMock.mockReset();
  accessResolverMock.mockReset().mockResolvedValue({ allowed: true });
  createDraftMock.mockReset();
  updateDraftMock.mockReset();
  getConnectionMock.mockReset();
  getProviderMock.mockReset().mockReturnValue({
    createDraft: createDraftMock,
    updateDraft: updateDraftMock,
  });
  resolveEmailSignatureMock.mockReset();
  renderMailboxDraftWithSignatureMock.mockClear();
  resolveEmailSignatureMock.mockResolvedValue({
    source: "ops",
    text: "Owner signature",
    html: null,
    marker: "signature-marker",
  });
  getConnectionMock.mockResolvedValue({
    id: "conn-1",
    companyId: "co-1",
    provider: "gmail",
    type: "company",
    userId: "owner-1",
    email: "owner@example.com",
    accessToken: "token",
    refreshToken: "refresh",
    expiresAt: new Date(),
    historyId: null,
    syncEnabled: true,
    lastSyncedAt: null,
    syncIntervalMinutes: 60,
    syncFilters: {},
    webhookSubscriptionId: null,
    webhookExpiresAt: null,
    opsLabelId: null,
    aiReviewEnabled: false,
    aiMemoryEnabled: true,
    status: "active",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  createDraftMock.mockResolvedValue("gmail-draft-1");
  runWithEmailConnectionSyncLockMock.mockReset();
  mailboxCheckpointMock.mockClear();
  runWithEmailConnectionSyncLockMock.mockImplementation(
    async ({ run }: { run: (checkpoint: () => Promise<void>) => unknown }) => {
      return { acquired: true, value: await run(mailboxCheckpointMock) };
    }
  );
  mutationExecuteMock.mockReset().mockImplementation(async (input) => {
    await input.assertMailboxLease();
    const providerResult = await input.executeProvider();
    await input.reconcile({
      attemptId: "attempt-1",
      resourceId: providerResult.resourceId,
      secondaryResourceId: providerResult.secondaryResourceId ?? null,
      result: providerResult.result ?? {},
    });
    return {
      providerResourceId: providerResult.resourceId,
      status: "completed",
    };
  });
});

afterEach(() => vi.clearAllMocks());

describe("P4-C — phase_c provider mailbox draft", () => {
  it("places a Gmail draft and stamps ai_draft_history after a successful doAutoDraft", async () => {
    generateDraftMock.mockResolvedValue({
      available: true,
      draft: "Generated body",
      subject: "Re: Quote",
      draftHistoryId: "adh-1",
    });

    const res = await PhaseCAutonomyRouter.doAutoDraft(
      thread(),
      "owner-1",
      "auto_draft"
    );
    expect(res.outcome).toBe("auto_drafted");

    expect(createDraftMock).toHaveBeenCalledTimes(1);
    expect(createDraftMock).toHaveBeenCalledWith(
      "client@acme.com",
      "Re: Quote",
      "Generated body\n\nOwner signature",
      "pt-1",
      "text"
    );
    expect(updateDraftMock).not.toHaveBeenCalled();
    expect(mailboxCheckpointMock).toHaveBeenCalledTimes(5);
    expect(mutationExecuteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: "owner-1",
        connectionId: "conn-1",
        operationKind: "draft_create",
        operationKey: "phase-c-reply-draft:adh-1",
        requestFingerprint: "fingerprint-1",
        assertMailboxLease: expect.any(Function),
        executeProvider: expect.any(Function),
        reconcile: expect.any(Function),
      })
    );
    expect(mailboxCheckpointMock).toHaveBeenCalledWith(true);
    expect(
      db.inserts.filter((i) => i.table === "opportunity_follow_up_drafts")
    ).toHaveLength(0);

    expect(db.rpcCalls).toEqual([
      {
        name: "reassign_phase_c_mailbox_draft",
        args: {
          p_company_id: "co-1",
          p_connection_id: "conn-1",
          p_new_draft_history_id: "adh-1",
          p_mailbox_draft_id: "gmail-draft-1",
          p_thread_id: "pt-1",
          p_expected_old_draft_history_id: null,
        },
      },
    ]);
    expect(
      db.updates.filter((update) => update.table === "ai_draft_history")
    ).toHaveLength(0);
  });

  it("preserves the subject provenance already recorded by draft generation", async () => {
    generateDraftMock.mockResolvedValue({
      available: true,
      draft: "Generated body",
      subject: "Re: Quote",
      draftHistoryId: "adh-thread-subject",
    });

    await PhaseCAutonomyRouter.doAutoDraft(thread(), "owner-1", "auto_draft");

    expect(db.rpcCalls[0]?.args).not.toHaveProperty("p_subject");
    expect(
      db.updates.flatMap((update) => Object.keys(update.payload))
    ).not.toContain("subject_source");
  });

  it("keeps the OPS review draft when provider draft placement fails", async () => {
    createDraftMock.mockRejectedValueOnce(new Error("OAuth token expired"));
    generateDraftMock.mockResolvedValue({
      available: true,
      draft: "Generated body",
      subject: "Re: Quote",
      draftHistoryId: "adh-provider-failed",
    });

    const result = await PhaseCAutonomyRouter.doAutoDraft(
      thread(),
      "owner-1",
      "auto_draft"
    );

    expect(result).toEqual({
      outcome: "draft_placement_pending",
      category: "CUSTOMER",
      effectiveLevel: "auto_draft",
      detail: "OAuth token expired",
    });
    expect(createDraftMock).toHaveBeenCalledTimes(1);
    expect(db.rpcCalls).toHaveLength(0);
    expect(db.updates).toHaveLength(0);
  });

  it("reconciles an accepted provider draft by exact id without creating again", async () => {
    mutationExecuteMock.mockImplementationOnce(async (input) => {
      await input.assertMailboxLease();
      await input.reconcile({
        attemptId: "attempt-recovered",
        resourceId: "gmail-recovered",
        secondaryResourceId: null,
        result: { draftId: "gmail-recovered" },
      });
      return {
        providerResourceId: "gmail-recovered",
        status: "completed",
      };
    });
    generateDraftMock.mockResolvedValue({
      available: true,
      draft: "Generated body",
      subject: "Re: Quote",
      draftHistoryId: "adh-recovered",
    });

    const result = await PhaseCAutonomyRouter.doAutoDraft(
      thread(),
      "owner-1",
      "auto_draft"
    );

    expect(result).toMatchObject({
      outcome: "auto_drafted",
      detail: "gmail-recovered",
    });
    expect(createDraftMock).not.toHaveBeenCalled();
    expect(updateDraftMock).toHaveBeenCalledWith(
      "gmail-recovered",
      "client@acme.com",
      "Re: Quote",
      "Generated body\n\nOwner signature",
      "pt-1",
      "text"
    );
    expect(db.rpcCalls).toContainEqual({
      name: "reassign_phase_c_mailbox_draft",
      args: expect.objectContaining({
        p_new_draft_history_id: "adh-recovered",
        p_mailbox_draft_id: "gmail-recovered",
        p_expected_old_draft_history_id: null,
      }),
    });
  });

  it("keeps the OPS review draft without provider access when the mailbox is busy", async () => {
    runWithEmailConnectionSyncLockMock.mockResolvedValue({ acquired: false });
    generateDraftMock.mockResolvedValue({
      available: true,
      draft: "Generated body",
      subject: "Re: Quote",
      draftHistoryId: "adh-mailbox-busy",
    });

    const result = await PhaseCAutonomyRouter.doAutoDraft(
      thread(),
      "owner-1",
      "auto_draft"
    );

    expect(result).toEqual({
      outcome: "draft_placement_pending",
      category: "CUSTOMER",
      effectiveLevel: "auto_draft",
      detail: "PHASE_C_DRAFT_MAILBOX_BUSY",
    });
    expect(getProviderMock).not.toHaveBeenCalled();
    expect(resolveEmailSignatureMock).not.toHaveBeenCalled();
    expect(createDraftMock).not.toHaveBeenCalled();
    expect(db.updates).toHaveLength(0);
  });

  it("retries a busy mailbox placement from the durable draft without regenerating", async () => {
    db.latestInboundMessageId = "msg-busy";
    runWithEmailConnectionSyncLockMock.mockResolvedValueOnce({
      acquired: false,
    });
    generateDraftMock.mockResolvedValue({
      available: true,
      draft: "Generated body",
      subject: "Re: Quote",
      draftHistoryId: "adh-mailbox-busy",
    });

    const first = await PhaseCAutonomyRouter.doAutoDraft(
      thread(),
      "owner-1",
      "auto_draft"
    );
    expect(first.outcome).toBe("draft_placement_pending");

    db.matchingHistoryRow = {
      id: "adh-mailbox-busy",
      status: "drafted",
      mailbox_draft_id: null,
      original_draft: "Generated body",
      subject: "Re: Quote",
    };
    runWithEmailConnectionSyncLockMock.mockImplementationOnce(
      async ({
        run,
      }: {
        run: (checkpoint: () => Promise<void>) => unknown;
      }) => ({ acquired: true, value: await run(mailboxCheckpointMock) })
    );

    const second = await PhaseCAutonomyRouter.doAutoDraft(
      thread(),
      "owner-1",
      "auto_draft"
    );

    expect(second.outcome).toBe("auto_drafted");
    expect(generateDraftMock).toHaveBeenCalledTimes(1);
    expect(createDraftMock).toHaveBeenCalledTimes(1);
    expect(db.rpcCalls).toContainEqual({
      name: "reassign_phase_c_mailbox_draft",
      args: expect.objectContaining({
        p_new_draft_history_id: "adh-mailbox-busy",
        p_mailbox_draft_id: "gmail-draft-1",
      }),
    });
  });

  it("updates an existing unresolved provider draft instead of creating a duplicate", async () => {
    db.priorMailboxDraftRows = [
      {
        id: "adh-old",
        mailbox_draft_id: "gmail-existing",
        status: "auto_drafted",
      },
    ];
    generateDraftMock.mockResolvedValue({
      available: true,
      draft: "Body",
      subject: "Re: Quote",
      draftHistoryId: "adh-2",
    });

    await PhaseCAutonomyRouter.doAutoDraft(thread(), "owner-1", "auto_draft");

    expect(updateDraftMock).toHaveBeenCalledWith(
      "gmail-existing",
      "client@acme.com",
      "Re: Quote",
      "Body\n\nOwner signature",
      "pt-1",
      "text"
    );
    expect(createDraftMock).not.toHaveBeenCalled();
    expect(db.rpcCalls).toEqual([
      {
        name: "reassign_phase_c_mailbox_draft",
        args: {
          p_company_id: "co-1",
          p_connection_id: "conn-1",
          p_new_draft_history_id: "adh-2",
          p_mailbox_draft_id: "gmail-existing",
          p_thread_id: "pt-1",
          p_expected_old_draft_history_id: "adh-old",
        },
      },
    ]);
    expect(
      db.updates.filter((update) => update.table === "ai_draft_history")
    ).toHaveLength(0);
    expect(db.priorMailboxDraftRows).toEqual([
      {
        id: "adh-old",
        mailbox_draft_id: "gmail-existing",
        status: "auto_drafted",
      },
    ]);
    expect(db.rpcCalls[0]?.args).not.toHaveProperty("p_subject");
    expect(db.rpcCalls[0]?.args).toMatchObject({
      p_expected_old_draft_history_id: "adh-old",
    });
  });

  it("does not create a paired draft when generate escalated (no draft)", async () => {
    generateDraftMock.mockResolvedValue({
      available: false,
      escalated: true,
      reason: "needs input",
    });
    const res = await PhaseCAutonomyRouter.doAutoDraft(
      thread(),
      "owner-1",
      "auto_draft"
    );
    expect(res.outcome).toBe("escalated_to_operator");
    expect(
      db.inserts.filter((i) => i.table === "opportunity_follow_up_drafts")
    ).toHaveLength(0);
    expect(createDraftMock).not.toHaveBeenCalled();
    expect(updateDraftMock).not.toHaveBeenCalled();
  });

  it("does not place an autonomous mailbox draft when no effective signature exists", async () => {
    resolveEmailSignatureMock.mockResolvedValue(null);
    generateDraftMock.mockResolvedValue({
      available: true,
      draft: "Generated body",
      subject: "Re: Quote",
      draftHistoryId: "adh-no-signature",
    });

    const result = await PhaseCAutonomyRouter.doAutoDraft(
      thread(),
      "owner-1",
      "auto_draft"
    );

    expect(result.outcome).toBe("draft_placement_pending");
    expect(createDraftMock).not.toHaveBeenCalled();
    expect(updateDraftMock).not.toHaveBeenCalled();
    expect(renderMailboxDraftWithSignatureMock).not.toHaveBeenCalled();
  });

  it("does not write a provider draft after the lead is reassigned during generation", async () => {
    accessResolverMock
      .mockResolvedValueOnce({ allowed: true })
      .mockResolvedValueOnce({
        allowed: false,
        reason: "opportunity_other_assignee",
      });
    generateDraftMock.mockResolvedValue({
      available: true,
      draft: "Generated body",
      subject: "Re: Quote",
      draftHistoryId: "adh-reassigned",
    });

    const result = await PhaseCAutonomyRouter.doAutoDraft(
      thread(),
      "owner-1",
      "auto_draft"
    );

    expect(result).toEqual({
      outcome: "noop_actor_unavailable",
      category: "CUSTOMER",
      effectiveLevel: "auto_draft",
      detail: "opportunity_other_assignee",
    });
    expect(createDraftMock).not.toHaveBeenCalled();
    expect(updateDraftMock).not.toHaveBeenCalled();
    expect(db.rpcCalls).toHaveLength(0);
  });
});

describe("P4-A — pre-LLM cost guard (no re-draft per re-sync)", () => {
  it("scopes the latest inbound source message to the exact mailbox", async () => {
    db.latestInboundMessageId = "msg-mailbox-scoped";
    generateDraftMock.mockResolvedValue({
      available: true,
      draft: "Fresh body",
      subject: "Re: Quote",
      draftHistoryId: "adh-mailbox-scoped",
    });

    await PhaseCAutonomyRouter.doAutoDraft(
      thread({ connectionId: "conn-exact" }),
      "owner-1",
      "auto_draft"
    );

    expect(db.latestInboundFilters).toMatchObject({
      company_id: "co-1",
      email_connection_id: "conn-exact",
      email_thread_id: "pt-1",
      type: "email",
      direction: "inbound",
    });
  });

  it("short-circuits BEFORE generateDraft when an open phase_c draft already covers the latest inbound message", async () => {
    // The thread's latest inbound message id...
    db.latestInboundMessageId = "msg-123";
    // ...is already covered by a phase_c ai_draft_history row.
    db.matchingHistoryRow = { id: "adh-open" };

    const res = await PhaseCAutonomyRouter.doAutoDraft(
      thread(),
      "owner-1",
      "auto_draft"
    );

    // No LLM call, no mailbox draft placement.
    expect(generateDraftMock).not.toHaveBeenCalled();
    expect(
      db.inserts.filter((i) => i.table === "opportunity_follow_up_drafts")
    ).toHaveLength(0);
    expect(createDraftMock).not.toHaveBeenCalled();
    expect(res.outcome).toBe("auto_drafted");
    expect(res.detail).toMatch(/no re-draft|existing/i);
  });

  it("DOES draft when the latest inbound message has no covering phase_c draft", async () => {
    db.latestInboundMessageId = "msg-456";
    generateDraftMock.mockResolvedValue({
      available: true,
      draft: "Fresh body",
      subject: "Re: Quote",
      draftHistoryId: "adh-fresh",
    });

    const res = await PhaseCAutonomyRouter.doAutoDraft(
      thread(),
      "owner-1",
      "auto_draft"
    );

    expect(generateDraftMock).toHaveBeenCalledTimes(1);
    expect(res.outcome).toBe("auto_drafted");
    expect(createDraftMock).toHaveBeenCalledTimes(1);
    expect(
      db.inserts.filter((i) => i.table === "opportunity_follow_up_drafts")
    ).toHaveLength(0);
  });

  it("DOES draft when the provider gave no message id to dedup on (can't key, must draft)", async () => {
    db.latestInboundMessageId = null;
    generateDraftMock.mockResolvedValue({
      available: true,
      draft: "Body",
      subject: "Re: Quote",
      draftHistoryId: "adh-x",
    });

    await PhaseCAutonomyRouter.doAutoDraft(thread(), "owner-1", "auto_draft");
    expect(generateDraftMock).toHaveBeenCalledTimes(1);
  });
});

describe("P4-E — auto_archive CUSTOMER hard-refuse", () => {
  it("allowedLevelsFor('CUSTOMER') excludes auto_archive", () => {
    expect(allowedLevelsFor("CUSTOMER")).not.toContain("auto_archive");
  });

  it("doAutoArchive refuses a CUSTOMER thread and returns error", async () => {
    const res = await PhaseCAutonomyRouter.doAutoArchive(
      thread({ primaryCategory: "CUSTOMER" }),
      "owner-1",
      "auto_archive"
    );
    expect(res.outcome).toBe("error");
    expect(res.detail).toMatch(/CUSTOMER/);
  });

  it("doAutoArchive proceeds for a non-CUSTOMER thread", async () => {
    const res = await PhaseCAutonomyRouter.doAutoArchive(
      thread({ primaryCategory: "MARKETING" }),
      "owner-1",
      "auto_archive"
    );
    expect(res.outcome).toBe("auto_archived");
  });
});
