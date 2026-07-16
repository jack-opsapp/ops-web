import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  EmailAssignmentContactFormDraftWorker,
  type ClaimedEmailAssignmentContactFormDraft,
  type EmailAssignmentContactFormDraftDependencies,
  type ContactFormDraftProviderPlacementAttempt,
} from "@/lib/api/services/email-assignment-contact-form-draft-worker";
import type { EmailConnection } from "@/lib/types/email-connection";

const FORM_BODY = [
  "New contact form submission",
  "Name: Sandra Dunford",
  "Email: sandra@example.com",
  "Message: Please quote a new deck at our home.",
].join("\n");
const PROVIDER_CREATE_ATTEMPT_ID = "00000000-0000-4000-8000-000000000801";

function connection(overrides: Partial<EmailConnection> = {}): EmailConnection {
  return {
    id: "00000000-0000-4000-8000-000000000101",
    companyId: "00000000-0000-4000-8000-000000000001",
    provider: "gmail",
    type: "company",
    userId: "00000000-0000-4000-8000-000000000999",
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
    status: "active",
    createdAt: new Date("2026-07-15T00:00:00.000Z"),
    updatedAt: new Date("2026-07-15T00:00:00.000Z"),
    ...overrides,
  };
}

function claimed(
  overrides: Partial<ClaimedEmailAssignmentContactFormDraft> = {}
): ClaimedEmailAssignmentContactFormDraft {
  return {
    id: "00000000-0000-4000-8000-000000000201",
    assignmentEventId: "00000000-0000-4000-8000-000000000202",
    companyId: "00000000-0000-4000-8000-000000000001",
    opportunityId: "00000000-0000-4000-8000-000000000301",
    assignmentVersion: 3,
    actorUserId: "00000000-0000-4000-8000-000000000401",
    connectionId: "00000000-0000-4000-8000-000000000101",
    sourceActivityId: "00000000-0000-4000-8000-000000000501",
    providerMessageId: "provider-message-exact",
    sourceProviderThreadId: "forwarder-thread",
    customerEmail: "sandra@example.com",
    customerName: "Sandra Dunford",
    sourceSubject: "New contact form submission",
    sourceBodyText: FORM_BODY,
    createdAt: "2026-07-15T12:00:00.000Z",
    attempts: 1,
    draftHistoryId: null,
    draftBody: null,
    draftSubject: null,
    ...overrides,
  };
}

function makeHarness(input?: {
  jobs?: ClaimedEmailAssignmentContactFormDraft[];
  autonomy?: string;
  authorization?: boolean[];
  connection?: EmailConnection | null;
  providerPlacementAttempt?: ContactFormDraftProviderPlacementAttempt | null;
}) {
  const job = claimed();
  const claim = vi.fn(async () => input?.jobs ?? [job]);
  const reauthorize = vi.fn();
  for (const result of input?.authorization ?? [true, true]) {
    reauthorize.mockResolvedValueOnce(result);
  }
  const loadConnection = vi.fn<
    EmailAssignmentContactFormDraftDependencies["loadConnection"]
  >(async () =>
    input && Object.prototype.hasOwnProperty.call(input, "connection")
      ? (input.connection ?? null)
      : connection()
  );
  const getCustomerAutonomy = vi.fn(
    async () => input?.autonomy ?? "auto_draft"
  );
  const generateDraft = vi.fn<
    EmailAssignmentContactFormDraftDependencies["generateDraft"]
  >(async () => ({
    available: true,
    draft: "Hi Sandra,\n\nThanks for reaching out. Let’s arrange a quick call.",
    draftHistoryId: "00000000-0000-4000-8000-000000000601",
    subject: "Your deck inquiry",
  }));
  const prepare = vi.fn(async () => true);
  const resolveSignature = vi.fn<
    EmailAssignmentContactFormDraftDependencies["resolveSignature"]
  >(async () => ({
    recordId: "00000000-0000-4000-8000-000000000701",
    source: "ops",
    scope: "operator",
    html: "<p>— Jackson</p>",
    text: "— Jackson",
    hash: "a".repeat(64),
    providerIdentity: null,
  }));
  const renderDraft = vi.fn((body: string) => ({
    body: `${body}\n\n— Jackson`,
    contentType: "text" as const,
  }));
  const beginProviderCreate = vi.fn(async () =>
    input &&
    Object.prototype.hasOwnProperty.call(input, "providerPlacementAttempt")
      ? (input.providerPlacementAttempt ?? null)
      : {
          attemptId: PROVIDER_CREATE_ATTEMPT_ID,
          mode: "create" as const,
          priorDraftHistoryId: null,
          mailboxDraftId: null,
          providerThreadId: null,
        }
  );
  const placeDraft = vi.fn(async (placementInput) => {
    const placement = placementInput.exactReusableDraft ?? {
      mailboxDraftId: "provider-draft-1",
      threadId: "provider-new-thread-1",
    };
    const persisted = await placementInput.persistPlacement(placement);
    if (!persisted)
      throw new Error("Atomic placement persistence was rejected");
    return placement;
  });
  const complete = vi.fn(async () => true);
  const markReconciliationRequired = vi.fn(async () => true);
  const fail = vi.fn<EmailAssignmentContactFormDraftDependencies["fail"]>(
    async () => "retrying"
  );
  const sendEmail = vi.fn();
  const transport = {
    createNewThreadDraft: vi.fn(),
    updateDraft: vi.fn(),
    listDrafts: vi.fn(),
    sendEmail,
  };
  const getDraftTransport = vi.fn(() => transport);

  const dependencies: EmailAssignmentContactFormDraftDependencies = {
    claim,
    reauthorize,
    loadConnection,
    getCustomerAutonomy,
    generateDraft,
    prepare,
    resolveSignature,
    renderDraft,
    getDraftTransport,
    beginProviderCreate,
    placeDraft,
    complete,
    markReconciliationRequired,
    fail,
    workerId: () => "contact-form-worker-1",
  };
  const worker = new EmailAssignmentContactFormDraftWorker(dependencies);
  return {
    worker,
    job,
    claim,
    reauthorize,
    loadConnection,
    getCustomerAutonomy,
    generateDraft,
    prepare,
    resolveSignature,
    renderDraft,
    getDraftTransport,
    beginProviderCreate,
    placeDraft,
    complete,
    markReconciliationRequired,
    fail,
    sendEmail,
  };
}

describe("EmailAssignmentContactFormDraftWorker", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("drafts against the exact claimed assignment, activity, mailbox, and CUSTOMER mapping", async () => {
    const harness = makeHarness();

    const result = await harness.worker.process({
      limit: 4,
      leaseSeconds: 360,
    });

    expect(harness.claim).toHaveBeenCalledWith({
      holder: "contact-form-worker-1",
      limit: 4,
      leaseSeconds: 360,
    });
    expect(harness.loadConnection).toHaveBeenCalledWith(
      harness.job.connectionId
    );
    expect(harness.getCustomerAutonomy).toHaveBeenCalledWith(
      harness.job.connectionId,
      "CUSTOMER"
    );
    expect(harness.generateDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: harness.job.companyId,
        userId: harness.job.actorUserId,
        connectionId: harness.job.connectionId,
        opportunityId: harness.job.opportunityId,
        recipientEmail: "sandra@example.com",
        recipientName: "Sandra Dunford",
        profileTypeOverride: "client_new_inquiry",
        autonomous: true,
        origin: "phase_c",
      })
    );
    const generatedInput = harness.generateDraft.mock.calls[0]![0];
    expect(generatedInput.threadId).toBeUndefined();
    expect(generatedInput.userInstruction).toContain("Please quote a new deck");
    expect(harness.placeDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: harness.job.connectionId,
        opportunityId: harness.job.opportunityId,
        draftHistoryId: "00000000-0000-4000-8000-000000000601",
        to: "sandra@example.com",
        subject: "Your deck inquiry",
        phaseCCompanyId: harness.job.companyId,
        forceCreate: true,
        persistPlacement: expect.any(Function),
      })
    );
    expect(harness.beginProviderCreate).toHaveBeenCalledWith({
      queueId: harness.job.id,
      holder: "contact-form-worker-1",
    });
    expect(harness.complete).toHaveBeenCalledWith({
      queueId: harness.job.id,
      holder: "contact-form-worker-1",
      mailboxDraftId: "provider-draft-1",
      providerThreadId: "provider-new-thread-1",
      draftHistoryId: "00000000-0000-4000-8000-000000000601",
      providerCreateAttemptId: PROVIDER_CREATE_ATTEMPT_ID,
      outcome: "drafted",
    });
    expect(harness.complete).toHaveBeenCalledTimes(1);
    expect(harness.sendEmail).not.toHaveBeenCalled();
    expect(result).toEqual({
      claimed: 1,
      drafted: 1,
      skipped: 0,
      retrying: 0,
      failed: 0,
      stale: 0,
      reconciliationRequired: 0,
      staleCompletions: 0,
      errors: [],
    });
  });

  it.each(["off", "draft_on_request", "auto_archive"])(
    "skips provider and model work when primary:CUSTOMER is %s",
    async (autonomy) => {
      const harness = makeHarness({ autonomy });

      const result = await harness.worker.process();

      expect(harness.generateDraft).not.toHaveBeenCalled();
      expect(harness.resolveSignature).not.toHaveBeenCalled();
      expect(harness.getDraftTransport).not.toHaveBeenCalled();
      expect(harness.placeDraft).not.toHaveBeenCalled();
      expect(harness.complete).toHaveBeenCalledWith({
        queueId: harness.job.id,
        holder: "contact-form-worker-1",
        mailboxDraftId: null,
        providerThreadId: null,
        draftHistoryId: null,
        providerCreateAttemptId: null,
        outcome: "autonomy_ineligible",
      });
      expect(result.skipped).toBe(1);
    }
  );

  it.each(["auto_draft", "auto_send", "auto_follow_up"])(
    "keeps %s review-only and never exposes the send capability",
    async (autonomy) => {
      const harness = makeHarness({ autonomy });

      await harness.worker.process();

      expect(harness.placeDraft).toHaveBeenCalledTimes(1);
      expect(harness.sendEmail).not.toHaveBeenCalled();
    }
  );

  it("fails closed before provider access when reassignment makes the lease stale", async () => {
    const harness = makeHarness({ authorization: [false] });
    harness.fail.mockResolvedValue("stale");

    const result = await harness.worker.process();

    expect(harness.generateDraft).not.toHaveBeenCalled();
    expect(harness.getDraftTransport).not.toHaveBeenCalled();
    expect(harness.fail).toHaveBeenCalledWith({
      queueId: harness.job.id,
      holder: "contact-form-worker-1",
      error: "EMAIL_ASSIGNMENT_CONTACT_FORM_DRAFT_AUTHORIZATION_STALE",
    });
    expect(result.stale).toBe(1);
    expect(harness.sendEmail).not.toHaveBeenCalled();
  });

  it("fences the assignment again after model and signature work", async () => {
    const harness = makeHarness({ authorization: [true, false] });
    harness.fail.mockResolvedValue("stale");

    const result = await harness.worker.process();

    expect(harness.generateDraft).toHaveBeenCalledTimes(1);
    expect(harness.resolveSignature).toHaveBeenCalledTimes(1);
    expect(harness.reauthorize).toHaveBeenCalledTimes(2);
    expect(harness.getDraftTransport).not.toHaveBeenCalled();
    expect(harness.placeDraft).not.toHaveBeenCalled();
    expect(harness.sendEmail).not.toHaveBeenCalled();
    expect(result.stale).toBe(1);
  });

  it("does not touch the provider when a prior create attempt requires manual reconciliation", async () => {
    const harness = makeHarness({ providerPlacementAttempt: null });

    const result = await harness.worker.process();

    expect(harness.beginProviderCreate).toHaveBeenCalledTimes(1);
    expect(harness.placeDraft).not.toHaveBeenCalled();
    expect(harness.getDraftTransport).not.toHaveBeenCalled();
    expect(harness.complete).not.toHaveBeenCalled();
    expect(harness.fail).not.toHaveBeenCalled();
    expect(result.reconciliationRequired).toBe(1);
  });

  it("never opens provider transport when an unresolved prior assignment blocks placement", async () => {
    const harness = makeHarness();
    harness.beginProviderCreate.mockRejectedValueOnce(
      new Error("contact_form_draft_prior_placement_blocked:blocked_unresolved")
    );

    const result = await harness.worker.process();

    expect(harness.getDraftTransport).not.toHaveBeenCalled();
    expect(harness.placeDraft).not.toHaveBeenCalled();
    expect(harness.fail).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "contact_form_draft_prior_placement_blocked:blocked_unresolved",
      })
    );
    expect(result.retrying).toBe(1);
    expect(harness.sendEmail).not.toHaveBeenCalled();
  });

  it("updates and atomically rebinds one exact completed prior-assignee draft", async () => {
    const harness = makeHarness({
      providerPlacementAttempt: {
        attemptId: PROVIDER_CREATE_ATTEMPT_ID,
        mode: "update",
        priorDraftHistoryId: "00000000-0000-4000-8000-000000000901",
        mailboxDraftId: "provider-draft-prior",
        providerThreadId: "provider-thread-prior",
      },
    });

    const result = await harness.worker.process();

    expect(result.drafted).toBe(1);
    expect(harness.placeDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        forceCreate: false,
        exactReusableDraft: {
          mailboxDraftId: "provider-draft-prior",
          threadId: "provider-thread-prior",
        },
      })
    );
    expect(harness.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        providerCreateAttemptId: PROVIDER_CREATE_ATTEMPT_ID,
        mailboxDraftId: "provider-draft-prior",
        providerThreadId: "provider-thread-prior",
      })
    );
    expect(harness.sendEmail).not.toHaveBeenCalled();
  });

  it("moves an uncertain provider create to manual reconciliation without retrying", async () => {
    const harness = makeHarness();
    harness.placeDraft.mockRejectedValueOnce(
      new Error("provider response was interrupted")
    );

    const result = await harness.worker.process();

    expect(harness.beginProviderCreate).toHaveBeenCalledTimes(1);
    expect(harness.markReconciliationRequired).toHaveBeenCalledWith({
      queueId: harness.job.id,
      holder: "contact-form-worker-1",
      providerCreateAttemptId: PROVIDER_CREATE_ATTEMPT_ID,
      mailboxDraftId: null,
      providerThreadId: null,
      error: "provider response was interrupted",
    });
    expect(harness.fail).not.toHaveBeenCalled();
    expect(result.reconciliationRequired).toBe(1);
    expect(result.retrying).toBe(0);
  });

  it("rejects a claimed activity whose parsed submitter differs from the durable customer", async () => {
    const harness = makeHarness({
      jobs: [claimed({ customerEmail: "different@example.com" })],
    });

    const result = await harness.worker.process();

    expect(harness.generateDraft).not.toHaveBeenCalled();
    expect(harness.placeDraft).not.toHaveBeenCalled();
    expect(harness.fail).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "EMAIL_ASSIGNMENT_CONTACT_FORM_DRAFT_CUSTOMER_MISMATCH",
      })
    );
    expect(result.retrying).toBe(1);
  });

  it("reuses the prepared AI history after a pre-provider retry", async () => {
    const first = claimed();
    const prepared = claimed({
      attempts: 2,
      draftHistoryId: "00000000-0000-4000-8000-000000000601",
      draftBody: "Hi Sandra,\n\nThanks for reaching out.",
      draftSubject: "Your deck inquiry",
    });
    const harness = makeHarness({ jobs: [first] });
    harness.resolveSignature.mockRejectedValueOnce(
      new Error("signature lookup unavailable")
    );

    const firstResult = await harness.worker.process();

    expect(firstResult.retrying).toBe(1);
    expect(harness.prepare).toHaveBeenCalledTimes(1);
    expect(harness.generateDraft).toHaveBeenCalledTimes(1);
    expect(harness.beginProviderCreate).not.toHaveBeenCalled();
    expect(harness.placeDraft).not.toHaveBeenCalled();
    expect(harness.sendEmail).not.toHaveBeenCalled();

    harness.claim.mockResolvedValueOnce([prepared]);
    harness.reauthorize.mockResolvedValue(true);

    const retryResult = await harness.worker.process();

    expect(retryResult.drafted).toBe(1);
    expect(harness.generateDraft).toHaveBeenCalledTimes(1);
    expect(harness.prepare).toHaveBeenCalledTimes(1);
    expect(harness.placeDraft).toHaveBeenLastCalledWith(
      expect.objectContaining({
        draftHistoryId: prepared.draftHistoryId,
        body: expect.stringContaining("Thanks for reaching out"),
      })
    );
    expect(harness.sendEmail).not.toHaveBeenCalled();
  });

  it("keeps a missing signature retryable after canonical notification reconciliation", async () => {
    const harness = makeHarness();
    harness.resolveSignature.mockResolvedValue(null);

    const result = await harness.worker.process();

    expect(harness.resolveSignature).toHaveBeenCalledWith(
      expect.objectContaining({
        connection: expect.objectContaining({ id: harness.job.connectionId }),
        userId: harness.job.actorUserId,
        refreshProviderIfMissing: true,
      })
    );
    expect(harness.placeDraft).not.toHaveBeenCalled();
    expect(harness.fail).toHaveBeenCalledWith(
      expect.objectContaining({ error: "EMAIL_SIGNATURE_REQUIRED" })
    );
    expect(result.retrying).toBe(1);
  });

  it("uses the canonical new-inquiry subject when a valid contact-form message has no subject", async () => {
    const job = claimed({ sourceSubject: "" });
    const harness = makeHarness({ jobs: [job] });
    harness.generateDraft.mockResolvedValue({
      available: true,
      draft: "Hi Sandra,\n\nThanks for reaching out.",
      draftHistoryId: "00000000-0000-4000-8000-000000000601",
    });

    const result = await harness.worker.process();

    expect(result.drafted).toBe(1);
    expect(harness.placeDraft).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "Thanks for reaching out" })
    );
  });

  it("rejects a mismatched or inactive claimed mailbox before model/provider work", async () => {
    const harness = makeHarness({
      connection: connection({
        id: "00000000-0000-4000-8000-000000000999",
        status: "disconnected",
        syncEnabled: false,
      }),
    });

    const result = await harness.worker.process();

    expect(harness.generateDraft).not.toHaveBeenCalled();
    expect(harness.getDraftTransport).not.toHaveBeenCalled();
    expect(harness.sendEmail).not.toHaveBeenCalled();
    expect(harness.fail).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "EMAIL_ASSIGNMENT_CONTACT_FORM_DRAFT_CONNECTION_INVALID",
      })
    );
    expect(result.retrying).toBe(1);
  });

  it("allows an individual mailbox only when its canonical owner is the assigned actor", async () => {
    const ownerHarness = makeHarness({
      connection: connection({
        type: "individual",
        userId: claimed().actorUserId,
      }),
    });

    const ownerResult = await ownerHarness.worker.process();

    expect(ownerResult.drafted).toBe(1);
    expect(ownerHarness.placeDraft).toHaveBeenCalledTimes(1);

    const otherUserHarness = makeHarness({
      connection: connection({
        type: "individual",
        userId: "00000000-0000-4000-8000-000000000999",
      }),
    });

    const otherUserResult = await otherUserHarness.worker.process();

    expect(otherUserResult.retrying).toBe(1);
    expect(otherUserHarness.generateDraft).not.toHaveBeenCalled();
    expect(otherUserHarness.placeDraft).not.toHaveBeenCalled();
  });
});
