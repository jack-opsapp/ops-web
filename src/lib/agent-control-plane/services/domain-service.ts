import "server-only";

import type { z } from "zod-v4";

import type { ActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import type {
  JobCommunicationContextInput,
  JobCommunicationContextResult,
  JobParticipantsInput,
  JobParticipantsResult,
} from "@/lib/agent-control-plane/contracts/communication";
import type {
  CorrespondenceEvidenceReadInputSchema,
  CorrespondenceEvidenceResultSchema,
  CustomerJobsInputSchema,
  CustomerJobsResultSchema,
  JobHistoryResultSchema,
  JobHistorySearchInputSchema,
  JobSummaryInputSchema,
  JobSummaryResultSchema,
} from "@/lib/agent-control-plane/contracts/job-catalog";
import type {
  GetJobConversationContextInput,
  JobReadinessIssuesInput,
  ListScheduledJobsInput,
} from "@/lib/agent-control-plane/registry/read-tools";
import type { JobConversationContextResult } from "./get-job-conversation-context";
import type { JobReadinessResult } from "./list-job-readiness-issues";
import type { ScheduledJobsResult } from "./list-scheduled-jobs";

export type {
  GetJobConversationContextInput,
  JobCommunicationContextInput,
  JobParticipantsInput,
  JobReadinessIssuesInput,
  ListScheduledJobsInput,
};

export type CustomerJobsInput = z.input<typeof CustomerJobsInputSchema>;
export type JobSummaryInput = z.input<typeof JobSummaryInputSchema>;
export type JobHistorySearchInput = z.input<typeof JobHistorySearchInputSchema>;
export type CorrespondenceEvidenceReadInput = z.input<
  typeof CorrespondenceEvidenceReadInputSchema
>;

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
  listCustomerJobs(
    actorContext: ActorContext,
    input: CustomerJobsInput,
    options?: DomainCallOptions
  ): Promise<z.infer<typeof CustomerJobsResultSchema>>;
  getJobSummary(
    actorContext: ActorContext,
    input: JobSummaryInput,
    options?: DomainCallOptions
  ): Promise<z.infer<typeof JobSummaryResultSchema>>;
  searchJobHistory(
    actorContext: ActorContext,
    input: JobHistorySearchInput,
    options?: DomainCallOptions
  ): Promise<z.infer<typeof JobHistoryResultSchema>>;
  getCorrespondenceEvidence(
    actorContext: ActorContext,
    input: CorrespondenceEvidenceReadInput,
    options?: DomainCallOptions
  ): Promise<z.infer<typeof CorrespondenceEvidenceResultSchema>>;
}

export type JobConversationContextDomainResult = Awaited<
  ReturnType<OpsAgentDomainService["getJobConversationContext"]>
>;
