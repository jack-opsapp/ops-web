import { describe, expect, it, vi } from "vitest";

import {
  buildEmailExactMessageRecoveryManifestHash,
  computeVancouverSevenDayCutoff,
  runEmailExactMessageRecovery,
  supersedeUnstartedEmailExactMessageRecoveryWork,
  SupabaseEmailExactMessageRecoveryStore,
  type EmailExactMessageRecoveryCreateTargetInspection,
  type EmailExactMessageRecoveryInspection,
  type EmailExactMessageRecoveryManifest,
  type EmailExactMessageRecoveryOpportunitySnapshot,
  type EmailExactMessageRecoveryProviderReader,
  type EmailExactMessageRecoveryReparentRepairAdapter,
  type EmailExactMessageRecoveryReparentResult,
  type EmailExactMessageRecoveryStore,
  type EmailExactMessageRecoveryWorkState,
} from "@/lib/api/services/email-exact-message-recovery-service";
import type { NormalizedEmail } from "@/lib/api/services/email-provider";

const IDS = {
  company: "10000000-0000-4000-8000-000000000001",
  actor: "10000000-0000-4000-8000-000000000002",
  connection: "10000000-0000-4000-8000-000000000003",
  source: "10000000-0000-4000-8000-000000000004",
  target: "10000000-0000-4000-8000-000000000005",
  activity: "10000000-0000-4000-8000-000000000006",
  event: "10000000-0000-4000-8000-000000000007",
  secondActivity: "10000000-0000-4000-8000-000000000008",
  secondEvent: "10000000-0000-4000-8000-000000000009",
  secondTarget: "10000000-0000-4000-8000-000000000012",
} as const;

const NOW = new Date("2026-07-22T18:30:00.000Z");

function opportunitySnapshot(
  overrides: Partial<EmailExactMessageRecoveryOpportunitySnapshot> = {}
) {
  return {
    updatedAt: "2026-07-22T17:00:00.000Z",
    stage: "new_lead",
    stageManuallySet: false,
    assignedTo: null,
    assignmentVersion: 0,
    projectId: null,
    ...overrides,
  };
}

function manifest(
  overrides: Partial<EmailExactMessageRecoveryManifest> = {}
): EmailExactMessageRecoveryManifest {
  return {
    schemaVersion: 1,
    companyId: IDS.company,
    actorUserId: IDS.actor,
    connectionId: IDS.connection,
    generatedAt: NOW.toISOString(),
    cutoffAt: "2026-07-15T07:00:00.000Z",
    entries: [
      {
        action: "reparent",
        providerThreadId: "thread-victoria-forward",
        providerMessageId: "message-victoria-forward",
        providerOccurredAt: "2026-07-22T16:00:00.000Z",
        sourceOpportunityId: IDS.source,
        targetOpportunityId: IDS.target,
        activityId: IDS.activity,
        correspondenceEventId: IDS.event,
        targetEmail: "lead@example.com",
        sourceSnapshot: opportunitySnapshot(),
        targetSnapshot: opportunitySnapshot({
          updatedAt: "2026-07-22T17:05:00.000Z",
          assignedTo: IDS.actor,
          assignmentVersion: 3,
        }),
      },
    ],
    ...overrides,
  };
}

function createTargetManifest(): EmailExactMessageRecoveryManifest {
  return manifest({
    entries: [
      {
        action: "create_target_and_reparent",
        providerThreadId: "thread-victoria-forward",
        providerMessageId: "message-victoria-forward",
        providerOccurredAt: "2026-07-22T16:00:00.000Z",
        sourceOpportunityId: IDS.source,
        activityId: IDS.activity,
        correspondenceEventId: IDS.event,
        targetEmail: "lead@example.com",
        targetLead: {
          sourceThreadKey: `email:gmail:${IDS.connection}:message:message-victoria-forward`,
          title: "Lead Example",
          contactName: "Lead Example",
        },
        sourceSnapshot: opportunitySnapshot(),
      },
    ],
  });
}

function providerMessage(
  overrides: Partial<NormalizedEmail> = {}
): NormalizedEmail {
  return {
    id: "message-victoria-forward",
    threadId: "thread-victoria-forward",
    from: "Victoria Office <victoria@example.com>",
    fromName: "Victoria Office",
    to: ["ops@example.com"],
    cc: [],
    subject: "Forwarded lead",
    snippet: "Untrusted provider snippet",
    bodyText: "Untrusted provider body",
    date: new Date("2026-07-22T16:00:00.000Z"),
    labelIds: ["INBOX"],
    isRead: false,
    hasAttachments: false,
    sizeEstimate: 100,
    ...overrides,
  };
}

function recoveryWorkState(
  entry: EmailExactMessageRecoveryManifest["entries"][number],
  overrides: Partial<EmailExactMessageRecoveryWorkState> = {}
): EmailExactMessageRecoveryWorkState {
  const isIngest = entry.action === "ingest";
  return {
    action: entry.action,
    activityId: isIngest ? IDS.activity : entry.activityId,
    opportunityId: isIngest ? IDS.target : null,
    sourceOpportunityId: isIngest ? null : entry.sourceOpportunityId,
    targetOpportunityId:
      entry.action === "reparent" ? entry.targetOpportunityId : IDS.target,
    correspondenceEventId: isIngest ? null : entry.correspondenceEventId,
    message: providerMessage({
      id: entry.providerMessageId,
      threadId: entry.providerThreadId,
      date: new Date(entry.providerOccurredAt),
    }),
    mutationCompleted: true,
    attachmentRequired: !isIngest,
    attachmentCompleted: !isIngest,
    repairRequired: !isIngest,
    repairCompleted: !isIngest,
    draftProjectionRequired: entry.unansweredDraftProjection !== undefined,
    draftProjectionCompleted: entry.unansweredDraftProjection !== undefined,
    ...overrides,
  };
}

function inspection(
  value = manifest().entries[0]
): EmailExactMessageRecoveryInspection {
  if (value.action !== "reparent") {
    throw new Error("test inspection requires a reparent entry");
  }
  return {
    activity: {
      id: value.activityId,
      opportunityId: value.sourceOpportunityId,
      direction: "inbound",
      fromEmail: value.targetEmail,
      toEmails: ["ops@example.com"],
      ccEmails: [],
    },
    correspondenceEvent: {
      id: value.correspondenceEventId,
      activityId: value.activityId,
      opportunityId: value.sourceOpportunityId,
      projectionApplied: true,
      direction: "inbound",
      partyRole: "customer",
      isMeaningful: true,
    },
    sourceSnapshot: value.sourceSnapshot,
    targetSnapshot: value.targetSnapshot,
    targetIdentityEmails: [value.targetEmail],
  };
}

function createTargetInspection(
  existingTarget: EmailExactMessageRecoveryCreateTargetInspection["existingTarget"] = null
): EmailExactMessageRecoveryCreateTargetInspection {
  return {
    activity: {
      id: IDS.activity,
      opportunityId: existingTarget?.id ?? IDS.source,
      connectionId: IDS.connection,
      direction: "inbound",
      fromEmail: "lead@example.com",
    },
    correspondenceEvent: {
      id: IDS.event,
      activityId: IDS.activity,
      opportunityId: existingTarget?.id ?? IDS.source,
      projectionApplied: true,
      direction: "inbound",
      partyRole: "customer",
      isMeaningful: true,
      fromEmail: "lead@example.com",
    },
    sourceSnapshot: opportunitySnapshot(),
    existingTarget,
  };
}

function dependencies(options?: {
  messages?: NormalizedEmail[];
  inspected?: EmailExactMessageRecoveryInspection;
  createTargetInspected?: EmailExactMessageRecoveryCreateTargetInspection;
}) {
  const fetchThread = vi.fn(
    async () => options?.messages ?? [providerMessage()]
  );
  const inspectExactMessage = vi.fn(
    async () => options?.inspected ?? inspection()
  );
  const findExactActivity = vi.fn(
    async (): Promise<{
      activityId: string;
      opportunityId: string | null;
    } | null> => null
  );
  const reparentExactMessage = vi.fn(
    async (
      _input: Parameters<
        EmailExactMessageRecoveryStore["reparentExactMessage"]
      >[0]
    ): Promise<EmailExactMessageRecoveryReparentResult> => ({
      applied: true,
      alreadyApplied: false,
      pendingAttachmentAttribution: false,
      activityId: IDS.activity,
      correspondenceEventId: IDS.event,
      sourceOpportunityId: IDS.source,
      targetOpportunityId: IDS.target,
    })
  );
  const inspectExactMessageForTargetCreation = vi.fn(
    async () => options?.createTargetInspected ?? createTargetInspection()
  );
  const createTargetAndReparentExactMessage = vi.fn(
    async (): Promise<EmailExactMessageRecoveryReparentResult> => ({
      applied: true,
      alreadyApplied: false,
      pendingAttachmentAttribution: false,
      activityId: IDS.activity,
      correspondenceEventId: IDS.event,
      sourceOpportunityId: IDS.source,
      targetOpportunityId: IDS.target,
    })
  );
  const inspectRecoveryApplication = vi.fn(
    async (
      _input: Parameters<
        EmailExactMessageRecoveryStore["inspectRecoveryApplication"]
      >[0]
    ): ReturnType<
      EmailExactMessageRecoveryStore["inspectRecoveryApplication"]
    > => null
  );
  const recoveryWork = new Map<
    string,
    Awaited<ReturnType<EmailExactMessageRecoveryStore["registerRecoveryWork"]>>
  >();
  const inspectRecoveryWork = vi.fn(
    async (
      input: Parameters<
        EmailExactMessageRecoveryStore["inspectRecoveryWork"]
      >[0]
    ) => recoveryWork.get(input.providerMessageId) ?? null
  );
  const registerRecoveryWork = vi.fn(
    async (
      input: Parameters<
        EmailExactMessageRecoveryStore["registerRecoveryWork"]
      >[0]
    ) => {
      const existing = recoveryWork.get(input.providerMessageId);
      if (existing) return existing;
      const state = {
        action: input.action,
        activityId: input.activityId,
        opportunityId: input.opportunityId,
        sourceOpportunityId: input.sourceOpportunityId,
        targetOpportunityId: input.targetOpportunityId,
        correspondenceEventId: input.correspondenceEventId,
        message: input.message,
        mutationCompleted: false,
        attachmentRequired: input.attachmentRequired,
        attachmentCompleted: false,
        repairRequired: input.repairRequired,
        repairCompleted: false,
        draftProjectionRequired: input.draftProjectionRequired,
        draftProjectionCompleted: false,
      };
      recoveryWork.set(input.providerMessageId, state);
      return state;
    }
  );
  const abandonRecoveryWork = vi.fn(async () => true);
  const markRecoveryWorkStep = vi.fn(
    async (
      input: Parameters<
        EmailExactMessageRecoveryStore["markRecoveryWorkStep"]
      >[0]
    ) => {
      const current = recoveryWork.get(input.providerMessageId);
      if (!current) throw new Error("test recovery work is missing");
      const next = {
        ...current,
        activityId: input.activityId ?? current.activityId,
        opportunityId: input.opportunityId ?? current.opportunityId,
        sourceOpportunityId:
          input.sourceOpportunityId ?? current.sourceOpportunityId,
        targetOpportunityId:
          input.targetOpportunityId ?? current.targetOpportunityId,
        correspondenceEventId:
          input.correspondenceEventId ?? current.correspondenceEventId,
        mutationCompleted:
          current.mutationCompleted || input.step === "mutation",
        attachmentCompleted:
          current.attachmentCompleted || input.step === "attachment",
        repairCompleted: current.repairCompleted || input.step === "repair",
        draftProjectionCompleted:
          current.draftProjectionCompleted || input.step === "draft_projection",
      };
      recoveryWork.set(input.providerMessageId, next);
      return next;
    }
  );

  const provider: EmailExactMessageRecoveryProviderReader = { fetchThread };
  const store: EmailExactMessageRecoveryStore = {
    findExactActivity,
    inspectExactMessage,
    reparentExactMessage,
    inspectExactMessageForTargetCreation,
    createTargetAndReparentExactMessage,
    inspectRecoveryApplication,
    inspectRecoveryWork,
    registerRecoveryWork,
    abandonRecoveryWork,
    markRecoveryWorkStep,
  };

  const ingestExactMessage = vi.fn(async () => ({
    applied: true,
    alreadyApplied: false,
    activityId: "10000000-0000-4000-8000-000000000010",
    opportunityId: "10000000-0000-4000-8000-000000000011",
  }));
  const repairReparentedMessage = vi.fn(
    async (
      _input: Parameters<EmailExactMessageRecoveryReparentRepairAdapter>[0]
    ) => undefined
  );
  const projectUnansweredDraft = vi.fn(async () => undefined);

  return {
    provider,
    store,
    fetchThread,
    findExactActivity,
    inspectExactMessage,
    reparentExactMessage,
    inspectExactMessageForTargetCreation,
    createTargetAndReparentExactMessage,
    inspectRecoveryApplication,
    inspectRecoveryWork,
    registerRecoveryWork,
    abandonRecoveryWork,
    markRecoveryWorkStep,
    recoveryWork,
    ingestExactMessage,
    repairReparentedMessage,
    projectUnansweredDraft,
  };
}

describe("computeVancouverSevenDayCutoff", () => {
  it("uses Vancouver midnight seven calendar days earlier during daylight time", () => {
    expect(computeVancouverSevenDayCutoff(NOW).toISOString()).toBe(
      "2026-07-15T07:00:00.000Z"
    );
  });

  it("uses Vancouver midnight across the fall daylight-saving boundary", () => {
    expect(
      computeVancouverSevenDayCutoff(
        new Date("2026-11-04T20:00:00.000Z")
      ).toISOString()
    ).toBe("2026-10-28T07:00:00.000Z");
  });
});

describe("buildEmailExactMessageRecoveryManifestHash", () => {
  it("is stable across object key order while remaining content-addressed", () => {
    const original = manifest();
    const reordered = {
      entries: original.entries,
      cutoffAt: original.cutoffAt,
      generatedAt: original.generatedAt,
      connectionId: original.connectionId,
      actorUserId: original.actorUserId,
      companyId: original.companyId,
      schemaVersion: original.schemaVersion,
    } as EmailExactMessageRecoveryManifest;

    expect(buildEmailExactMessageRecoveryManifestHash(reordered)).toBe(
      buildEmailExactMessageRecoveryManifestHash(original)
    );
    expect(
      buildEmailExactMessageRecoveryManifestHash({
        ...original,
        actorUserId: "20000000-0000-4000-8000-000000000002",
      })
    ).not.toBe(buildEmailExactMessageRecoveryManifestHash(original));
    expect(
      buildEmailExactMessageRecoveryManifestHash({
        ...original,
        entries: [
          {
            ...original.entries[0],
            unansweredDraftProjection: {
              workstream: "sales",
              responseDisposition: "reply_required",
              conversationScope: "message",
            },
          },
        ],
      })
    ).not.toBe(buildEmailExactMessageRecoveryManifestHash(original));

    const createTarget = createTargetManifest();
    const createTargetEntry = createTarget.entries[0];
    if (createTargetEntry.action !== "create_target_and_reparent") {
      throw new Error("expected create-target entry");
    }
    expect(
      buildEmailExactMessageRecoveryManifestHash({
        ...createTarget,
        entries: [
          {
            ...createTargetEntry,
            targetLead: {
              ...createTargetEntry.targetLead,
              title: "A different approved title",
            },
          },
        ],
      })
    ).not.toBe(buildEmailExactMessageRecoveryManifestHash(createTarget));
  });
});

describe("supersedeUnstartedEmailExactMessageRecoveryWork", () => {
  it("abandons only explicitly selected exact rows under the newly approved hash", async () => {
    const first = manifest().entries[0];
    if (first.action !== "reparent") throw new Error("expected reparent entry");
    const second = {
      ...first,
      providerMessageId: "message-two",
      providerOccurredAt: "2026-07-22T16:05:00.000Z",
      activityId: IDS.secondActivity,
      correspondenceEventId: IDS.secondEvent,
      targetOpportunityId: IDS.secondTarget,
      targetEmail: "second@example.com",
    };
    const priorManifest = manifest({ entries: [first, second] });
    const supersedingManifest = manifest({
      entries: [
        {
          ...second,
          targetEmail: "reviewed-second@example.com",
        },
      ],
    });
    const deps = dependencies();
    const approvedSupersedingManifestSha256 =
      buildEmailExactMessageRecoveryManifestHash(supersedingManifest);

    const result = await supersedeUnstartedEmailExactMessageRecoveryWork({
      priorManifest,
      supersedingManifest,
      providerMessageIds: [second.providerMessageId],
      approvedSupersedingManifestSha256,
      store: deps.store,
      now: NOW,
    });

    expect(result).toEqual({
      priorManifestSha256:
        buildEmailExactMessageRecoveryManifestHash(priorManifest),
      supersedingManifestSha256: approvedSupersedingManifestSha256,
      providerMessageIds: [second.providerMessageId],
    });
    expect(deps.abandonRecoveryWork).toHaveBeenCalledTimes(1);
    expect(deps.abandonRecoveryWork).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: supersedingManifest.actorUserId,
        providerThreadId: second.providerThreadId,
        providerMessageId: second.providerMessageId,
        priorManifestSha256:
          buildEmailExactMessageRecoveryManifestHash(priorManifest),
        supersedingManifestSha256: approvedSupersedingManifestSha256,
      })
    );
    expect(deps.fetchThread).not.toHaveBeenCalled();
  });

  it("rejects a changed provider identity or unapproved superseding hash", async () => {
    const priorManifest = manifest();
    const priorEntry = priorManifest.entries[0];
    if (priorEntry.action !== "reparent") {
      throw new Error("expected reparent entry");
    }
    const supersedingManifest = manifest({
      entries: [
        {
          ...priorEntry,
          providerThreadId: "different-thread",
        },
      ],
    });
    const deps = dependencies();

    await expect(
      supersedeUnstartedEmailExactMessageRecoveryWork({
        priorManifest,
        supersedingManifest,
        providerMessageIds: [priorEntry.providerMessageId],
        approvedSupersedingManifestSha256:
          buildEmailExactMessageRecoveryManifestHash(supersedingManifest),
        store: deps.store,
        now: NOW,
      })
    ).rejects.toThrow("changed exact provider message identity");
    await expect(
      supersedeUnstartedEmailExactMessageRecoveryWork({
        priorManifest,
        supersedingManifest: manifest({
          entries: [{ ...priorEntry, targetEmail: "changed@example.com" }],
        }),
        providerMessageIds: [priorEntry.providerMessageId],
        approvedSupersedingManifestSha256: "0".repeat(64),
        store: deps.store,
        now: NOW,
      })
    ).rejects.toThrow("approved superseding manifest sha256 does not match");
    expect(deps.abandonRecoveryWork).not.toHaveBeenCalled();
  });

  it("rejects multi-row supersession before abandoning any durable row", async () => {
    const first = manifest().entries[0];
    if (first.action !== "reparent") throw new Error("expected reparent entry");
    const second = {
      ...first,
      providerMessageId: "message-two",
      providerOccurredAt: "2026-07-22T16:05:00.000Z",
    };
    const priorManifest = manifest({ entries: [first, second] });
    const supersedingManifest = manifest({
      entries: [{ ...first, targetEmail: "reviewed@example.com" }],
    });
    const deps = dependencies();

    await expect(
      supersedeUnstartedEmailExactMessageRecoveryWork({
        priorManifest,
        supersedingManifest,
        providerMessageIds: [first.providerMessageId, second.providerMessageId],
        approvedSupersedingManifestSha256:
          buildEmailExactMessageRecoveryManifestHash(supersedingManifest),
        store: deps.store,
        now: NOW,
      })
    ).rejects.toThrow("exactly one provider message per manifest");
    expect(deps.abandonRecoveryWork).not.toHaveBeenCalled();
  });
});

describe("runEmailExactMessageRecovery", () => {
  it("defaults to a read-only dry-run and never invokes the reparent RPC", async () => {
    const deps = dependencies();

    const result = await runEmailExactMessageRecovery({
      manifest: manifest(),
      provider: deps.provider,
      store: deps.store,
      ingestExactMessage: deps.ingestExactMessage,
      now: NOW,
    });

    expect(result.mode).toBe("dry-run");
    expect(result.entries).toEqual([
      expect.objectContaining({
        providerThreadId: "thread-victoria-forward",
        providerMessageId: "message-victoria-forward",
        status: "ready",
      }),
    ]);
    expect(deps.fetchThread).toHaveBeenCalledTimes(1);
    expect(deps.inspectExactMessage).toHaveBeenCalledTimes(1);
    expect(deps.ingestExactMessage).not.toHaveBeenCalled();
    expect(deps.reparentExactMessage).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("Untrusted provider body");
    expect(JSON.stringify(result)).not.toContain("Untrusted provider snippet");
  });

  it("deduplicates provider reads while preserving an exact message allowlist", async () => {
    const first = manifest().entries[0];
    if (first.action !== "reparent") throw new Error("expected reparent entry");
    const second = {
      ...first,
      providerMessageId: "message-two",
      providerOccurredAt: "2026-07-22T16:05:00.000Z",
      activityId: "10000000-0000-4000-8000-000000000008",
      correspondenceEventId: "10000000-0000-4000-8000-000000000009",
    };
    const secondInspection = inspection(second);
    const deps = dependencies({
      messages: [
        providerMessage(),
        providerMessage({
          id: second.providerMessageId,
          date: new Date(second.providerOccurredAt),
        }),
      ],
    });
    deps.inspectExactMessage
      .mockResolvedValueOnce(inspection(first))
      .mockResolvedValueOnce(secondInspection);

    const result = await runEmailExactMessageRecovery({
      manifest: manifest({ entries: [first, second] }),
      provider: deps.provider,
      store: deps.store,
      ingestExactMessage: deps.ingestExactMessage,
      now: NOW,
    });

    expect(result.entries).toHaveLength(2);
    expect(deps.fetchThread).toHaveBeenCalledTimes(1);
    expect(deps.fetchThread).toHaveBeenCalledWith(
      "thread-victoria-forward",
      expect.objectContaining({
        context: expect.stringContaining("exact-message recovery"),
        oauthTokenMode: "current_only_no_persist",
      })
    );
  });

  it("fails closed when the provider thread does not contain the allowed message", async () => {
    const deps = dependencies({
      messages: [providerMessage({ id: "different-message" })],
    });

    await expect(
      runEmailExactMessageRecovery({
        manifest: manifest(),
        provider: deps.provider,
        store: deps.store,
        ingestExactMessage: deps.ingestExactMessage,
        now: NOW,
      })
    ).rejects.toThrow("exact provider message not found");

    expect(deps.inspectExactMessage).not.toHaveBeenCalled();
    expect(deps.reparentExactMessage).not.toHaveBeenCalled();
  });

  it("rejects messages older than the Vancouver seven-day cutoff", async () => {
    const staleAt = "2026-07-15T06:59:59.999Z";
    const deps = dependencies({
      messages: [providerMessage({ date: new Date(staleAt) })],
    });

    await expect(
      runEmailExactMessageRecovery({
        manifest: manifest({
          entries: [
            {
              ...manifest().entries[0],
              providerOccurredAt: staleAt,
            },
          ],
        }),
        provider: deps.provider,
        store: deps.store,
        ingestExactMessage: deps.ingestExactMessage,
        now: NOW,
      })
    ).rejects.toThrow("outside the seven-day Vancouver recovery window");
  });

  it("keeps an approved manifest retryable after the Vancouver cutoff advances", async () => {
    const deps = dependencies();

    const result = await runEmailExactMessageRecovery({
      manifest: manifest(),
      provider: deps.provider,
      store: deps.store,
      ingestExactMessage: deps.ingestExactMessage,
      now: new Date("2026-07-23T08:00:00.000Z"),
    });

    expect(result.cutoffAt).toBe("2026-07-15T07:00:00.000Z");
    expect(result.entries[0].status).toBe("ready");
  });

  it("rejects a manifest more than 24 hours after its trusted generation time before provider access", async () => {
    const deps = dependencies();

    await expect(
      runEmailExactMessageRecovery({
        manifest: manifest(),
        provider: deps.provider,
        store: deps.store,
        ingestExactMessage: deps.ingestExactMessage,
        now: new Date("2026-07-23T18:30:00.001Z"),
      })
    ).rejects.toThrow("manifest.generatedAt is older than 24 hours");

    expect(deps.fetchThread).not.toHaveBeenCalled();
    expect(deps.inspectExactMessage).not.toHaveBeenCalled();
    expect(deps.reparentExactMessage).not.toHaveBeenCalled();
  });

  it("rejects an expired manifest whose content hash differs from durable nonterminal work", async () => {
    const originalManifest = manifest();
    const originalManifestSha256 =
      buildEmailExactMessageRecoveryManifestHash(originalManifest);
    const originalEntry = originalManifest.entries[0];
    if (originalEntry.action !== "reparent") {
      throw new Error("expected reparent entry");
    }
    const changedManifest = manifest({
      entries: [{ ...originalEntry, targetEmail: "changed@example.com" }],
    });
    const deps = dependencies();
    const pendingState = recoveryWorkState(originalEntry, {
      attachmentCompleted: false,
      repairCompleted: false,
    });
    deps.inspectRecoveryWork.mockImplementation(async (input) =>
      input.manifestSha256 === originalManifestSha256 ? pendingState : null
    );

    await expect(
      runEmailExactMessageRecovery({
        manifest: changedManifest,
        provider: deps.provider,
        store: deps.store,
        ingestExactMessage: deps.ingestExactMessage,
        now: new Date("2026-07-23T18:30:00.001Z"),
      })
    ).rejects.toThrow("manifest.generatedAt is older than 24 hours");

    expect(deps.inspectRecoveryWork).toHaveBeenCalledWith(
      expect.objectContaining({
        manifestSha256:
          buildEmailExactMessageRecoveryManifestHash(changedManifest),
      })
    );
    expect(deps.fetchThread).not.toHaveBeenCalled();
  });

  it("skips unregistered entries while exposing exact nonterminal expired work", async () => {
    const reparentEntry = manifest().entries[0];
    const ingestEntry = {
      action: "ingest" as const,
      providerThreadId: "thread-victoria-forward",
      providerMessageId: "message-ingest",
      providerOccurredAt: "2026-07-22T16:02:00.000Z",
    };
    const expiredManifest = manifest({
      entries: [reparentEntry, ingestEntry],
    });
    const deps = dependencies();
    if (reparentEntry.action !== "reparent") {
      throw new Error("expected reparent entry");
    }
    deps.recoveryWork.set(
      reparentEntry.providerMessageId,
      recoveryWorkState(reparentEntry, {
        attachmentCompleted: false,
        repairCompleted: false,
      })
    );

    const result = await runEmailExactMessageRecovery({
      manifest: expiredManifest,
      provider: deps.provider,
      store: deps.store,
      ingestExactMessage: deps.ingestExactMessage,
      now: new Date("2026-07-23T18:30:00.001Z"),
    });

    expect(result.entries.map((entry) => entry.status)).toEqual([
      "pending_attachment_attribution",
      "skipped_expired",
    ]);
    expect(deps.inspectRecoveryWork).toHaveBeenCalledTimes(2);
    expect(deps.findExactActivity).not.toHaveBeenCalled();
    expect(deps.fetchThread).not.toHaveBeenCalled();
  });

  it("drains registered expired work provider-free, then rejects an incomplete durable manifest set", async () => {
    const first = {
      action: "ingest" as const,
      providerThreadId: "thread-victoria-forward",
      providerMessageId: "message-ingest-one",
      providerOccurredAt: "2026-07-22T16:02:00.000Z",
    };
    const second = {
      ...first,
      providerMessageId: "message-ingest-two",
      providerOccurredAt: "2026-07-22T16:03:00.000Z",
    };
    const expiredManifest = manifest({ entries: [first, second] });
    const deps = dependencies();
    deps.recoveryWork.set(
      first.providerMessageId,
      recoveryWorkState(first, {
        activityId: null,
        opportunityId: null,
        mutationCompleted: false,
      })
    );

    await expect(
      runEmailExactMessageRecovery({
        manifest: expiredManifest,
        provider: deps.provider,
        store: deps.store,
        ingestExactMessage: deps.ingestExactMessage,
        now: new Date("2026-07-23T18:30:00.001Z"),
        apply: true,
        approvedManifestSha256:
          buildEmailExactMessageRecoveryManifestHash(expiredManifest),
      })
    ).rejects.toThrow("new reviewed manifest approval is required");

    expect(deps.fetchThread).not.toHaveBeenCalled();
    expect(deps.registerRecoveryWork).not.toHaveBeenCalled();
    expect(deps.ingestExactMessage).toHaveBeenCalledTimes(1);
    expect(
      deps.recoveryWork.get(first.providerMessageId)?.mutationCompleted
    ).toBe(true);
    expect(deps.recoveryWork.has(second.providerMessageId)).toBe(false);
  });

  it("accepts an all-complete expired durable manifest as already applied", async () => {
    const first = {
      action: "ingest" as const,
      providerThreadId: "thread-victoria-forward",
      providerMessageId: "message-ingest-one",
      providerOccurredAt: "2026-07-22T16:02:00.000Z",
    };
    const second = {
      ...first,
      providerMessageId: "message-ingest-two",
      providerOccurredAt: "2026-07-22T16:03:00.000Z",
    };
    const expiredManifest = manifest({ entries: [first, second] });
    const deps = dependencies();
    deps.recoveryWork.set(first.providerMessageId, recoveryWorkState(first));
    deps.recoveryWork.set(second.providerMessageId, recoveryWorkState(second));

    const result = await runEmailExactMessageRecovery({
      manifest: expiredManifest,
      provider: deps.provider,
      store: deps.store,
      ingestExactMessage: deps.ingestExactMessage,
      now: new Date("2026-07-23T18:30:00.001Z"),
      apply: true,
      approvedManifestSha256:
        buildEmailExactMessageRecoveryManifestHash(expiredManifest),
    });

    expect(result.entries.map((entry) => entry.status)).toEqual([
      "already_applied",
      "already_applied",
    ]);
    expect(deps.fetchThread).not.toHaveBeenCalled();
    expect(deps.ingestExactMessage).not.toHaveBeenCalled();
  });

  it("accepts an all-complete expired reparent and draft retry without execution adapters", async () => {
    const baseEntry = manifest().entries[0];
    if (baseEntry.action !== "reparent") {
      throw new Error("expected reparent entry");
    }
    const entry = {
      ...baseEntry,
      unansweredDraftProjection: {
        workstream: "sales" as const,
        responseDisposition: "reply_required" as const,
        conversationScope: "message" as const,
      },
    };
    const expiredManifest = manifest({ entries: [entry] });
    const deps = dependencies();
    deps.recoveryWork.set(entry.providerMessageId, recoveryWorkState(entry));

    const result = await runEmailExactMessageRecovery({
      manifest: expiredManifest,
      provider: deps.provider,
      store: deps.store,
      ingestExactMessage: deps.ingestExactMessage,
      now: new Date("2026-07-23T18:30:00.001Z"),
      apply: true,
      approvedManifestSha256:
        buildEmailExactMessageRecoveryManifestHash(expiredManifest),
    });

    expect(result.entries[0]?.status).toBe("already_applied");
    expect(deps.fetchThread).not.toHaveBeenCalled();
    expect(deps.reparentExactMessage).not.toHaveBeenCalled();
    expect(deps.repairReparentedMessage).not.toHaveBeenCalled();
    expect(deps.projectUnansweredDraft).not.toHaveBeenCalled();
  });

  it("resumes an expired identical manifest only from immutable complete and nonterminal work", async () => {
    const first = manifest().entries[0];
    if (first.action !== "reparent") throw new Error("expected reparent entry");
    const ingestEntry = {
      action: "ingest" as const,
      providerThreadId: first.providerThreadId,
      providerMessageId: "message-ingest",
      providerOccurredAt: "2026-07-22T16:02:00.000Z",
    };
    const second = {
      ...first,
      providerMessageId: "message-two",
      providerOccurredAt: "2026-07-22T16:05:00.000Z",
      targetOpportunityId: IDS.secondTarget,
      activityId: IDS.secondActivity,
      correspondenceEventId: IDS.secondEvent,
      targetEmail: "second@example.com",
      targetSnapshot: opportunitySnapshot({
        updatedAt: "2026-07-22T17:06:00.000Z",
      }),
    };
    const expiredManifest = manifest({
      entries: [ingestEntry, first, second],
    });
    const deps = dependencies();
    deps.recoveryWork.set(
      ingestEntry.providerMessageId,
      recoveryWorkState(ingestEntry)
    );
    deps.recoveryWork.set(first.providerMessageId, recoveryWorkState(first));
    deps.recoveryWork.set(
      second.providerMessageId,
      recoveryWorkState(second, {
        attachmentCompleted: false,
        repairCompleted: false,
      })
    );
    deps.reparentExactMessage.mockResolvedValueOnce({
      applied: true,
      alreadyApplied: false,
      pendingAttachmentAttribution: false,
      activityId: second.activityId,
      correspondenceEventId: second.correspondenceEventId,
      sourceOpportunityId: second.sourceOpportunityId,
      targetOpportunityId: second.targetOpportunityId,
    });
    const approvedManifestSha256 =
      buildEmailExactMessageRecoveryManifestHash(expiredManifest);

    const result = await runEmailExactMessageRecovery({
      manifest: expiredManifest,
      provider: deps.provider,
      store: deps.store,
      ingestExactMessage: deps.ingestExactMessage,
      repairReparentedMessage: deps.repairReparentedMessage,
      now: new Date("2026-07-23T18:30:00.001Z"),
      apply: true,
      approvedManifestSha256,
    });

    expect(result.entries.map((entry) => entry.status)).toEqual([
      "already_applied",
      "already_applied",
      "applied",
    ]);
    expect(deps.inspectRecoveryWork).toHaveBeenCalledTimes(3);
    expect(deps.fetchThread).not.toHaveBeenCalled();
    expect(deps.findExactActivity).not.toHaveBeenCalled();
    expect(deps.reparentExactMessage).toHaveBeenCalledTimes(1);
    expect(deps.repairReparentedMessage).toHaveBeenCalledTimes(1);
  });

  it("previews target creation only after proving the exact effective customer event", async () => {
    const approvedManifest = createTargetManifest();
    const deps = dependencies();

    const result = await runEmailExactMessageRecovery({
      manifest: approvedManifest,
      provider: deps.provider,
      store: deps.store,
      ingestExactMessage: deps.ingestExactMessage,
      now: NOW,
    });

    expect(result.entries).toEqual([
      expect.objectContaining({
        action: "create_target_and_reparent",
        status: "ready",
        activityId: IDS.activity,
        opportunityId: null,
      }),
    ]);
    expect(deps.inspectExactMessageForTargetCreation).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceOpportunityId: IDS.source,
        targetEmail: "lead@example.com",
        targetLead: expect.objectContaining({
          sourceThreadKey: `email:gmail:${IDS.connection}:message:message-victoria-forward`,
        }),
      })
    );
    expect(deps.inspectExactMessage).not.toHaveBeenCalled();
    expect(deps.createTargetAndReparentExactMessage).not.toHaveBeenCalled();
  });

  it("rejects target creation when stored effective identity is not a meaningful customer inbound", async () => {
    const deps = dependencies({
      createTargetInspected: {
        ...createTargetInspection(),
        correspondenceEvent: {
          ...createTargetInspection().correspondenceEvent,
          partyRole: "internal",
        },
      },
    });

    await expect(
      runEmailExactMessageRecovery({
        manifest: createTargetManifest(),
        provider: deps.provider,
        store: deps.store,
        ingestExactMessage: deps.ingestExactMessage,
        now: NOW,
      })
    ).rejects.toThrow("exact event is not a meaningful customer inbound");

    expect(deps.createTargetAndReparentExactMessage).not.toHaveBeenCalled();
  });

  it("atomically creates or converges on the target and then runs canonical repair", async () => {
    const approvedManifest = createTargetManifest();
    const approvedEntry = approvedManifest.entries[0];
    if (approvedEntry.action !== "create_target_and_reparent") {
      throw new Error("expected create-target entry");
    }
    const deps = dependencies();
    const approvedManifestSha256 =
      buildEmailExactMessageRecoveryManifestHash(approvedManifest);

    const first = await runEmailExactMessageRecovery({
      manifest: approvedManifest,
      provider: deps.provider,
      store: deps.store,
      ingestExactMessage: deps.ingestExactMessage,
      repairReparentedMessage: deps.repairReparentedMessage,
      now: NOW,
      apply: true,
      approvedManifestSha256,
    });

    expect(first.entries[0]).toMatchObject({
      action: "create_target_and_reparent",
      status: "applied",
      opportunityId: IDS.target,
    });
    expect(deps.createTargetAndReparentExactMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        targetLead: approvedEntry.targetLead,
        manifestSha256: approvedManifestSha256,
        entrySha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      })
    );
    expect(deps.repairReparentedMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        entry: approvedEntry,
        sourceOpportunityId: IDS.source,
        targetOpportunityId: IDS.target,
      })
    );
  });

  it("reports the same target on retry/concurrent source-key convergence without a duplicate move", async () => {
    const approvedManifest = createTargetManifest();
    const existingTarget = {
      id: IDS.target,
      sourceThreadKey: `email:gmail:${IDS.connection}:message:message-victoria-forward`,
      identityEmails: ["lead@example.com"],
    };
    const deps = dependencies({
      createTargetInspected: createTargetInspection(existingTarget),
    });
    deps.createTargetAndReparentExactMessage.mockResolvedValueOnce({
      applied: false,
      alreadyApplied: true,
      pendingAttachmentAttribution: false,
      activityId: IDS.activity,
      correspondenceEventId: IDS.event,
      sourceOpportunityId: IDS.source,
      targetOpportunityId: IDS.target,
    });

    const preview = await runEmailExactMessageRecovery({
      manifest: approvedManifest,
      provider: deps.provider,
      store: deps.store,
      ingestExactMessage: deps.ingestExactMessage,
      now: NOW,
    });
    expect(preview.entries[0]).toMatchObject({
      status: "already_applied",
      opportunityId: IDS.target,
    });

    const applied = await runEmailExactMessageRecovery({
      manifest: approvedManifest,
      provider: deps.provider,
      store: deps.store,
      ingestExactMessage: deps.ingestExactMessage,
      repairReparentedMessage: deps.repairReparentedMessage,
      now: NOW,
      apply: true,
      approvedManifestSha256:
        buildEmailExactMessageRecoveryManifestHash(approvedManifest),
    });
    expect(applied.entries[0]).toMatchObject({
      status: "already_applied",
      opportunityId: IDS.target,
    });
    expect(deps.createTargetAndReparentExactMessage).toHaveBeenCalledTimes(1);
  });

  it("treats a concurrent canonical source-key winner as the ready target while the exact message is still source-owned", async () => {
    const approvedManifest = createTargetManifest();
    const existingTarget = {
      id: IDS.target,
      sourceThreadKey: `email:gmail:${IDS.connection}:message:message-victoria-forward`,
      identityEmails: ["lead@example.com"],
    };
    const concurrentInspection = createTargetInspection(existingTarget);
    concurrentInspection.activity.opportunityId = IDS.source;
    concurrentInspection.correspondenceEvent.opportunityId = IDS.source;
    const deps = dependencies({
      createTargetInspected: concurrentInspection,
    });

    const result = await runEmailExactMessageRecovery({
      manifest: approvedManifest,
      provider: deps.provider,
      store: deps.store,
      ingestExactMessage: deps.ingestExactMessage,
      now: NOW,
    });

    expect(result.entries[0]).toMatchObject({
      status: "ready",
      opportunityId: IDS.target,
    });
  });

  it("requires an exact content-addressed approval before any apply reads", async () => {
    const deps = dependencies();

    await expect(
      runEmailExactMessageRecovery({
        manifest: manifest(),
        provider: deps.provider,
        store: deps.store,
        ingestExactMessage: deps.ingestExactMessage,
        now: NOW,
        apply: true,
        approvedManifestSha256: "0".repeat(64),
      })
    ).rejects.toThrow("approved manifest sha256 does not match");

    expect(deps.fetchThread).not.toHaveBeenCalled();
    expect(deps.inspectExactMessage).not.toHaveBeenCalled();
    expect(deps.reparentExactMessage).not.toHaveBeenCalled();
  });

  it("fails closed when the database snapshot no longer matches the manifest CAS", async () => {
    const reparentEntry = manifest().entries[0];
    if (reparentEntry.action !== "reparent") {
      throw new Error("expected reparent entry");
    }
    const deps = dependencies({
      inspected: inspection({
        ...reparentEntry,
        targetSnapshot: opportunitySnapshot({
          updatedAt: "2026-07-22T17:05:00.000Z",
          stage: "won",
          stageManuallySet: true,
          assignedTo: IDS.actor,
          assignmentVersion: 3,
        }),
      }),
    });

    await expect(
      runEmailExactMessageRecovery({
        manifest: manifest(),
        provider: deps.provider,
        store: deps.store,
        ingestExactMessage: deps.ingestExactMessage,
        now: NOW,
      })
    ).rejects.toThrow("target opportunity snapshot changed");

    expect(deps.reparentExactMessage).not.toHaveBeenCalled();
  });

  it("validates the target email against both the activity and persisted target identity", async () => {
    const deps = dependencies({
      inspected: {
        ...inspection(),
        activity: {
          ...inspection().activity,
          fromEmail: "someone-else@example.com",
        },
      },
    });

    await expect(
      runEmailExactMessageRecovery({
        manifest: manifest(),
        provider: deps.provider,
        store: deps.store,
        ingestExactMessage: deps.ingestExactMessage,
        now: NOW,
      })
    ).rejects.toThrow("target email is not an exact activity participant");
  });

  it("rejects reparenting when the exact event is not a meaningful customer inbound", async () => {
    const deps = dependencies({
      inspected: {
        ...inspection(),
        correspondenceEvent: {
          ...inspection().correspondenceEvent,
          isMeaningful: false,
        },
      },
    });

    await expect(
      runEmailExactMessageRecovery({
        manifest: manifest(),
        provider: deps.provider,
        store: deps.store,
        ingestExactMessage: deps.ingestExactMessage,
        now: NOW,
      })
    ).rejects.toThrow("exact event is not a meaningful customer inbound");

    expect(deps.reparentExactMessage).not.toHaveBeenCalled();
  });

  it("applies only after every allowlisted message and CAS snapshot is validated", async () => {
    const approvedManifest = manifest();
    const manifestSha256 =
      buildEmailExactMessageRecoveryManifestHash(approvedManifest);
    const deps = dependencies();

    const result = await runEmailExactMessageRecovery({
      manifest: approvedManifest,
      provider: deps.provider,
      store: deps.store,
      ingestExactMessage: deps.ingestExactMessage,
      repairReparentedMessage: deps.repairReparentedMessage,
      now: NOW,
      apply: true,
      approvedManifestSha256: manifestSha256,
    });

    expect(result.mode).toBe("apply");
    expect(result.manifestSha256).toBe(manifestSha256);
    expect(result.entries[0].status).toBe("applied");
    expect(deps.reparentExactMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: IDS.company,
        actorUserId: IDS.actor,
        connectionId: IDS.connection,
        providerThreadId: "thread-victoria-forward",
        providerMessageId: "message-victoria-forward",
        manifestSha256,
        entrySha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      })
    );
    expect(deps.repairReparentedMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: IDS.company,
        actorUserId: IDS.actor,
        connectionId: IDS.connection,
        message: expect.objectContaining({
          id: "message-victoria-forward",
          threadId: "thread-victoria-forward",
        }),
        sourceOpportunityId: IDS.source,
        targetOpportunityId: IDS.target,
      })
    );
    expect(deps.reparentExactMessage.mock.invocationCallOrder[0]).toBeLessThan(
      deps.repairReparentedMessage.mock.invocationCallOrder[0]
    );
  });

  it("prevalidates shared-source entries before sequential guarded moves", async () => {
    const first = manifest().entries[0];
    if (first.action !== "reparent") throw new Error("expected reparent entry");
    const second = {
      ...first,
      providerMessageId: "message-two",
      providerOccurredAt: "2026-07-22T16:05:00.000Z",
      targetOpportunityId: IDS.secondTarget,
      activityId: IDS.secondActivity,
      correspondenceEventId: IDS.secondEvent,
      targetEmail: "second@example.com",
      targetSnapshot: opportunitySnapshot({
        updatedAt: "2026-07-22T17:06:00.000Z",
      }),
    };
    const approvedManifest = manifest({ entries: [first, second] });
    const deps = dependencies({
      messages: [
        providerMessage(),
        providerMessage({
          id: second.providerMessageId,
          date: new Date(second.providerOccurredAt),
        }),
      ],
    });
    deps.inspectExactMessage
      .mockResolvedValueOnce(inspection(first))
      .mockResolvedValueOnce(inspection(second));

    const result = await runEmailExactMessageRecovery({
      manifest: approvedManifest,
      provider: deps.provider,
      store: deps.store,
      ingestExactMessage: deps.ingestExactMessage,
      repairReparentedMessage: deps.repairReparentedMessage,
      now: NOW,
      apply: true,
      approvedManifestSha256:
        buildEmailExactMessageRecoveryManifestHash(approvedManifest),
    });

    expect(result.entries.map((entry) => entry.status)).toEqual([
      "applied",
      "applied",
    ]);
    expect(deps.inspectExactMessage).toHaveBeenCalledTimes(2);
    expect(deps.reparentExactMessage).toHaveBeenCalledTimes(2);
    expect(deps.inspectExactMessage.mock.invocationCallOrder[1]).toBeLessThan(
      deps.reparentExactMessage.mock.invocationCallOrder[0]
    );
    expect(deps.reparentExactMessage.mock.calls[1]?.[0]).toMatchObject({
      sourceSnapshot: first.sourceSnapshot,
      targetOpportunityId: IDS.secondTarget,
    });
    expect(deps.reparentExactMessage.mock.invocationCallOrder[1]).toBeLessThan(
      deps.repairReparentedMessage.mock.invocationCallOrder[0]
    );
  });

  it("retries completed shared-source moves after post-move repair is interrupted", async () => {
    const first = manifest().entries[0];
    if (first.action !== "reparent") throw new Error("expected reparent entry");
    const second = {
      ...first,
      providerMessageId: "message-two",
      providerOccurredAt: "2026-07-22T16:05:00.000Z",
      targetOpportunityId: IDS.secondTarget,
      activityId: IDS.secondActivity,
      correspondenceEventId: IDS.secondEvent,
      targetEmail: "second@example.com",
      targetSnapshot: opportunitySnapshot({
        updatedAt: "2026-07-22T17:06:00.000Z",
      }),
    };
    const approvedManifest = manifest({ entries: [first, second] });
    const firstAlreadyApplied = inspection(first);
    firstAlreadyApplied.activity.opportunityId = first.targetOpportunityId;
    firstAlreadyApplied.correspondenceEvent.opportunityId =
      first.targetOpportunityId;
    firstAlreadyApplied.sourceSnapshot = opportunitySnapshot({
      updatedAt: "2026-07-22T17:30:00.000Z",
    });
    const secondAlreadyApplied = inspection(second);
    secondAlreadyApplied.activity.opportunityId = second.targetOpportunityId;
    secondAlreadyApplied.correspondenceEvent.opportunityId =
      second.targetOpportunityId;
    secondAlreadyApplied.sourceSnapshot = opportunitySnapshot({
      updatedAt: "2026-07-22T17:30:00.000Z",
    });
    const deps = dependencies({
      messages: [
        providerMessage(),
        providerMessage({
          id: second.providerMessageId,
          date: new Date(second.providerOccurredAt),
        }),
      ],
    });
    deps.inspectExactMessage
      .mockResolvedValueOnce(inspection(first))
      .mockResolvedValueOnce(inspection(second))
      .mockResolvedValueOnce(firstAlreadyApplied)
      .mockResolvedValueOnce(secondAlreadyApplied);
    deps.reparentExactMessage
      .mockResolvedValueOnce({
        applied: true,
        alreadyApplied: false,
        pendingAttachmentAttribution: false,
        activityId: first.activityId,
        correspondenceEventId: first.correspondenceEventId,
        sourceOpportunityId: first.sourceOpportunityId,
        targetOpportunityId: first.targetOpportunityId,
      })
      .mockResolvedValueOnce({
        applied: true,
        alreadyApplied: false,
        pendingAttachmentAttribution: false,
        activityId: second.activityId,
        correspondenceEventId: second.correspondenceEventId,
        sourceOpportunityId: second.sourceOpportunityId,
        targetOpportunityId: second.targetOpportunityId,
      })
      .mockResolvedValueOnce({
        applied: false,
        alreadyApplied: true,
        pendingAttachmentAttribution: false,
        activityId: first.activityId,
        correspondenceEventId: first.correspondenceEventId,
        sourceOpportunityId: first.sourceOpportunityId,
        targetOpportunityId: first.targetOpportunityId,
      })
      .mockResolvedValueOnce({
        applied: false,
        alreadyApplied: true,
        pendingAttachmentAttribution: false,
        activityId: second.activityId,
        correspondenceEventId: second.correspondenceEventId,
        sourceOpportunityId: second.sourceOpportunityId,
        targetOpportunityId: second.targetOpportunityId,
      });
    deps.repairReparentedMessage.mockRejectedValueOnce(
      new Error("repair interrupted")
    );
    const approvedManifestSha256 =
      buildEmailExactMessageRecoveryManifestHash(approvedManifest);

    await expect(
      runEmailExactMessageRecovery({
        manifest: approvedManifest,
        provider: deps.provider,
        store: deps.store,
        ingestExactMessage: deps.ingestExactMessage,
        repairReparentedMessage: deps.repairReparentedMessage,
        now: NOW,
        apply: true,
        approvedManifestSha256,
      })
    ).rejects.toThrow("repair interrupted");

    expect(deps.reparentExactMessage).toHaveBeenCalledTimes(2);
    expect(deps.repairReparentedMessage).toHaveBeenCalledTimes(2);
    expect(deps.repairReparentedMessage.mock.calls[1]?.[0]).toMatchObject({
      activityId: second.activityId,
      targetOpportunityId: second.targetOpportunityId,
    });

    const retry = await runEmailExactMessageRecovery({
      manifest: approvedManifest,
      provider: deps.provider,
      store: deps.store,
      ingestExactMessage: deps.ingestExactMessage,
      repairReparentedMessage: deps.repairReparentedMessage,
      now: NOW,
      apply: true,
      approvedManifestSha256,
    });

    expect(retry.entries.map((entry) => entry.status)).toEqual([
      "already_applied",
      "already_applied",
    ]);
    expect(deps.reparentExactMessage).toHaveBeenCalledTimes(2);
    expect(deps.repairReparentedMessage).toHaveBeenCalledTimes(3);
    expect(deps.repairReparentedMessage.mock.calls[2]?.[0]).toMatchObject({
      activityId: first.activityId,
      targetOpportunityId: first.targetOpportunityId,
    });
  });

  it("reports an idempotent RPC retry without treating it as a second move", async () => {
    const approvedManifest = manifest();
    const deps = dependencies();
    deps.reparentExactMessage.mockResolvedValueOnce({
      applied: false,
      alreadyApplied: true,
      pendingAttachmentAttribution: false,
      activityId: IDS.activity,
      correspondenceEventId: IDS.event,
      sourceOpportunityId: IDS.source,
      targetOpportunityId: IDS.target,
    });

    const result = await runEmailExactMessageRecovery({
      manifest: approvedManifest,
      provider: deps.provider,
      store: deps.store,
      ingestExactMessage: deps.ingestExactMessage,
      repairReparentedMessage: deps.repairReparentedMessage,
      now: NOW,
      apply: true,
      approvedManifestSha256:
        buildEmailExactMessageRecoveryManifestHash(approvedManifest),
    });

    expect(result.entries[0].status).toBe("already_applied");
    expect(deps.reparentExactMessage).toHaveBeenCalledTimes(1);
    expect(deps.repairReparentedMessage).toHaveBeenCalledTimes(1);
  });

  it("reports pending attachment attribution and does not repair summaries or outcomes early", async () => {
    const reparentEntry = manifest().entries[0];
    const approvedManifest = manifest({
      entries: [
        {
          ...reparentEntry,
          unansweredDraftProjection: {
            workstream: "sales",
            responseDisposition: "reply_required",
            conversationScope: "message",
          },
        },
      ],
    });
    const deps = dependencies();
    deps.reparentExactMessage.mockResolvedValueOnce({
      applied: false,
      alreadyApplied: false,
      pendingAttachmentAttribution: true,
      activityId: IDS.activity,
      correspondenceEventId: IDS.event,
      sourceOpportunityId: IDS.source,
      targetOpportunityId: IDS.target,
    });

    const result = await runEmailExactMessageRecovery({
      manifest: approvedManifest,
      provider: deps.provider,
      store: deps.store,
      ingestExactMessage: deps.ingestExactMessage,
      repairReparentedMessage: deps.repairReparentedMessage,
      projectUnansweredDraft: deps.projectUnansweredDraft,
      now: NOW,
      apply: true,
      approvedManifestSha256:
        buildEmailExactMessageRecoveryManifestHash(approvedManifest),
    });

    expect(result.entries[0].status).toBe("pending_attachment_attribution");
    expect(deps.repairReparentedMessage).not.toHaveBeenCalled();
    expect(deps.projectUnansweredDraft).not.toHaveBeenCalled();
  });

  it("projects an approved message-scoped draft candidate only after completed reparent repair", async () => {
    const approvedManifest = manifest({
      entries: [
        {
          ...manifest().entries[0],
          unansweredDraftProjection: {
            workstream: "sales",
            responseDisposition: "reply_required",
            conversationScope: "message",
          },
        },
      ],
    });
    const deps = dependencies();

    await runEmailExactMessageRecovery({
      manifest: approvedManifest,
      provider: deps.provider,
      store: deps.store,
      ingestExactMessage: deps.ingestExactMessage,
      repairReparentedMessage: deps.repairReparentedMessage,
      projectUnansweredDraft: deps.projectUnansweredDraft,
      now: NOW,
      apply: true,
      approvedManifestSha256:
        buildEmailExactMessageRecoveryManifestHash(approvedManifest),
    });

    expect(deps.projectUnansweredDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        opportunityId: IDS.target,
        activityId: IDS.activity,
        correspondenceEventId: IDS.event,
        message: expect.objectContaining({ id: "message-victoria-forward" }),
        projection: approvedManifest.entries[0].unansweredDraftProjection,
      })
    );
    expect(
      deps.repairReparentedMessage.mock.invocationCallOrder[0]
    ).toBeLessThan(deps.projectUnansweredDraft.mock.invocationCallOrder[0]);
  });

  it("fails the apply result when canonical post-move repair does not complete", async () => {
    const approvedManifest = manifest();
    const deps = dependencies();
    deps.repairReparentedMessage.mockRejectedValueOnce(
      new Error("target outcome repair failed")
    );

    await expect(
      runEmailExactMessageRecovery({
        manifest: approvedManifest,
        provider: deps.provider,
        store: deps.store,
        ingestExactMessage: deps.ingestExactMessage,
        repairReparentedMessage: deps.repairReparentedMessage,
        now: NOW,
        apply: true,
        approvedManifestSha256:
          buildEmailExactMessageRecoveryManifestHash(approvedManifest),
      })
    ).rejects.toThrow("target outcome repair failed");

    expect(deps.reparentExactMessage).toHaveBeenCalledTimes(1);
    expect(deps.repairReparentedMessage).toHaveBeenCalledTimes(1);
  });

  it("previews a provider-only ingest without invoking the canonical ingestion adapter", async () => {
    const ingestManifest = manifest({
      entries: [
        {
          action: "ingest",
          providerThreadId: "thread-victoria-forward",
          providerMessageId: "message-victoria-forward",
          providerOccurredAt: "2026-07-22T16:00:00.000Z",
        },
      ],
    });
    const deps = dependencies();

    const result = await runEmailExactMessageRecovery({
      manifest: ingestManifest,
      provider: deps.provider,
      store: deps.store,
      ingestExactMessage: deps.ingestExactMessage,
      now: NOW,
    });

    expect(result.entries).toEqual([
      expect.objectContaining({ action: "ingest", status: "ready" }),
    ]);
    expect(deps.findExactActivity).toHaveBeenCalledWith({
      companyId: IDS.company,
      connectionId: IDS.connection,
      providerThreadId: "thread-victoria-forward",
      providerMessageId: "message-victoria-forward",
    });
    expect(deps.inspectExactMessage).not.toHaveBeenCalled();
    expect(deps.ingestExactMessage).not.toHaveBeenCalled();
    expect(deps.reparentExactMessage).not.toHaveBeenCalled();
  });

  it("previews an exact orphan activity as ready instead of already applied", async () => {
    const ingestManifest = manifest({
      entries: [
        {
          action: "ingest",
          providerThreadId: "thread-victoria-forward",
          providerMessageId: "message-victoria-forward",
          providerOccurredAt: "2026-07-22T16:00:00.000Z",
        },
      ],
    });
    const deps = dependencies();
    deps.findExactActivity.mockResolvedValueOnce({
      activityId: IDS.activity,
      opportunityId: null,
    });

    const result = await runEmailExactMessageRecovery({
      manifest: ingestManifest,
      provider: deps.provider,
      store: deps.store,
      ingestExactMessage: deps.ingestExactMessage,
      now: NOW,
    });

    expect(result.entries[0]).toMatchObject({
      action: "ingest",
      status: "ready",
      activityId: IDS.activity,
      opportunityId: null,
    });
    expect(deps.ingestExactMessage).not.toHaveBeenCalled();
  });

  it("passes the already-fetched provider message to the injected canonical ingestion adapter", async () => {
    const ingestManifest = manifest({
      entries: [
        {
          action: "ingest",
          providerThreadId: "thread-victoria-forward",
          providerMessageId: "message-victoria-forward",
          providerOccurredAt: "2026-07-22T16:00:00.000Z",
        },
      ],
    });
    const deps = dependencies();
    const approvedManifestSha256 =
      buildEmailExactMessageRecoveryManifestHash(ingestManifest);

    const result = await runEmailExactMessageRecovery({
      manifest: ingestManifest,
      provider: deps.provider,
      store: deps.store,
      ingestExactMessage: deps.ingestExactMessage,
      now: NOW,
      apply: true,
      approvedManifestSha256,
    });

    expect(result.entries[0]).toMatchObject({
      action: "ingest",
      status: "applied",
    });
    expect(deps.ingestExactMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: IDS.company,
        actorUserId: IDS.actor,
        connectionId: IDS.connection,
        entry: ingestManifest.entries[0],
        message: expect.objectContaining({
          id: "message-victoria-forward",
          threadId: "thread-victoria-forward",
        }),
        manifestSha256: approvedManifestSha256,
        entrySha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      })
    );
    expect(deps.reparentExactMessage).not.toHaveBeenCalled();
  });

  it("ingests only the exact allowlisted forwarded message without assuming thread ownership", async () => {
    const ingestManifest = manifest({
      entries: [
        {
          action: "ingest",
          providerThreadId: "thread-victoria-forward",
          providerMessageId: "message-victoria-forward",
          providerOccurredAt: "2026-07-22T16:00:00.000Z",
        },
      ],
    });
    const unrelated = providerMessage({
      id: "message-unrelated-in-shared-forward-thread",
      date: new Date("2026-07-22T16:05:00.000Z"),
    });
    const deps = dependencies({
      messages: [unrelated, providerMessage()],
    });

    await runEmailExactMessageRecovery({
      manifest: ingestManifest,
      provider: deps.provider,
      store: deps.store,
      ingestExactMessage: deps.ingestExactMessage,
      now: NOW,
      apply: true,
      approvedManifestSha256:
        buildEmailExactMessageRecoveryManifestHash(ingestManifest),
    });

    expect(deps.ingestExactMessage).toHaveBeenCalledTimes(1);
    expect(deps.ingestExactMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.objectContaining({ id: "message-victoria-forward" }),
      })
    );
  });

  it("projects an explicitly approved ingest only after canonical persistence", async () => {
    const ingestManifest = manifest({
      entries: [
        {
          action: "ingest",
          providerThreadId: "thread-victoria-forward",
          providerMessageId: "message-victoria-forward",
          providerOccurredAt: "2026-07-22T16:00:00.000Z",
          unansweredDraftProjection: {
            workstream: "sales",
            responseDisposition: "reply_required",
            conversationScope: "message",
          },
        },
      ],
    });
    const deps = dependencies();

    await runEmailExactMessageRecovery({
      manifest: ingestManifest,
      provider: deps.provider,
      store: deps.store,
      ingestExactMessage: deps.ingestExactMessage,
      projectUnansweredDraft: deps.projectUnansweredDraft,
      now: NOW,
      apply: true,
      approvedManifestSha256:
        buildEmailExactMessageRecoveryManifestHash(ingestManifest),
    });

    expect(deps.projectUnansweredDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        opportunityId: "10000000-0000-4000-8000-000000000011",
        activityId: "10000000-0000-4000-8000-000000000010",
        correspondenceEventId: null,
        projection: ingestManifest.entries[0].unansweredDraftProjection,
      })
    );
    expect(deps.ingestExactMessage.mock.invocationCallOrder[0]).toBeLessThan(
      deps.projectUnansweredDraft.mock.invocationCallOrder[0]
    );
  });

  it("requires the approved projection adapter before any apply reads", async () => {
    const ingestManifest = manifest({
      entries: [
        {
          action: "ingest",
          providerThreadId: "thread-victoria-forward",
          providerMessageId: "message-victoria-forward",
          providerOccurredAt: "2026-07-22T16:00:00.000Z",
          unansweredDraftProjection: {
            workstream: "sales",
            responseDisposition: "reply_required",
            conversationScope: "message",
          },
        },
      ],
    });
    const deps = dependencies();

    await expect(
      runEmailExactMessageRecovery({
        manifest: ingestManifest,
        provider: deps.provider,
        store: deps.store,
        ingestExactMessage: deps.ingestExactMessage,
        now: NOW,
        apply: true,
        approvedManifestSha256:
          buildEmailExactMessageRecoveryManifestHash(ingestManifest),
      })
    ).rejects.toThrow("approved unanswered-draft projection adapter");

    expect(deps.fetchThread).not.toHaveBeenCalled();
    expect(deps.ingestExactMessage).not.toHaveBeenCalled();
  });

  it("replays canonical ingestion when an exact activity exists so partial persistence can repair", async () => {
    const ingestManifest = manifest({
      entries: [
        {
          action: "ingest",
          providerThreadId: "thread-victoria-forward",
          providerMessageId: "message-victoria-forward",
          providerOccurredAt: "2026-07-22T16:00:00.000Z",
        },
      ],
    });
    const deps = dependencies();
    deps.findExactActivity.mockResolvedValueOnce({
      activityId: "10000000-0000-4000-8000-000000000010",
      opportunityId: "10000000-0000-4000-8000-000000000011",
    });
    deps.ingestExactMessage.mockResolvedValueOnce({
      applied: false,
      alreadyApplied: true,
      activityId: "10000000-0000-4000-8000-000000000010",
      opportunityId: "10000000-0000-4000-8000-000000000011",
    });

    const result = await runEmailExactMessageRecovery({
      manifest: ingestManifest,
      provider: deps.provider,
      store: deps.store,
      ingestExactMessage: deps.ingestExactMessage,
      now: NOW,
      apply: true,
      approvedManifestSha256:
        buildEmailExactMessageRecoveryManifestHash(ingestManifest),
    });

    expect(result.entries[0]).toMatchObject({
      action: "ingest",
      status: "already_applied",
    });
    expect(deps.ingestExactMessage).toHaveBeenCalledTimes(1);
    expect(deps.reparentExactMessage).not.toHaveBeenCalled();
  });

  it("reports an exact orphan linked by canonical replay as newly applied", async () => {
    const ingestManifest = manifest({
      entries: [
        {
          action: "ingest",
          providerThreadId: "thread-victoria-forward",
          providerMessageId: "message-victoria-forward",
          providerOccurredAt: "2026-07-22T16:00:00.000Z",
        },
      ],
    });
    const deps = dependencies();
    deps.findExactActivity.mockResolvedValueOnce({
      activityId: IDS.activity,
      opportunityId: null,
    });
    deps.ingestExactMessage.mockResolvedValueOnce({
      applied: false,
      alreadyApplied: true,
      activityId: IDS.activity,
      opportunityId: IDS.target,
    });

    const result = await runEmailExactMessageRecovery({
      manifest: ingestManifest,
      provider: deps.provider,
      store: deps.store,
      ingestExactMessage: deps.ingestExactMessage,
      now: NOW,
      apply: true,
      approvedManifestSha256:
        buildEmailExactMessageRecoveryManifestHash(ingestManifest),
    });

    expect(result.entries[0]).toMatchObject({
      action: "ingest",
      status: "applied",
      activityId: IDS.activity,
      opportunityId: IDS.target,
    });
    expect(deps.ingestExactMessage).toHaveBeenCalledTimes(1);
  });
});

function recoveryStoreSupabase(
  tables: Record<string, Array<Record<string, unknown>>>
) {
  class Query {
    private readonly filters: Array<
      | { kind: "eq" | "is"; column: string; value: unknown }
      | { kind: "in"; column: string; value: unknown[] }
    > = [];

    constructor(private readonly table: string) {}

    select() {
      return this;
    }

    eq(column: string, value: unknown) {
      this.filters.push({ kind: "eq", column, value });
      return this;
    }

    is(column: string, value: unknown) {
      this.filters.push({ kind: "is", column, value });
      return this;
    }

    in(column: string, value: unknown[]) {
      this.filters.push({ kind: "in", column, value });
      return this;
    }

    limit(count: number) {
      const result = this.result();
      return Promise.resolve({ ...result, data: result.data.slice(0, count) });
    }

    then<TResult1 = unknown, TResult2 = never>(
      onfulfilled?:
        | ((value: unknown) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?:
        | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
        | null
    ) {
      return Promise.resolve(this.result()).then(onfulfilled, onrejected);
    }

    private result() {
      const data = (tables[this.table] ?? []).filter((row) =>
        this.filters.every((filter) => {
          if (filter.kind === "in") {
            return filter.value.includes(row[filter.column]);
          }
          return row[filter.column] === filter.value;
        })
      );
      return { data, error: null };
    }
  }

  return {
    from(table: string) {
      return new Query(table);
    },
  };
}

describe("SupabaseEmailExactMessageRecoveryStore legacy mailbox proof", () => {
  const legacyActivity = {
    id: IDS.activity,
    company_id: IDS.company,
    opportunity_id: IDS.source,
    email_connection_id: null,
    email_thread_id: "thread-victoria-forward",
    email_message_id: "message-victoria-forward",
    type: "email",
    from_email: "lead@example.com",
    to_emails: ["ops@example.com"],
    cc_emails: [],
  };
  const exactEvent = {
    id: IDS.event,
    company_id: IDS.company,
    opportunity_id: IDS.source,
    activity_id: IDS.activity,
    connection_id: IDS.connection,
    provider_thread_id: "thread-victoria-forward",
    provider_message_id: "message-victoria-forward",
    opportunity_projection_applied: true,
  };

  it("finds a correct-owner legacy activity only through the exact mailbox correspondence event", async () => {
    const store = new SupabaseEmailExactMessageRecoveryStore(
      recoveryStoreSupabase({
        activities: [legacyActivity],
        opportunity_correspondence_events: [exactEvent],
      }) as never
    );

    await expect(
      store.findExactActivity({
        companyId: IDS.company,
        connectionId: IDS.connection,
        providerThreadId: "thread-victoria-forward",
        providerMessageId: "message-victoria-forward",
      })
    ).resolves.toEqual({
      activityId: IDS.activity,
      opportunityId: IDS.source,
    });
  });

  it("does not accept a NULL-connection activity without exact event proof for the requested mailbox", async () => {
    const store = new SupabaseEmailExactMessageRecoveryStore(
      recoveryStoreSupabase({
        activities: [legacyActivity],
        opportunity_correspondence_events: [
          { ...exactEvent, connection_id: IDS.secondTarget },
        ],
      }) as never
    );

    await expect(
      store.findExactActivity({
        companyId: IDS.company,
        connectionId: IDS.connection,
        providerThreadId: "thread-victoria-forward",
        providerMessageId: "message-victoria-forward",
      })
    ).resolves.toBeNull();
  });

  it("inspects a wrong-owner legacy activity when the exact event proves the mailbox and message", async () => {
    const source = {
      id: IDS.source,
      company_id: IDS.company,
      updated_at: "2026-07-22T17:00:00.123456+00:00",
      stage: "new_lead",
      stage_manually_set: false,
      assigned_to: null,
      assignment_version: 0,
      project_id: null,
      project_ref: null,
      client_id: null,
      client_ref: null,
      contact_email: "wrong@example.com",
      deleted_at: null,
    };
    const target = {
      ...source,
      id: IDS.target,
      updated_at: "2026-07-22T17:05:00.987654+00:00",
      assigned_to: IDS.actor,
      assignment_version: 3,
      contact_email: "lead@example.com",
    };
    const store = new SupabaseEmailExactMessageRecoveryStore(
      recoveryStoreSupabase({
        activities: [legacyActivity],
        opportunity_correspondence_events: [exactEvent],
        opportunities: [source, target],
      }) as never
    );
    const reparentEntry = manifest().entries[0];
    if (reparentEntry.action !== "reparent") {
      throw new Error("expected reparent entry");
    }

    await expect(
      store.inspectExactMessage({
        companyId: IDS.company,
        actorUserId: IDS.actor,
        connectionId: IDS.connection,
        providerThreadId: reparentEntry.providerThreadId,
        providerMessageId: reparentEntry.providerMessageId,
        sourceOpportunityId: IDS.source,
        targetOpportunityId: IDS.target,
        activityId: IDS.activity,
        correspondenceEventId: IDS.event,
        targetEmail: "lead@example.com",
        sourceSnapshot: reparentEntry.sourceSnapshot,
        targetSnapshot: reparentEntry.targetSnapshot,
        manifestSha256: "a".repeat(64),
        entrySha256: "b".repeat(64),
      })
    ).resolves.toMatchObject({
      activity: {
        id: IDS.activity,
        opportunityId: IDS.source,
      },
      correspondenceEvent: {
        id: IDS.event,
        opportunityId: IDS.source,
      },
      sourceSnapshot: {
        updatedAt: "2026-07-22T17:00:00.123456+00:00",
      },
      targetSnapshot: {
        updatedAt: "2026-07-22T17:05:00.987654+00:00",
      },
    });
  });
});

describe("SupabaseEmailExactMessageRecoveryStore durable ledger RPCs", () => {
  it("passes both reviewed hashes and the replacement actor to guarded supersession", async () => {
    const rpc = vi.fn(async () => ({ data: true, error: null }));
    const store = new SupabaseEmailExactMessageRecoveryStore({ rpc } as never);

    await expect(
      store.abandonRecoveryWork({
        actorUserId: IDS.actor,
        companyId: IDS.company,
        connectionId: IDS.connection,
        providerThreadId: "thread-victoria-forward",
        providerMessageId: "message-victoria-forward",
        priorManifestSha256: "a".repeat(64),
        priorEntrySha256: "b".repeat(64),
        supersedingManifestSha256: "c".repeat(64),
        supersedingEntrySha256: "d".repeat(64),
      })
    ).resolves.toBe(true);

    expect(rpc).toHaveBeenCalledWith(
      "abandon_exact_message_recovery_work_as_system",
      {
        p_actor_user_id: IDS.actor,
        p_company_id: IDS.company,
        p_connection_id: IDS.connection,
        p_provider_thread_id: "thread-victoria-forward",
        p_provider_message_id: "message-victoria-forward",
        p_manifest_sha256: "a".repeat(64),
        p_entry_sha256: "b".repeat(64),
        p_superseding_manifest_sha256: "c".repeat(64),
        p_superseding_entry_sha256: "d".repeat(64),
      }
    );
  });
});
