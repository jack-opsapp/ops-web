import "server-only";

import { z } from "zod-v4";

import { authorizeCapability } from "@/lib/agent-control-plane/actor/authorize-capability";
import {
  ActorAccessError,
  authorizationInternal,
} from "@/lib/agent-control-plane/actor/errors";
import {
  isActorContext,
  type ActorContext,
} from "@/lib/agent-control-plane/actor/resolve-actor-context";
import {
  getCapabilityManifestEntry,
  resolveCapabilityAuthorization,
} from "@/lib/agent-control-plane/registry/capability-manifest";
import type {
  DomainCallOptions,
  GetJobConversationContextInput,
  OpsAgentDomainService,
} from "./domain-service";
import {
  getJobConversationContext as readJobConversationContext,
  type JobConversationMemoryCatchUp,
} from "./get-job-conversation-context";
import { authorizeJobConversationContextRead } from "./job-conversation-context-authorization";
import {
  isTrustedOpsAgentDomainRepositories,
  type OpsAgentDomainRepositories,
} from "./repositories";

const CAPABILITY_ID = "get_job_conversation_context" as const;

export interface CreateOpsAgentDomainServiceInput {
  readonly repositories: OpsAgentDomainRepositories;
  readonly catchUpJobConversationMemory?: JobConversationMemoryCatchUp;
  readonly now?: () => Date;
}

function invalidDomainInput(requestId: string): ActorAccessError {
  return new ActorAccessError({
    requestId,
    code: "INVALID_ARGUMENT",
    message: "The input is invalid.",
    retryable: false,
    auditReason: "domain_capability_input_invalid",
    fieldIssues: [
      {
        path: ["input"],
        code: "INVALID_ARGUMENT",
        message: "The input is invalid.",
      },
    ],
  });
}

function authorizeConversationContextRead(
  actorContext: ActorContext,
  input: GetJobConversationContextInput
) {
  if (!isActorContext(actorContext)) {
    throw authorizationInternal(
      "unknown-request",
      "domain_actor_context_source_untrusted"
    );
  }

  let resolved: ReturnType<typeof resolveCapabilityAuthorization>;
  try {
    resolved = resolveCapabilityAuthorization(CAPABILITY_ID, input);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw invalidDomainInput(actorContext.requestId);
    }
    throw authorizationInternal(
      actorContext.requestId,
      "domain_capability_resolution_failed"
    );
  }

  if (
    resolved.capability.name !== CAPABILITY_ID ||
    resolved.capability.availability.implementation !== "available" ||
    resolved.variants.length !== 1
  ) {
    throw authorizationInternal(
      actorContext.requestId,
      "domain_capability_unavailable"
    );
  }

  const authorization = authorizeCapability({
    actorContext,
    policy: resolved.variants[0]!.policy,
  });
  return authorizeJobConversationContextRead({
    authorization,
    rawInput: resolved.parsedInput,
  });
}

export function createOpsAgentDomainService(
  input: CreateOpsAgentDomainServiceInput
): OpsAgentDomainService {
  const repositories = input?.repositories;
  const catchUpMemory = input?.catchUpJobConversationMemory;
  const now = input?.now;

  if (!isTrustedOpsAgentDomainRepositories(repositories)) {
    throw new TypeError("Trusted OPS agent domain repositories are required");
  }
  if (catchUpMemory !== undefined && typeof catchUpMemory !== "function") {
    throw new TypeError("Conversation memory catch-up must be a function");
  }
  if (now !== undefined && typeof now !== "function") {
    throw new TypeError("Domain clock must be a function");
  }
  if (
    getCapabilityManifestEntry(CAPABILITY_ID).availability.implementation !==
    "available"
  ) {
    throw new TypeError("Job conversation context is not implemented");
  }

  const getJobConversationContext = async (
    actorContext: ActorContext,
    domainInput: GetJobConversationContextInput,
    options?: DomainCallOptions
  ) =>
    await readJobConversationContext({
      authorization: authorizeConversationContextRead(
        actorContext,
        domainInput
      ),
      repository: repositories.jobConversationContext,
      ...(catchUpMemory ? { catchUpMemory } : {}),
      ...(options?.signal ? { signal: options.signal } : {}),
      ...(now ? { now } : {}),
    });

  return Object.freeze({
    getJobConversationContext,
  } satisfies OpsAgentDomainService);
}
