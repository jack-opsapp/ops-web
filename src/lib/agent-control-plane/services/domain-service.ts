import "server-only";

import type { ActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import type {
  JobCommunicationContextInput,
  JobCommunicationContextResult,
  JobParticipantsInput,
  JobParticipantsResult,
} from "@/lib/agent-control-plane/contracts/communication";
import type { GetJobConversationContextInput } from "@/lib/agent-control-plane/registry/read-tools";
import type {
  JobReadinessIssuesInput,
  ListScheduledJobsInput,
} from "@/lib/agent-control-plane/registry/read-tools";
import type { JobConversationContextResult } from "./get-job-conversation-context";
import type { ScheduledJobsResult } from "./list-scheduled-jobs";
import type { JobReadinessResult } from "./list-job-readiness-issues";

export type {
  GetJobConversationContextInput,
  JobCommunicationContextInput,
  JobParticipantsInput,
  JobReadinessIssuesInput,
  ListScheduledJobsInput,
};

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
  listScheduledJobs(
    actorContext: ActorContext,
    input: ListScheduledJobsInput,
    options?: DomainCallOptions
  ): Promise<ScheduledJobsResult>;
  listJobReadinessIssues(
    actorContext: ActorContext,
    input: JobReadinessIssuesInput,
    options?: DomainCallOptions
  ): Promise<JobReadinessResult>;
  getJobCommunicationContext(
    actorContext: ActorContext,
    input: JobCommunicationContextInput,
    options?: DomainCallOptions
  ): Promise<JobCommunicationContextResult>;
  resolveJobParticipants(
    actorContext: ActorContext,
    input: JobParticipantsInput,
    options?: DomainCallOptions
  ): Promise<JobParticipantsResult>;
}
