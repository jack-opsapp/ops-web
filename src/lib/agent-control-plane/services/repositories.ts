import "server-only";

import {
  isTrustedJobConversationContextRepository,
  type JobConversationContextRepository,
} from "./job-conversation-context-repository";

declare const TRUSTED_OPS_AGENT_DOMAIN_REPOSITORIES: unique symbol;
const TRUSTED_REPOSITORY_BUNDLES = new WeakSet<object>();

interface TrustedOpsAgentDomainRepositoriesBrand {
  readonly [TRUSTED_OPS_AGENT_DOMAIN_REPOSITORIES]: true;
}

export interface OpsAgentDomainRepositories extends TrustedOpsAgentDomainRepositoriesBrand {
  readonly jobConversationContext: JobConversationContextRepository;
}

export interface CreateOpsAgentDomainRepositoriesInput {
  readonly jobConversationContext: JobConversationContextRepository;
}

export function createOpsAgentDomainRepositories(
  input: CreateOpsAgentDomainRepositoriesInput
): OpsAgentDomainRepositories {
  const jobConversationContext = input?.jobConversationContext;
  if (!isTrustedJobConversationContextRepository(jobConversationContext)) {
    throw new TypeError(
      "A trusted job conversation context repository is required"
    );
  }

  const repositories = {
    jobConversationContext,
  };
  TRUSTED_REPOSITORY_BUNDLES.add(repositories);
  return Object.freeze(repositories) as OpsAgentDomainRepositories;
}

export function isTrustedOpsAgentDomainRepositories(
  value: unknown
): value is OpsAgentDomainRepositories {
  return (
    typeof value === "object" &&
    value !== null &&
    TRUSTED_REPOSITORY_BUNDLES.has(value)
  );
}
