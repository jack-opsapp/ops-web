import "server-only";

import { createSupabaseActorAuthorityRepository } from "@/lib/agent-control-plane/actor/authority-repository";
import { createSupabaseCorrespondenceEvidencePageRepository } from "@/lib/agent-control-plane/services/correspondence-evidence-page-repository";
import { createOpsAgentDomainService } from "@/lib/agent-control-plane/services/create-domain-service";
import { createSupabaseCustomerJobsRepository } from "@/lib/agent-control-plane/services/customer-jobs-repository";
import { createSupabaseCustomerDiscoveryRepository } from "@/lib/agent-control-plane/services/customer-discovery-repository";
import { createSupabaseJobCommunicationContextRepository } from "@/lib/agent-control-plane/services/job-communication-context-repository";
import { createSupabaseJobConversationContextRepository } from "@/lib/agent-control-plane/services/job-conversation-context-repository";
import { createSupabaseJobHistoryRepository } from "@/lib/agent-control-plane/services/job-history-repository";
import { createSupabaseJobDiscoveryRepository } from "@/lib/agent-control-plane/services/job-discovery-repository";
import { createSupabaseJobParticipantsRepository } from "@/lib/agent-control-plane/services/job-participants-repository";
import { createSupabaseJobReadinessRepository } from "@/lib/agent-control-plane/services/job-readiness-repository";
import { createSupabaseJobSummaryRepository } from "@/lib/agent-control-plane/services/job-summary-repository";
import {
  isTrustedOperationalReadCursorCodec,
  type OperationalReadCursorCodec,
} from "@/lib/agent-control-plane/services/operational-read-cursor";
import {
  createOpsAgentP2DomainService,
  type P2CursorKey,
} from "@/lib/agent-control-plane/services/p2/domain-service";
import { createSupabaseOpsAgentP2Repositories } from "@/lib/agent-control-plane/services/p2/repositories";
import { createOpsAgentReadCatalogueService } from "@/lib/agent-control-plane/services/read-catalogue-service";
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
  readonly p2CursorKey: P2CursorKey;
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
    customerDiscovery: createSupabaseCustomerDiscoveryRepository(
      rpcClient,
      cursorCodec
    ),
    jobDiscovery: createSupabaseJobDiscoveryRepository(rpcClient, cursorCodec),
  });
  const currentProduction = createOpsAgentDomainService({ repositories });
  const p2 = createOpsAgentP2DomainService({
    repositories: createSupabaseOpsAgentP2Repositories(rpcClient),
    cursorKey: input.p2CursorKey,
  });
  const domainService = createOpsAgentReadCatalogueService({
    currentProduction,
    p2,
  });
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
