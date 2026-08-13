import "server-only";

import {
  isTrustedJobConversationContextRepository,
  type JobConversationContextRepository,
} from "./job-conversation-context-repository";
import {
  isTrustedScheduledJobsRepository,
  type ScheduledJobsRepository,
} from "./scheduled-jobs-repository";
import {
  isTrustedJobReadinessRepository,
  type JobReadinessRepository,
} from "./job-readiness-repository";

declare const TRUSTED_OPS_AGENT_DOMAIN_REPOSITORIES: unique symbol;
const TRUSTED_REPOSITORY_BUNDLES = new WeakSet<object>();

interface TrustedOpsAgentDomainRepositoriesBrand {
  readonly [TRUSTED_OPS_AGENT_DOMAIN_REPOSITORIES]: true;
}

export interface OpsAgentDomainRepositories extends TrustedOpsAgentDomainRepositoriesBrand {
  readonly jobConversationContext: JobConversationContextRepository;
  readonly scheduledJobs: ScheduledJobsRepository;
  readonly jobReadiness: JobReadinessRepository;
}

export interface CreateOpsAgentDomainRepositoriesInput {
  readonly jobConversationContext: JobConversationContextRepository;
  readonly scheduledJobs: ScheduledJobsRepository;
  readonly jobReadiness: JobReadinessRepository;
}

export function createOpsAgentDomainRepositories(
  input: CreateOpsAgentDomainRepositoriesInput
): OpsAgentDomainRepositories {
  const jobConversationContext = input?.jobConversationContext;
  const scheduledJobs = input?.scheduledJobs;
  const jobReadiness = input?.jobReadiness;
  if (!isTrustedJobConversationContextRepository(jobConversationContext)) {
    throw new TypeError(
      "A trusted job conversation context repository is required"
    );
  }
  if (!isTrustedScheduledJobsRepository(scheduledJobs)) {
    throw new TypeError("A trusted scheduled-jobs repository is required");
  }
  if (!isTrustedJobReadinessRepository(jobReadiness)) {
    throw new TypeError("A trusted job-readiness repository is required");
  }

  const repositories = {
    jobConversationContext,
    scheduledJobs,
    jobReadiness,
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
