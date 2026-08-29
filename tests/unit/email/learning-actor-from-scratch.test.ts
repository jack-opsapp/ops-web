/**
 * Unit tests — company-mailbox rewrite actor proof (cc90c3ed, Package B / B1)
 *
 * A shared (company-type) mailbox cannot name the author of a send, so the
 * actor RPC used to refuse every `from_scratch` outcome on those connections.
 * The proof that now licenses learning is the same one the `used` arm already
 * trusts: the current exact assignee who owns the OPS draft on that thread.
 * It arrives as the `company_mailbox_assignee` proof type, and the TypeScript
 * side must accept it — while still refusing proof types nobody minted.
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

vi.mock("@/lib/api/services/email-outbound-learning-service", () => ({
  EmailOutboundLearningService: class {
    enqueueIfEnabled = enqueueIfEnabledMock;
  },
}));

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

import { reconcilePendingMailboxDrafts } from "@/lib/api/services/draft-reconciliation";

/** The AI draft the operator ignored. */
const AI_DRAFT =
  "Hi Karan,\n\nWe can book the railing install for early next week and " +
  "finish in a single visit.\n\nThanks,";

/** The operator's own reply — no verbatim run survives from the draft. */
const OPERATOR_REWRITE =
  "Karan,\n\nPermits have to clear before any railing goes up, so I will " +
  "confirm dates once the city signs off.\n\nThanks,\n\n" +
  "Old Jackson\nOld OPS LTD.";

const PENDING_ROW = {
  id: "draft-history-karan",
  company_id: "company-1",
  user_id: "user-1",
  mailbox_draft_id: "provider-draft-karan",
  source_message_id: null,
  created_at: "2026-08-06T00:10:00.000Z",
  profile_type: "client_new_inquiry",
  opportunity_id: "opportunity-karan",
  original_draft: AI_DRAFT,
};

const OUTBOUND_ROW = {
  id: "activity-karan",
  direction: "outbound",
  body_text: OPERATOR_REWRITE,
  created_at: "2026-08-06T01:20:00.000Z",
  subject: "Railing install",
  from_email: "canprojack@gmail.com",
  to_emails: ["karan@example.com"],
  email_message_id: "provider-message-karan",
  opportunity_id: "opportunity-karan",
};

async function reconcileWithActorProof(proof: unknown): Promise<{
  rpc: ReturnType<typeof vi.fn>;
  updateCalls: Array<Record<string, unknown>>;
}> {
  const updateCalls: Array<Record<string, unknown>> = [];

  function queryFor(table: string) {
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      not: vi.fn(() => query),
      update: vi.fn((payload: Record<string, unknown>) => {
        updateCalls.push(payload);
        return query;
      }),
      order: vi.fn(async () => ({
        data: table === "activities" ? [OUTBOUND_ROW] : [],
        error: null,
      })),
      limit: vi.fn(async () => ({ data: [], error: null })),
      then: (
        onfulfilled?: (value: unknown) => unknown,
        onrejected?: (reason: unknown) => unknown
      ) =>
        Promise.resolve({
          data: table === "ai_draft_history" ? [PENDING_ROW] : [],
          error: null,
        }).then(onfulfilled, onrejected),
    };
    return query;
  }

  const rpc = vi.fn().mockResolvedValue({ data: proof, error: null });

  await reconcilePendingMailboxDrafts({
    connection: {
      id: "connection-1",
      companyId: "company-1",
      email: "canprojack@gmail.com",
    } as never,
    providerThreadId: "provider-thread-karan",
    supabase: { from: vi.fn((table: string) => queryFor(table)), rpc } as never,
  });

  return { rpc, updateCalls };
}

describe("from_scratch learning actor on a company mailbox", () => {
  beforeEach(() => {
    getDraftMock.mockReset();
    deleteDraftMock.mockReset();
    enqueueIfEnabledMock.mockReset();
    listKnownSignaturesMock.mockReset();
    // Draft still sitting in the mailbox + a send that reuses none of its
    // wording is the definition of a rewrite.
    getDraftMock.mockResolvedValue({ id: "provider-draft-karan" });
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

  it("learns from the rewrite when the current assignee owns the draft", async () => {
    const { rpc, updateCalls } = await reconcileWithActorProof({
      actorUserId: "user-9",
      opportunityId: "opportunity-karan",
      assignmentVersion: 4,
      assignmentEventId: "assignment-event-4",
      proofType: "company_mailbox_assignee",
    });

    expect(rpc).toHaveBeenCalledWith(
      "resolve_email_outbound_learning_mailbox_actor_as_system",
      expect.objectContaining({
        p_draft_history_id: "draft-history-karan",
        p_provider_message_id: "provider-message-karan",
        p_outcome: "from_scratch",
      })
    );
    expect(enqueueIfEnabledMock).toHaveBeenCalledTimes(1);
    expect(enqueueIfEnabledMock).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "company-1",
        connectionId: "connection-1",
        providerMessageId: "provider-message-karan",
        userId: "user-9",
        opportunityId: "opportunity-karan",
        learningAuthority: "operator_authored",
      })
    );
    // The ignored draft is still retired — capture never changes bookkeeping.
    expect(updateCalls).toContainEqual(
      expect.objectContaining({ status: "superseded" })
    );
  });

  it("supersedes without learning when the RPC refuses to name an actor", async () => {
    const { updateCalls } = await reconcileWithActorProof(null);

    expect(enqueueIfEnabledMock).not.toHaveBeenCalled();
    expect(updateCalls).toContainEqual(
      expect.objectContaining({ status: "superseded" })
    );
  });

  it("refuses a proof type outside the accepted set", async () => {
    const { updateCalls } = await reconcileWithActorProof({
      actorUserId: "user-9",
      opportunityId: "opportunity-karan",
      assignmentVersion: 4,
      assignmentEventId: "assignment-event-4",
      proofType: "connector_metadata",
    });

    expect(enqueueIfEnabledMock).not.toHaveBeenCalled();
    expect(updateCalls).toContainEqual(
      expect.objectContaining({ status: "superseded" })
    );
  });
});
