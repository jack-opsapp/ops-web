/**
 * Unit tests — replacement-lesson capture (cc90c3ed, Package B / B2 + B3)
 *
 * When the operator throws our draft away and writes their own reply, the
 * lesson lives in the delta: the qualification we missed, the arithmetic we got
 * wrong, the tone we over-wrote. Reconciliation deliberately never attaches the
 * ignored draft as `draftHistoryId` — that would register a bogus 100% rewrite
 * and poison edit statistics — so the replacement travels on its own pointer,
 * `replacedDraftHistoryId`, and is mined into memory only.
 *
 * The B3 block pins the DEFECT 1 regression class shut: outcome classification
 * now reads exact provider draft presence plus the sent body, and a draft is
 * deleted only when the send proves it was used.
 */

import { beforeEach, describe, it, expect, vi } from "vitest";

const {
  getDraftMock,
  deleteDraftMock,
  enqueueIfEnabledMock,
  listKnownSignaturesMock,
} = vi.hoisted(() => ({
  getDraftMock: vi.fn(),
  deleteDraftMock: vi.fn(),
  enqueueIfEnabledMock: vi.fn(),
  listKnownSignaturesMock: vi.fn(),
}));

vi.mock("@/lib/api/services/email-service", () => ({
  EmailService: {
    getProvider: () => ({
      getDraft: getDraftMock,
      deleteDraft: deleteDraftMock,
    }),
  },
}));

vi.mock("@/lib/api/services/email-provider-mailbox-operation", () => ({
  runEmailProviderMailboxOperation: async (input: {
    providerLockCheckpoint?: (force?: boolean) => Promise<void>;
    run: (checkpoint: (force?: boolean) => Promise<void>) => Promise<unknown>;
  }) => input.run(input.providerLockCheckpoint ?? (async () => {})),
}));

vi.mock("@/lib/api/services/email-outbound-learning-service", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/api/services/email-outbound-learning-service")
  >("@/lib/api/services/email-outbound-learning-service");
  return {
    ...actual,
    EmailOutboundLearningService: class {
      enqueueIfEnabled = enqueueIfEnabledMock;
    },
  };
});

vi.mock("@/lib/api/services/email-signature-service", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/api/services/email-signature-service")
  >("@/lib/api/services/email-signature-service");
  return {
    ...actual,
    EmailSignatureService: {
      ...actual.EmailSignatureService,
      listKnown: listKnownSignaturesMock,
    },
  };
});

import {
  classifyDraftOutcome,
  reconcilePendingMailboxDrafts,
} from "@/lib/api/services/draft-reconciliation";

/**
 * Reconciliation gets the stubbed enqueue class above; the worker under test
 * needs the real implementation, so load it past the module mock.
 */
async function realLearningService() {
  const actual = await vi.importActual<
    typeof import("@/lib/api/services/email-outbound-learning-service")
  >("@/lib/api/services/email-outbound-learning-service");
  return actual.EmailOutboundLearningService;
}

const AI_DRAFT =
  "Hi Karan,\n\nWe can book the railing install for early next week and " +
  "finish in a single visit.\n\nThanks,";

const OPERATOR_REWRITE =
  "Karan,\n\nPermits have to clear before any railing goes up, so I will " +
  "confirm dates once the city signs off.\n\nThanks,\n\n" +
  "Old Jackson\nOld OPS LTD.";

/** Long enough to clear the 50-character verbatim-run derivation threshold. */
const DERIVED_SENT_BODY =
  "Hi Karan,\n\nWe can book the railing install for early next week and " +
  "finish in a single visit.\n\nThanks,\n\nJackson";

function pendingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "draft-history-karan",
    company_id: "company-1",
    user_id: "user-1",
    mailbox_draft_id: "provider-draft-karan",
    source_message_id: null,
    created_at: "2026-08-06T00:10:00.000Z",
    profile_type: "client_new_inquiry",
    opportunity_id: "opportunity-karan",
    original_draft: AI_DRAFT,
    ...overrides,
  };
}

function outboundRow(bodyText: string) {
  return {
    id: "activity-karan",
    direction: "outbound",
    body_text: bodyText,
    created_at: "2026-08-06T01:20:00.000Z",
    subject: "Railing install",
    from_email: "canprojack@gmail.com",
    to_emails: ["karan@example.com"],
    email_message_id: "provider-message-karan",
    opportunity_id: "opportunity-karan",
  };
}

async function reconcile(input: {
  sentBody: string;
  draftPresent: boolean;
  actorProof: unknown;
}): Promise<Array<Record<string, unknown>>> {
  const updateCalls: Array<Record<string, unknown>> = [];
  const rows = [pendingRow()];
  const activities = [outboundRow(input.sentBody)];

  getDraftMock.mockResolvedValue(
    input.draftPresent ? { id: "provider-draft-karan" } : null
  );

  function queryFor(table: string) {
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      not: vi.fn(() => query),
      gt: vi.fn(() => query),
      update: vi.fn((payload: Record<string, unknown>) => {
        updateCalls.push(payload);
        return query;
      }),
      order: vi.fn(async () => ({
        data: table === "activities" ? activities : [],
        error: null,
      })),
      limit: vi.fn(async () => ({ data: [], error: null })),
      then: (
        onfulfilled?: (value: unknown) => unknown,
        onrejected?: (reason: unknown) => unknown
      ) =>
        Promise.resolve({
          data: table === "ai_draft_history" ? rows : [],
          error: null,
        }).then(onfulfilled, onrejected),
    };
    return query;
  }

  await reconcilePendingMailboxDrafts({
    connection: {
      id: "connection-1",
      companyId: "company-1",
      email: "canprojack@gmail.com",
    } as never,
    providerThreadId: "provider-thread-karan",
    supabase: {
      from: vi.fn((table: string) => queryFor(table)),
      rpc: vi.fn().mockResolvedValue({ data: input.actorProof, error: null }),
    } as never,
  });

  return updateCalls;
}

describe("replacement lesson capture on operator rewrites", () => {
  beforeEach(() => {
    getDraftMock.mockReset();
    deleteDraftMock.mockReset();
    enqueueIfEnabledMock.mockReset();
    listKnownSignaturesMock.mockReset();
    deleteDraftMock.mockResolvedValue(undefined);
    enqueueIfEnabledMock.mockResolvedValue({ id: "queue-1" });
    listKnownSignaturesMock.mockResolvedValue([
      {
        scopeUserId: null,
        contentHtml: "<div>Old Jackson<br>Old OPS LTD.</div>",
        contentText: "Old Jackson\nOld OPS LTD.",
        contentHash: "a".repeat(64),
      },
    ]);
  });

  it("carries the replaced draft pointer into the learning queue", async () => {
    const updateCalls = await reconcile({
      sentBody: OPERATOR_REWRITE,
      draftPresent: true,
      actorProof: {
        actorUserId: "user-9",
        opportunityId: "opportunity-karan",
        assignmentVersion: 4,
        assignmentEventId: "assignment-event-4",
        proofType: "company_mailbox_assignee",
      },
    });

    expect(enqueueIfEnabledMock).toHaveBeenCalledTimes(1);
    expect(enqueueIfEnabledMock).toHaveBeenCalledWith(
      expect.objectContaining({
        replacedDraftHistoryId: "draft-history-karan",
        userId: "user-9",
        learningAuthority: "operator_authored",
      })
    );
    // The rewritten draft is never attached as the sent draft: edit-distance
    // statistics must not record a 100% rewrite.
    expect(enqueueIfEnabledMock.mock.calls[0][0]).not.toHaveProperty(
      "draftHistoryId"
    );
    expect(updateCalls).toContainEqual(
      expect.objectContaining({ status: "superseded" })
    );
  });
});

describe("outcome classification regressions (DEFECT 1)", () => {
  beforeEach(() => {
    getDraftMock.mockReset();
    deleteDraftMock.mockReset();
    enqueueIfEnabledMock.mockReset();
    listKnownSignaturesMock.mockReset();
    deleteDraftMock.mockResolvedValue(undefined);
    enqueueIfEnabledMock.mockResolvedValue({ id: "queue-1" });
    listKnownSignaturesMock.mockResolvedValue([]);
  });

  it("classifies a gone draft with a send as used, and a present undeived draft as from_scratch", () => {
    expect(
      classifyDraftOutcome({
        draftStillInMailbox: false,
        hasOutboundAfter: true,
        daysSinceDraft: 1,
      })
    ).toBe("used");
    expect(
      classifyDraftOutcome({
        draftStillInMailbox: true,
        hasOutboundAfter: true,
        daysSinceDraft: 1,
        outboundDerivedFromDraft: true,
      })
    ).toBe("used");
    expect(
      classifyDraftOutcome({
        draftStillInMailbox: true,
        hasOutboundAfter: true,
        daysSinceDraft: 1,
        outboundDerivedFromDraft: false,
      })
    ).toBe("from_scratch");
  });

  it("still books the sent draft receipt when no actor proof exists", async () => {
    await reconcile({
      sentBody: DERIVED_SENT_BODY,
      draftPresent: false,
      actorProof: null,
    });

    expect(enqueueIfEnabledMock).toHaveBeenCalledTimes(1);
    expect(enqueueIfEnabledMock).toHaveBeenCalledWith(
      expect.objectContaining({
        draftHistoryId: "draft-history-karan",
        draftDeliveryChannel: "mailbox",
        userId: "user-1",
        learningAuthority: "autonomous",
      })
    );
    expect(deleteDraftMock).not.toHaveBeenCalled();
  });

  it("deletes a surviving draft object only when the send reused its wording", async () => {
    await reconcile({
      sentBody: DERIVED_SENT_BODY,
      draftPresent: true,
      actorProof: null,
    });

    expect(deleteDraftMock).toHaveBeenCalledWith("provider-draft-karan");
    expect(enqueueIfEnabledMock).toHaveBeenCalledWith(
      expect.objectContaining({ draftHistoryId: "draft-history-karan" })
    );
  });
});

describe("outbound learning enqueue — replaced draft provenance", () => {
  async function enqueueWith(replacedDraftHistoryId: string | null) {
    const rpc = vi.fn(async () => ({
      data: [{ id: "job-1", status: "pending" }],
      error: null,
    }));
    const LearningService = await realLearningService();
    await new LearningService({ rpc } as never).enqueue({
      companyId: "company-1",
      connectionId: "connection-1",
      providerMessageId: "provider-message-karan",
      providerThreadId: "provider-thread-karan",
      userId: "user-9",
      subject: "Railing install",
      bodyText: OPERATOR_REWRITE,
      ...(replacedDraftHistoryId ? { replacedDraftHistoryId } : {}),
    });
    return rpc.mock.calls[0]?.[1] as Record<string, unknown>;
  }

  it("records the replaced draft on the queue row", async () => {
    const args = await enqueueWith("draft-history-karan");
    expect(args.p_replaced_draft_history_id).toBe("draft-history-karan");
  });

  it("leaves the ordinary send contract untouched", async () => {
    const args = await enqueueWith(null);
    expect(args).not.toHaveProperty("p_replaced_draft_history_id");
  });
});

describe("outbound learning worker — replacement lesson preparation", () => {
  const leasedRow = {
    id: "job-1",
    company_id: "company-1",
    connection_id: "connection-1",
    provider_message_id: "provider-message-karan",
    provider_thread_id: "provider-thread-karan",
    user_id: "user-9",
    from_email: "canprojack@gmail.com",
    to_emails: ["karan@example.com"],
    subject: "Railing install",
    authored_body: OPERATOR_REWRITE,
    clean_body: OPERATOR_REWRITE,
    draft_history_id: null,
    follow_up_draft_id: null,
    draft_delivery_channel: null,
    opportunity_id: "opportunity-karan",
    profile_type: "client_new_inquiry",
    learning_authority: "operator_authored",
    replaced_draft_history_id: "draft-history-karan",
    status: "leased",
    attempts: 0,
    max_attempts: 8,
    next_attempt_at: "2026-08-06T02:00:00.000Z",
    lease_token: "11111111-1111-4111-8111-111111111111",
    lease_expires_at: "2026-08-06T02:05:00.000Z",
    created_at: "2026-08-06T01:30:00.000Z",
    updated_at: "2026-08-06T01:30:00.000Z",
  };

  async function buildHarness(row: Record<string, unknown>) {
    const eqCalls: Array<[string, unknown]> = [];
    const tables: string[] = [];
    const maybeSingle = vi.fn(async () => ({
      data: { original_draft: AI_DRAFT },
      error: null,
    }));
    const from = vi.fn((table: string) => {
      tables.push(table);
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn((column: string, value: unknown) => {
          eqCalls.push([column, value]);
          return query;
        }),
        maybeSingle,
      };
      return query;
    });
    const prepared = {
      ...row,
      prepared_at: "2026-08-06T02:01:00.000Z",
      preparation_version: "outbound-learning-v1",
      apply_learning: true,
      apply_full_body_learning: true,
      draft_outcome: { finalVersion: OPERATOR_REWRITE },
      draft_correction_facts: [],
      writing_sample: { profileType: "client_new_inquiry" },
      memory_extraction: { facts: [], edges: [] },
    };
    const rpc = vi.fn(async (name: string) => {
      if (name === "claim_email_outbound_learning") {
        return { data: [row], error: null };
      }
      if (name === "prepare_email_outbound_learning") {
        return { data: [prepared], error: null };
      }
      if (name === "apply_email_outbound_learning") {
        return {
          data: [{ ...prepared, applied_at: "2026-08-06T02:02:00.000Z" }],
          error: null,
        };
      }
      throw new Error(`unexpected rpc ${name}`);
    });
    const prepareMemoryExtraction = vi.fn(async () => ({
      facts: [],
      edges: [],
    }));
    const prepareDraftOutcome = vi.fn(async () => ({
      finalVersion: OPERATOR_REWRITE,
      editDistance: 0,
      changesMade: [],
      sentWithoutChanges: true,
      subject: "Railing install",
      subjectEdited: false,
      edited: false,
      contentCorrections: [],
    }));
    const deps = {
      isFeatureEnabled: vi.fn(async () => true),
      prepareWritingSample: vi.fn(async () => ({
        profileType: "client_new_inquiry",
      })),
      prepareMemoryExtraction,
      prepareDraftOutcome,
      prepareCorrectionEmbedding: vi.fn(async () => null),
    };
    const LearningService = await realLearningService();
    const service = new LearningService({ from, rpc } as never, deps as never);
    return {
      service,
      prepareMemoryExtraction,
      prepareDraftOutcome,
      eqCalls,
      tables,
    };
  }

  it("hands the replaced draft body to memory extraction as a replacement lesson", async () => {
    const harness = await buildHarness(leasedRow);

    await harness.service.runWorker({ limit: 1, concurrency: 1 });

    expect(harness.tables).toContain("ai_draft_history");
    expect(harness.eqCalls).toContainEqual(["id", "draft-history-karan"]);
    expect(harness.eqCalls).toContainEqual(["company_id", "company-1"]);
    expect(harness.prepareMemoryExtraction).toHaveBeenCalledWith(
      expect.objectContaining({
        bodyText: OPERATOR_REWRITE,
        replacedDraft: AI_DRAFT,
        lessonKind: "replacement",
      })
    );
    // Edit statistics stay clean: the replaced draft is never the sent draft.
    expect(harness.prepareDraftOutcome.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ draftHistoryId: null })
    );
  });

  it("reads no replaced draft for an ordinary send", async () => {
    const harness = await buildHarness({
      ...leasedRow,
      replaced_draft_history_id: null,
    });

    await harness.service.runWorker({ limit: 1, concurrency: 1 });

    expect(harness.tables).not.toContain("ai_draft_history");
    expect(harness.prepareMemoryExtraction).toHaveBeenCalledWith(
      expect.objectContaining({
        replacedDraft: null,
        lessonKind: "standard",
      })
    );
  });
});
