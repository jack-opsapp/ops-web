import { describe, expect, it, vi } from "vitest";

import {
  EMPTY_MEMORY_DOCUMENT,
  type JobMemoryDocument,
} from "../memory-schema";
import {
  createMemoryRepository,
  type CommitMemoryVersionInput,
} from "../memory-repository";

const COMPANY_ID = "00000000-0000-4000-8000-000000000301";
const CONVERSATION_ID = "00000000-0000-4000-8000-000000000302";
const TURN_ID = "00000000-0000-4000-8000-000000000303";
const VERSION_ID = "00000000-0000-4000-8000-000000000304";
const SOURCE_ID = "00000000-0000-4000-8000-000000000305";
const TURN_2_ID = "00000000-0000-4000-8000-000000000306";
const OTHER_COMPANY_ID = "00000000-0000-4000-8000-000000000307";
const OTHER_CONVERSATION_ID = "00000000-0000-4000-8000-000000000308";
const EVIDENCE_ID = `job_conversation_turn:${TURN_ID}`;

function versionRow(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    id: VERSION_ID,
    company_id: COMPANY_ID,
    conversation_id: CONVERSATION_ID,
    version_number: 1,
    predecessor_version_id: null,
    turn_high_watermark_id: TURN_ID,
    turn_high_watermark_sequence: 1,
    source_state_revision: 1,
    generation_input_hash: `sha256:${"a".repeat(64)}`,
    memory_document: EMPTY_MEMORY_DOCUMENT,
    memory_document_hash: `sha256:${"b".repeat(64)}`,
    generator_revision: "job-memory:test:v1",
    created_at: "2026-08-07T18:01:00.000Z",
    ...overrides,
  };
}

function pendingTurnRow(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    id: TURN_2_ID,
    turn_sequence: 2,
    source_state_revision: 2,
    side: "user",
    participant_id: "client:one",
    participant_resolution_status: "resolved",
    direction: "inbound",
    channel: "email",
    delivered_at: "2026-08-07T18:00:00.000Z",
    ingested_at: "2026-08-07T18:00:01.000Z",
    subject: "Question",
    normalized_plain_text: "Can you confirm Monday?",
    attachment_evidence_ids: [],
    provider_delivery_source_id: SOURCE_ID,
    provider_delivery_source_sha256: `sha256:${"c".repeat(64)}`,
    evidence_source_revision: "job-conversation-turn-projection:v1:2",
    evidence_content_hash: `sha256:${"d".repeat(64)}`,
    redaction_kinds: [],
    ...overrides,
  };
}

function snapshotRow(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    company_id: COMPANY_ID,
    conversation_id: CONVERSATION_ID,
    source_state_revision: 2,
    last_turn_sequence: 2,
    current_version: versionRow(),
    current_evidence: [],
    pending_turns: [pendingTurnRow()],
    invalidated_evidence_ids: [],
    required_through: { turn_id: TURN_2_ID, state: "pending" },
    ...overrides,
  };
}

function commitInput(
  overrides: Partial<CommitMemoryVersionInput> = {}
): CommitMemoryVersionInput {
  return {
    companyId: COMPANY_ID,
    conversationId: CONVERSATION_ID,
    expectedCurrentMemoryVersionId: null,
    expectedSourceStateRevision: 1,
    processedTurnIds: [TURN_ID],
    turnHighWatermarkId: TURN_ID,
    turnHighWatermarkSequence: 1,
    generationInputHash: `sha256:${"a".repeat(64)}`,
    generatorRevision: "job-memory:test:v1",
    memoryDocument: EMPTY_MEMORY_DOCUMENT,
    ...overrides,
  };
}

function documentedMemory(): JobMemoryDocument {
  return {
    ...EMPTY_MEMORY_DOCUMENT,
    facts: [
      {
        statement: "The site visit is requested for Monday.",
        evidence: [{ evidence_id: EVIDENCE_ID, relationship: "supports" }],
      },
    ],
  };
}

function evidenceRow(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    evidence_id: EVIDENCE_ID,
    relationship: "supports",
    source_domain: "job_conversation",
    source_type: "delivered_email_turn",
    source_entity_id: TURN_ID,
    source_revision: "job-conversation-turn-projection:v1:1",
    source_content_hash: `sha256:${"e".repeat(64)}`,
    source_participant_id: "client:one",
    source_participant_resolution_status: "resolved",
    ...overrides,
  };
}

describe("memory repository guarded RPC boundary", () => {
  it("loads and validates one bounded source-consistent snapshot", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: snapshotRow(), error: null });
    const repository = createMemoryRepository({ rpc });

    const result = await repository.loadGenerationSnapshot({
      companyId: COMPANY_ID,
      conversationId: CONVERSATION_ID,
      requiredThroughTurnId: TURN_2_ID,
      maxTurns: 25,
    });

    expect(rpc).toHaveBeenCalledWith(
      "read_job_memory_generation_snapshot_as_system",
      {
        p_company_id: COMPANY_ID,
        p_conversation_id: CONVERSATION_ID,
        p_required_through_turn_id: TURN_2_ID,
        p_max_turns: 25,
      }
    );
    expect(result.pendingTurns[0]).toMatchObject({
      id: TURN_2_ID,
      turnSequence: 2,
      providerDeliverySourceId: SOURCE_ID,
    });
    expect(result.currentVersion?.versionNumber).toBe(1);
  });

  it("forwards cancellation to an abortable snapshot RPC", async () => {
    const controller = new AbortController();
    const request = Promise.resolve({
      data: snapshotRow(),
      error: null,
    }) as Promise<{ data: unknown; error: unknown }> & {
      abortSignal: ReturnType<typeof vi.fn>;
    };
    request.abortSignal = vi.fn().mockReturnValue(request);
    const repository = createMemoryRepository({
      rpc: vi.fn().mockReturnValue(request),
    });

    await repository.loadGenerationSnapshot({
      companyId: COMPANY_ID,
      conversationId: CONVERSATION_ID,
      requiredThroughTurnId: TURN_2_ID,
      maxTurns: 25,
      signal: controller.signal,
    });

    expect(request.abortSignal).toHaveBeenCalledWith(controller.signal);
  });

  it("commits only through the atomic optimistic RPC and trusts its exact readback", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ result_kind: "committed", current_version: versionRow() }],
      error: null,
    });
    const repository = createMemoryRepository({ rpc });

    const result = await repository.commitMemoryVersion(commitInput());

    expect(rpc).toHaveBeenCalledWith("commit_job_memory_version_as_system", {
      p_company_id: COMPANY_ID,
      p_conversation_id: CONVERSATION_ID,
      p_expected_current_memory_version_id: null,
      p_expected_source_state_revision: 1,
      p_processed_turn_ids: [TURN_ID],
      p_turn_high_watermark_id: TURN_ID,
      p_turn_high_watermark_sequence: 1,
      p_generation_input_hash: `sha256:${"a".repeat(64)}`,
      p_generator_revision: "job-memory:test:v1",
      p_memory_document: EMPTY_MEMORY_DOCUMENT,
    });
    expect(result).toMatchObject({
      kind: "committed",
      version: {
        id: VERSION_ID,
        memoryDocumentHash: `sha256:${"b".repeat(64)}`,
      },
    });
  });

  it("fails closed on malformed RPC data", async () => {
    const repository = createMemoryRepository({
      rpc: vi.fn().mockResolvedValue({
        data: snapshotRow({
          source_state_revision: "1",
          required_through: { turn_id: null, state: "not_requested" },
        }),
        error: null,
      }),
    });

    await expect(
      repository.loadGenerationSnapshot({
        companyId: COMPANY_ID,
        conversationId: CONVERSATION_ID,
        maxTurns: 1,
      })
    ).rejects.toMatchObject({ code: "MEMORY_SNAPSHOT_INVALID" });
  });

  it.each([
    {
      name: "top-level company scope",
      row: () => snapshotRow({ company_id: OTHER_COMPANY_ID }),
    },
    {
      name: "top-level conversation scope",
      row: () => snapshotRow({ conversation_id: OTHER_CONVERSATION_ID }),
    },
    {
      name: "nested current-version company scope",
      row: () =>
        snapshotRow({
          current_version: versionRow({ company_id: OTHER_COMPANY_ID }),
        }),
    },
    {
      name: "nested current-version conversation scope",
      row: () =>
        snapshotRow({
          current_version: versionRow({
            conversation_id: OTHER_CONVERSATION_ID,
          }),
        }),
    },
    {
      name: "current watermark above the conversation watermark",
      row: () =>
        snapshotRow({
          current_version: versionRow({ turn_high_watermark_sequence: 3 }),
        }),
    },
    {
      name: "current source revision above the snapshot revision",
      row: () =>
        snapshotRow({
          current_version: versionRow({ source_state_revision: 3 }),
        }),
    },
    {
      name: "source revision below the turn watermark",
      row: () => snapshotRow({ source_state_revision: 1 }),
    },
    {
      name: "non-contiguous pending sequence",
      row: () =>
        snapshotRow({ pending_turns: [pendingTurnRow({ turn_sequence: 3 })] }),
    },
    {
      name: "omitted pending turn before the last watermark",
      row: () => snapshotRow({ pending_turns: [] }),
    },
    {
      name: "pending turn source revision above the snapshot",
      row: () =>
        snapshotRow({
          pending_turns: [pendingTurnRow({ source_state_revision: 3 })],
        }),
    },
    {
      name: "resolved inbound turn projected onto the assistant side",
      row: () =>
        snapshotRow({ pending_turns: [pendingTurnRow({ side: "assistant" })] }),
    },
    {
      name: "participant-redacted turn that still exposes resolved identity",
      row: () =>
        snapshotRow({
          pending_turns: [
            pendingTurnRow({
              redaction_kinds: ["participant_pseudonymized"],
            }),
          ],
        }),
    },
  ])("rejects $name", async ({ row }) => {
    const repository = createMemoryRepository({
      rpc: vi.fn().mockResolvedValue({ data: row(), error: null }),
    });

    await expect(
      repository.loadGenerationSnapshot({
        companyId: COMPANY_ID,
        conversationId: CONVERSATION_ID,
        requiredThroughTurnId: TURN_2_ID,
        maxTurns: 25,
      })
    ).rejects.toMatchObject({ code: "MEMORY_SNAPSHOT_INVALID" });
  });

  it.each([
    {
      name: "a different requested turn",
      requiredThroughTurnId: TURN_2_ID,
      requiredThrough: { turn_id: TURN_ID, state: "pending" },
    },
    {
      name: "not-requested state for a requested turn",
      requiredThroughTurnId: TURN_2_ID,
      requiredThrough: { turn_id: TURN_2_ID, state: "not_requested" },
    },
    {
      name: "a requested state when no turn was requested",
      requiredThroughTurnId: undefined,
      requiredThrough: { turn_id: TURN_2_ID, state: "pending" },
    },
    {
      name: "summarized state while newer source remains pending",
      requiredThroughTurnId: TURN_2_ID,
      requiredThrough: { turn_id: TURN_2_ID, state: "summarized" },
    },
  ])(
    "rejects required-through response with $name",
    async ({ requiredThroughTurnId, requiredThrough }) => {
      const repository = createMemoryRepository({
        rpc: vi.fn().mockResolvedValue({
          data: snapshotRow({ required_through: requiredThrough }),
          error: null,
        }),
      });

      await expect(
        repository.loadGenerationSnapshot({
          companyId: COMPANY_ID,
          conversationId: CONVERSATION_ID,
          requiredThroughTurnId,
          maxTurns: 25,
        })
      ).rejects.toMatchObject({ code: "MEMORY_SNAPSHOT_INVALID" });
    }
  );

  it("requires current evidence to exactly match memory links and source identity", async () => {
    const current = versionRow({ memory_document: documentedMemory() });
    const base = snapshotRow({
      current_version: current,
      current_evidence: [evidenceRow()],
      invalidated_evidence_ids: [EVIDENCE_ID],
    });
    const repository = createMemoryRepository({
      rpc: vi
        .fn()
        .mockResolvedValueOnce({ data: base, error: null })
        .mockResolvedValueOnce({
          data: snapshotRow({
            current_version: current,
            current_evidence: [evidenceRow({ source_entity_id: TURN_2_ID })],
          }),
          error: null,
        })
        .mockResolvedValueOnce({
          data: snapshotRow({
            current_version: current,
            current_evidence: [evidenceRow({ relationship: "contradicts" })],
          }),
          error: null,
        })
        .mockResolvedValueOnce({
          data: snapshotRow({
            current_version: current,
            current_evidence: [evidenceRow()],
            invalidated_evidence_ids: [`job_conversation_turn:${TURN_2_ID}`],
          }),
          error: null,
        }),
    });
    const request = {
      companyId: COMPANY_ID,
      conversationId: CONVERSATION_ID,
      requiredThroughTurnId: TURN_2_ID,
      maxTurns: 25,
    } as const;

    await expect(
      repository.loadGenerationSnapshot(request)
    ).resolves.toMatchObject({
      invalidatedEvidenceIds: [EVIDENCE_ID],
    });
    await expect(
      repository.loadGenerationSnapshot(request)
    ).rejects.toMatchObject({
      code: "MEMORY_SNAPSHOT_INVALID",
    });
    await expect(
      repository.loadGenerationSnapshot(request)
    ).rejects.toMatchObject({
      code: "MEMORY_SNAPSHOT_INVALID",
    });
    await expect(
      repository.loadGenerationSnapshot(request)
    ).rejects.toMatchObject({
      code: "MEMORY_SNAPSHOT_INVALID",
    });
  });

  it("rejects current evidence that marks a redaction sentinel as resolved", async () => {
    const repository = createMemoryRepository({
      rpc: vi.fn().mockResolvedValue({
        data: snapshotRow({
          current_version: versionRow({ memory_document: documentedMemory() }),
          current_evidence: [
            evidenceRow({
              source_participant_id: "[PARTICIPANT REDACTED]",
              source_participant_resolution_status: "resolved",
            }),
          ],
        }),
        error: null,
      }),
    });

    await expect(
      repository.loadGenerationSnapshot({
        companyId: COMPANY_ID,
        conversationId: CONVERSATION_ID,
        requiredThroughTurnId: TURN_2_ID,
        maxTurns: 25,
      })
    ).rejects.toMatchObject({ code: "MEMORY_SNAPSHOT_INVALID" });
  });

  it.each([
    {
      name: "wrong company",
      responseVersion: () => versionRow({ company_id: OTHER_COMPANY_ID }),
    },
    {
      name: "wrong conversation",
      responseVersion: () =>
        versionRow({ conversation_id: OTHER_CONVERSATION_ID }),
    },
    {
      name: "wrong predecessor",
      responseVersion: () => versionRow({ predecessor_version_id: VERSION_ID }),
    },
    {
      name: "wrong watermark",
      responseVersion: () => versionRow({ turn_high_watermark_sequence: 2 }),
    },
    {
      name: "wrong source revision",
      responseVersion: () => versionRow({ source_state_revision: 2 }),
    },
    {
      name: "wrong generation input",
      responseVersion: () =>
        versionRow({ generation_input_hash: `sha256:${"f".repeat(64)}` }),
    },
    {
      name: "wrong generator",
      responseVersion: () => versionRow({ generator_revision: "other" }),
    },
    {
      name: "wrong memory document",
      responseVersion: () =>
        versionRow({ memory_document: documentedMemory() }),
    },
  ])(
    "rejects a successful commit readback with $name",
    async ({ responseVersion }) => {
      const repository = createMemoryRepository({
        rpc: vi.fn().mockResolvedValue({
          data: [
            { result_kind: "committed", current_version: responseVersion() },
          ],
          error: null,
        }),
      });

      await expect(
        repository.commitMemoryVersion(commitInput())
      ).rejects.toMatchObject({
        code: "MEMORY_COMMIT_INVALID",
      });
    }
  );

  it("rejects a cross-scope conflict version", async () => {
    const repository = createMemoryRepository({
      rpc: vi.fn().mockResolvedValue({
        data: [
          {
            result_kind: "conflict",
            current_version: versionRow({ company_id: OTHER_COMPANY_ID }),
          },
        ],
        error: null,
      }),
    });

    await expect(
      repository.commitMemoryVersion(commitInput())
    ).rejects.toMatchObject({
      code: "MEMORY_COMMIT_INVALID",
    });
  });
});
