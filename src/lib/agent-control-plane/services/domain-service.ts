import "server-only";

import type { ActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import type { GetJobConversationContextInput } from "@/lib/agent-control-plane/registry/read-tools";
import type { JobConversationContextResult } from "./get-job-conversation-context";

export type { GetJobConversationContextInput };

export interface DomainCallOptions {
  readonly signal?: AbortSignal;
}

/**
 * Transport-neutral OPS operations that have a real implementation and have
 * passed their domain gates. Future manifest capabilities are added here only
 * with their concrete service, repository, and tests.
 */
export interface OpsAgentDomainService {
  getJobConversationContext(
    actorContext: ActorContext,
    input: GetJobConversationContextInput,
    options?: DomainCallOptions
  ): Promise<JobConversationContextResult>;
}
