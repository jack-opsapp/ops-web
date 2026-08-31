import "server-only";

import { z } from "zod-v4";

import type { ActorAuthorityRepository } from "@/lib/agent-control-plane/actor/authority-repository";
import { authorizationInternal } from "@/lib/agent-control-plane/actor/errors";
import { createMcpPrincipalFromValidatedGrant } from "@/lib/agent-control-plane/actor/principal-boundary";
import {
  isActorContext,
  resolveActorContext,
  type ActorContext,
} from "@/lib/agent-control-plane/actor/resolve-actor-context";
import { INVISIBLE_OFFICE_CAPABILITY_MANIFEST_REVISION } from "@/lib/agent-control-plane/registry/capability-manifest";

const ACTOR_POLICY_REVISION = "actor-policy:v1" as const;
const INVISIBLE_OFFICE_EXPOSURE_REVISION =
  "2026-08-30.mcp-exposure.v3" as const;
const TRUSTED_ROUTINE_ACTOR_RESOLVERS = new WeakSet<object>();

const AuthorizedRoutineBindingSchema = z
  .object({
    authorized: z.literal(true),
    routine_id: z.uuid(),
    scheduled_for: z.iso.datetime({ offset: true }),
    actor_user_id: z.uuid(),
    company_id: z.uuid(),
    oauth_grant_id: z.uuid(),
    oauth_client_id: z.uuid(),
    grant_revision: z.string().min(1).max(256),
    granted_scope_ceiling: z.array(z.string().min(1).max(128)).max(64),
    permission_snapshot_revision: z.string().min(1).max(256),
    capability_manifest_revision: z.literal(
      INVISIBLE_OFFICE_CAPABILITY_MANIFEST_REVISION
    ),
    exposure_revision: z.literal(INVISIBLE_OFFICE_EXPOSURE_REVISION),
  })
  .strict();
const RoutineAuthorizationClaimSchema = z
  .object({
    routineId: z.uuid(),
    claimToken: z.uuid(),
    scheduledFor: z.iso.datetime({ offset: true }),
    idempotencyKey: z
      .string()
      .min(8)
      .max(200)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
  })
  .strict();

interface RoutineAuthorizationRpcResult {
  readonly data: unknown;
  readonly error: unknown;
}

interface RoutineAuthorizationRpcRequest extends PromiseLike<RoutineAuthorizationRpcResult> {
  abortSignal?: (
    signal: AbortSignal
  ) => PromiseLike<RoutineAuthorizationRpcResult>;
}

export interface DayCloseoutRoutineAuthorizationRpcClient {
  rpc(
    functionName: string,
    args: Readonly<Record<string, unknown>>
  ): RoutineAuthorizationRpcRequest;
}

export interface DayCloseoutRoutineAuthorizationClaim {
  readonly routineId: string;
  readonly claimToken: string;
  readonly scheduledFor: string;
  readonly idempotencyKey: string;
}

export interface DayCloseoutRoutineActorResolver {
  resolve(
    claim: DayCloseoutRoutineAuthorizationClaim,
    signal?: AbortSignal
  ): Promise<ActorContext>;
}

export class DayCloseoutRoutineAuthorityError extends Error {
  constructor() {
    super("Day-closeout routine authority is no longer available");
    this.name = "DayCloseoutRoutineAuthorityError";
  }
}

function errorShape(value: unknown): { code: string; message: string } | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return {
    code: typeof record.code === "string" ? record.code : "",
    message: typeof record.message === "string" ? record.message : "",
  };
}

/**
 * Narrow MCP auth adapter for reauthorizing a previously resolved actor under
 * another server-owned manifest. Domain services cannot mint principals.
 */
export async function reauthorizeResolvedMcpActor(input: {
  actorContext: ActorContext;
  authorityRepository: ActorAuthorityRepository;
  capabilityManifestRevision: string;
  signal?: AbortSignal;
}): Promise<ActorContext> {
  const actor = input.actorContext;
  if (!isActorContext(actor) || actor.auth.channel !== "mcp") {
    throw authorizationInternal(
      isActorContext(actor) ? actor.requestId : "unknown-request",
      "mcp_actor_reauthorization_source_untrusted"
    );
  }
  return await resolveMcpActorContext({
    actorUserId: actor.actorUserId,
    companyId: actor.companyId,
    oauthGrantId: actor.auth.oauthGrantId,
    oauthClientId: actor.auth.oauthClientId,
    validatedScopes: actor.auth.scopeCeiling,
    tokenId: actor.auth.tokenId,
    issuer: actor.auth.issuer,
    audience: actor.auth.audience,
    grantRevision: actor.auth.grantRevision,
    applicationId: actor.auditClient.applicationId,
    protocolEra: actor.auditClient.protocolEra,
    authorityRepository: input.authorityRepository,
    requestId: actor.requestId,
    causationId: actor.causationId,
    capabilityManifestRevision: input.capabilityManifestRevision,
    signal: input.signal,
  });
}

/** Exact auth adapter for a currently leased OPS-owned routine occurrence. */
export function createDayCloseoutRoutineActorResolver(input: {
  rpcClient: DayCloseoutRoutineAuthorizationRpcClient;
  authorityRepository: ActorAuthorityRepository;
  oauthIdentity: { issuer: string; audience: string };
}): DayCloseoutRoutineActorResolver {
  if (
    !input?.rpcClient ||
    typeof input.rpcClient.rpc !== "function" ||
    !input.authorityRepository ||
    !input.oauthIdentity?.issuer ||
    !input.oauthIdentity?.audience
  ) {
    throw new TypeError("Day-closeout routine actor dependencies are required");
  }

  const resolver: DayCloseoutRoutineActorResolver = {
    async resolve(claim, signal) {
      const requestClaim = RoutineAuthorizationClaimSchema.parse(claim);
      const request = input.rpcClient.rpc(
        "assert_agent_day_closeout_routine_claim_as_system",
        {
          p_routine_id: requestClaim.routineId,
          p_claim_token: requestClaim.claimToken,
          p_scheduled_for: requestClaim.scheduledFor,
        }
      );
      const response =
        signal && request.abortSignal
          ? await request.abortSignal(signal)
          : await request;
      if (response.error) {
        const error = errorShape(response.error);
        if (
          error?.code === "42501" ||
          error?.message.startsWith("AGENT_DAY_CLOSEOUT_AUTHORITY") ||
          error?.message.startsWith("AGENT_DAY_CLOSEOUT_GRANT") ||
          error?.message.startsWith("AGENT_DAY_CLOSEOUT_ROUTINE_AUTHORITY")
        ) {
          throw new DayCloseoutRoutineAuthorityError();
        }
        throw new Error("Day-closeout routine authorization is unavailable");
      }

      const binding = AuthorizedRoutineBindingSchema.parse(response.data);
      if (
        binding.routine_id !== requestClaim.routineId ||
        new Date(binding.scheduled_for).toISOString() !==
          new Date(requestClaim.scheduledFor).toISOString()
      ) {
        throw authorizationInternal(
          `routine-day-closeout:${requestClaim.claimToken}`,
          "mcp_routine_authorization_binding_mismatch"
        );
      }
      return await resolveMcpActorContext({
        actorUserId: binding.actor_user_id,
        companyId: binding.company_id,
        oauthGrantId: binding.oauth_grant_id,
        oauthClientId: binding.oauth_client_id,
        validatedScopes: binding.granted_scope_ceiling,
        tokenId: `routine-claim:${requestClaim.claimToken}`,
        issuer: input.oauthIdentity.issuer,
        audience: input.oauthIdentity.audience,
        grantRevision: binding.grant_revision,
        applicationId: "ops-day-closeout-routine",
        protocolEra: "ops-routine:v1",
        authorityRepository: input.authorityRepository,
        requestId: `routine-day-closeout:${requestClaim.claimToken}`,
        causationId: requestClaim.idempotencyKey,
        capabilityManifestRevision: binding.capability_manifest_revision,
        signal,
      });
    },
  };
  TRUSTED_ROUTINE_ACTOR_RESOLVERS.add(resolver);
  return Object.freeze(resolver);
}

export function isTrustedDayCloseoutRoutineActorResolver(
  value: unknown
): value is DayCloseoutRoutineActorResolver {
  return (
    typeof value === "object" &&
    value !== null &&
    TRUSTED_ROUTINE_ACTOR_RESOLVERS.has(value)
  );
}

async function resolveMcpActorContext(input: {
  actorUserId: string;
  companyId: string;
  oauthGrantId: string;
  oauthClientId: string;
  validatedScopes: readonly string[];
  tokenId: string;
  issuer: string;
  audience: string;
  grantRevision: string;
  applicationId: string | null;
  protocolEra: string | null;
  authorityRepository: ActorAuthorityRepository;
  requestId: string;
  causationId: string | null;
  capabilityManifestRevision: string;
  signal?: AbortSignal;
}): Promise<ActorContext> {
  const principal = createMcpPrincipalFromValidatedGrant({
    actorUserId: input.actorUserId,
    companyId: input.companyId,
    oauthGrantId: input.oauthGrantId,
    oauthClientId: input.oauthClientId,
    validatedScopes: input.validatedScopes,
    tokenId: input.tokenId,
    issuer: input.issuer,
    audience: input.audience,
    grantRevision: input.grantRevision,
    applicationId: input.applicationId,
    protocolEra: input.protocolEra,
  });
  return await resolveActorContext({
    principal,
    authorityRepository: input.authorityRepository,
    requestId: input.requestId,
    causationId: input.causationId,
    policyRevision: ACTOR_POLICY_REVISION,
    capabilityManifestRevision: input.capabilityManifestRevision,
    signal: input.signal,
  });
}
