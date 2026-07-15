import { describe, expect, it, vi } from "vitest";
import {
  EmailOutboundLearningService,
  type EmailOutboundLearningDependencies,
  type EmailOutboundLearningJob,
  type OutboundDraftOutcome,
  type OutboundMemoryExtraction,
  type OutboundWritingSample,
} from "@/lib/api/services/email-outbound-learning-service";
import { outboundLearningEvidenceKey } from "@/lib/email/outbound-learning-evidence";

const WRITING_SAMPLE: OutboundWritingSample = {
  profileType: "general",
  formalityScore: 0.5,
  avgSentenceLength: 4,
  greeting: null,
  closing: null,
  hedgingFrequency: 0,
  punctuation: {
    exclamation_marks: 0,
    em_dashes: 0,
    semicolons: 0,
    ellipsis: 0,
    parenthetical: 0,
  },
  paragraphStructure: {
    bulletFrequency: 0,
    avgParagraphLines: 1,
    prefersBullets: false,
  },
  vocabularyComplexity: {
    avgWordLength: 4,
    uniqueWordRatio: 1,
    usesTradeJargon: false,
  },
  engagementStyle: {
    questionsPerEmail: 0,
    directAddressFreq: 0,
    firstPersonFreq: 0.2,
  },
  emailLength: { wordCount: 4, category: "short" },
};

const MEMORY_EXTRACTION: OutboundMemoryExtraction = {
  facts: [
    {
      evidenceKey: "fact:timeline:i can start monday",
      type: "fact",
      category: "timeline",
      content: "The operator can start Monday.",
      confidence: 0.9,
      embedding: null,
    },
  ],
  edges: [],
};

const DRAFT_OUTCOME: OutboundDraftOutcome = {
  finalVersion: "I can start Monday.\n\nThanks,\nJackson",
  editDistance: 0,
  changesMade: [],
  sentWithoutChanges: true,
  subject: "Project timing",
  subjectEdited: false,
  edited: false,
  contentCorrections: [],
};

function dbRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "8ef4bb80-8707-4446-b650-d27b13bb3464",
    company_id: "f739fdc2-16b0-434d-9f31-3c58ee795865",
    connection_id: "22538067-7acc-4799-b912-5edb74e0d3e8",
    provider_message_id: "provider-message-1",
    provider_thread_id: "provider-thread-1",
    user_id: "89516663-bb16-4743-aa76-ec68a19d0b3b",
    from_email: "operator@example.com",
    to_emails: ["lead@example.com"],
    subject: "Project timing",
    authored_body: "I can start Monday.\n\nThanks,\nJackson",
    clean_body: "I can start Monday.",
    draft_history_id: null,
    follow_up_draft_id: null,
    draft_delivery_channel: null,
    opportunity_id: null,
    profile_type: "general",
    learning_authority: "operator_authored",
    writing_sample: null,
    memory_extraction: null,
    draft_outcome: null,
    draft_correction_facts: null,
    apply_learning: null,
    apply_full_body_learning: null,
    preparation_version: null,
    prepared_at: null,
    applied_at: null,
    occurred_at: "2026-07-14T18:00:00.000Z",
    status: "pending",
    attempts: 0,
    max_attempts: 8,
    next_attempt_at: "2026-07-14T18:00:00.000Z",
    lease_token: null,
    lease_expires_at: null,
    last_error: null,
    completed_lease_token: null,
    created_at: "2026-07-14T18:00:01.000Z",
    updated_at: "2026-07-14T18:00:01.000Z",
    ...overrides,
  };
}

function clientMock() {
  return { rpc: vi.fn() };
}

function dependencyMock(
  overrides: Partial<EmailOutboundLearningDependencies> = {}
): EmailOutboundLearningDependencies {
  return {
    isFeatureEnabled: vi.fn().mockResolvedValue(true),
    prepareWritingSample: vi.fn().mockResolvedValue(WRITING_SAMPLE),
    prepareMemoryExtraction: vi.fn().mockResolvedValue(MEMORY_EXTRACTION),
    prepareDraftOutcome: vi.fn().mockResolvedValue(DRAFT_OUTCOME),
    prepareCorrectionEmbedding: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

function leasedJob(overrides: Partial<EmailOutboundLearningJob> = {}) {
  return {
    id: "8ef4bb80-8707-4446-b650-d27b13bb3464",
    companyId: "f739fdc2-16b0-434d-9f31-3c58ee795865",
    connectionId: "22538067-7acc-4799-b912-5edb74e0d3e8",
    providerMessageId: "provider-message-1",
    providerThreadId: "provider-thread-1",
    userId: "89516663-bb16-4743-aa76-ec68a19d0b3b",
    fromEmail: "operator@example.com",
    toEmails: ["lead@example.com"],
    subject: "Project timing",
    authoredBody: "I can start Monday.\n\nThanks,\nJackson",
    cleanBody: "I can start Monday.",
    draftHistoryId: null,
    followUpDraftId: null,
    draftDeliveryChannel: null,
    opportunityId: null,
    profileType: "general",
    learningAuthority: "operator_authored" as const,
    writingSample: null,
    memoryExtraction: null,
    draftOutcome: null,
    draftCorrectionFacts: null,
    applyLearning: null,
    applyFullBodyLearning: null,
    preparationVersion: null,
    preparedAt: null,
    appliedAt: null,
    occurredAt: "2026-07-14T18:00:00.000Z",
    status: "leased" as const,
    attempts: 1,
    maxAttempts: 8,
    nextAttemptAt: "2026-07-14T18:00:00.000Z",
    leaseToken: "0e8fd9ee-9bc3-4c7a-b273-50802cbcd29f",
    leaseExpiresAt: "2026-07-14T18:05:00.000Z",
    lastError: null,
    completedLeaseToken: null,
    createdAt: "2026-07-14T18:00:01.000Z",
    updatedAt: "2026-07-14T18:00:02.000Z",
    ...overrides,
  } satisfies EmailOutboundLearningJob;
}

describe("EmailOutboundLearningService", () => {
  it("enqueues one clean sample by provider identity without persisting raw quoted body", async () => {
    const db = clientMock();
    db.rpc.mockResolvedValue({
      data: dbRow({
        draft_history_id: "4d16ed89-5bf5-438c-9388-62c345ab6d55",
        follow_up_draft_id: "a8fa5692-2b34-41bd-8d43-d6be1ba6399f",
        draft_delivery_channel: "ops_send",
        opportunity_id: "b00f706f-249d-4cd4-8680-076c310b87ad",
      }),
      error: null,
    });
    const service = new EmailOutboundLearningService(db as never);

    const job = await service.enqueue({
      companyId: "f739fdc2-16b0-434d-9f31-3c58ee795865",
      connectionId: "22538067-7acc-4799-b912-5edb74e0d3e8",
      providerMessageId: "provider-message-1",
      providerThreadId: "provider-thread-1",
      userId: "89516663-bb16-4743-aa76-ec68a19d0b3b",
      fromEmail: "operator@example.com",
      toEmails: ["lead@example.com"],
      subject: "Project timing",
      bodyText:
        "I can start Monday.\n\nThanks,\nJackson\n\nOn Tue, Jul 14, 2026, Lead wrote:\n> Can you start next week?",
      occurredAt: new Date("2026-07-14T18:00:00.000Z"),
      draftHistoryId: "4d16ed89-5bf5-438c-9388-62c345ab6d55",
      followUpDraftId: "a8fa5692-2b34-41bd-8d43-d6be1ba6399f",
      draftDeliveryChannel: "ops_send",
      opportunityId: "b00f706f-249d-4cd4-8680-076c310b87ad",
      profileType: "estimate_follow_up",
      learningAuthority: "operator_approved",
    });

    expect(db.rpc).toHaveBeenCalledWith("enqueue_email_outbound_learning", {
      p_company_id: "f739fdc2-16b0-434d-9f31-3c58ee795865",
      p_connection_id: "22538067-7acc-4799-b912-5edb74e0d3e8",
      p_provider_message_id: "provider-message-1",
      p_provider_thread_id: "provider-thread-1",
      p_user_id: "89516663-bb16-4743-aa76-ec68a19d0b3b",
      p_from_email: "operator@example.com",
      p_to_emails: ["lead@example.com"],
      p_subject: "Project timing",
      p_authored_body: "I can start Monday.\n\nThanks,\nJackson",
      p_clean_body: "I can start Monday.",
      p_occurred_at: "2026-07-14T18:00:00.000Z",
      p_draft_history_id: "4d16ed89-5bf5-438c-9388-62c345ab6d55",
      p_follow_up_draft_id: "a8fa5692-2b34-41bd-8d43-d6be1ba6399f",
      p_opportunity_id: "b00f706f-249d-4cd4-8680-076c310b87ad",
      p_draft_delivery_channel: "ops_send",
      p_profile_type: "estimate_follow_up",
      p_learning_authority: "operator_approved",
    });
    expect(job).toEqual(
      expect.objectContaining({
        providerMessageId: "provider-message-1",
        providerThreadId: "provider-thread-1",
        cleanBody: "I can start Monday.",
        authoredBody: "I can start Monday.\n\nThanks,\nJackson",
        draftHistoryId: "4d16ed89-5bf5-438c-9388-62c345ab6d55",
        followUpDraftId: "a8fa5692-2b34-41bd-8d43-d6be1ba6399f",
        draftDeliveryChannel: "ops_send",
        opportunityId: "b00f706f-249d-4cd4-8680-076c310b87ad",
        maxAttempts: 8,
      })
    );
  });

  it("derives clean persistence from the exact authored body supplied by reconciliation", async () => {
    const db = clientMock();
    db.rpc.mockResolvedValue({ data: dbRow(), error: null });
    const service = new EmailOutboundLearningService(db as never);

    await service.enqueue({
      companyId: "f739fdc2-16b0-434d-9f31-3c58ee795865",
      connectionId: "22538067-7acc-4799-b912-5edb74e0d3e8",
      providerMessageId: "provider-message-exact-body",
      userId: "89516663-bb16-4743-aa76-ec68a19d0b3b",
      subject: "Project timing",
      bodyText: "Exact authored body\n\nOld Jackson\nOld OPS",
      authoredBody: "Exact authored body",
      learningAuthority: "operator_approved",
    });

    expect(db.rpc).toHaveBeenCalledWith(
      "enqueue_email_outbound_learning",
      expect.objectContaining({
        p_authored_body: "Exact authored body",
        p_clean_body: "Exact authored body",
      })
    );
  });

  it("does not enqueue drafts, spam, trash, empty bodies, or feature-disabled samples", async () => {
    const db = clientMock();
    const disabled = dependencyMock({
      isFeatureEnabled: vi.fn().mockResolvedValue(false),
    });
    const service = new EmailOutboundLearningService(db as never, disabled);

    await expect(
      service.enqueueIfEnabled({
        companyId: "f739fdc2-16b0-434d-9f31-3c58ee795865",
        connectionId: "22538067-7acc-4799-b912-5edb74e0d3e8",
        providerMessageId: "provider-message-disabled",
        bodyText: "Valid body",
      })
    ).resolves.toBeNull();

    const enabledService = new EmailOutboundLearningService(
      db as never,
      dependencyMock()
    );
    for (const labelIds of [["DRAFT"], ["SPAM"], ["TRASH"]]) {
      await expect(
        enabledService.enqueueIfEnabled({
          companyId: "f739fdc2-16b0-434d-9f31-3c58ee795865",
          connectionId: "22538067-7acc-4799-b912-5edb74e0d3e8",
          providerMessageId: `provider-message-${labelIds[0]}`,
          bodyText: "Valid body",
          labelIds,
        })
      ).resolves.toBeNull();
    }
    await expect(
      enabledService.enqueueIfEnabled({
        companyId: "f739fdc2-16b0-434d-9f31-3c58ee795865",
        connectionId: "22538067-7acc-4799-b912-5edb74e0d3e8",
        providerMessageId: "provider-message-empty",
        bodyText: "Thanks,\nJackson",
      })
    ).resolves.toBeNull();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("still enqueues sent-draft provenance when optional Phase C learning is disabled", async () => {
    const db = clientMock();
    db.rpc.mockResolvedValue({
      data: dbRow({
        draft_history_id: "4d16ed89-5bf5-438c-9388-62c345ab6d55",
        draft_delivery_channel: "ops_send",
      }),
      error: null,
    });
    const dependencies = dependencyMock({
      isFeatureEnabled: vi.fn().mockResolvedValue(false),
    });
    const service = new EmailOutboundLearningService(db as never, dependencies);

    const job = await service.enqueueIfEnabled({
      companyId: "f739fdc2-16b0-434d-9f31-3c58ee795865",
      connectionId: "22538067-7acc-4799-b912-5edb74e0d3e8",
      providerMessageId: "provider-message-draft-disabled",
      userId: "89516663-bb16-4743-aa76-ec68a19d0b3b",
      bodyText: "I can start Monday.",
      draftHistoryId: "4d16ed89-5bf5-438c-9388-62c345ab6d55",
      draftDeliveryChannel: "ops_send",
    });

    expect(job).not.toBeNull();
    expect(db.rpc).toHaveBeenCalledWith(
      "enqueue_email_outbound_learning",
      expect.objectContaining({
        p_draft_history_id: "4d16ed89-5bf5-438c-9388-62c345ab6d55",
        p_draft_delivery_channel: "ops_send",
      })
    );
  });

  it("claims due and stale-leased jobs through the atomic claim RPC", async () => {
    const db = clientMock();
    db.rpc.mockResolvedValue({
      data: [
        dbRow({
          status: "leased",
          attempts: 2,
          lease_token: "0e8fd9ee-9bc3-4c7a-b273-50802cbcd29f",
          lease_expires_at: "2026-07-14T18:05:00.000Z",
        }),
      ],
      error: null,
    });
    const service = new EmailOutboundLearningService(db as never);

    const jobs = await service.claim({ limit: 20, leaseSeconds: 240 });

    expect(db.rpc).toHaveBeenCalledWith("claim_email_outbound_learning", {
      p_limit: 20,
      p_lease_seconds: 240,
    });
    expect(jobs).toEqual([
      expect.objectContaining({
        status: "leased",
        attempts: 2,
        leaseToken: "0e8fd9ee-9bc3-4c7a-b273-50802cbcd29f",
      }),
    ]);
  });

  it("reports leases terminalized by the claim sweep", async () => {
    const db = clientMock();
    db.rpc.mockResolvedValue({
      data: [
        dbRow({
          id: "expired-job",
          provider_message_id: "expired-provider-message",
          status: "failed",
          attempts: 8,
          max_attempts: 8,
          lease_token: null,
          lease_expires_at: null,
          last_error: "lease expired after maximum attempts",
        }),
      ],
      error: null,
    });
    const service = new EmailOutboundLearningService(db as never);

    const result = await service.runWorker({ limit: 10, concurrency: 1 });

    expect(result).toMatchObject({
      claimed: 0,
      completed: 0,
      terminalFailed: 1,
      failed: 1,
    });
    expect(result.errors).toEqual([
      {
        jobId: "expired-job",
        providerMessageId: "expired-provider-message",
        error: "lease expired after maximum attempts",
      },
    ]);
  });

  it("persists prepared model output before atomically applying effects", async () => {
    const db = clientMock();
    db.rpc
      .mockResolvedValueOnce({
        data: dbRow({
          status: "leased",
          lease_token: "0e8fd9ee-9bc3-4c7a-b273-50802cbcd29f",
          lease_expires_at: "2026-07-14T18:05:00.000Z",
          writing_sample: WRITING_SAMPLE,
          memory_extraction: MEMORY_EXTRACTION,
          draft_outcome: DRAFT_OUTCOME,
          draft_correction_facts: [],
          apply_learning: true,
          apply_full_body_learning: true,
          preparation_version: "outbound-learning-v1",
          prepared_at: "2026-07-14T18:01:00.000Z",
        }),
        error: null,
      })
      .mockResolvedValueOnce({
        data: dbRow({
          status: "completed",
          writing_sample: WRITING_SAMPLE,
          memory_extraction: MEMORY_EXTRACTION,
          draft_outcome: DRAFT_OUTCOME,
          draft_correction_facts: [],
          apply_learning: true,
          apply_full_body_learning: true,
          preparation_version: "outbound-learning-v1",
          prepared_at: "2026-07-14T18:01:00.000Z",
          applied_at: "2026-07-14T18:01:01.000Z",
        }),
        error: null,
      });
    const service = new EmailOutboundLearningService(db as never);

    const prepared = await service.prepare(leasedJob(), {
      applyLearning: true,
      writingSample: WRITING_SAMPLE,
      memoryExtraction: MEMORY_EXTRACTION,
      draftOutcome: DRAFT_OUTCOME,
      draftCorrectionFacts: [],
    });
    const result = await service.apply(prepared);

    expect(db.rpc).toHaveBeenNthCalledWith(
      1,
      "prepare_email_outbound_learning",
      {
        p_job_id: "8ef4bb80-8707-4446-b650-d27b13bb3464",
        p_lease_token: "0e8fd9ee-9bc3-4c7a-b273-50802cbcd29f",
        p_apply_learning: true,
        p_apply_full_body_learning: true,
        p_writing_sample: WRITING_SAMPLE,
        p_memory_extraction: MEMORY_EXTRACTION,
        p_draft_outcome: DRAFT_OUTCOME,
        p_draft_correction_facts: [],
        p_preparation_version: "outbound-learning-v1",
      }
    );
    expect(db.rpc).toHaveBeenNthCalledWith(2, "apply_email_outbound_learning", {
      p_job_id: "8ef4bb80-8707-4446-b650-d27b13bb3464",
      p_lease_token: "0e8fd9ee-9bc3-4c7a-b273-50802cbcd29f",
    });
    expect(result.status).toBe("completed");
    expect(result.appliedAt).toBe("2026-07-14T18:01:01.000Z");
  });

  it("refuses preparation and application before an RPC without a live lease", async () => {
    const db = clientMock();
    const service = new EmailOutboundLearningService(db as never);
    const invalid = leasedJob({ status: "pending", leaseToken: null });

    await expect(service.apply(invalid)).rejects.toThrow(
      "requires a leased job and lease token"
    );
    await expect(
      service.prepare(invalid, {
        applyLearning: true,
        writingSample: WRITING_SAMPLE,
        memoryExtraction: MEMORY_EXTRACTION,
        draftOutcome: DRAFT_OUTCOME,
        draftCorrectionFacts: [],
      })
    ).rejects.toThrow("requires a leased job and lease token");
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("prepares operator-approved drafts for durable edit learning without sampling the AI-authored body", async () => {
    const correctionEmbedding = [0.25, 0.75];
    const cedarEvidenceKey = outboundLearningEvidenceKey("draft-correction", [
      "Use cedar decking.",
    ]);
    const budgetEvidenceKey = outboundLearningEvidenceKey("draft-correction", [
      "Budget is $12,000.",
    ]);
    const draftOutcome: OutboundDraftOutcome = {
      ...DRAFT_OUTCOME,
      edited: true,
      sentWithoutChanges: false,
      contentCorrections: [
        "Use cedar decking.",
        " use cedar decking. ",
        "Budget is $12,000.",
      ],
    };
    const dependencies = dependencyMock({
      prepareDraftOutcome: vi.fn().mockResolvedValue(draftOutcome),
      prepareCorrectionEmbedding: vi
        .fn()
        .mockResolvedValue(correctionEmbedding),
      afterApplied: vi.fn().mockResolvedValue(undefined),
    });
    const claimed = dbRow({
      status: "leased",
      attempts: 1,
      lease_token: "0e8fd9ee-9bc3-4c7a-b273-50802cbcd29f",
      lease_expires_at: "2026-07-14T18:05:00.000Z",
      profile_type: "estimate_follow_up",
      learning_authority: "operator_approved",
    });
    const prepared = dbRow({
      ...claimed,
      writing_sample: null,
      memory_extraction: null,
      draft_outcome: draftOutcome,
      draft_correction_facts: [
        {
          evidenceKey: cedarEvidenceKey,
          type: "fact",
          category: "correction",
          content: "Use cedar decking.",
          confidence: 0.9,
          embedding: correctionEmbedding,
        },
        {
          evidenceKey: budgetEvidenceKey,
          type: "fact",
          category: "correction",
          content: "Budget is $12,000.",
          confidence: 0.9,
          embedding: correctionEmbedding,
        },
      ],
      apply_learning: true,
      apply_full_body_learning: false,
      preparation_version: "outbound-learning-v1",
      prepared_at: "2026-07-14T18:01:00.000Z",
    });
    const db = clientMock();
    db.rpc
      .mockResolvedValueOnce({ data: [claimed], error: null })
      .mockResolvedValueOnce({ data: prepared, error: null })
      .mockResolvedValueOnce({
        data: {
          ...prepared,
          status: "completed",
          applied_at: "2026-07-14T18:01:01.000Z",
        },
        error: null,
      });
    const service = new EmailOutboundLearningService(db as never, dependencies);

    const result = await service.runWorker({ limit: 1, concurrency: 1 });

    expect(result).toMatchObject({
      claimed: 1,
      prepared: 1,
      completed: 1,
      failed: 0,
    });
    expect(dependencies.prepareWritingSample).not.toHaveBeenCalled();
    expect(dependencies.prepareMemoryExtraction).not.toHaveBeenCalled();
    expect(dependencies.prepareDraftOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ id: claimed.id }),
      db,
      { analyzeEdits: true }
    );
    expect(dependencies.prepareCorrectionEmbedding).toHaveBeenCalledTimes(2);
    expect(dependencies.afterApplied).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "completed",
        learningAuthority: "operator_approved",
      })
    );
    expect(dependencies.prepareCorrectionEmbedding).toHaveBeenNthCalledWith(
      1,
      "Use cedar decking."
    );
    expect(dependencies.prepareCorrectionEmbedding).toHaveBeenNthCalledWith(
      2,
      "Budget is $12,000."
    );
    expect(db.rpc).toHaveBeenNthCalledWith(
      2,
      "prepare_email_outbound_learning",
      expect.objectContaining({
        p_apply_learning: true,
        p_apply_full_body_learning: false,
        p_writing_sample: null,
        p_memory_extraction: null,
        p_draft_outcome: draftOutcome,
        p_draft_correction_facts: prepared.draft_correction_facts,
      })
    );
  });

  it("applies core sent-draft state with no model learning when Phase C is disabled", async () => {
    const claimed = dbRow({
      status: "leased",
      attempts: 1,
      lease_token: "0e8fd9ee-9bc3-4c7a-b273-50802cbcd29f",
      lease_expires_at: "2026-07-14T18:05:00.000Z",
      draft_history_id: "4d16ed89-5bf5-438c-9388-62c345ab6d55",
      draft_delivery_channel: "ops_send",
    });
    const prepared = dbRow({
      ...claimed,
      apply_learning: false,
      apply_full_body_learning: false,
      draft_outcome: DRAFT_OUTCOME,
      draft_correction_facts: [],
      preparation_version: "outbound-learning-v1",
      prepared_at: "2026-07-14T18:01:00.000Z",
    });
    const db = clientMock();
    db.rpc
      .mockResolvedValueOnce({ data: [claimed], error: null })
      .mockResolvedValueOnce({ data: prepared, error: null })
      .mockResolvedValueOnce({
        data: {
          ...prepared,
          status: "completed",
          applied_at: "2026-07-14T18:01:01.000Z",
        },
        error: null,
      });
    const dependencies = dependencyMock({
      isFeatureEnabled: vi.fn().mockResolvedValue(false),
    });
    const service = new EmailOutboundLearningService(db as never, dependencies);

    const result = await service.runWorker({ limit: 1, concurrency: 1 });

    expect(result).toMatchObject({
      claimed: 1,
      prepared: 1,
      completed: 1,
      deferred: 0,
      failed: 0,
    });
    expect(dependencies.prepareWritingSample).not.toHaveBeenCalled();
    expect(dependencies.prepareMemoryExtraction).not.toHaveBeenCalled();
    expect(dependencies.prepareCorrectionEmbedding).not.toHaveBeenCalled();
    expect(dependencies.prepareDraftOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ id: claimed.id }),
      db,
      { analyzeEdits: false }
    );
    expect(db.rpc).toHaveBeenNthCalledWith(
      2,
      "prepare_email_outbound_learning",
      expect.objectContaining({
        p_apply_learning: false,
        p_apply_full_body_learning: false,
        p_writing_sample: null,
        p_memory_extraction: null,
        p_draft_correction_facts: [],
      })
    );
  });

  it("records autonomous sent state without training on its own output", async () => {
    const claimed = dbRow({
      status: "leased",
      attempts: 1,
      lease_token: "0e8fd9ee-9bc3-4c7a-b273-50802cbcd29f",
      lease_expires_at: "2026-07-14T18:05:00.000Z",
      draft_history_id: "4d16ed89-5bf5-438c-9388-62c345ab6d55",
      draft_delivery_channel: "ops_send",
      profile_type: "lead_initial",
      learning_authority: "autonomous",
    });
    const prepared = dbRow({
      ...claimed,
      apply_learning: false,
      apply_full_body_learning: false,
      draft_outcome: DRAFT_OUTCOME,
      draft_correction_facts: [],
      preparation_version: "outbound-learning-v1",
      prepared_at: "2026-07-14T18:01:00.000Z",
    });
    const db = clientMock();
    db.rpc
      .mockResolvedValueOnce({ data: [claimed], error: null })
      .mockResolvedValueOnce({ data: prepared, error: null })
      .mockResolvedValueOnce({
        data: { ...prepared, status: "completed" },
        error: null,
      });
    const dependencies = dependencyMock({
      afterApplied: vi.fn().mockResolvedValue(undefined),
    });
    const service = new EmailOutboundLearningService(db as never, dependencies);

    const result = await service.runWorker({ limit: 1, concurrency: 1 });

    expect(result).toMatchObject({ completed: 1, failed: 0 });
    expect(dependencies.prepareWritingSample).not.toHaveBeenCalled();
    expect(dependencies.prepareMemoryExtraction).not.toHaveBeenCalled();
    expect(dependencies.prepareCorrectionEmbedding).not.toHaveBeenCalled();
    expect(dependencies.afterApplied).not.toHaveBeenCalled();
    expect(dependencies.prepareDraftOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ learningAuthority: "autonomous" }),
      db,
      { analyzeEdits: false }
    );
    expect(db.rpc).toHaveBeenNthCalledWith(
      2,
      "prepare_email_outbound_learning",
      expect.objectContaining({
        p_apply_learning: false,
        p_apply_full_body_learning: false,
        p_writing_sample: null,
        p_memory_extraction: null,
        p_draft_correction_facts: [],
      })
    );
  });

  it("preserves generation-one base extraction when draft provenance arrives later", async () => {
    const correction = "Use cedar decking.";
    const correctionEvidenceKey = outboundLearningEvidenceKey(
      "draft-correction",
      [correction]
    );
    const draftOutcome: OutboundDraftOutcome = {
      ...DRAFT_OUTCOME,
      edited: true,
      sentWithoutChanges: false,
      contentCorrections: [correction],
    };
    const claimed = dbRow({
      status: "leased",
      attempts: 1,
      lease_token: "0e8fd9ee-9bc3-4c7a-b273-50802cbcd29f",
      lease_expires_at: "2026-07-14T18:05:00.000Z",
      draft_history_id: "4d16ed89-5bf5-438c-9388-62c345ab6d55",
      draft_delivery_channel: "ops_send",
      writing_sample: WRITING_SAMPLE,
      memory_extraction: MEMORY_EXTRACTION,
      applied_at: "2026-07-14T18:00:30.000Z",
    });
    const prepared = dbRow({
      ...claimed,
      apply_learning: true,
      apply_full_body_learning: true,
      draft_outcome: draftOutcome,
      draft_correction_facts: [
        {
          evidenceKey: correctionEvidenceKey,
          type: "fact",
          category: "correction",
          content: correction,
          confidence: 0.9,
          embedding: null,
        },
      ],
      preparation_version: "outbound-learning-v1",
      prepared_at: "2026-07-14T18:01:00.000Z",
    });
    const db = clientMock();
    db.rpc
      .mockResolvedValueOnce({ data: [claimed], error: null })
      .mockResolvedValueOnce({ data: prepared, error: null })
      .mockResolvedValueOnce({
        data: { ...prepared, status: "completed" },
        error: null,
      });
    const dependencies = dependencyMock({
      prepareDraftOutcome: vi.fn().mockResolvedValue(draftOutcome),
    });
    const service = new EmailOutboundLearningService(db as never, dependencies);

    const result = await service.runWorker({ limit: 1, concurrency: 1 });

    expect(result).toMatchObject({ completed: 1, failed: 0 });
    expect(dependencies.prepareWritingSample).not.toHaveBeenCalled();
    expect(dependencies.prepareMemoryExtraction).not.toHaveBeenCalled();
    expect(dependencies.prepareCorrectionEmbedding).toHaveBeenCalledOnce();
    expect(db.rpc).toHaveBeenNthCalledWith(
      2,
      "prepare_email_outbound_learning",
      expect.objectContaining({
        p_writing_sample: WRITING_SAMPLE,
        p_memory_extraction: MEMORY_EXTRACTION,
        p_draft_correction_facts: [
          expect.objectContaining({ evidenceKey: correctionEvidenceKey }),
        ],
      })
    );
  });

  it("schedules a bounded database retry with the same lease ownership", async () => {
    const db = clientMock();
    db.rpc.mockResolvedValue({
      data: dbRow({
        status: "pending",
        attempts: 1,
        next_attempt_at: "2026-07-14T18:00:30.000Z",
        last_error: "rate limited",
      }),
      error: null,
    });
    const service = new EmailOutboundLearningService(db as never);

    const result = await service.retry(leasedJob(), new Error("rate limited"));

    expect(db.rpc).toHaveBeenCalledWith("retry_email_outbound_learning", {
      p_job_id: "8ef4bb80-8707-4446-b650-d27b13bb3464",
      p_lease_token: "0e8fd9ee-9bc3-4c7a-b273-50802cbcd29f",
      p_error: "rate limited",
    });
    expect(result).toEqual(
      expect.objectContaining({ status: "pending", lastError: "rate limited" })
    );
  });

  it("pages sanitized diagnostics with a stable two-part failure cursor", async () => {
    const db = clientMock();
    db.rpc.mockResolvedValue({
      data: [
        {
          id: "failed-job",
          company_id: "company-1",
          connection_id: "connection-1",
          provider_message_id: "provider-message-1",
          provider_thread_id: "provider-thread-1",
          user_id: "user-1",
          opportunity_id: "opportunity-1",
          draft_history_id: "draft-1",
          follow_up_draft_id: null,
          draft_delivery_channel: "ops_send",
          status: "failed",
          attempts: 8,
          max_attempts: 8,
          next_attempt_at: "2026-07-14T18:00:00.000Z",
          lease_expires_at: null,
          last_error: "terminal",
          last_failed_at: "2026-07-14T19:00:00.000Z",
          last_terminal_error: "terminal",
          requeue_count: 0,
          last_requeued_at: null,
          last_requeue_reason: null,
          is_prepared: true,
          has_learning_receipt: false,
          applied_at: null,
          completed_at: null,
          occurred_at: "2026-07-14T17:00:00.000Z",
          created_at: "2026-07-14T17:00:01.000Z",
          updated_at: "2026-07-14T19:00:00.000Z",
        },
      ],
      error: null,
    });
    const service = new EmailOutboundLearningService(db as never);

    const page = await service.diagnose({
      companyId: "company-1",
      status: "failed",
      limit: 50,
      before: {
        sortAt: "2026-07-14T20:00:00.000Z",
        id: "cursor-job",
      },
    });

    expect(db.rpc).toHaveBeenCalledWith("diagnose_email_outbound_learning", {
      p_company_id: "company-1",
      p_status: "failed",
      p_limit: 50,
      p_before_sort_at: "2026-07-14T20:00:00.000Z",
      p_before_id: "cursor-job",
    });
    expect(page.items).toEqual([
      expect.objectContaining({
        id: "failed-job",
        status: "failed",
        lastFailedAt: "2026-07-14T19:00:00.000Z",
        isPrepared: true,
        hasLearningReceipt: false,
      }),
    ]);
    expect(page.nextCursor).toEqual({
      sortAt: "2026-07-14T19:00:00.000Z",
      id: "failed-job",
    });
  });

  it("requeues one failed job through the audited RPC", async () => {
    const db = clientMock();
    db.rpc.mockResolvedValue({
      data: dbRow({ status: "pending", attempts: 0 }),
      error: null,
    });
    const service = new EmailOutboundLearningService(db as never);

    const job = await service.requeueFailed(
      "8ef4bb80-8707-4446-b650-d27b13bb3464",
      "operator reviewed transient provider outage"
    );

    expect(db.rpc).toHaveBeenCalledWith(
      "requeue_failed_email_outbound_learning",
      {
        p_job_id: "8ef4bb80-8707-4446-b650-d27b13bb3464",
        p_reason: "operator reviewed transient provider outage",
      }
    );
    expect(job.status).toBe("pending");
  });

  it("reuses prepared extraction after a crash and never regenerates divergent effects", async () => {
    const db = clientMock();
    const dependencies = dependencyMock();
    db.rpc
      .mockResolvedValueOnce({
        data: [
          dbRow({
            status: "leased",
            attempts: 2,
            lease_token: "0e8fd9ee-9bc3-4c7a-b273-50802cbcd29f",
            lease_expires_at: "2026-07-14T18:05:00.000Z",
            writing_sample: WRITING_SAMPLE,
            memory_extraction: MEMORY_EXTRACTION,
            draft_outcome: DRAFT_OUTCOME,
            draft_correction_facts: [],
            apply_learning: true,
            apply_full_body_learning: true,
            preparation_version: "outbound-learning-v1",
            prepared_at: "2026-07-14T18:01:00.000Z",
          }),
        ],
        error: null,
      })
      .mockResolvedValueOnce({
        data: dbRow({
          status: "completed",
          writing_sample: WRITING_SAMPLE,
          memory_extraction: MEMORY_EXTRACTION,
          draft_outcome: DRAFT_OUTCOME,
          draft_correction_facts: [],
          apply_learning: true,
          apply_full_body_learning: true,
          preparation_version: "outbound-learning-v1",
          prepared_at: "2026-07-14T18:01:00.000Z",
          applied_at: "2026-07-14T18:02:00.000Z",
        }),
        error: null,
      });
    const service = new EmailOutboundLearningService(db as never, dependencies);

    const result = await service.runWorker({ limit: 1, concurrency: 1 });

    expect(result).toMatchObject({ claimed: 1, completed: 1, failed: 0 });
    expect(dependencies.prepareWritingSample).not.toHaveBeenCalled();
    expect(dependencies.prepareMemoryExtraction).not.toHaveBeenCalled();
    expect(dependencies.prepareDraftOutcome).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalledWith(
      "prepare_email_outbound_learning",
      expect.anything()
    );
  });

  it("defers without retry noise when provenance enrichment invalidates its lease", async () => {
    const db = clientMock();
    db.rpc
      .mockResolvedValueOnce({
        data: [
          dbRow({
            status: "leased",
            attempts: 1,
            lease_token: "0e8fd9ee-9bc3-4c7a-b273-50802cbcd29f",
            lease_expires_at: "2026-07-14T18:05:00.000Z",
          }),
        ],
        error: null,
      })
      .mockResolvedValueOnce({
        data: null,
        error: new Error("outbound learning preparation lost lease ownership"),
      });
    const service = new EmailOutboundLearningService(
      db as never,
      dependencyMock()
    );

    const result = await service.runWorker({ limit: 1, concurrency: 1 });

    expect(result).toMatchObject({
      claimed: 1,
      prepared: 0,
      completed: 0,
      deferred: 1,
      failed: 0,
      errors: [],
    });
    expect(db.rpc).not.toHaveBeenCalledWith(
      "retry_email_outbound_learning",
      expect.anything()
    );
  });

  it("isolates per-job failures so one bad extraction does not block unrelated jobs", async () => {
    const failed = dbRow({
      id: "job-failed",
      provider_message_id: "provider-message-failed",
      status: "leased",
      lease_token: "lease-failed",
      lease_expires_at: "2026-07-14T18:05:00.000Z",
    });
    const succeeds = dbRow({
      id: "job-succeeds",
      provider_message_id: "provider-message-succeeds",
      status: "leased",
      lease_token: "lease-succeeds",
      lease_expires_at: "2026-07-14T18:05:00.000Z",
      writing_sample: WRITING_SAMPLE,
      memory_extraction: MEMORY_EXTRACTION,
      draft_outcome: DRAFT_OUTCOME,
      draft_correction_facts: [],
      apply_learning: true,
      apply_full_body_learning: true,
      preparation_version: "outbound-learning-v1",
      prepared_at: "2026-07-14T18:01:00.000Z",
    });
    const db = clientMock();
    db.rpc.mockImplementation(
      async (name: string, args: Record<string, unknown>) => {
        if (name === "claim_email_outbound_learning") {
          return { data: [failed, succeeds], error: null };
        }
        if (
          name === "apply_email_outbound_learning" &&
          args.p_job_id === "job-succeeds"
        ) {
          return {
            data: { ...succeeds, status: "completed", applied_at: "now" },
            error: null,
          };
        }
        if (name === "retry_email_outbound_learning") {
          return {
            data: {
              ...failed,
              status: "pending",
              last_error: "model unavailable",
            },
            error: null,
          };
        }
        throw new Error(`Unexpected RPC ${name}`);
      }
    );
    const dependencies = dependencyMock({
      prepareMemoryExtraction: vi
        .fn()
        .mockRejectedValue(new Error("model unavailable")),
    });
    const service = new EmailOutboundLearningService(db as never, dependencies);

    const result = await service.runWorker({ limit: 2, concurrency: 2 });

    expect(result).toMatchObject({
      claimed: 2,
      completed: 1,
      retrying: 1,
      terminalFailed: 0,
      failed: 0,
    });
    expect(result.errors).toEqual([
      expect.objectContaining({
        jobId: "job-failed",
        providerMessageId: "provider-message-failed",
        error: "model unavailable",
      }),
    ]);
  });

  it("treats an exact-token completed retry as success after a lost apply response", async () => {
    const prepared = dbRow({
      status: "leased",
      attempts: 1,
      lease_token: "0e8fd9ee-9bc3-4c7a-b273-50802cbcd29f",
      lease_expires_at: "2026-07-14T18:05:00.000Z",
      writing_sample: WRITING_SAMPLE,
      memory_extraction: MEMORY_EXTRACTION,
      draft_outcome: DRAFT_OUTCOME,
      draft_correction_facts: [],
      apply_learning: true,
      apply_full_body_learning: true,
      preparation_version: "outbound-learning-v1",
      prepared_at: "2026-07-14T18:01:00.000Z",
    });
    const db = clientMock();
    db.rpc
      .mockResolvedValueOnce({ data: [prepared], error: null })
      .mockResolvedValueOnce({
        data: null,
        error: new Error("response lost after commit"),
      })
      .mockResolvedValueOnce({
        data: {
          ...prepared,
          status: "completed",
          applied_at: "2026-07-14T18:02:00.000Z",
          completed_lease_token: "0e8fd9ee-9bc3-4c7a-b273-50802cbcd29f",
        },
        error: null,
      });

    const service = new EmailOutboundLearningService(
      db as never,
      dependencyMock()
    );
    const result = await service.runWorker({ limit: 1, concurrency: 1 });

    expect(result).toMatchObject({
      claimed: 1,
      completed: 1,
      failed: 0,
      errors: [],
    });
    expect(db.rpc).toHaveBeenNthCalledWith(3, "retry_email_outbound_learning", {
      p_job_id: "8ef4bb80-8707-4446-b650-d27b13bb3464",
      p_lease_token: "0e8fd9ee-9bc3-4c7a-b273-50802cbcd29f",
      p_error: "response lost after commit",
    });
  });

  it("reports unknown retry bookkeeping separately from a terminal job", async () => {
    const db = clientMock();
    db.rpc
      .mockResolvedValueOnce({
        data: [
          dbRow({
            status: "leased",
            attempts: 1,
            lease_token: "0e8fd9ee-9bc3-4c7a-b273-50802cbcd29f",
            lease_expires_at: "2026-07-14T18:05:00.000Z",
          }),
        ],
        error: null,
      })
      .mockResolvedValueOnce({
        data: null,
        error: new Error("model unavailable"),
      })
      .mockResolvedValueOnce({
        data: null,
        error: new Error("retry response lost"),
      });
    const service = new EmailOutboundLearningService(
      db as never,
      dependencyMock()
    );

    const result = await service.runWorker({ limit: 1, concurrency: 1 });

    expect(result).toMatchObject({
      claimed: 1,
      completed: 0,
      retrying: 0,
      bookkeepingFailed: 1,
      terminalFailed: 0,
      failed: 0,
    });
    expect(result.errors).toEqual([
      expect.objectContaining({ error: "model unavailable" }),
    ]);
  });

  it("counts a job as terminal only when retry bookkeeping returns failed", async () => {
    const leased = dbRow({
      status: "leased",
      attempts: 8,
      max_attempts: 8,
      lease_token: "0e8fd9ee-9bc3-4c7a-b273-50802cbcd29f",
      lease_expires_at: "2026-07-14T18:05:00.000Z",
    });
    const db = clientMock();
    db.rpc
      .mockResolvedValueOnce({ data: [leased], error: null })
      .mockResolvedValueOnce({
        data: null,
        error: new Error("model unavailable"),
      })
      .mockResolvedValueOnce({
        data: { ...leased, status: "failed", last_error: "model unavailable" },
        error: null,
      });
    const service = new EmailOutboundLearningService(
      db as never,
      dependencyMock()
    );

    const result = await service.runWorker({ limit: 1, concurrency: 1 });

    expect(result).toMatchObject({
      claimed: 1,
      completed: 0,
      retrying: 0,
      bookkeepingFailed: 0,
      terminalFailed: 1,
      failed: 1,
    });
  });
});
