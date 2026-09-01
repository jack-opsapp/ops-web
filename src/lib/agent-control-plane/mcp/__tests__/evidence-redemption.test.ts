import { describe, expect, it, vi } from "vitest";

import type { ActorAuthoritySnapshot } from "@/lib/agent-control-plane/actor/authority-repository";
import { authorizeCapability } from "@/lib/agent-control-plane/actor/authorize-capability";
import { resolveActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import { trustedAuthorityRepositoryForSnapshot } from "@/lib/agent-control-plane/actor/__tests__/fixtures/trusted-repository-fixtures";
import { validatedMcpPrincipalFixture } from "@/lib/agent-control-plane/actor/__tests__/fixtures/verified-principal-fixtures";
import { GetJobArtifactEvidenceSourceResultSchema } from "@/lib/agent-control-plane/contracts/job-artifacts";
import {
  GET_JOB_ARTIFACT_EVIDENCE_CANDIDATE,
  selectedGetJobArtifactEvidenceVariantKeys,
} from "@/lib/agent-control-plane/registry/read-capabilities/p2/artifacts";
import { authorizeGetJobArtifactEvidenceRead } from "@/lib/agent-control-plane/services/p2/artifacts/artifact-authorization";
import {
  EvidenceIssuanceError,
  EvidenceRedemptionUnavailableError,
  createMcpEvidenceRedeemer,
  issueMcpEvidenceResourceLink,
} from "../evidence-redemption";
import { createMcpEvidenceTokenCodec } from "../evidence-token";

const ACTOR_ID = "d1111111-1111-4111-d111-111111111111";
const COMPANY_ID = "00000000-0000-0000-0000-000000000001";
const JOB_ID = "ffffffff-ffff-ffff-ffff-ffffffffffff";
const GRANT_ID = "44444444-4444-4444-8444-444444444444";
const CLIENT_ID = "55555555-5555-4555-8555-555555555555";
const EVIDENCE_REF = `ops_evidence:v1:${"a".repeat(64)}`;
const TOKEN_HASH = "b".repeat(64);
const NOW_SECONDS = 1_787_899_200;
const SCOPES = ["ops.correspondence.read", "ops.files.read"] as const;

function authority(): ActorAuthoritySnapshot {
  return {
    actorUserId: ACTOR_ID,
    companyId: COMPANY_ID,
    isActive: true,
    isAdmin: false,
    roleIds: ["66666666-6666-4666-8666-666666666666"],
    configuredPermissions: ["email.view", "inbox.view", "pipeline.view"],
    effectivePermissions: [
      { permission: "email.view", scope: "own" },
      { permission: "inbox.view", scope: "assigned" },
      { permission: "pipeline.view", scope: "assigned" },
    ],
    permissionSnapshotRevision: `sha256:${"c".repeat(64)}`,
  };
}

async function context() {
  return resolveActorContext({
    principal: validatedMcpPrincipalFixture({
      actorUserId: ACTOR_ID,
      companyId: COMPANY_ID,
      oauthGrantId: GRANT_ID,
      oauthClientId: CLIENT_ID,
      validatedScopes: [...SCOPES],
      tokenId: TOKEN_HASH,
      issuer: "https://app.opsapp.co",
      audience: "https://app.opsapp.co/api/mcp",
      grantRevision: "d".repeat(32),
    }),
    authorityRepository: trustedAuthorityRepositoryForSnapshot(authority()),
    requestId: "request-evidence",
    policyRevision: "actor-policy:v1",
    capabilityManifestRevision: "2026-08-22.capability-manifest.v8",
  });
}

async function authorization() {
  const actorContext = await context();
  const query = {
    job_ref: { kind: "opportunity" as const, id: JOB_ID },
    source_kind: "email_attachment" as const,
    evidence_ref: EVIDENCE_REF,
  };
  const variants = new Map(
    GET_JOB_ARTIFACT_EVIDENCE_CANDIDATE.authorization.variants.map(
      (variant) => [variant.key, variant.policy]
    )
  );
  const keys = selectedGetJobArtifactEvidenceVariantKeys(query);
  return authorizeGetJobArtifactEvidenceRead({
    query,
    authorizations: Object.fromEntries(
      keys.map((key) => [
        key,
        authorizeCapability({
          actorContext,
          policy: variants.get(key)!,
        }),
      ])
    ),
  });
}

function sourceResult() {
  return GetJobArtifactEvidenceSourceResultSchema.parse({
    artifact: {
      evidence_ref: EVIDENCE_REF,
      source_kind: "email_attachment",
      artifact_kind: "file",
      occurred_at: "2026-08-28T12:00:00.000Z",
      display_name: null,
      note_excerpt: null,
      review_state: "not_applicable",
      client_visibility: "not_applicable",
      mime_family: "pdf",
      byte_size: 2048,
      availability: "available",
      inspection_state: "passed",
    },
    content: {
      kind: "binary_resource",
      delivery_state: "ready_for_single_use_delivery",
      mime_family: "pdf",
      byte_size: 2048,
    },
    evidence: [
      {
        evidence_ref: EVIDENCE_REF,
        source_domain: "artifacts",
        source_type: "email_attachment",
        occurred_at: "2026-08-28T12:00:01.000Z",
      },
    ],
    proof: {
      proof_ref: `ops_proof:v1:${"e".repeat(64)}`,
      read_at: "2026-08-28T12:00:01.000Z",
      source_revisions: [
        { domain: "artifacts", source_revision: 17 },
        { domain: "legacy_operational", source_revision: 29 },
      ],
    },
  });
}

function codec() {
  return createMcpEvidenceTokenCodec({
    key: Uint8Array.from(Buffer.from("11".repeat(32), "hex")),
    now: () => NOW_SECONDS,
    randomBytes: () => Uint8Array.from(Buffer.from("22".repeat(32), "hex")),
  });
}

describe("MCP evidence issuance", () => {
  it("issues for PostgreSQL-shaped non-RFC actor, company, and parent IDs", async () => {
    const proof = await authorization();
    const consume = vi.fn().mockResolvedValue({
      allowed: true,
      remainingUnits: 29,
      resetAt: "2026-08-28T12:01:00.000Z",
    });
    const auditRpc = vi.fn().mockResolvedValue({ data: true, error: null });

    const issued = await issueMcpEvidenceResourceLink({
      authorization: proof,
      result: sourceResult(),
      protocolEra: "modern",
      durableRateLimiter: { consume },
      auditRpcClient: { rpc: auditRpc },
      tokenCodec: codec(),
    });

    expect(consume).toHaveBeenCalledWith({
      requestId: "request-evidence",
      grantId: GRANT_ID,
      actorUserId: ACTOR_ID,
      companyId: COMPANY_ID,
      capabilityId: "issue_mcp_evidence",
      protocolEra: "modern",
      bucket: "evidence_search",
    });
    expect(issued.resourceLink).toEqual({
      type: "resource_link",
      name: "OPS evidence",
      uri: expect.stringMatching(
        /^https:\/\/app\.opsapp\.co\/api\/mcp\/evidence\/ops_mcp_ev1\./
      ),
      size: 2048,
    });
    expect(issued.expiresAt).toBe(NOW_SECONDS + 300);
    const auditArgs = auditRpc.mock.calls.find(
      ([name]) => name === "append_mcp_request_audit_as_system"
    )?.[1];
    expect(JSON.stringify(auditArgs)).not.toMatch(
      /ops_mcp_ev1|storage|locator|filename|payload|private\//i
    );
  });

  it("fails closed for reconstructed authority, unavailable content, or a durable denial", async () => {
    const proof = await authorization();
    const allowed = {
      consume: vi.fn().mockResolvedValue({
        allowed: true,
        remainingUnits: 1,
        resetAt: "2026-08-28T12:01:00.000Z",
      }),
    };
    const audit = {
      rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
    };
    await expect(
      issueMcpEvidenceResourceLink({
        authorization: { ...proof },
        result: sourceResult(),
        protocolEra: "modern",
        durableRateLimiter: allowed,
        auditRpcClient: audit,
        tokenCodec: codec(),
      })
    ).rejects.toBeInstanceOf(EvidenceIssuanceError);
    await expect(
      issueMcpEvidenceResourceLink({
        authorization: proof,
        result: {
          ...sourceResult(),
          content: { kind: "unavailable", code: "SOURCE_PENDING" },
        },
        protocolEra: "modern",
        durableRateLimiter: allowed,
        auditRpcClient: audit,
        tokenCodec: codec(),
      })
    ).rejects.toBeInstanceOf(EvidenceIssuanceError);
    await expect(
      issueMcpEvidenceResourceLink({
        authorization: proof,
        result: sourceResult(),
        protocolEra: "modern",
        durableRateLimiter: {
          consume: vi.fn().mockResolvedValue({
            allowed: false,
            remainingUnits: 0,
            resetAt: "2026-08-28T12:01:00.000Z",
          }),
        },
        auditRpcClient: audit,
        tokenCodec: codec(),
      })
    ).rejects.toBeInstanceOf(EvidenceIssuanceError);
  });
});

describe("MCP evidence redemption adapter", () => {
  it("redeems PostgreSQL-shaped non-RFC actor, company, and parent IDs through the one fixed no-retry RPC", async () => {
    const actorContext = await context();
    const verified = codec().issue({
      audience:
        actorContext.auth.channel === "mcp" ? actorContext.auth.audience : "",
      clientId: CLIENT_ID,
      grantId: GRANT_ID,
      actorUserId: ACTOR_ID,
      companyId: COMPANY_ID,
      parent: { kind: "opportunity", id: JOB_ID },
      sourceKind: "email_attachment",
      evidenceRef: EVIDENCE_REF,
      sourceRevisions: [
        { domain: "artifacts", source_revision: 17 },
        { domain: "legacy_operational", source_revision: 29 },
      ],
    });
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          outcome: "delivered",
          locator_kind: "storage_path",
          locator: "company/object.pdf",
          mime_type: "application/pdf",
          byte_size: 2048,
        },
      ],
      error: null,
    });
    const result = await createMcpEvidenceRedeemer({ rpc }).redeem({
      requestId: "request-redemption",
      protocolEra: "modern",
      token: verified,
      actorContext,
      grantFacts: {
        grantId: GRANT_ID,
        clientId: CLIENT_ID,
        clientName: "Claude",
        actorUserId: ACTOR_ID,
        companyId: COMPANY_ID,
        scopes: [...SCOPES],
        exposureRevision: "2026-08-22.mcp-exposure.v1",
        tokenId: TOKEN_HASH,
        expiresAtEpochSeconds: NOW_SECONDS + 3600,
      },
    });

    expect(result).toEqual({
      outcome: "delivered",
      locatorKind: "storage_path",
      locator: "company/object.pdf",
      mimeType: "application/pdf",
      byteSize: 2048,
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      "redeem_agent_mcp_evidence_as_system",
      expect.objectContaining({
        p_access_token_hash: TOKEN_HASH,
        p_audience: "https://app.opsapp.co/api/mcp",
        p_actor_user_id: ACTOR_ID,
        p_company_id: COMPANY_ID,
        p_oauth_grant_id: GRANT_ID,
        p_oauth_client_id: CLIENT_ID,
        p_job_kind: "opportunity",
        p_job_id: JOB_ID,
        p_source_kind: "email_attachment",
        p_evidence_ref: EVIDENCE_REF,
        p_artifact_source_revision: 17,
        p_operational_source_revision: 29,
        p_nonce_digest: verified.nonceDigest,
        p_source_revision_digest: verified.sourceRevisionDigest,
        p_binding_digest: verified.bindingDigest,
        p_required_oauth_scopes: [...SCOPES],
        p_resolved_permission_scopes: {
          "email.view": "own",
          "inbox.view": "assigned",
          "pipeline.view": "assigned",
        },
      })
    );
  });

  it("rejects wrong actor/client binding before RPC and never retries malformed or ambiguous results", async () => {
    const actorContext = await context();
    const token = codec().issue({
      audience: "https://app.opsapp.co/api/mcp",
      clientId: "77777777-7777-4777-8777-777777777777",
      grantId: GRANT_ID,
      actorUserId: ACTOR_ID,
      companyId: COMPANY_ID,
      parent: { kind: "opportunity", id: JOB_ID },
      sourceKind: "email_attachment",
      evidenceRef: EVIDENCE_REF,
      sourceRevisions: [
        { domain: "artifacts", source_revision: 17 },
        { domain: "legacy_operational", source_revision: 29 },
      ],
    });
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    const redeemer = createMcpEvidenceRedeemer({ rpc });
    await expect(
      redeemer.redeem({
        requestId: "request-redemption",
        protocolEra: "modern",
        token,
        actorContext,
        grantFacts: {
          grantId: GRANT_ID,
          clientId: CLIENT_ID,
          clientName: "Claude",
          actorUserId: ACTOR_ID,
          companyId: COMPANY_ID,
          scopes: [...SCOPES],
          exposureRevision: "2026-08-22.mcp-exposure.v1",
          tokenId: TOKEN_HASH,
          expiresAtEpochSeconds: NOW_SECONDS + 3600,
        },
      })
    ).rejects.toBeInstanceOf(EvidenceRedemptionUnavailableError);
    expect(rpc).not.toHaveBeenCalled();

    const validToken = codec().issue({
      audience: "https://app.opsapp.co/api/mcp",
      clientId: CLIENT_ID,
      grantId: GRANT_ID,
      actorUserId: ACTOR_ID,
      companyId: COMPANY_ID,
      parent: { kind: "opportunity", id: JOB_ID },
      sourceKind: "email_attachment",
      evidenceRef: EVIDENCE_REF,
      sourceRevisions: [
        { domain: "artifacts", source_revision: 17 },
        { domain: "legacy_operational", source_revision: 29 },
      ],
    });
    await expect(
      redeemer.redeem({
        requestId: "request-redemption",
        protocolEra: "modern",
        token: validToken,
        actorContext,
        grantFacts: {
          grantId: GRANT_ID,
          clientId: CLIENT_ID,
          clientName: "Claude",
          actorUserId: ACTOR_ID,
          companyId: COMPANY_ID,
          scopes: [...SCOPES],
          exposureRevision: "2026-08-22.mcp-exposure.v1",
          tokenId: TOKEN_HASH,
          expiresAtEpochSeconds: NOW_SECONDS + 3600,
        },
      })
    ).rejects.toBeInstanceOf(EvidenceRedemptionUnavailableError);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
