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
  type JobCommunicationContextInput,
  type JobParticipantsInput,
} from "@/lib/agent-control-plane/contracts/communication";
import {
  getCapabilityManifestEntry,
  resolveCapabilityAuthorization,
} from "@/lib/agent-control-plane/registry/capability-manifest";
import type {
  DomainCallOptions,
  CorrespondenceEvidenceReadInput,
  CustomerJobsInput,
  GetJobConversationContextInput,
  JobHistorySearchInput,
  JobReadinessIssuesInput,
  JobSummaryInput,
  ListScheduledJobsInput,
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
import { authorizeScheduledJobsRead } from "./scheduled-jobs-authorization";
import { listScheduledJobs as readScheduledJobs } from "./list-scheduled-jobs";
import { authorizeJobReadinessRead } from "./job-readiness-authorization";
import { listJobReadinessIssues as readJobReadinessIssues } from "./list-job-readiness-issues";
import { authorizeJobCommunicationRead } from "./job-communication-authorization";
import { authorizeJobParticipantsRead } from "./job-participants-authorization";
import { getJobCommunicationContext as readJobCommunicationContext } from "./get-job-communication-context";
import { resolveJobParticipants as readJobParticipants } from "./resolve-job-participants";
import { authorizeCustomerJobsRead } from "./customer-jobs-authorization";
import { authorizeJobSummaryRead } from "./job-summary-authorization";
import { authorizeJobHistoryRead } from "./job-history-authorization";
import { authorizeCorrespondenceEvidencePageRead } from "./correspondence-evidence-page-authorization";
import { listCustomerJobs as readCustomerJobs } from "./list-customer-jobs";
import { getJobSummary as readJobSummary } from "./get-job-summary";
import { searchJobHistory as readJobHistory } from "./search-job-history";
import { getCorrespondenceEvidence as readCorrespondenceEvidence } from "./get-correspondence-evidence";

const CAPABILITY_ID = "get_job_conversation_context" as const;
const SCHEDULE_CAPABILITY_ID = "list_scheduled_jobs" as const;
const READINESS_CAPABILITY_ID = "list_job_readiness_issues" as const;
const COMMUNICATION_CAPABILITY_ID = "get_job_communication_context" as const;
const PARTICIPANTS_CAPABILITY_ID = "resolve_job_participants" as const;
const CUSTOMER_JOBS_CAPABILITY_ID = "list_customer_jobs" as const;
const JOB_SUMMARY_CAPABILITY_ID = "get_job_summary" as const;
const JOB_HISTORY_CAPABILITY_ID = "search_job_history" as const;
const CORRESPONDENCE_EVIDENCE_CAPABILITY_ID =
  "get_correspondence_evidence" as const;
const TRUSTED_DOMAIN_SERVICES = new WeakSet<object>();

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

function resolveAvailableCapability(
  capabilityId: string,
  actorContext: ActorContext,
  input: unknown
) {
  if (!isActorContext(actorContext)) {
    throw authorizationInternal(
      "unknown-request",
      "domain_actor_context_source_untrusted"
    );
  }
  let resolved: ReturnType<typeof resolveCapabilityAuthorization>;
  try {
    resolved = resolveCapabilityAuthorization(capabilityId, input);
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
    resolved.capability.name !== capabilityId ||
    resolved.capability.availability.implementation !== "available" ||
    resolved.variants.length === 0
  ) {
    throw authorizationInternal(
      actorContext.requestId,
      "domain_capability_unavailable"
    );
  }
  return resolved;
}

function authorizeScheduleRead(
  actorContext: ActorContext,
  input: ListScheduledJobsInput
) {
  const resolved = resolveAvailableCapability(
    SCHEDULE_CAPABILITY_ID,
    actorContext,
    input
  );
  if (resolved.variants.length !== 1) {
    throw authorizationInternal(
      actorContext.requestId,
      "domain_schedule_variant_invalid"
    );
  }
  return authorizeScheduledJobsRead({
    authorization: authorizeCapability({
      actorContext,
      policy: resolved.variants[0]!.policy,
    }),
    rawInput: resolved.parsedInput,
  });
}

function authorizeReadinessRead(
  actorContext: ActorContext,
  input: JobReadinessIssuesInput
) {
  const resolved = resolveAvailableCapability(
    READINESS_CAPABILITY_ID,
    actorContext,
    input
  );
  return authorizeJobReadinessRead({
    authorizations: resolved.variants.map((variant) =>
      authorizeCapability({ actorContext, policy: variant.policy })
    ),
    rawInput: resolved.parsedInput,
  });
}

function authorizeCommunicationRead(
  actorContext: ActorContext,
  input: JobCommunicationContextInput
) {
  const resolved = resolveAvailableCapability(
    COMMUNICATION_CAPABILITY_ID,
    actorContext,
    input
  );
  return authorizeJobCommunicationRead({
    authorizations: resolved.variants.map((variant) =>
      authorizeCapability({ actorContext, policy: variant.policy })
    ),
    rawInput: resolved.parsedInput,
  });
}

function authorizeParticipantsRead(
  actorContext: ActorContext,
  input: JobParticipantsInput
) {
  const resolved = resolveAvailableCapability(
    PARTICIPANTS_CAPABILITY_ID,
    actorContext,
    input
  );
  return authorizeJobParticipantsRead({
    authorizations: resolved.variants.map((variant) =>
      authorizeCapability({ actorContext, policy: variant.policy })
    ),
    rawInput: resolved.parsedInput,
  });
}

function authorizeCustomerJobsDomainRead(
  actorContext: ActorContext,
  input: CustomerJobsInput
) {
  const resolved = resolveAvailableCapability(
    CUSTOMER_JOBS_CAPABILITY_ID,
    actorContext,
    input
  );
  return authorizeCustomerJobsRead({
    authorizations: resolved.variants.map((variant) =>
      authorizeCapability({ actorContext, policy: variant.policy })
    ),
    rawInput: resolved.parsedInput,
  });
}

function authorizeJobSummaryDomainRead(
  actorContext: ActorContext,
  input: JobSummaryInput
) {
  const resolved = resolveAvailableCapability(
    JOB_SUMMARY_CAPABILITY_ID,
    actorContext,
    input
  );
  return authorizeJobSummaryRead({
    authorizations: resolved.variants.map((variant) =>
      authorizeCapability({ actorContext, policy: variant.policy })
    ),
    rawInput: resolved.parsedInput,
  });
}

function authorizeJobHistoryDomainRead(
  actorContext: ActorContext,
  input: JobHistorySearchInput
) {
  const resolved = resolveAvailableCapability(
    JOB_HISTORY_CAPABILITY_ID,
    actorContext,
    input
  );
  return authorizeJobHistoryRead({
    authorizations: resolved.variants.map((variant) =>
      authorizeCapability({ actorContext, policy: variant.policy })
    ),
    rawInput: resolved.parsedInput,
  });
}

function authorizeCorrespondenceEvidenceDomainRead(
  actorContext: ActorContext,
  input: CorrespondenceEvidenceReadInput
) {
  const resolved = resolveAvailableCapability(
    CORRESPONDENCE_EVIDENCE_CAPABILITY_ID,
    actorContext,
    input
  );
  return authorizeCorrespondenceEvidencePageRead({
    authorizations: resolved.variants.map((variant) =>
      authorizeCapability({ actorContext, policy: variant.policy })
    ),
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
  for (const capabilityId of [
    SCHEDULE_CAPABILITY_ID,
    READINESS_CAPABILITY_ID,
    COMMUNICATION_CAPABILITY_ID,
    PARTICIPANTS_CAPABILITY_ID,
    CUSTOMER_JOBS_CAPABILITY_ID,
    JOB_SUMMARY_CAPABILITY_ID,
    JOB_HISTORY_CAPABILITY_ID,
    CORRESPONDENCE_EVIDENCE_CAPABILITY_ID,
  ]) {
    if (
      getCapabilityManifestEntry(capabilityId).availability.implementation !==
      "available"
    ) {
      throw new TypeError(`${capabilityId} is not implemented`);
    }
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

  const listScheduledJobs = async (
    actorContext: ActorContext,
    domainInput: ListScheduledJobsInput,
    options?: DomainCallOptions
  ) =>
    await readScheduledJobs({
      authorization: authorizeScheduleRead(actorContext, domainInput),
      repository: repositories.scheduledJobs,
      ...(options?.signal ? { signal: options.signal } : {}),
      ...(now ? { now } : {}),
    });

  const listJobReadinessIssues = async (
    actorContext: ActorContext,
    domainInput: JobReadinessIssuesInput,
    options?: DomainCallOptions
  ) =>
    await readJobReadinessIssues({
      authorization: authorizeReadinessRead(actorContext, domainInput),
      repository: repositories.jobReadiness,
      ...(options?.signal ? { signal: options.signal } : {}),
      ...(now ? { now } : {}),
    });

  const getJobCommunicationContext = async (
    actorContext: ActorContext,
    domainInput: JobCommunicationContextInput,
    options?: DomainCallOptions
  ) =>
    await readJobCommunicationContext({
      authorization: authorizeCommunicationRead(actorContext, domainInput),
      repository: repositories.jobCommunicationContext,
      ...(options?.signal ? { signal: options.signal } : {}),
      ...(now ? { now } : {}),
    });

  const resolveJobParticipants = async (
    actorContext: ActorContext,
    domainInput: JobParticipantsInput,
    options?: DomainCallOptions
  ) =>
    await readJobParticipants({
      authorization: authorizeParticipantsRead(actorContext, domainInput),
      repository: repositories.jobParticipants,
      ...(options?.signal ? { signal: options.signal } : {}),
      ...(now ? { now } : {}),
    });

  const listCustomerJobs = async (
    actorContext: ActorContext,
    domainInput: CustomerJobsInput,
    options?: DomainCallOptions
  ) =>
    await readCustomerJobs({
      authorization: authorizeCustomerJobsDomainRead(actorContext, domainInput),
      repository: repositories.customerJobs,
      ...(options?.signal ? { signal: options.signal } : {}),
      ...(now ? { now } : {}),
    });

  const getJobSummary = async (
    actorContext: ActorContext,
    domainInput: JobSummaryInput,
    options?: DomainCallOptions
  ) =>
    await readJobSummary({
      authorization: authorizeJobSummaryDomainRead(actorContext, domainInput),
      repository: repositories.jobSummary,
      ...(options?.signal ? { signal: options.signal } : {}),
      ...(now ? { now } : {}),
    });

  const searchJobHistory = async (
    actorContext: ActorContext,
    domainInput: JobHistorySearchInput,
    options?: DomainCallOptions
  ) =>
    await readJobHistory({
      authorization: authorizeJobHistoryDomainRead(actorContext, domainInput),
      repository: repositories.jobHistory,
      ...(options?.signal ? { signal: options.signal } : {}),
      ...(now ? { now } : {}),
    });

  const getCorrespondenceEvidence = async (
    actorContext: ActorContext,
    domainInput: CorrespondenceEvidenceReadInput,
    options?: DomainCallOptions
  ) =>
    await readCorrespondenceEvidence({
      authorization: authorizeCorrespondenceEvidenceDomainRead(
        actorContext,
        domainInput
      ),
      repository: repositories.correspondenceEvidence,
      ...(options?.signal ? { signal: options.signal } : {}),
      ...(now ? { now } : {}),
    });

  const service = {
    getJobConversationContext,
    listScheduledJobs,
    listJobReadinessIssues,
    getJobCommunicationContext,
    resolveJobParticipants,
    listCustomerJobs,
    getJobSummary,
    searchJobHistory,
    getCorrespondenceEvidence,
  } satisfies OpsAgentDomainService;
  TRUSTED_DOMAIN_SERVICES.add(service);
  return Object.freeze(service);
}

export function isTrustedOpsAgentDomainService(
  value: unknown
): value is OpsAgentDomainService {
  return (
    typeof value === "object" &&
    value !== null &&
    TRUSTED_DOMAIN_SERVICES.has(value)
  );
}
