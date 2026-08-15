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
import {
  isTrustedCustomerJobsRepository,
  type CustomerJobsRepository,
} from "./customer-jobs-repository";
import {
  isTrustedJobSummaryRepository,
  type JobSummaryRepository,
} from "./job-summary-repository";
import {
  isTrustedJobHistoryRepository,
  type JobHistoryRepository,
} from "./job-history-repository";
import {
  isTrustedCorrespondenceEvidencePageRepository,
  type CorrespondenceEvidencePageRepository,
} from "./correspondence-evidence-page-repository";

declare const TRUSTED_OPS_AGENT_DOMAIN_REPOSITORIES: unique symbol;
const TRUSTED_REPOSITORY_BUNDLES = new WeakSet<object>();

interface TrustedOpsAgentDomainRepositoriesBrand {
  readonly [TRUSTED_OPS_AGENT_DOMAIN_REPOSITORIES]: true;
}

export interface OpsAgentDomainRepositories extends TrustedOpsAgentDomainRepositoriesBrand {
  readonly jobConversationContext: JobConversationContextRepository;
  readonly scheduledJobs: ScheduledJobsRepository;
  readonly jobReadiness: JobReadinessRepository;
  readonly jobCommunicationContext: JobCommunicationContextRepository;
  readonly jobParticipants: JobParticipantsRepository;
  readonly customerJobs: CustomerJobsRepository;
  readonly jobSummary: JobSummaryRepository;
  readonly jobHistory: JobHistoryRepository;
  readonly correspondenceEvidence: CorrespondenceEvidencePageRepository;
}

export interface CreateOpsAgentDomainRepositoriesInput {
  readonly jobConversationContext: JobConversationContextRepository;
  readonly scheduledJobs: ScheduledJobsRepository;
  readonly jobReadiness: JobReadinessRepository;
  readonly jobCommunicationContext: JobCommunicationContextRepository;
  readonly jobParticipants: JobParticipantsRepository;
  readonly customerJobs: CustomerJobsRepository;
  readonly jobSummary: JobSummaryRepository;
  readonly jobHistory: JobHistoryRepository;
  readonly correspondenceEvidence: CorrespondenceEvidencePageRepository;
}

export function createOpsAgentDomainRepositories(
  input: CreateOpsAgentDomainRepositoriesInput
): OpsAgentDomainRepositories {
  const jobConversationContext = input?.jobConversationContext;
  const scheduledJobs = input?.scheduledJobs;
  const jobReadiness = input?.jobReadiness;
  const jobCommunicationContext = input?.jobCommunicationContext;
  const jobParticipants = input?.jobParticipants;
  const customerJobs = input?.customerJobs;
  const jobSummary = input?.jobSummary;
  const jobHistory = input?.jobHistory;
  const correspondenceEvidence = input?.correspondenceEvidence;
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
  if (!isTrustedCustomerJobsRepository(customerJobs)) {
    throw new TypeError("A trusted customer-jobs repository is required");
  }
  if (!isTrustedJobSummaryRepository(jobSummary)) {
    throw new TypeError("A trusted job-summary repository is required");
  }
  if (!isTrustedJobHistoryRepository(jobHistory)) {
    throw new TypeError("A trusted job-history repository is required");
  }
  if (!isTrustedCorrespondenceEvidencePageRepository(correspondenceEvidence)) {
    throw new TypeError(
      "A trusted correspondence-evidence repository is required"
    );
  }

  const repositories = {
    jobConversationContext,
    scheduledJobs,
    jobReadiness,
    jobCommunicationContext,
    jobParticipants,
    customerJobs,
    jobSummary,
    jobHistory,
    correspondenceEvidence,
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
