import "server-only";

import { createSupabaseActorAuthorityRepository } from "@/lib/agent-control-plane/actor/authority-repository";
import { createSupabaseCorrespondenceEvidencePageRepository } from "@/lib/agent-control-plane/services/correspondence-evidence-page-repository";
import { createOpsAgentDomainService } from "@/lib/agent-control-plane/services/create-domain-service";
import { createSupabaseCustomerJobsRepository } from "@/lib/agent-control-plane/services/customer-jobs-repository";
import { createSupabaseJobCommunicationContextRepository } from "@/lib/agent-control-plane/services/job-communication-context-repository";
import { createSupabaseJobConversationContextRepository } from "@/lib/agent-control-plane/services/job-conversation-context-repository";
import { createSupabaseJobHistoryRepository } from "@/lib/agent-control-plane/services/job-history-repository";
import { createSupabaseJobParticipantsRepository } from "@/lib/agent-control-plane/services/job-participants-repository";
import { createSupabaseJobReadinessRepository } from "@/lib/agent-control-plane/services/job-readiness-repository";
import { createSupabaseJobSummaryRepository } from "@/lib/agent-control-plane/services/job-summary-repository";
import {
  isTrustedOperationalReadCursorCodec,
  type OperationalReadCursorCodec,
} from "@/lib/agent-control-plane/services/operational-read-cursor";
import { createOpsAgentDomainRepositories } from "@/lib/agent-control-plane/services/repositories";
import { createSupabaseScheduledJobsRepository } from "@/lib/agent-control-plane/services/scheduled-jobs-repository";
import {
  createInternalPhaseCAdapter,
  type InternalPhaseCAdapter,
} from "./internal";
import {
  createPhaseCSourceTurnRepository,
  createSupabasePhaseCSourceTurnReadAdapter,
} from "./phase-c-source-turn-repository";

export interface InternalPhaseCRuntimeRpcClient {
  rpc(
    functionName: string,
    args: Readonly<Record<string, unknown>>
  ): PromiseLike<{ readonly data: unknown; readonly error: unknown }>;
}

export interface CreateInternalPhaseCAdapterRuntimeInput {
  readonly rpcClient: InternalPhaseCRuntimeRpcClient;
  readonly cursorCodec: OperationalReadCursorCodec;
}

/**
 * Production composition root for the internal adapter. Every repository is
 * minted from the same fixed service-role RPC transport; no caller can replace
 * an authorization or context port with a structural lookalike.
 */
export function createInternalPhaseCAdapterRuntime(
  input: CreateInternalPhaseCAdapterRuntimeInput
): InternalPhaseCAdapter {
  const rpcClient = input?.rpcClient;
  const cursorCodec = input?.cursorCodec;
  if (
    !rpcClient ||
    typeof rpcClient.rpc !== "function" ||
    !isTrustedOperationalReadCursorCodec(cursorCodec)
  ) {
    throw new TypeError("Phase C agent runtime dependencies are invalid");
  }

  const repositories = createOpsAgentDomainRepositories({
    jobConversationContext:
      createSupabaseJobConversationContextRepository(rpcClient),
    scheduledJobs: createSupabaseScheduledJobsRepository(
      rpcClient,
      cursorCodec
    ),
    jobReadiness: createSupabaseJobReadinessRepository(rpcClient, cursorCodec),
    jobCommunicationContext:
      createSupabaseJobCommunicationContextRepository(rpcClient),
    jobParticipants: createSupabaseJobParticipantsRepository(rpcClient),
    customerJobs: createSupabaseCustomerJobsRepository(rpcClient, cursorCodec),
    jobSummary: createSupabaseJobSummaryRepository(rpcClient),
    jobHistory: createSupabaseJobHistoryRepository(rpcClient, cursorCodec),
    correspondenceEvidence:
      createSupabaseCorrespondenceEvidencePageRepository(rpcClient),
  });
  const domainService = createOpsAgentDomainService({ repositories });
  const authorityRepository = createSupabaseActorAuthorityRepository(rpcClient);
  const sourceTurnRepository = createPhaseCSourceTurnRepository(
    createSupabasePhaseCSourceTurnReadAdapter(rpcClient)
  );
  return createInternalPhaseCAdapter({
    domainService,
    authorityRepository,
    sourceTurnRepository,
  });
}
