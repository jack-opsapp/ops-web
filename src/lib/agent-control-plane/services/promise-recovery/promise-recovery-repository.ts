import "server-only";

import { z } from "zod-v4";

import type { ActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import { Rfc3339UtcTimestampSchema } from "@/lib/agent-control-plane/contracts/common";
import {
  PROMISE_RECOVERY_MAX_ATTACHMENT_REFS,
  PROMISE_RECOVERY_MAX_BODY_CHARACTERS,
  PROMISE_RECOVERY_MAX_SOURCE_ROWS,
  PROMISE_RECOVERY_MAX_TOTAL_BODY_CHARACTERS,
} from "@/lib/agent-control-plane/contracts/promise-recovery";
import { P2CanonicalUuidSchema } from "@/lib/agent-control-plane/contracts/p2-common";
import { PROMISE_RECOVERY_CAPABILITY_MANIFEST_REVISION } from "@/lib/agent-control-plane/registry/capability-manifest";

export const PROMISE_RECOVERY_EXPOSURE_REVISION =
  "2026-09-01.mcp-exposure.v6" as const;
const PROMISE_RECOVERY_CAPABILITY_ID = "check_customer_reply" as const;
const PROMISE_RECOVERY_CAPABILITY_REVISION =
  "check_customer_reply:2026-08-31.v1" as const;
const TRUSTED_REPOSITORIES = new WeakSet<object>();

interface PromiseRecoveryRpcResult {
  readonly data: unknown;
  readonly error: unknown;
}

interface PromiseRecoveryRpcRequest extends PromiseLike<PromiseRecoveryRpcResult> {
  abortSignal?: (signal: AbortSignal) => PromiseLike<PromiseRecoveryRpcResult>;
}

export interface PromiseRecoveryRpcClient {
  rpc(
    functionName: string,
    args: Readonly<Record<string, unknown>>
  ): PromiseRecoveryRpcRequest;
}

const ExactCustomerSchema = z
  .object({
    state: z.literal("exact"),
    candidate_count: z.literal(1),
    client_id: P2CanonicalUuidSchema,
    display_name: z.string().min(1).max(240),
    identity_available: z.boolean(),
    identity_ambiguous: z.boolean(),
  })
  .strict();

const CustomerResolutionSchema = z.discriminatedUnion("state", [
  ExactCustomerSchema,
  z
    .object({
      state: z.literal("not_found"),
      candidate_count: z.literal(0),
      client_id: z.null(),
      display_name: z.null(),
      identity_available: z.literal(false),
      identity_ambiguous: z.literal(false),
    })
    .strict(),
  z
    .object({
      state: z.literal("ambiguous"),
      candidate_count: z.number().int().min(2).max(25),
      client_id: z.null(),
      display_name: z.null(),
      identity_available: z.literal(false),
      identity_ambiguous: z.literal(false),
    })
    .strict(),
]);

const SourceSchema = z
  .object({
    id: P2CanonicalUuidSchema,
    delivered_at: Rfc3339UtcTimestampSchema,
    direction: z.enum(["inbound", "outbound"]),
    safe_subject: z.string().max(1_000).nullable(),
    safe_body: z.string().max(PROMISE_RECOVERY_MAX_BODY_CHARACTERS).nullable(),
    body_state: z.enum([
      "readable",
      "unreadable",
      "oversized",
      "payload_bound",
    ]),
    normalization_revision: z.string().trim().min(1).max(160),
    source_sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    participant_attribution: z.enum(["exact", "thread_only"]),
    operator_attribution: z.enum(["exact", "unresolved", "not_applicable"]),
    attachment_enumeration_complete: z.boolean(),
    attachment_evidence_ids: z
      .array(
        z
          .string()
          .refine(
            (value) =>
              value.startsWith("email_attachment:") &&
              P2CanonicalUuidSchema.safeParse(
                value.slice("email_attachment:".length)
              ).success,
            "PROMISE_RECOVERY_ATTACHMENT_EVIDENCE_INVALID"
          )
      )
      .max(PROMISE_RECOVERY_MAX_ATTACHMENT_REFS),
    turn_id: P2CanonicalUuidSchema.nullable(),
  })
  .strict()
  .refine(
    (row) =>
      (row.body_state === "readable" && row.safe_body !== null) ||
      (row.body_state !== "readable" && row.safe_body === null),
    "PROMISE_RECOVERY_SOURCE_BODY_STATE_INVALID"
  )
  .refine(
    (row) =>
      (row.direction === "inbound" &&
        row.operator_attribution === "not_applicable") ||
      (row.direction === "outbound" &&
        row.operator_attribution !== "not_applicable"),
    "PROMISE_RECOVERY_OPERATOR_ATTRIBUTION_INVALID"
  );

const SnapshotSchema = z
  .object({
    customer_resolution: CustomerResolutionSchema,
    population_count: z.number().int().nonnegative().max(501),
    source_bound_reached: z.boolean(),
    first_delivered_at: Rfc3339UtcTimestampSchema.nullable(),
    last_delivered_at: Rfc3339UtcTimestampSchema.nullable(),
    sources: z.array(SourceSchema).max(PROMISE_RECOVERY_MAX_SOURCE_ROWS),
  })
  .strict()
  .superRefine((snapshot, context) => {
    const exact = snapshot.customer_resolution.state === "exact";
    const timestampsValid =
      snapshot.population_count === 0
        ? snapshot.first_delivered_at === null &&
          snapshot.last_delivered_at === null
        : snapshot.first_delivered_at !== null &&
          snapshot.last_delivered_at !== null &&
          snapshot.first_delivered_at <= snapshot.last_delivered_at;
    const boundValid = snapshot.source_bound_reached
      ? snapshot.population_count === 501 &&
        snapshot.sources.length === PROMISE_RECOVERY_MAX_SOURCE_ROWS
      : snapshot.population_count === snapshot.sources.length;
    const chronology = snapshot.sources.map(
      (source) => `${source.delivered_at}:${source.id}`
    );
    const totalBodyCharacters = snapshot.sources.reduce(
      (total, source) =>
        total +
        (source.safe_body === null ? 0 : Array.from(source.safe_body).length),
      0
    );
    const attachmentReferenceCount = snapshot.sources.reduce(
      (total, source) => total + source.attachment_evidence_ids.length,
      0
    );
    if (
      (!exact &&
        (snapshot.population_count !== 0 || snapshot.sources.length !== 0)) ||
      !timestampsValid ||
      !boundValid ||
      new Set(snapshot.sources.map((source) => source.id)).size !==
        snapshot.sources.length ||
      totalBodyCharacters > PROMISE_RECOVERY_MAX_TOTAL_BODY_CHARACTERS ||
      attachmentReferenceCount > PROMISE_RECOVERY_MAX_ATTACHMENT_REFS ||
      chronology.some(
        (key, index) => index > 0 && chronology[index - 1]! >= key
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "PROMISE_RECOVERY_SNAPSHOT_INVALID",
      });
    }
  });

export interface PromiseRecoverySource {
  readonly id: string;
  readonly deliveredAt: string;
  readonly direction: "inbound" | "outbound";
  readonly safeSubject: string | null;
  readonly safeBody: string | null;
  readonly bodyState: "readable" | "unreadable" | "oversized" | "payload_bound";
  readonly normalizationRevision: string;
  readonly sourceSha256: string;
  readonly participantAttribution: "exact" | "thread_only";
  readonly operatorAttribution: "exact" | "unresolved" | "not_applicable";
  readonly attachmentEnumerationComplete: boolean;
  readonly attachmentEvidenceIds: readonly string[];
  readonly turnId: string | null;
}

export interface PromiseRecoverySnapshot {
  readonly customerResolution:
    | Readonly<{
        state: "exact";
        candidateCount: 1;
        clientId: string;
        displayName: string;
        identityAvailable: boolean;
        identityAmbiguous: boolean;
      }>
    | Readonly<{
        state: "not_found" | "ambiguous";
        candidateCount: number;
        clientId: null;
        displayName: null;
        identityAvailable: false;
        identityAmbiguous: false;
      }>;
  readonly populationCount: number;
  readonly sourceBoundReached: boolean;
  readonly firstDeliveredAt: string | null;
  readonly lastDeliveredAt: string | null;
  readonly sources: readonly PromiseRecoverySource[];
}

export interface PromiseRecoveryRepository {
  read(input: {
    actorContext: ActorContext;
    customerQuery: string;
    asOf: string;
    signal?: AbortSignal;
  }): Promise<PromiseRecoverySnapshot>;
}

function actorBinding(actorContext: ActorContext) {
  if (
    actorContext.auth.channel !== "mcp" ||
    actorContext.capabilityManifestRevision !==
      PROMISE_RECOVERY_CAPABILITY_MANIFEST_REVISION
  ) {
    throw new TypeError("Promise recovery requires a v12 MCP actor");
  }
  return {
    p_actor_user_id: actorContext.actorUserId,
    p_company_id: actorContext.companyId,
    p_oauth_grant_id: actorContext.auth.oauthGrantId,
    p_oauth_client_id: actorContext.auth.oauthClientId,
    p_grant_revision: actorContext.auth.grantRevision,
    p_granted_scope_ceiling: [...actorContext.auth.scopeCeiling],
    p_permission_snapshot_revision: actorContext.permissionSnapshotRevision,
    p_capability_manifest_revision:
      PROMISE_RECOVERY_CAPABILITY_MANIFEST_REVISION,
    p_exposure_revision: PROMISE_RECOVERY_EXPOSURE_REVISION,
    p_capability_id: PROMISE_RECOVERY_CAPABILITY_ID,
    p_capability_revision: PROMISE_RECOVERY_CAPABILITY_REVISION,
  } as const;
}

function freezeSnapshot(
  parsed: z.infer<typeof SnapshotSchema>
): PromiseRecoverySnapshot {
  const customer = parsed.customer_resolution;
  const customerResolution =
    customer.state === "exact"
      ? Object.freeze({
          state: customer.state,
          candidateCount: customer.candidate_count,
          clientId: customer.client_id,
          displayName: customer.display_name,
          identityAvailable: customer.identity_available,
          identityAmbiguous: customer.identity_ambiguous,
        })
      : Object.freeze({
          state: customer.state,
          candidateCount: customer.candidate_count,
          clientId: null,
          displayName: null,
          identityAvailable: false as const,
          identityAmbiguous: false as const,
        });
  const sources = parsed.sources.map((source) =>
    Object.freeze({
      id: source.id,
      deliveredAt: source.delivered_at,
      direction: source.direction,
      safeSubject: source.safe_subject,
      safeBody: source.safe_body,
      bodyState: source.body_state,
      normalizationRevision: source.normalization_revision,
      sourceSha256: source.source_sha256,
      participantAttribution: source.participant_attribution,
      operatorAttribution: source.operator_attribution,
      attachmentEnumerationComplete: source.attachment_enumeration_complete,
      attachmentEvidenceIds: Object.freeze([...source.attachment_evidence_ids]),
      turnId: source.turn_id,
    })
  );
  return Object.freeze({
    customerResolution,
    populationCount: parsed.population_count,
    sourceBoundReached: parsed.source_bound_reached,
    firstDeliveredAt: parsed.first_delivered_at,
    lastDeliveredAt: parsed.last_delivered_at,
    sources: Object.freeze(sources),
  });
}

export function createPromiseRecoveryRepository(input: {
  rpc: PromiseRecoveryRpcClient["rpc"];
}): PromiseRecoveryRepository {
  if (!input || typeof input.rpc !== "function") {
    throw new TypeError("A promise-recovery RPC client is required");
  }
  const repository: PromiseRecoveryRepository = {
    async read(request) {
      const rpcRequest = input.rpc("read_agent_promise_recovery_as_system", {
        ...actorBinding(request.actorContext),
        p_customer_query: request.customerQuery,
        p_as_of: request.asOf,
      });
      const response =
        request.signal && rpcRequest.abortSignal
          ? await rpcRequest.abortSignal(request.signal)
          : await rpcRequest;
      if (response.error) {
        throw new Error("Promise-recovery storage is unavailable");
      }
      return freezeSnapshot(SnapshotSchema.parse(response.data));
    },
  };
  TRUSTED_REPOSITORIES.add(repository);
  return Object.freeze(repository);
}

export function isTrustedPromiseRecoveryRepository(
  value: unknown
): value is PromiseRecoveryRepository {
  return (
    typeof value === "object" &&
    value !== null &&
    TRUSTED_REPOSITORIES.has(value)
  );
}
