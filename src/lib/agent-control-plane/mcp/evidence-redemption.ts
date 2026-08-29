import "server-only";

import { z } from "zod-v4";

import { REGISTERED_ACTOR_PERMISSION_KEYS } from "@/lib/agent-control-plane/actor/authority-repository";
import {
  isActorContext,
  type ActorContext,
} from "@/lib/agent-control-plane/actor/resolve-actor-context";
import {
  ARTIFACT_MAX_IMAGE_BYTES,
  ARTIFACT_MAX_PDF_BYTES,
  GetJobArtifactEvidenceSourceResultSchema,
  type ArtifactSourceKind,
  type GetJobArtifactEvidenceSourceResult,
} from "@/lib/agent-control-plane/contracts/job-artifacts";
import {
  isAuthorizedGetJobArtifactEvidenceRead,
  type AuthorizedGetJobArtifactEvidenceRead,
} from "@/lib/agent-control-plane/services/p2/artifacts/artifact-authorization";
import type { PermissionScope } from "@/lib/types/permissions";
import { auditInputDigest, recordMcpAudit } from "./audit";
import type { McpGrantFacts } from "./bearer";
import type { DurableMcpRateLimiter } from "./durable-rate-limit";
import {
  createConfiguredMcpEvidenceTokenCodec,
  isVerifiedMcpEvidenceToken,
  type McpEvidenceTokenCodec,
  type VerifiedMcpEvidenceToken,
} from "./evidence-token";
import type { McpOAuthRpcClient } from "./oauth";

const REDEMPTION_RPC = "redeem_agent_mcp_evidence_as_system" as const;
const REDEMPTION_TIMEOUT_MS = 3_000;
const TOKEN_HASH_PATTERN = /^[0-9a-f]{64}$/;

const SOURCE_OAUTH_SCOPES: Readonly<
  Record<ArtifactSourceKind, readonly string[]>
> = Object.freeze({
  deck_design: Object.freeze(["ops.files.read", "ops.jobs.read"]),
  email_attachment: Object.freeze([
    "ops.correspondence.read",
    "ops.files.read",
  ]),
  expense_receipt: Object.freeze(["ops.expenses.read", "ops.files.read"]),
  generated_estimate: Object.freeze([
    "ops.files.read",
    "ops.financial_documents.read",
  ]),
  generated_invoice: Object.freeze([
    "ops.files.read",
    "ops.financial_documents.read",
  ]),
  project_note: Object.freeze(["ops.files.read"]),
  project_photo: Object.freeze(["ops.files.read"]),
  site_visit_artifact: Object.freeze([
    "ops.customers.read",
    "ops.files.read",
    "ops.schedule.read",
    "ops.site_visits.read",
  ]),
});

const SOURCE_PERMISSIONS: Readonly<
  Record<ArtifactSourceKind, readonly string[]>
> = Object.freeze({
  deck_design: Object.freeze(["deck_builder.view"]),
  email_attachment: Object.freeze(["email.view", "inbox.view"]),
  expense_receipt: Object.freeze(["expenses.view"]),
  generated_estimate: Object.freeze(["documents.view", "estimates.view"]),
  generated_invoice: Object.freeze(["documents.view", "invoices.view"]),
  project_note: Object.freeze([]),
  project_photo: Object.freeze(["photos.view"]),
  site_visit_artifact: Object.freeze([
    "calendar.view",
    "clients.view",
    "photos.view",
    "pipeline.view",
  ]),
});

const AllowedMimeTypeSchema = z.enum([
  "application/pdf",
  "image/avif",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const StoragePathSchema = z
  .string()
  .min(1)
  .max(2_048)
  .refine((value) => value === value.trim())
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value))
  .refine((value) => !value.startsWith("/"))
  .refine(
    (value) => !value.split("/").some((part) => part === "." || part === "..")
  );
const DeliveredRowSchema = z
  .object({
    outcome: z.literal("delivered"),
    locator_kind: z.literal("storage_path"),
    locator: StoragePathSchema,
    mime_type: AllowedMimeTypeSchema,
    byte_size: z.number().int().safe().positive().max(ARTIFACT_MAX_PDF_BYTES),
  })
  .strict()
  .refine(
    (row) =>
      (row.mime_type.startsWith("image/") &&
        row.byte_size <= ARTIFACT_MAX_IMAGE_BYTES) ||
      (row.mime_type === "application/pdf" &&
        row.byte_size <= ARTIFACT_MAX_PDF_BYTES),
    "MCP_EVIDENCE_DELIVERY_LIMIT_INVALID"
  );
const UnavailableRowSchema = z
  .object({
    outcome: z.enum(["expired", "replay", "unavailable"]),
    locator_kind: z.null(),
    locator: z.null(),
    mime_type: z.null(),
    byte_size: z.null(),
  })
  .strict();
const RedemptionRowSchema = z.union([DeliveredRowSchema, UnavailableRowSchema]);

export interface McpEvidenceResourceLink {
  readonly type: "resource_link";
  readonly name: "OPS evidence";
  readonly uri: string;
  readonly size: number;
}

export interface IssuedMcpEvidenceResource {
  readonly resourceLink: McpEvidenceResourceLink;
  readonly expiresAt: number;
}

export type McpEvidenceRedemptionResult =
  | Readonly<{
      outcome: "delivered";
      locatorKind: "storage_path";
      locator: string;
      mimeType: z.infer<typeof AllowedMimeTypeSchema>;
      byteSize: number;
    }>
  | Readonly<{ outcome: "expired" | "replay" | "unavailable" }>;

export interface McpEvidenceRedeemer {
  redeem(input: McpEvidenceRedeemInput): Promise<McpEvidenceRedemptionResult>;
}

export interface McpEvidenceRedeemInput {
  readonly requestId: string;
  readonly protocolEra: "legacy" | "modern";
  readonly token: VerifiedMcpEvidenceToken;
  readonly actorContext: ActorContext;
  readonly grantFacts: McpGrantFacts;
}

export class EvidenceIssuanceError extends Error {
  readonly code:
    | "MCP_EVIDENCE_ISSUANCE_INVALID"
    | "MCP_EVIDENCE_ISSUANCE_RATE_LIMITED"
    | "MCP_EVIDENCE_ISSUANCE_UNAVAILABLE";

  constructor(code: EvidenceIssuanceError["code"]) {
    super(code);
    this.name = "EvidenceIssuanceError";
    this.code = code;
  }
}

export class EvidenceRedemptionUnavailableError extends Error {
  readonly code = "MCP_EVIDENCE_REDEMPTION_UNAVAILABLE" as const;

  constructor() {
    super("MCP_EVIDENCE_REDEMPTION_UNAVAILABLE");
    this.name = "EvidenceRedemptionUnavailableError";
  }
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return Object.freeze(
    [...new Set(values)].sort((left, right) => left.localeCompare(right))
  );
}

function sameStrings(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function requirements(input: {
  readonly sourceKind: ArtifactSourceKind;
  readonly parentKind: "opportunity" | "project";
}) {
  const requiredOAuthScopes = SOURCE_OAUTH_SCOPES[input.sourceKind];
  const requiredPermissionKeys = sortedUnique([
    input.parentKind === "opportunity" ? "pipeline.view" : "projects.view",
    ...SOURCE_PERMISSIONS[input.sourceKind],
  ]);
  return Object.freeze({ requiredOAuthScopes, requiredPermissionKeys });
}

async function issuanceAudit(input: {
  readonly authorization: AuthorizedGetJobArtifactEvidenceRead;
  readonly rpcClient: McpOAuthRpcClient;
  readonly protocolEra: "legacy" | "modern";
  readonly outcome: "ok" | "rate_limited" | "internal";
  readonly errorCode: string | null;
  readonly inputSha256: string | null;
  readonly resultBytes: number | null;
}) {
  const authorization = input.authorization;
  await recordMcpAudit(input.rpcClient, {
    requestId: authorization.actorContext.requestId,
    grantId: authorization.oauthGrantId,
    clientId: authorization.oauthClientId,
    actorUserId: authorization.actorContext.actorUserId,
    companyId: authorization.actorContext.companyId,
    tool: "issue_mcp_evidence",
    protocolEra: input.protocolEra,
    outcome: input.outcome,
    errorCode: input.errorCode,
    inputSha256: input.inputSha256,
    resultBytes: input.resultBytes,
    latencyMs: null,
  });
}

export async function issueMcpEvidenceResourceLink(input: {
  readonly authorization: AuthorizedGetJobArtifactEvidenceRead;
  readonly result: GetJobArtifactEvidenceSourceResult;
  readonly protocolEra: "legacy" | "modern";
  readonly durableRateLimiter: DurableMcpRateLimiter;
  readonly auditRpcClient: McpOAuthRpcClient;
  readonly tokenCodec?: McpEvidenceTokenCodec;
}): Promise<IssuedMcpEvidenceResource> {
  const authorization = input.authorization;
  if (!isAuthorizedGetJobArtifactEvidenceRead(authorization)) {
    throw new EvidenceIssuanceError("MCP_EVIDENCE_ISSUANCE_INVALID");
  }
  const parsed = GetJobArtifactEvidenceSourceResultSchema.safeParse(
    input.result
  );
  const auth = authorization.actorContext.auth;
  if (
    !parsed.success ||
    parsed.data.content.kind !== "binary_resource" ||
    parsed.data.artifact.evidence_ref !== authorization.query.evidence_ref ||
    parsed.data.artifact.source_kind !== authorization.query.source_kind ||
    parsed.data.proof.source_revisions.length !== 2 ||
    parsed.data.proof.source_revisions[0]?.domain !== "artifacts" ||
    parsed.data.proof.source_revisions[1]?.domain !== "legacy_operational" ||
    auth.channel !== "mcp" ||
    auth.oauthGrantId !== authorization.oauthGrantId ||
    auth.oauthClientId !== authorization.oauthClientId ||
    auth.audience.trim() !== auth.audience ||
    auth.issuer.trim() !== auth.issuer
  ) {
    throw new EvidenceIssuanceError("MCP_EVIDENCE_ISSUANCE_INVALID");
  }

  const safeInputDigest = auditInputDigest({
    job_ref: authorization.query.job_ref,
    source_kind: authorization.query.source_kind,
    evidence_ref: authorization.query.evidence_ref,
    source_revisions: parsed.data.proof.source_revisions,
  });
  let decision;
  try {
    decision = await input.durableRateLimiter.consume({
      requestId: authorization.actorContext.requestId,
      grantId: authorization.oauthGrantId,
      actorUserId: authorization.actorContext.actorUserId,
      companyId: authorization.actorContext.companyId,
      capabilityId: "issue_mcp_evidence",
      protocolEra: input.protocolEra,
      bucket: "evidence_search",
    });
  } catch {
    await issuanceAudit({
      authorization,
      rpcClient: input.auditRpcClient,
      protocolEra: input.protocolEra,
      outcome: "internal",
      errorCode: "TEMPORARILY_UNAVAILABLE",
      inputSha256: safeInputDigest,
      resultBytes: null,
    });
    throw new EvidenceIssuanceError("MCP_EVIDENCE_ISSUANCE_UNAVAILABLE");
  }
  if (!decision.allowed) {
    await issuanceAudit({
      authorization,
      rpcClient: input.auditRpcClient,
      protocolEra: input.protocolEra,
      outcome: "rate_limited",
      errorCode: "RATE_LIMITED",
      inputSha256: safeInputDigest,
      resultBytes: null,
    });
    throw new EvidenceIssuanceError("MCP_EVIDENCE_ISSUANCE_RATE_LIMITED");
  }

  let issued: VerifiedMcpEvidenceToken;
  try {
    issued = (
      input.tokenCodec ?? createConfiguredMcpEvidenceTokenCodec()
    ).issue({
      audience: auth.audience,
      clientId: auth.oauthClientId,
      grantId: auth.oauthGrantId,
      actorUserId: authorization.actorContext.actorUserId,
      companyId: authorization.actorContext.companyId,
      parent: { ...authorization.query.job_ref },
      sourceKind: authorization.query.source_kind,
      evidenceRef: authorization.query.evidence_ref,
      sourceRevisions: [
        {
          domain: "artifacts",
          source_revision:
            parsed.data.proof.source_revisions[0].source_revision,
        },
        {
          domain: "legacy_operational",
          source_revision:
            parsed.data.proof.source_revisions[1].source_revision,
        },
      ],
    });
  } catch {
    await issuanceAudit({
      authorization,
      rpcClient: input.auditRpcClient,
      protocolEra: input.protocolEra,
      outcome: "internal",
      errorCode: "TEMPORARILY_UNAVAILABLE",
      inputSha256: safeInputDigest,
      resultBytes: null,
    });
    throw new EvidenceIssuanceError("MCP_EVIDENCE_ISSUANCE_UNAVAILABLE");
  }

  await issuanceAudit({
    authorization,
    rpcClient: input.auditRpcClient,
    protocolEra: input.protocolEra,
    outcome: "ok",
    errorCode: null,
    inputSha256: safeInputDigest,
    resultBytes: parsed.data.content.byte_size,
  });
  return Object.freeze({
    resourceLink: Object.freeze({
      type: "resource_link" as const,
      name: "OPS evidence" as const,
      uri: `${auth.issuer}/api/mcp/evidence/${encodeURIComponent(issued.token)}`,
      size: parsed.data.content.byte_size,
    }),
    expiresAt: issued.claims.expiresAt,
  });
}

type RpcResponse = { readonly data: unknown; readonly error: unknown };
type AbortableRpcRequest = PromiseLike<RpcResponse> & {
  abortSignal(signal: AbortSignal): PromiseLike<RpcResponse>;
};

function supportsAbortSignal(
  value: PromiseLike<RpcResponse>
): value is AbortableRpcRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    "abortSignal" in value &&
    typeof value.abortSignal === "function"
  );
}

async function redeemWithDeadline(
  client: McpOAuthRpcClient,
  args: Readonly<Record<string, unknown>>
): Promise<RpcResponse> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new EvidenceRedemptionUnavailableError());
    }, REDEMPTION_TIMEOUT_MS);
  });
  try {
    const raw = client.rpc(REDEMPTION_RPC, args);
    const request = supportsAbortSignal(raw)
      ? raw.abortSignal(controller.signal)
      : raw;
    return await Promise.race([Promise.resolve(request), deadline]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

export function createMcpEvidenceRedeemer(
  client: McpOAuthRpcClient
): McpEvidenceRedeemer {
  let rpc: McpOAuthRpcClient["rpc"] | undefined;
  try {
    rpc = client?.rpc;
  } catch {
    rpc = undefined;
  }
  if (typeof rpc !== "function") {
    throw new TypeError("An MCP evidence redemption RPC client is required");
  }
  const rpcClient: McpOAuthRpcClient = Object.freeze({
    rpc(name: string, args: Readonly<Record<string, unknown>>) {
      return Reflect.apply(rpc!, client, [name, args]);
    },
  });

  return Object.freeze({
    async redeem(
      rawInput: McpEvidenceRedeemInput
    ): Promise<McpEvidenceRedemptionResult> {
      const { actorContext, grantFacts, token } = rawInput;
      const auth = actorContext?.auth;
      if (
        !isVerifiedMcpEvidenceToken(token) ||
        !isActorContext(actorContext) ||
        auth.channel !== "mcp" ||
        rawInput.requestId !== rawInput.requestId.trim() ||
        rawInput.requestId.length < 1 ||
        rawInput.requestId.length > 256 ||
        !TOKEN_HASH_PATTERN.test(grantFacts.tokenId) ||
        token.claims.audience !== auth.audience ||
        token.claims.clientId !== auth.oauthClientId ||
        token.claims.grantId !== auth.oauthGrantId ||
        token.claims.actorUserId !== actorContext.actorUserId ||
        token.claims.companyId !== actorContext.companyId ||
        grantFacts.grantId !== auth.oauthGrantId ||
        grantFacts.clientId !== auth.oauthClientId ||
        grantFacts.actorUserId !== actorContext.actorUserId ||
        grantFacts.companyId !== actorContext.companyId
      ) {
        throw new EvidenceRedemptionUnavailableError();
      }
      const required = requirements({
        sourceKind: token.claims.sourceKind,
        parentKind: token.claims.parent.kind,
      });
      const grantedScopeCeiling = sortedUnique(auth.scopeCeiling);
      if (
        !sameStrings(grantedScopeCeiling, sortedUnique(grantFacts.scopes)) ||
        required.requiredOAuthScopes.some(
          (scope) => !grantedScopeCeiling.includes(scope)
        )
      ) {
        throw new EvidenceRedemptionUnavailableError();
      }
      const resolvedPermissionScopes: Record<string, PermissionScope> = {};
      for (const key of required.requiredPermissionKeys) {
        const scope =
          actorContext.effectivePermissions[
            key as keyof typeof actorContext.effectivePermissions
          ];
        if (!scope) throw new EvidenceRedemptionUnavailableError();
        resolvedPermissionScopes[key] = scope;
      }

      let response: RpcResponse;
      try {
        response = await redeemWithDeadline(rpcClient, {
          p_request_id: rawInput.requestId,
          p_protocol_era: rawInput.protocolEra,
          p_access_token_hash: grantFacts.tokenId,
          p_issuer: auth.issuer,
          p_audience: auth.audience,
          p_actor_user_id: actorContext.actorUserId,
          p_company_id: actorContext.companyId,
          p_oauth_grant_id: auth.oauthGrantId,
          p_oauth_client_id: auth.oauthClientId,
          p_grant_revision: auth.grantRevision,
          p_granted_scope_ceiling: [...grantedScopeCeiling],
          p_permission_snapshot_revision:
            actorContext.permissionSnapshotRevision,
          p_registered_permission_keys: [...REGISTERED_ACTOR_PERMISSION_KEYS],
          p_required_oauth_scopes: [...required.requiredOAuthScopes],
          p_resolved_permission_scopes: { ...resolvedPermissionScopes },
          p_job_kind: token.claims.parent.kind,
          p_job_id: token.claims.parent.id,
          p_source_kind: token.claims.sourceKind,
          p_evidence_ref: token.claims.evidenceRef,
          p_artifact_source_revision:
            token.claims.sourceRevisions[0].source_revision,
          p_operational_source_revision:
            token.claims.sourceRevisions[1].source_revision,
          p_nonce_digest: token.nonceDigest,
          p_source_revision_digest: token.sourceRevisionDigest,
          p_binding_digest: token.bindingDigest,
          p_issued_at: new Date(token.claims.issuedAt * 1_000).toISOString(),
          p_expires_at: new Date(token.claims.expiresAt * 1_000).toISOString(),
        });
      } catch {
        throw new EvidenceRedemptionUnavailableError();
      }
      if (
        response.error != null ||
        !Array.isArray(response.data) ||
        response.data.length !== 1
      ) {
        throw new EvidenceRedemptionUnavailableError();
      }
      const parsed = RedemptionRowSchema.safeParse(response.data[0]);
      if (!parsed.success) throw new EvidenceRedemptionUnavailableError();
      if (parsed.data.outcome !== "delivered") {
        return Object.freeze({ outcome: parsed.data.outcome });
      }
      return Object.freeze({
        outcome: "delivered" as const,
        locatorKind: parsed.data.locator_kind,
        locator: parsed.data.locator,
        mimeType: parsed.data.mime_type,
        byteSize: parsed.data.byte_size,
      });
    },
  });
}
