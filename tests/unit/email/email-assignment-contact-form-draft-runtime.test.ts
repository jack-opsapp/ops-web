import { describe, expect, it, vi } from "vitest";

const {
  generateDraftMock,
  getAutonomyMock,
  getConnectionMock,
  getProviderMock,
  placeNewThreadDraftMock,
  renderDraftMock,
  resolveSignatureMock,
  runWithEmailConnectionSyncLockMock,
} = vi.hoisted(() => ({
  generateDraftMock: vi.fn(),
  getAutonomyMock: vi.fn(),
  getConnectionMock: vi.fn(),
  getProviderMock: vi.fn(),
  placeNewThreadDraftMock: vi.fn(),
  renderDraftMock: vi.fn(),
  resolveSignatureMock: vi.fn(),
  runWithEmailConnectionSyncLockMock: vi.fn(),
}));

vi.mock("@/lib/api/services/ai-draft-service", () => ({
  AIDraftService: { generateDraft: generateDraftMock },
}));

vi.mock("@/lib/api/services/email-service", () => ({
  EmailService: {
    getConnection: getConnectionMock,
    getProvider: getProviderMock,
  },
}));

vi.mock("@/lib/api/services/phase-c-category-autonomy-service", () => ({
  PhaseCCategoryAutonomy: { get: getAutonomyMock },
}));

vi.mock("@/lib/email/email-signature-runtime", () => ({
  resolveEmailSignatureForMessage: resolveSignatureMock,
  renderMailboxDraftWithSignature: renderDraftMock,
}));

vi.mock("@/lib/api/services/mailbox-draft-push", () => ({
  buildContactFormDraftInstruction: vi.fn(() => "contact form instruction"),
  placeNewThreadDraft: placeNewThreadDraftMock,
}));

vi.mock("@/lib/api/services/email-connection-sync-lock", () => ({
  runWithEmailConnectionSyncLock: runWithEmailConnectionSyncLockMock,
}));

import { runSupabaseEmailAssignmentContactFormDraftWorker } from "@/lib/api/services/email-assignment-contact-form-draft-runtime";

const COMPANY_ID = "00000000-0000-4000-8000-000000000001";
const CONNECTION_ID = "00000000-0000-4000-8000-000000000101";
const QUEUE_ID = "00000000-0000-4000-8000-000000000201";
const ACTOR_ID = "00000000-0000-4000-8000-000000000401";
const OPPORTUNITY_ID = "00000000-0000-4000-8000-000000000301";
const DRAFT_HISTORY_ID = "00000000-0000-4000-8000-000000000601";
const PROVIDER_CREATE_ATTEMPT_ID = "00000000-0000-4000-8000-000000000801";

function connection() {
  return {
    id: CONNECTION_ID,
    companyId: COMPANY_ID,
    provider: "gmail" as const,
    type: "company" as const,
    userId: "legacy-company-connector-user",
    email: "office@example.com",
    accessToken: "token",
    refreshToken: "refresh",
    expiresAt: new Date("2027-01-01T00:00:00.000Z"),
    historyId: null,
    syncEnabled: true,
    lastSyncedAt: null,
    syncIntervalMinutes: 60,
    syncFilters: {},
    historyRecoveryAnchor: null,
    historyRecoveryPageToken: null,
    historyRecoveryTargetToken: null,
    webhookSubscriptionId: null,
    webhookExpiresAt: null,
    webhookClientStateHash: null,
    opsLabelId: null,
    aiReviewEnabled: true,
    aiMemoryEnabled: true,
    status: "active" as const,
    createdAt: new Date("2026-07-15T00:00:00.000Z"),
    updatedAt: new Date("2026-07-15T00:00:00.000Z"),
  };
}

describe("assignment contact-form draft runtime", () => {
  it("maps the durable claim to a review-only provider capability and exact actor RPC lifecycle", async () => {
    const mailboxCheckpoint = vi.fn(async () => undefined);
    runWithEmailConnectionSyncLockMock.mockImplementation(
      async ({
        run,
      }: {
        run: (checkpoint: () => Promise<void>) => unknown;
      }) => ({ acquired: true, value: await run(mailboxCheckpoint) })
    );
    const provider = {
      createNewThreadDraft: vi.fn(),
      updateDraft: vi.fn(),
      listDrafts: vi.fn(),
      sendEmail: vi.fn(),
    };
    getConnectionMock.mockResolvedValue(connection());
    getProviderMock.mockReturnValue(provider);
    getAutonomyMock.mockResolvedValue({ CUSTOMER: "auto_draft" });
    generateDraftMock.mockResolvedValue({
      available: true,
      draft: "Hi Sandra,\n\nThanks for reaching out.",
      draftHistoryId: DRAFT_HISTORY_ID,
      subject: "Your deck inquiry",
    });
    resolveSignatureMock.mockResolvedValue({
      recordId: "signature-1",
      source: "ops",
      scope: "operator",
      html: "<p>— Jackson</p>",
      text: "— Jackson",
      hash: "a".repeat(64),
      providerIdentity: null,
    });
    renderDraftMock.mockReturnValue({
      body: "<p>Hi Sandra</p><p>— Jackson</p>",
      contentType: "html",
    });
    placeNewThreadDraftMock.mockImplementation(async (input) => {
      const persisted = await input.persistPlacement({
        mailboxDraftId: "provider-draft-1",
        threadId: "provider-thread-1",
      });
      expect(persisted).toBe(true);
      return {
        mailboxDraftId: "provider-draft-1",
        threadId: "provider-thread-1",
      };
    });

    const rpc = vi.fn(async (name: string) => {
      if (name === "claim_email_assignment_contact_form_drafts") {
        return {
          data: [
            {
              id: QUEUE_ID,
              assignment_event_id: "00000000-0000-4000-8000-000000000202",
              company_id: COMPANY_ID,
              opportunity_id: OPPORTUNITY_ID,
              assignment_version: "3",
              actor_user_id: ACTOR_ID,
              connection_id: CONNECTION_ID,
              source_activity_id: "00000000-0000-4000-8000-000000000501",
              provider_message_id: "provider-message-exact",
              source_provider_thread_id: "forwarder-thread",
              customer_email: "sandra@example.com",
              customer_name: "Sandra Dunford",
              source_subject: "",
              source_body_text:
                "New contact form submission\nName: Sandra Dunford\nEmail: sandra@example.com\nMessage: Please quote a deck.",
              created_at: "2026-07-15T12:00:00.000Z",
              attempts: "1",
              draft_history_id: null,
              draft_body: null,
              draft_subject: null,
            },
          ],
          error: null,
        };
      }
      if (name === "fail_email_assignment_contact_form_draft_as_system") {
        return { data: "retrying", error: null };
      }
      if (
        name ===
        "begin_email_assignment_contact_form_draft_provider_create_as_system"
      ) {
        return {
          data: {
            attempt_id: PROVIDER_CREATE_ATTEMPT_ID,
            mode: "create",
          },
          error: null,
        };
      }
      return { data: true, error: null };
    });
    const supabase = { rpc } as never;

    const result = await runSupabaseEmailAssignmentContactFormDraftWorker(
      supabase,
      { limit: 2, leaseSeconds: 360 }
    );

    expect(result.drafted).toBe(1);
    expect(generateDraftMock).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: COMPANY_ID,
        userId: ACTOR_ID,
        connectionId: CONNECTION_ID,
        opportunityId: OPPORTUNITY_ID,
        origin: "phase_c",
        autonomous: true,
      })
    );
    expect(resolveSignatureMock).toHaveBeenCalledWith(
      expect.objectContaining({
        supabase,
        connection: expect.objectContaining({ id: CONNECTION_ID }),
        userId: ACTOR_ID,
        refreshProviderIfMissing: true,
        providerLockCheckpoint: mailboxCheckpoint,
      })
    );
    const placement = placeNewThreadDraftMock.mock.calls[0]![0];
    expect(placement).toEqual(
      expect.objectContaining({
        connectionId: CONNECTION_ID,
        opportunityId: OPPORTUNITY_ID,
        draftHistoryId: DRAFT_HISTORY_ID,
        phaseCCompanyId: COMPANY_ID,
        forceCreate: true,
        persistPlacement: expect.any(Function),
      })
    );
    expect(Object.keys(placement.provider).sort()).toEqual([
      "createNewThreadDraft",
      "updateDraft",
    ]);
    expect(placement.provider).not.toHaveProperty("sendEmail");
    expect(provider.sendEmail).not.toHaveBeenCalled();

    expect(rpc).toHaveBeenCalledWith(
      "prepare_email_assignment_contact_form_draft_as_system",
      expect.objectContaining({
        p_queue_id: QUEUE_ID,
        p_draft_history_id: DRAFT_HISTORY_ID,
      })
    );
    expect(rpc).toHaveBeenCalledWith(
      "complete_email_assignment_contact_form_draft_as_system",
      expect.objectContaining({
        p_queue_id: QUEUE_ID,
        p_mailbox_draft_id: "provider-draft-1",
        p_provider_thread_id: "provider-thread-1",
        p_draft_history_id: DRAFT_HISTORY_ID,
        p_provider_create_attempt_id: PROVIDER_CREATE_ATTEMPT_ID,
        p_outcome: "drafted",
      })
    );
    expect(rpc).toHaveBeenCalledWith(
      "begin_email_assignment_contact_form_draft_provider_create_as_system",
      expect.objectContaining({ p_queue_id: QUEUE_ID })
    );
    expect(
      rpc.mock.calls.filter(
        ([name]) =>
          name === "reauthorize_email_assignment_contact_form_draft_as_system"
      )
    ).toHaveLength(2);
  });
});
