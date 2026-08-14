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
import {
  isTrustedJobCommunicationContextRepository,
  type JobCommunicationContextRepository,
} from "./job-communication-context-repository";
import {
  isTrustedJobParticipantsRepository,
  type JobParticipantsRepository,
} from "./job-participants-repository";

declare const TRUSTED_OPS_AGENT_DOMAIN_REPOSITORIES: unique symbol;
const TRUSTED_REPOSITORY_BUNDLES = new WeakSet<object>();

interface TrustedOpsAgentDomainRepositoriesBrand {
  readonly [TRUSTED_OPS_AGENT_DOMAIN_REPOSITORIES]: true;
}

export interface OpsAgentDomainRepositories
  extends TrustedOpsAgentDomainRepositoriesBrand {
  readonly jobConversationContext: JobConversationContextRepository;
  readonly scheduledJobs: ScheduledJobsRepository;
  readonly jobReadiness: JobReadinessRepository;
  readonly jobCommunicationContext: JobCommunicationContextRepository;
  readonly jobParticipants: JobParticipantsRepository;
}

export interface CreateOpsAgentDomainRepositoriesInput {
  readonly jobConversationContext: JobConversationContextRepository;
  readonly scheduledJobs: ScheduledJobsRepository;
  readonly jobReadiness: JobReadinessRepository;
  readonly jobCommunicationContext: JobCommunicationContextRepository;
  readonly jobParticipants: JobParticipantsRepository;
}

export function createOpsAgentDomainRepositories(
  input: CreateOpsAgentDomainRepositoriesInput
): OpsAgentDomainRepositories {
  const jobConversationContext = input?.jobConversationContext;
  const scheduledJobs = input?.scheduledJobs;
  const jobReadiness = input?.jobReadiness;
  const jobCommunicationContext = input?.jobCommunicationContext;
  const jobParticipants = input?.jobParticipants;
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
  if (!isTrustedJobCommunicationContextRepository(jobCommunicationContext)) {
    throw new TypeError(
      "A trusted job communication context repository is required"
    );
  }
  if (!isTrustedJobParticipantsRepository(jobParticipants)) {
    throw new TypeError("A trusted job-participants repository is required");
  }

  const repositories = {
    jobConversationContext,
    scheduledJobs,
    jobReadiness,
    jobCommunicationContext,
    jobParticipants,
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
