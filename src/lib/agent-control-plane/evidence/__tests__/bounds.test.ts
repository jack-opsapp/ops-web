import { describe, expect, it } from "vitest";

import type { ActorAuthoritySnapshot } from "@/lib/agent-control-plane/actor/authority-repository";
import { REGISTERED_ACTOR_PERMISSION_KEYS } from "@/lib/agent-control-plane/actor/authority-repository";
import {
  authorizeCapability,
  type AuthorizedCapability,
} from "@/lib/agent-control-plane/actor/authorize-capability";
import { defineCapabilityPolicyForManifest } from "@/lib/agent-control-plane/actor/capability-policy-boundary";
import { ActorAccessError } from "@/lib/agent-control-plane/actor/errors";
import { resolveActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import {
  validatedMcpPrincipalFixture,
  verifiedInternalPrincipalFixture,
} from "@/lib/agent-control-plane/actor/__tests__/fixtures/verified-principal-fixtures";
import { trustedAuthorityRepositoryForSnapshot } from "@/lib/agent-control-plane/actor/__tests__/fixtures/trusted-repository-fixtures";
import { authorizeCorrespondenceEvidenceRead } from "@/lib/agent-control-plane/evidence/evidence-read-authorization";
import { MAX_EXACT_CORRESPONDENCE_CONTENT_BYTES } from "@/lib/agent-control-plane/evidence/limits";
import { normalizeCorrespondence } from "@/lib/agent-control-plane/evidence/normalize-correspondence";
import {
  createCorrespondenceEvidenceRepository,
  createSupabaseAuthorizedEvidenceLookupAdapter,
  isTrustedAuthorizedEvidenceLookupAdapter,
  type AuthorizedEvidenceLookupRpcClient,
} from "@/lib/agent-control-plane/evidence/repository";
import { hasValidCorrespondenceIntegrity } from "@/lib/agent-control-plane/evidence/source-version";
import type { NormalizedCorrespondenceEvidence } from "@/lib/agent-control-plane/evidence/types";
import {
  CAPABILITY_MANIFEST_REVISION,
  getCapabilityManifestEntry,
} from "@/lib/agent-control-plane/registry/capability-manifest";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const COMPANY_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_COMPANY_ID = "99999999-9999-4999-8999-999999999999";
const EVIDENCE_RPC = "read_agent_correspondence_evidence_as_system";
const AUTHORITY_REVISION = `sha256:${"a".repeat(64)}`;

class StubEvidenceLookupRpcClient implements AuthorizedEvidenceLookupRpcClient {
  readonly calls: Array<{
    functionName: string;
    args: Readonly<Record<string, unknown>>;
  }> = [];
  rows: unknown;
  failure: unknown = null;

  constructor(rows: unknown) {
    this.rows = rows;
  }

  async rpc(
    functionName: typeof EVIDENCE_RPC,
    args: Readonly<Record<string, unknown>>
  ): Promise<{ data: unknown; error: unknown }> {
    this.calls.push({ functionName, args });
    if (this.failure) throw this.failure;
    return { data: this.rows, error: null };
  }
}

function authority(): ActorAuthoritySnapshot {
  return {
    actorUserId: ACTOR_ID,
    companyId: COMPANY_ID,
    isActive: true,
    isAdmin: false,
    roleIds: ["33333333-3333-4333-8333-333333333333"],
    configuredPermissions: ["inbox.view"],
    effectivePermissions: [{ permission: "inbox.view", scope: "all" }],
    permissionSnapshotRevision: AUTHORITY_REVISION,
  };
}

async function genericAuthorization(
  input: {
    readonly channel?: "internal" | "mcp";
    readonly capabilityId?: string;
    readonly capabilityRevision?: string;
    readonly requiredOAuthScopes?: readonly string[];
  } = {}
): Promise<AuthorizedCapability> {
  const principal =
    input.channel === "mcp"
      ? validatedMcpPrincipalFixture({
          actorUserId: ACTOR_ID,
          companyId: COMPANY_ID,
          oauthGrantId: "grant-evidence-1",
          oauthClientId: "client-evidence-1",
          validatedScopes: input.requiredOAuthScopes ?? [
            "ops.correspondence.read",
          ],
          tokenId: "token-evidence-1",
          issuer: "https://auth.opsapp.co",
          audience: "https://mcp.opsapp.co/mcp",
          grantRevision: "grant-revision-evidence-1",
        })
      : verifiedInternalPrincipalFixture({
          channel: "internal",
          firebaseSubject: "firebase-evidence-user",
        });
  const actorContext = await resolveActorContext({
    principal,
    authorityRepository: trustedAuthorityRepositoryForSnapshot(authority()),
    requestId: "request-evidence-1",
    policyRevision: "actor-policy:v1",
    capabilityManifestRevision: CAPABILITY_MANIFEST_REVISION,
  });

  const manifestPolicy = getCapabilityManifestEntry(
    "get_correspondence_evidence"
  ).authorization.variants[0]!.policy;

  return authorizeCapability({
    actorContext,
    policy: defineCapabilityPolicyForManifest({
      capabilityId: input.capabilityId ?? manifestPolicy.capabilityId,
      capabilityRevision:
        input.capabilityRevision ?? manifestPolicy.capabilityRevision,
      capabilityManifestRevision: CAPABILITY_MANIFEST_REVISION,
      requiredOAuthScopes:
        input.requiredOAuthScopes ?? manifestPolicy.requiredOAuthScopes,
      permissionRequirementGroups: [
        [
          {
            permission: "inbox.view",
            allowedScopes: ["all", "assigned", "own"],
          },
        ],
      ],
    }),
  });
}

async function authorization() {
  return authorizeCorrespondenceEvidenceRead(await genericAuthorization());
}

function clientAndRepository(rows: unknown) {
  const rpcClient = new StubEvidenceLookupRpcClient(rows);
  const adapter = createSupabaseAuthorizedEvidenceLookupAdapter(rpcClient);
  return {
    rpcClient,
    adapter,
    repository: createCorrespondenceEvidenceRepository(adapter),
  };
}

function evidence(input: {
  evidenceId: string;
  occurredAt?: string;
  companyId?: string;
  body?: string;
}): NormalizedCorrespondenceEvidence {
  return normalizeCorrespondence({
    evidenceId: input.evidenceId,
    companyId: input.companyId ?? COMPANY_ID,
    sourceDomain: "email",
    sourceType: "provider_message",
    sourceId: `source:${input.evidenceId}`,
    occurredAt: input.occurredAt ?? "2026-08-07T20:00:00.000Z",
    subject: null,
    content: { mediaType: "text/plain", value: input.body ?? input.evidenceId },
    attachments: [],
  });
}

function rpcRow(value: NormalizedCorrespondenceEvidence) {
  return {
    evidence_id: value.evidenceId,
    company_id: value.companyId,
    source_id: value.sourceId,
    occurred_at: value.occurredAt,
    subject: value.subject,
    side: "user",
    participant_id: "client:44444444-4444-4444-8444-444444444444",
    participant_resolution_status: "resolved",
    direction: "inbound",
    source_activity_id: "55555555-5555-4555-8555-555555555555",
    source_correspondence_event_id: "66666666-6666-4666-8666-666666666666",
    recipient_identities: ["ops_mailbox:77777777-7777-4777-8777-777777777777"],
    cc_recipient_identities: [],
    redaction_kinds: [] as string[],
    normalized_plain_text: value.normalizedPlainText,
    original_content_hash: value.originalContentHash,
    attachments: value.attachments.map((attachment) => ({
      attachment_id: attachment.attachmentId,
      filename: attachment.filename,
      mime_type: attachment.mimeType,
      size_bytes: attachment.sizeBytes,
      inline: attachment.inline,
      content_hash: attachment.contentHash,
    })),
  };
}

async function rejected(
  operation: () => unknown | Promise<unknown>
): Promise<ActorAccessError> {
  try {
    await operation();
  } catch (error) {
    expect(error).toBeInstanceOf(ActorAccessError);
    return error as ActorAccessError;
  }
  throw new Error("Expected evidence lookup to fail");
}

describe("bounded correspondence evidence repository", () => {
  it("keeps persisted integrity validation aligned with the shared 8 MiB byte boundary", () => {
    const large = evidence({
      evidenceId: "evidence-above-former-character-limit",
      body: "x".repeat(MAX_EXACT_CORRESPONDENCE_CONTENT_BYTES),
    });

    expect(Buffer.byteLength(large.normalizedPlainText, "utf8")).toBe(
      MAX_EXACT_CORRESPONDENCE_CONTENT_BYTES
    );
    expect(hasValidCorrespondenceIntegrity(large)).toBe(true);
  });

  it("requires a capability-specific nominal proof from the exact manifest entry", async () => {
    const valid = await genericAuthorization();
    const forged = { ...valid } as AuthorizedCapability;
    const forgedError = await rejected(() =>
      authorizeCorrespondenceEvidenceRead(forged)
    );
    expect(forgedError.code).toBe("INTERNAL");

    const otherCapability = await genericAuthorization({
      capabilityId: "prepare_client_message_batch",
      capabilityRevision: "prepare_client_message_batch:2026-08-07.v1",
    });
    const otherCapabilityError = await rejected(() =>
      authorizeCorrespondenceEvidenceRead(otherCapability)
    );
    expect(otherCapabilityError.code).toBe("INTERNAL");

    const wrongScope = await genericAuthorization({
      channel: "mcp",
      requiredOAuthScopes: ["ops.jobs.read"],
    });
    const wrongScopeError = await rejected(() =>
      authorizeCorrespondenceEvidenceRead(wrongScope)
    );
    expect(wrongScopeError.code).toBe("INTERNAL");

    const exactMcpProof = authorizeCorrespondenceEvidenceRead(
      await genericAuthorization({ channel: "mcp" })
    );
    expect(exactMcpProof.requiredOAuthScope).toBe("ops.correspondence.read");
    expect(Object.isFrozen(exactMcpProof)).toBe(true);
  });

  it("rejects a structurally forged lookup adapter", () => {
    expect(() =>
      createCorrespondenceEvidenceRepository({
        async lookupAuthorizedCorrespondenceEvidence() {
          return [];
        },
      } as never)
    ).toThrow(TypeError);
  });

  it("uses one branded RPC adapter for same-statement authority and evidence intersection", async () => {
    const { rpcClient, adapter, repository } = clientAndRepository([
      rpcRow(evidence({ evidenceId: "evidence-1" })),
    ]);

    await repository.getCorrespondenceEvidence({
      authorization: await authorization(),
      evidenceIds: ["evidence-1"],
    });

    expect(rpcClient.calls).toEqual([
      {
        functionName: EVIDENCE_RPC,
        args: {
          p_request_id: "request-evidence-1",
          p_actor_user_id: ACTOR_ID,
          p_company_id: COMPANY_ID,
          p_permission_snapshot_revision: AUTHORITY_REVISION,
          p_registered_permission_keys: [...REGISTERED_ACTOR_PERMISSION_KEYS],
          p_capability_id: "get_correspondence_evidence",
          p_capability_revision: "get_correspondence_evidence:2026-08-07.v1",
          p_capability_manifest_revision: CAPABILITY_MANIFEST_REVISION,
          p_required_oauth_scope: "ops.correspondence.read",
          p_inbox_scope: "all",
          p_evidence_ids: ["evidence-1"],
        },
      },
    ]);
    expect(isTrustedAuthorizedEvidenceLookupAdapter(adapter)).toBe(true);
    expect(isTrustedAuthorizedEvidenceLookupAdapter({ ...adapter })).toBe(
      false
    );
  });

  it("accepts at most 20 unique IDs and rejects larger requests before storage", async () => {
    const twenty = Array.from({ length: 20 }, (_, index) =>
      evidence({ evidenceId: `evidence-${String(index).padStart(2, "0")}` })
    );
    const accepted = clientAndRepository([...twenty].reverse().map(rpcRow));

    const result = await accepted.repository.getCorrespondenceEvidence({
      authorization: await authorization(),
      evidenceIds: twenty.map((item) => item.evidenceId),
    });
    expect(result.evidence).toHaveLength(20);

    const rejectedLookup = clientAndRepository([]);
    const rejectedAuthorization = await authorization();
    const error = await rejected(() =>
      rejectedLookup.repository.getCorrespondenceEvidence({
        authorization: rejectedAuthorization,
        evidenceIds: Array.from({ length: 21 }, (_, index) => `id-${index}`),
      })
    );
    expect(error.code).toBe("INVALID_ARGUMENT");
    expect(rejectedLookup.rpcClient.calls).toEqual([]);
  });

  it("sorts storage results chronologically with evidence ID as a stable tie-breaker", async () => {
    const { repository } = clientAndRepository([
      rpcRow(
        evidence({
          evidenceId: "evidence-c",
          occurredAt: "2026-08-07T21:00:00.000Z",
        })
      ),
      rpcRow(
        evidence({
          evidenceId: "evidence-b",
          occurredAt: "2026-08-07T20:00:00.000Z",
        })
      ),
      rpcRow(
        evidence({
          evidenceId: "evidence-a",
          occurredAt: "2026-08-07T20:00:00.000Z",
        })
      ),
    ]);
    const result = await repository.getCorrespondenceEvidence({
      authorization: await authorization(),
      evidenceIds: ["evidence-c", "evidence-b", "evidence-a"],
    });

    expect(result.evidence.map((item) => item.evidenceId)).toEqual([
      "evidence-a",
      "evidence-b",
      "evidence-c",
    ]);
    expect(result.characterCount).toBe(result.promptText.length);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.evidence)).toBe(true);
  });

  it("fails closed instead of truncating when exact prompt-safe evidence exceeds 60,000 characters", async () => {
    const oversized = evidence({
      evidenceId: "evidence-oversized",
      body: "x".repeat(60_001),
    });
    expect(oversized.normalizedPlainText).toHaveLength(60_001);
    const { repository } = clientAndRepository([rpcRow(oversized)]);
    const auth = await authorization();

    const error = await rejected(() =>
      repository.getCorrespondenceEvidence({
        authorization: auth,
        evidenceIds: [oversized.evidenceId],
      })
    );

    expect(error.code).toBe("INVALID_ARGUMENT");
    expect(error.toAgentError().message).not.toContain("60,001");
  });

  it("returns the same privacy-safe not-found response for absent and cross-company IDs", async () => {
    const auth = await authorization();
    const missingRepository = clientAndRepository([]).repository;
    const foreignRepository = clientAndRepository([
      {
        evidence_id: "secret-id",
        company_id: OTHER_COMPANY_ID,
        normalized_plain_text: "tampered foreign content",
      },
    ]).repository;

    const missing = await rejected(() =>
      missingRepository.getCorrespondenceEvidence({
        authorization: auth,
        evidenceIds: ["secret-id"],
      })
    );
    const foreign = await rejected(() =>
      foreignRepository.getCorrespondenceEvidence({
        authorization: auth,
        evidenceIds: ["secret-id"],
      })
    );

    expect(missing.toAgentError()).toEqual(foreign.toAgentError());
    expect(missing.toAgentError()).toMatchObject({
      code: "NOT_FOUND",
      message: "Resource is not available.",
    });
    expect(JSON.stringify(missing.toAgentError())).not.toContain("secret-id");
  });

  it("fails closed on date-shaped but impossible persisted timestamps", async () => {
    const malformed = rpcRow(evidence({ evidenceId: "evidence-bad-date" }));
    malformed.occurred_at = "2026-99-99T20:00:00.000Z";
    const { repository } = clientAndRepository([malformed]);
    const auth = await authorization();

    const error = await rejected(() =>
      repository.getCorrespondenceEvidence({
        authorization: auth,
        evidenceIds: ["evidence-bad-date"],
      })
    );

    expect(error.code).toBe("INTERNAL");
    expect(error.auditReasonForLog()).toBe("evidence_content_integrity_failed");
  });

  it("aligns persisted source IDs with the 512-character contract boundary", async () => {
    const acceptedRow = rpcRow(evidence({ evidenceId: "evidence-source-512" }));
    acceptedRow.source_id = "s".repeat(512);
    const accepted = clientAndRepository([acceptedRow]);
    const acceptedResult = await accepted.repository.getCorrespondenceEvidence({
      authorization: await authorization(),
      evidenceIds: ["evidence-source-512"],
    });
    expect(acceptedResult.promptText).toContain(
      `"source_id":"${"s".repeat(512)}"`
    );

    const rejectedRow = rpcRow(evidence({ evidenceId: "evidence-source-513" }));
    rejectedRow.source_id = "s".repeat(513);
    const rejectedRepository = clientAndRepository([rejectedRow]).repository;
    const rejectedAuthorization = await authorization();
    const error = await rejected(() =>
      rejectedRepository.getCorrespondenceEvidence({
        authorization: rejectedAuthorization,
        evidenceIds: ["evidence-source-513"],
      })
    );
    expect(error.code).toBe("INTERNAL");
    expect(error.auditReasonForLog()).toBe("evidence_content_integrity_failed");
  });

  it("binds delivered speaker, recipient, source-event, and redaction metadata into prompt evidence", async () => {
    const original = evidence({ evidenceId: "evidence-delivery-metadata" });
    const row = rpcRow(original);
    row.subject = "Site visit details";
    row.redaction_kinds = [
      "content_redacted",
      "attachment_redacted",
      "participant_pseudonymized",
    ];
    row.normalized_plain_text = "[CONTENT REDACTED]";
    row.attachments = [];
    const { repository } = clientAndRepository([row]);

    const result = await repository.getCorrespondenceEvidence({
      authorization: await authorization(),
      evidenceIds: ["evidence-delivery-metadata"],
    });
    const data = JSON.parse(result.promptText.split("DATA_JSON=")[1]!);
    expect(data.evidence[0]).toMatchObject({
      subject: "[SUBJECT REDACTED]",
      delivery: {
        side: "user",
        sender_identity: "[PARTICIPANT REDACTED]",
        participant_resolution_status: "resolved",
        direction: "inbound",
        source_activity_id: "55555555-5555-4555-8555-555555555555",
        source_correspondence_event_id: "66666666-6666-4666-8666-666666666666",
        recipient_identities: [
          "ops_mailbox:77777777-7777-4777-8777-777777777777",
        ],
        cc_recipient_identities: [],
      },
      redaction_kinds: [
        "content_redacted",
        "attachment_redacted",
        "participant_pseudonymized",
      ],
      normalized_plain_text: "[CONTENT REDACTED]",
      attachments: [],
    });
    expect(result.evidence[0]).toMatchObject({
      redactionKinds: [
        "content_redacted",
        "attachment_redacted",
        "participant_pseudonymized",
      ],
      delivery: {
        senderIdentity: "[PARTICIPANT REDACTED]",
      },
    });
  });

  it("accepts only canonical UTF-8 byte order for non-ASCII identities", async () => {
    const bytewise = rpcRow(evidence({ evidenceId: "evidence-byte-order" }));
    bytewise.recipient_identities = [
      "client:\ue000@example.com",
      "client:\u{10000}@example.com",
    ];
    const accepted = clientAndRepository([bytewise]).repository;

    await expect(
      accepted.getCorrespondenceEvidence({
        authorization: await authorization(),
        evidenceIds: ["evidence-byte-order"],
      })
    ).resolves.toBeDefined();

    const utf16Order = structuredClone(bytewise);
    utf16Order.recipient_identities = [
      "client:\u{10000}@example.com",
      "client:\ue000@example.com",
    ];
    const rejectedRepository = clientAndRepository([utf16Order]).repository;
    const rejectedAuthorization = await authorization();
    const error = await rejected(() =>
      rejectedRepository.getCorrespondenceEvidence({
        authorization: rejectedAuthorization,
        evidenceIds: ["evidence-byte-order"],
      })
    );
    expect(error.code).toBe("INTERNAL");
    expect(error.auditReasonForLog()).toBe("evidence_content_integrity_failed");
  });

  it("cryptographically binds every immutable delivery and privacy field", async () => {
    const original = evidence({ evidenceId: "evidence-hash-boundary" });
    const baseRow = rpcRow(original);
    baseRow.subject = "Original subject";
    baseRow.attachments = [
      {
        attachment_id: "attachment-a",
        filename: "estimate.pdf",
        mime_type: "application/pdf",
        size_bytes: 42,
        inline: false,
        content_hash: null,
      },
    ];

    const variants: Array<(row: ReturnType<typeof rpcRow>) => void> = [
      () => undefined,
      (row) => {
        row.subject = "Changed subject";
      },
      (row) => {
        row.side = "assistant";
        row.direction = "outbound";
        row.participant_id = "ops_user:88888888-8888-4888-8888-888888888888";
      },
      (row) => {
        row.participant_id = "ops_user:88888888-8888-4888-8888-888888888888";
      },
      (row) => {
        row.recipient_identities = [
          "client:99999999-9999-4999-8999-999999999999",
        ];
      },
      (row) => {
        row.redaction_kinds = ["participant_pseudonymized"];
      },
      (row) => {
        row.attachments = [
          {
            ...baseRow.attachments[0]!,
            attachment_id: "attachment-b",
          },
        ];
      },
    ];

    const hashes = await Promise.all(
      variants.map(async (mutate) => {
        const row = structuredClone(baseRow);
        mutate(row);
        const { repository } = clientAndRepository([row]);
        const result = await repository.getCorrespondenceEvidence({
          authorization: await authorization(),
          evidenceIds: ["evidence-hash-boundary"],
        });
        return result.evidence[0]!.normalizedContentHash;
      })
    );

    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it.each([
    [
      "side/status invariant",
      (row: ReturnType<typeof rpcRow>) => {
        row.participant_resolution_status = "ambiguous";
      },
    ],
    [
      "direction/side invariant",
      (row: ReturnType<typeof rpcRow>) => {
        row.side = "assistant";
      },
    ],
    [
      "recipient identity controls",
      (row: ReturnType<typeof rpcRow>) => {
        row.recipient_identities = ["client:unsafe\u2066"];
      },
    ],
    [
      "redaction order",
      (row: ReturnType<typeof rpcRow>) => {
        row.redaction_kinds = ["attachment_redacted", "content_redacted"];
      },
    ],
    [
      "activity UUID",
      (row: ReturnType<typeof rpcRow>) => {
        row.source_activity_id = "not-a-uuid";
      },
    ],
  ])("fails closed on invalid delivered %s", async (_label, mutate) => {
    const row = rpcRow(evidence({ evidenceId: "evidence-bad-delivery" }));
    mutate(row);
    const { repository } = clientAndRepository([row]);
    const auth = await authorization();

    const error = await rejected(() =>
      repository.getCorrespondenceEvidence({
        authorization: auth,
        evidenceIds: ["evidence-bad-delivery"],
      })
    );
    expect(error.code).toBe("INTERNAL");
    expect(error.auditReasonForLog()).toBe("evidence_content_integrity_failed");
  });

  it.each([
    [
      "source ID",
      (row: ReturnType<typeof rpcRow>) => {
        row.source_id = `source:unsafe\u2066`;
      },
    ],
    [
      "subject",
      (row: ReturnType<typeof rpcRow>) => {
        row.subject = `unsafe\u2066 subject`;
      },
    ],
    [
      "normalized body",
      (row: ReturnType<typeof rpcRow>) => {
        row.normalized_plain_text = `unsafe\u2066 body`;
      },
    ],
    [
      "attachment ID",
      (row: ReturnType<typeof rpcRow>) => {
        row.attachments = [
          {
            attachment_id: `attachment\u2066-1`,
            filename: "estimate.pdf",
            mime_type: "application/pdf",
            size_bytes: 42,
            inline: false,
            content_hash: null,
          },
        ];
      },
    ],
    [
      "attachment filename",
      (row: ReturnType<typeof rpcRow>) => {
        row.attachments = [
          {
            attachment_id: "attachment-1",
            filename: `estimate\u2066.pdf`,
            mime_type: "application/pdf",
            size_bytes: 42,
            inline: false,
            content_hash: null,
          },
        ];
      },
    ],
    [
      "attachment MIME type",
      (row: ReturnType<typeof rpcRow>) => {
        row.attachments = [
          {
            attachment_id: "attachment-1",
            filename: "estimate.pdf",
            mime_type: `application/pdf\u2066`,
            size_bytes: 42,
            inline: false,
            content_hash: null,
          },
        ];
      },
    ],
  ])(
    "fails closed on unsafe controls in persisted %s",
    async (_label, mutate) => {
      const row = rpcRow(evidence({ evidenceId: "evidence-controls" }));
      mutate(row);
      const { repository } = clientAndRepository([row]);
      const auth = await authorization();

      const error = await rejected(() =>
        repository.getCorrespondenceEvidence({
          authorization: auth,
          evidenceIds: ["evidence-controls"],
        })
      );

      expect(error.code).toBe("INTERNAL");
      expect(error.auditReasonForLog()).toBe(
        "evidence_content_integrity_failed"
      );
    }
  );

  it("preserves linguistic shaping controls in persisted metadata", async () => {
    const row = rpcRow(evidence({ evidenceId: "evidence-shaping" }));
    row.source_id = `source:می\u200Cروم:👩\u200D🔧`;
    row.attachments = [
      {
        attachment_id: "attachment-1",
        filename: `می\u200Cروم-👩\u200D🔧.pdf`,
        mime_type: "application/pdf",
        size_bytes: 42,
        inline: false,
        content_hash: null,
      },
    ];
    const { repository } = clientAndRepository([row]);

    const result = await repository.getCorrespondenceEvidence({
      authorization: await authorization(),
      evidenceIds: ["evidence-shaping"],
    });

    expect(result.promptText).toContain(row.source_id);
    expect(result.promptText).toContain(row.attachments[0]!.filename);
  });

  it("keeps opaque attachment references without fabricating filenames", async () => {
    const sourceEvidence = evidence({ evidenceId: "evidence-attachment-ref" });
    const row: Record<string, unknown> = {
      ...rpcRow(sourceEvidence),
      attachments: [
        {
          attachment_id: "attachment-evidence-ref-1",
          filename: null,
          mime_type: null,
          size_bytes: null,
          inline: false,
          content_hash: null,
        },
      ],
    };
    const { repository } = clientAndRepository([row]);

    const result = await repository.getCorrespondenceEvidence({
      authorization: await authorization(),
      evidenceIds: [sourceEvidence.evidenceId],
    });

    expect(result.promptText).toContain(
      '"attachment_id":"attachment-evidence-ref-1"'
    );
    expect(result.promptText).toContain('"filename":null');
    expect(result.promptText).not.toContain(
      '"filename":"attachment-evidence-ref-1"'
    );
  });

  it("fails closed when persisted source integrity metadata is malformed", async () => {
    const original = evidence({ evidenceId: "evidence-integrity" });
    const { repository } = clientAndRepository([
      {
        ...rpcRow(original),
        original_content_hash: "sha256:not-a-hash",
      },
    ]);
    const auth = await authorization();

    const error = await rejected(() =>
      repository.getCorrespondenceEvidence({
        authorization: auth,
        evidenceIds: [original.evidenceId],
      })
    );

    expect(error.code).toBe("INTERNAL");
    expect(error.toAgentError().message).not.toContain("tampered");
  });
});
