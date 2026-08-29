import "server-only";

import { randomUUID } from "node:crypto";

import {
  isTrustedActorAuthorityRepository,
  type ActorAuthorityRepository,
} from "@/lib/agent-control-plane/actor/authority-repository";
import {
  ActorAccessError,
  actorForbidden,
  authorizationInternal,
  authorizationUnavailable,
} from "@/lib/agent-control-plane/actor/errors";
import { createInternalPrincipalFromVerifiedPhaseCRouting } from "@/lib/agent-control-plane/actor/principal-boundary";
import { resolveActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import { snapshotExactOwnEnumerableData } from "@/lib/agent-control-plane/actor/exact-own-data-snapshot";
import { CAPABILITY_MANIFEST_REVISION } from "@/lib/agent-control-plane/registry/capability-manifest";
import { isTrustedOpsAgentDomainService } from "@/lib/agent-control-plane/services/create-domain-service";
import type {
  JobConversationContextDomainResult,
  OpsAgentDomainService,
} from "@/lib/agent-control-plane/services/domain-service";
import { isTrustedOpsAgentReadCatalogueService } from "@/lib/agent-control-plane/services/read-catalogue-service";
import {
  isTrustedPhaseCSourceTurnRepository,
  type PhaseCSourceTurnRepository,
} from "@/lib/agent-control-plane/adapters/phase-c-source-turn-repository";
import {
  isResolvedPhaseCEmailActorContext,
  type PhaseCEmailActorContext,
} from "@/lib/email/phase-c-email-actor";

const ACTOR_POLICY_REVISION = "actor-policy:v1";
const EXACT_TURN_LIMIT = 20;
const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const INTERNAL_PHASE_C_REQUEST_KEYS = [
  "routedActor",
  "sourceActivityId",
] as const;
const ROUTED_ACTOR_KEYS = [
  "actorUserId",
  "assignmentVersion",
  "assignmentEventId",
  "companyId",
  "connectionId",
  "opportunityId",
  "internalThreadId",
  "providerThreadId",
  "connectionType",
  "actorNameSnapshot",
  "actorEmailSnapshot",
  "clientFacingAddressSnapshot",
] as const;

export interface InternalPhaseCConversationContextRequest {
  /** Non-transferable output of the canonical mailbox/job actor resolver. */
  readonly routedActor: PhaseCEmailActorContext;
  /** Canonical inbound activity that triggered this reply attempt. */
  readonly sourceActivityId: string;
}

export interface InternalPhaseCAdapter {
  getJobConversationContext(
    request: InternalPhaseCConversationContextRequest
  ): Promise<JobConversationContextDomainResult>;
}

export interface CreateInternalPhaseCAdapterInput {
  readonly domainService: OpsAgentDomainService;
  readonly authorityRepository: ActorAuthorityRepository;
  readonly sourceTurnRepository: PhaseCSourceTurnRepository;
}

function invalidSourceActivity(requestId: string): ActorAccessError {
  return new ActorAccessError({
    requestId,
    code: "INVALID_ARGUMENT",
    message: "The input is invalid.",
    retryable: false,
    auditReason: "phase_c_source_activity_invalid",
    fieldIssues: [
      {
        path: ["sourceActivityId"],
        code: "INVALID_ARGUMENT",
        message: "A canonical inbound activity is required.",
      },
    ],
  });
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value;
}

/**
 * Phase C transport adapter. It translates only trusted route metadata; it
 * cannot accept tenant, actor, mailbox, or job identifiers independently.
 */
export function createInternalPhaseCAdapter(
  input: CreateInternalPhaseCAdapterInput
): InternalPhaseCAdapter {
  const domainService = input?.domainService;
  const authorityRepository = input?.authorityRepository;
  const sourceTurnRepository = input?.sourceTurnRepository;
  if (
    (!isTrustedOpsAgentDomainService(domainService) &&
      !isTrustedOpsAgentReadCatalogueService(domainService)) ||
    !isTrustedActorAuthorityRepository(authorityRepository) ||
    !isTrustedPhaseCSourceTurnRepository(sourceTurnRepository)
  ) {
    throw new TypeError("Trusted Phase C adapter dependencies are required");
  }
  const resolveSourceTurn = sourceTurnRepository.resolve;

  const getJobConversationContext = async (
    request: InternalPhaseCConversationContextRequest
  ): Promise<JobConversationContextDomainResult> => {
    const requestId = randomUUID();
    const requestSnapshot = snapshotExactOwnEnumerableData(
      request,
      INTERNAL_PHASE_C_REQUEST_KEYS
    );
    if (!requestSnapshot) {
      throw actorForbidden(requestId, "phase_c_request_invalid");
    }
    const routedActor = requestSnapshot.routedActor;
    const routedActorSnapshot = snapshotExactOwnEnumerableData(
      routedActor,
      ROUTED_ACTOR_KEYS
    );
    if (
      !isResolvedPhaseCEmailActorContext(routedActor) ||
      !routedActorSnapshot
    ) {
      throw actorForbidden(requestId, "phase_c_routed_actor_untrusted");
    }
    const sourceActivityId = requestSnapshot.sourceActivityId;
    if (
      typeof sourceActivityId !== "string" ||
      !CANONICAL_UUID_PATTERN.test(sourceActivityId)
    ) {
      throw invalidSourceActivity(requestId);
    }
    const actorUserId = routedActorSnapshot.actorUserId as string;
    const assignmentVersion = routedActorSnapshot.assignmentVersion as number;
    const companyId = routedActorSnapshot.companyId as string;
    const connectionId = routedActorSnapshot.connectionId as string;
    const opportunityId = routedActorSnapshot.opportunityId as string;
    const internalThreadId = routedActorSnapshot.internalThreadId as string;
    const providerThreadId = routedActorSnapshot.providerThreadId as string;

    let sourceTurn: Awaited<ReturnType<typeof resolveSourceTurn>>;
    try {
      sourceTurn = await resolveSourceTurn.call(sourceTurnRepository, {
        companyId,
        opportunityId,
        actorUserId,
        assignmentVersion,
        connectionId,
        internalThreadId,
        providerThreadId,
        sourceActivityId,
      });
    } catch {
      throw authorizationUnavailable(
        requestId,
        "phase_c_source_turn_unavailable"
      );
    }

    const principal = createInternalPrincipalFromVerifiedPhaseCRouting({
      actorUserId,
      companyId,
      assignmentVersion,
      connectionId,
      opportunityId,
      internalThreadId,
      providerThreadId,
      sourceActivityId,
      sourceTurnId: sourceTurn.turnId,
      sourceConversationId: sourceTurn.conversationId,
      applicationId: "phase-c",
      protocolEra: "internal-v1",
    });
    const actorContext = await resolveActorContext({
      principal,
      authorityRepository,
      requestId,
      causationId: sourceTurn.turnId,
      policyRevision: ACTOR_POLICY_REVISION,
      capabilityManifestRevision: CAPABILITY_MANIFEST_REVISION,
    });

    const result = await domainService.getJobConversationContext(actorContext, {
      job_ref: {
        kind: "opportunity",
        id: opportunityId,
      },
      exact_turn_limit: EXACT_TURN_LIMIT,
      required_through_turn_id: sourceTurn.turnId,
      sections: [
        "memory",
        "recent_turns",
        "participants",
        "gaps",
        "cross_job_seed",
      ],
    });

    const freshnessSections = result.data.sections.filter(
      (section) => section.kind === "freshness_and_gaps"
    );
    if (
      result.request_id !== requestId ||
      result.company_id !== companyId ||
      result.actor.user_id !== actorUserId ||
      result.actor.permission_snapshot_revision !==
        actorContext.permissionSnapshotRevision ||
      result.data.requested_job.kind !== "opportunity" ||
      result.data.requested_job.id !== opportunityId ||
      result.data.conversation_id !== sourceTurn.conversationId ||
      freshnessSections.length !== 1 ||
      freshnessSections[0]!.required_through.turn_id !== sourceTurn.turnId ||
      freshnessSections[0]!.required_through.state !== "summarized"
    ) {
      throw authorizationInternal(
        requestId,
        "phase_c_domain_result_authority_mismatch"
      );
    }
    return deepFreeze(result);
  };

  return Object.freeze({ getJobConversationContext });
}
