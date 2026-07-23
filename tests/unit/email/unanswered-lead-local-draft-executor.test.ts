import { describe, expect, it, vi } from "vitest";

import {
  buildUnansweredLeadDraftManifestHash,
  runApprovedUnansweredLeadLocalDraftBackfill,
  validateApprovedUnansweredLeadDraftManifest,
  type ApprovedUnansweredLeadDraftManifest,
} from "@/lib/api/services/unanswered-lead-local-draft-executor";
import {
  previousSevenVancouverCalendarDays,
  type UnansweredLeadDraftBackfillDependencies,
  type UnansweredLeadOpportunitySnapshot,
} from "@/lib/api/services/unanswered-lead-local-draft-backfill-service";

const COMPANY_ID = "10000000-0000-4000-8000-000000000001";
const ACTOR_USER_ID = "10000000-0000-4000-8000-000000000002";
const OPPORTUNITY_ID = "10000000-0000-4000-8000-000000000003";
const SOURCE_EVENT_ID = "10000000-0000-4000-8000-000000000004";
const SOURCE_ACTIVITY_ID = "10000000-0000-4000-8000-000000000005";
const CONNECTION_ID = "10000000-0000-4000-8000-000000000006";
const ASSIGNED_TO = "10000000-0000-4000-8000-000000000007";
const NOW = new Date("2026-07-22T17:30:00.000Z");

function snapshot(
  overrides: Partial<UnansweredLeadOpportunitySnapshot> = {}
): UnansweredLeadOpportunitySnapshot {
  return {
    id: OPPORTUNITY_ID,
    label: "Lauri Humeniuk",
    companyId: COMPANY_ID,
    stage: "new_lead",
    stageManuallySet: false,
    assignmentVersion: 7,
    assignedTo: ASSIGNED_TO,
    archivedAt: null,
    deletedAt: null,
    mergedIntoOpportunityId: null,
    projectId: null,
    projectRef: null,
    workstream: "sales",
    contactName: "Lauri Humeniuk",
    contactEmail: "lauri@example.com",
    events: [
      {
        id: SOURCE_EVENT_ID,
        activityId: SOURCE_ACTIVITY_ID,
        opportunityId: OPPORTUNITY_ID,
        connectionId: CONNECTION_ID,
        providerThreadId: "provider-thread-lauri",
        providerMessageId: "provider-message-lauri",
        direction: "inbound",
        partyRole: "customer",
        fromEmail: "lauri@example.com",
        toEmails: ["jackson@ops.example"],
        ccEmails: [],
        isMeaningful: true,
        noiseReason: null,
        responseDisposition: "reply_required",
        conversationScope: "message",
        occurredAt: "2026-07-22T16:00:00.000Z",
        untrustedSubject: "Customer-controlled subject",
        untrustedBodyText: "Customer-controlled body",
      },
    ],
    ...overrides,
  };
}

function manifest(): ApprovedUnansweredLeadDraftManifest {
  const lead = snapshot();
  const event = lead.events[0]!;
  const window = previousSevenVancouverCalendarDays(NOW);
  return {
    schemaVersion: 1,
    companyId: COMPANY_ID,
    actorUserId: ACTOR_USER_ID,
    generatedAt: NOW.toISOString(),
    cutoffAt: window.startInclusive.toISOString(),
    entries: [
      {
        opportunityId: lead.id,
        label: lead.label,
        recipientName: lead.contactName,
        recipientEmail: lead.contactEmail!,
        sourceEventId: event.id,
        sourceActivityId: event.activityId!,
        sourceConnectionId: event.connectionId!,
        sourceProviderThreadId: event.providerThreadId!,
        sourceProviderMessageId: event.providerMessageId!,
        sourceOccurredAt: event.occurredAt,
        providerThreadId: null,
        expectedStage: lead.stage,
        expectedStageManuallySet: lead.stageManuallySet,
        expectedAssignmentVersion: lead.assignmentVersion,
        expectedAssignedTo: lead.assignedTo,
        expectedWorkstream: "sales",
      },
    ],
  };
}

function dependencies(
  currentSnapshot: UnansweredLeadOpportunitySnapshot = snapshot()
): UnansweredLeadDraftBackfillDependencies {
  return {
    loadOpportunitySnapshots: vi.fn(async () => [currentSnapshot]),
    loadCurrentOpportunitySnapshot: vi.fn(async () => currentSnapshot),
    authorizeCurrentAccess: vi.fn(async () => ({
      inboxAllowed: true,
      pipelineAllowed: true,
    })),
    claimLocalGeneration: vi.fn(async () => ({
      acquired: true,
      claimToken: "claim-token",
      reason: "acquired" as const,
    })),
    releaseLocalGeneration: vi.fn(async () => undefined),
    loadUntrustedConversation: vi.fn(async () => ({
      sourceEventId: SOURCE_EVENT_ID,
      messages: [
        {
          direction: "inbound" as const,
          occurredAt: "2026-07-22T16:00:00.000Z",
          untrustedSubject: "Customer-controlled subject",
          untrustedBodyText: "Customer-controlled body",
        },
      ],
    })),
    generateLocalCopy: vi.fn(async () => ({
      subject: "Re: Your railing inquiry",
      body: "Hi Lauri,\n\nThanks for reaching out.",
      aiDraftHistoryId: "10000000-0000-4000-8000-000000000008",
    })),
    persistLocalSystemHandoff: vi.fn(async () => "created" as const),
  };
}

describe("approval-gated unanswered-lead local-draft executor", () => {
  it("runs a live recheck dry-run by default without claiming, generating, or persisting", async () => {
    const approved = manifest();
    const deps = dependencies();

    const result = await runApprovedUnansweredLeadLocalDraftBackfill({
      manifest: approved,
      dependencies: deps,
      now: NOW,
    });

    expect(result).toMatchObject({
      mode: "dry-run",
      manifestSha256: buildUnansweredLeadDraftManifestHash(approved),
      entries: [
        {
          opportunityId: OPPORTUNITY_ID,
          sourceEventId: SOURCE_EVENT_ID,
          status: "ready",
        },
      ],
    });
    expect(deps.loadOpportunitySnapshots).toHaveBeenCalled();
    expect(deps.authorizeCurrentAccess).toHaveBeenCalled();
    expect(deps.claimLocalGeneration).not.toHaveBeenCalled();
    expect(deps.generateLocalCopy).not.toHaveBeenCalled();
    expect(deps.persistLocalSystemHandoff).not.toHaveBeenCalled();
  });

  it("refuses apply before live reads unless the exact canonical manifest hash is approved", async () => {
    const approved = manifest();
    const deps = dependencies();

    await expect(
      runApprovedUnansweredLeadLocalDraftBackfill({
        manifest: approved,
        dependencies: deps,
        apply: true,
        approvedManifestSha256: "a".repeat(64),
        now: NOW,
      })
    ).rejects.toThrow("approved manifest sha256 does not match");

    expect(deps.loadOpportunitySnapshots).not.toHaveBeenCalled();
    expect(deps.persistLocalSystemHandoff).not.toHaveBeenCalled();
  });

  it("applies only an exact still-current and still-authorized manifest entry", async () => {
    const approved = manifest();
    const deps = dependencies();

    const result = await runApprovedUnansweredLeadLocalDraftBackfill({
      manifest: approved,
      dependencies: deps,
      apply: true,
      approvedManifestSha256: buildUnansweredLeadDraftManifestHash(approved),
      now: NOW,
    });

    expect(result).toMatchObject({
      mode: "apply",
      entries: [
        {
          opportunityId: OPPORTUNITY_ID,
          sourceEventId: SOURCE_EVENT_ID,
          status: "created",
        },
      ],
    });
    expect(deps.persistLocalSystemHandoff).toHaveBeenCalledTimes(1);
    expect(deps.persistLocalSystemHandoff).toHaveBeenCalledWith(
      expect.objectContaining({
        opportunityId: OPPORTUNITY_ID,
        sourceEventId: SOURCE_EVENT_ID,
        sourceActivityId: SOURCE_ACTIVITY_ID,
        providerDraftId: null,
        origin: "system_handoff",
      })
    );
  });

  it("fails closed before generation when the approved source event is no longer the candidate", async () => {
    const approved = manifest();
    const changed = snapshot({
      events: [
        ...snapshot().events,
        {
          ...snapshot().events[0]!,
          id: "10000000-0000-4000-8000-000000000009",
          activityId: "10000000-0000-4000-8000-000000000010",
          providerMessageId: "provider-message-newer",
          occurredAt: "2026-07-22T17:00:00.000Z",
        },
      ],
    });
    const deps = dependencies(changed);

    await expect(
      runApprovedUnansweredLeadLocalDraftBackfill({
        manifest: approved,
        dependencies: deps,
        apply: true,
        approvedManifestSha256: buildUnansweredLeadDraftManifestHash(approved),
        now: NOW,
      })
    ).rejects.toThrow("approved draft candidate changed");

    expect(deps.claimLocalGeneration).not.toHaveBeenCalled();
    expect(deps.generateLocalCopy).not.toHaveBeenCalled();
    expect(deps.persistLocalSystemHandoff).not.toHaveBeenCalled();
  });

  it("fails the whole apply preflight when current authorization denies an approved entry", async () => {
    const approved = manifest();
    const deps = dependencies();
    vi.mocked(deps.authorizeCurrentAccess).mockResolvedValue({
      inboxAllowed: true,
      pipelineAllowed: false,
    });

    await expect(
      runApprovedUnansweredLeadLocalDraftBackfill({
        manifest: approved,
        dependencies: deps,
        apply: true,
        approvedManifestSha256: buildUnansweredLeadDraftManifestHash(approved),
        now: NOW,
      })
    ).rejects.toThrow("approved draft manifest is not currently authorized");

    expect(deps.claimLocalGeneration).not.toHaveBeenCalled();
    expect(deps.persistLocalSystemHandoff).not.toHaveBeenCalled();
  });

  it("is retry-safe when the source-bound local draft already exists", async () => {
    const approved = manifest();
    const deps = dependencies();
    vi.mocked(deps.claimLocalGeneration)
      .mockResolvedValueOnce({
        acquired: true,
        claimToken: "claim-token",
        reason: "acquired",
      })
      .mockResolvedValueOnce({
        acquired: false,
        claimToken: null,
        reason: "existing_draft",
      });

    const apply = () =>
      runApprovedUnansweredLeadLocalDraftBackfill({
        manifest: approved,
        dependencies: deps,
        apply: true,
        approvedManifestSha256: buildUnansweredLeadDraftManifestHash(approved),
        now: NOW,
      });

    await expect(apply()).resolves.toMatchObject({
      entries: [{ status: "created" }],
    });
    await expect(apply()).resolves.toMatchObject({
      entries: [{ status: "already_exists" }],
    });
    expect(deps.persistLocalSystemHandoff).toHaveBeenCalledTimes(1);
  });

  it("rejects duplicate entries and timestamps outside the exact seven-day Vancouver window", () => {
    const duplicate = manifest();
    duplicate.entries.push({ ...duplicate.entries[0]! });
    expect(() =>
      validateApprovedUnansweredLeadDraftManifest(duplicate, NOW)
    ).toThrow("duplicates an approved opportunity or source event");

    const outOfWindow = manifest();
    outOfWindow.entries[0] = {
      ...outOfWindow.entries[0]!,
      sourceOccurredAt: "2026-07-15T06:59:59.999Z",
    };
    expect(() =>
      validateApprovedUnansweredLeadDraftManifest(outOfWindow, NOW)
    ).toThrow("outside the seven-day Vancouver window");
  });

  it("expires an approved manifest after 24 hours against trusted execution time", () => {
    const approved = manifest();

    expect(() =>
      validateApprovedUnansweredLeadDraftManifest(
        approved,
        new Date("2026-07-23T17:30:00.001Z")
      )
    ).toThrow("manifest.generatedAt is more than 24 hours old");

    expect(() =>
      validateApprovedUnansweredLeadDraftManifest(
        approved,
        new Date("2026-07-23T17:30:00.000Z")
      )
    ).not.toThrow();
  });
});
