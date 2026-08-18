import "server-only";

import { createSupabaseActorAuthorityRepository } from "@/lib/agent-control-plane/actor/authority-repository";
import type { ActorAuthorityRepository } from "@/lib/agent-control-plane/actor/authority-repository";
import { createSupabaseCorrespondenceEvidencePageRepository } from "@/lib/agent-control-plane/services/correspondence-evidence-page-repository";
import { createOpsAgentDomainService } from "@/lib/agent-control-plane/services/create-domain-service";
import { createSupabaseCustomerJobsRepository } from "@/lib/agent-control-plane/services/customer-jobs-repository";
import type { OpsAgentDomainService } from "@/lib/agent-control-plane/services/domain-service";
import { createSupabaseJobCommunicationContextRepository } from "@/lib/agent-control-plane/services/job-communication-context-repository";
import { createSupabaseJobConversationContextRepository } from "@/lib/agent-control-plane/services/job-conversation-context-repository";
import { createSupabaseJobHistoryRepository } from "@/lib/agent-control-plane/services/job-history-repository";
import { createSupabaseJobParticipantsRepository } from "@/lib/agent-control-plane/services/job-participants-repository";
import { createSupabaseJobReadinessRepository } from "@/lib/agent-control-plane/services/job-readiness-repository";
import { createSupabaseJobSummaryRepository } from "@/lib/agent-control-plane/services/job-summary-repository";
import { createOperationalReadCursorCodec } from "@/lib/agent-control-plane/services/operational-read-cursor";
import { createOpsAgentDomainRepositories } from "@/lib/agent-control-plane/services/repositories";
import { createSupabaseScheduledJobsRepository } from "@/lib/agent-control-plane/services/scheduled-jobs-repository";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import type { McpOAuthRpcClient } from "./oauth";

const OPERATIONAL_READ_CURSOR_KEY_ENV =
  "OPS_AGENT_OPERATIONAL_READ_CURSOR_KEY" as const;
const CURSOR_KEY_PATTERN = /^[0-9a-f]{64}$/;

interface McpRpcClient {
  rpc(
    functionName: string,
    args: Readonly<Record<string, unknown>>
  ): PromiseLike<{ readonly data: unknown; readonly error: unknown }>;
}

export interface McpServerRuntime {
  readonly domainService: OpsAgentDomainService;
  readonly authorityRepository: ActorAuthorityRepository;
  readonly rpcClient: McpOAuthRpcClient;
}

let cachedRuntime: McpServerRuntime | null = null;

/**
 * Whether the operational-read cursor key is provisioned. The MCP mount is
 * deliberately unusable without it: signed keyset cursors are part of the
 * read contract, and serving page one of a read whose page two cannot exist
 * would be a silent partial capability.
 */
export function mcpRuntimeConfigured(): boolean {
  const rawKey = process.env[OPERATIONAL_READ_CURSOR_KEY_ENV]?.trim() ?? "";
  return CURSOR_KEY_PATTERN.test(rawKey);
}

/**
 * Production composition root for the MCP transport, mirroring the internal
 * Phase C runtime: one fixed service-role RPC transport feeds every
 * repository, the frozen domain service owns manifest authorization, and the
 * actor authority repository re-resolves authority per call. Lazy and cached;
 * throws only when called unconfigured (routes must gate on
 * mcpRuntimeConfigured() first so module import never throws at build time).
 */
export function getMcpServerRuntime(): McpServerRuntime {
  if (cachedRuntime) return cachedRuntime;

  const rawKey = process.env[OPERATIONAL_READ_CURSOR_KEY_ENV]?.trim() ?? "";
  if (!CURSOR_KEY_PATTERN.test(rawKey)) {
    throw new TypeError("MCP operational read cursor key is not provisioned");
  }
  const cursorCodec = createOperationalReadCursorCodec({
    key: Uint8Array.from(Buffer.from(rawKey, "hex")),
    keyId: "mcp-operational-read",
    version: 1,
  });

  const supabase = getServiceRoleClient();
  const rpcClient: McpRpcClient = Object.freeze({
    async rpc(
      functionName: string,
      args: Readonly<Record<string, unknown>>
    ): Promise<{ readonly data: unknown; readonly error: unknown }> {
      try {
        const { data, error } = await supabase.rpc(
          functionName,
          args as Record<string, unknown>
        );
        if (error != null) {
          const shaped = error as {
            code?: string;
            message?: string;
            details?: string;
            hint?: string;
          };
          console.error(
            JSON.stringify({
              at: "mcp_runtime_rpc",
              fn: functionName,
              errorCode: shaped.code ?? "unknown",
              message: shaped.message ?? null,
              details: shaped.details ?? null,
              hint: shaped.hint ?? null,
            })
          );
        }
        return { data, error };
      } catch (thrown) {
        console.error(
          JSON.stringify({
            at: "mcp_runtime_rpc",
            fn: functionName,
            thrown: thrown instanceof Error ? thrown.message : "unknown",
          })
        );
        throw thrown;
      }
    },
  });

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

  cachedRuntime = Object.freeze({
    domainService: createOpsAgentDomainService({ repositories }),
    authorityRepository: createSupabaseActorAuthorityRepository(rpcClient),
    rpcClient,
  });
  return cachedRuntime;
}
