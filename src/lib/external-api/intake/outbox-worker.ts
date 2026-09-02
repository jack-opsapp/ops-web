import "server-only";

import { z } from "zod";

import { refreshExternalIntakeLeadSummary } from "@/lib/api/services/lead-summary-service";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

interface OutboxRpcClient {
  rpc(
    name: string,
    args: Record<string, unknown>
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

interface OutboxWorkerDependencies {
  client?: OutboxRpcClient;
  refreshLeadSummary?: typeof refreshExternalIntakeLeadSummary;
}

const originalContextSchema = z
  .object({
    work: z.record(z.unknown()),
    serviceAddress: z.record(z.unknown()),
    answers: z.array(z.unknown()).max(100),
    occurredAt: z.string().datetime({ offset: true }),
  })
  .strict();

const outboxClaimSchema = z
  .object({
    outbox_id: z.string().uuid(),
    lease_token: z.string().uuid(),
    company_id: z.string().uuid(),
    opportunity_id: z.string().uuid(),
    original_context: originalContextSchema,
  })
  .strict();

async function transition(
  client: OutboxRpcClient,
  name:
    | "complete_external_intake_post_commit_outbox_as_system"
    | "retry_external_intake_post_commit_outbox_as_system",
  args: Record<string, unknown>
): Promise<void> {
  const { data, error } = await client.rpc(name, args);
  if (error || data !== true) {
    throw new Error("external intake outbox transition failed");
  }
}

export async function processExternalIntakeOutboxBatch(
  options: Readonly<{
    limit?: number;
    leaseSeconds?: number;
    workerId?: string;
  }> = {},
  dependencies: OutboxWorkerDependencies = {}
) {
  const limit = Math.max(1, Math.min(options.limit ?? 5, 25));
  const leaseSeconds = Math.max(30, Math.min(options.leaseSeconds ?? 300, 900));
  const workerId = (options.workerId ?? "external-intake-outbox").slice(0, 128);
  const client =
    dependencies.client ??
    (getServiceRoleClient() as unknown as OutboxRpcClient);
  const refreshLeadSummary =
    dependencies.refreshLeadSummary ?? refreshExternalIntakeLeadSummary;
  const claimedResponse = await client.rpc(
    "claim_external_intake_post_commit_outbox_as_system",
    {
      p_worker_id: workerId,
      p_limit: limit,
      p_lease_seconds: leaseSeconds,
    }
  );
  if (claimedResponse.error) {
    throw new Error("external intake outbox claim failed");
  }
  const parsed = z.array(outboxClaimSchema).safeParse(claimedResponse.data);
  if (!parsed.success) {
    throw new Error("external intake outbox claim was malformed");
  }

  const result: {
    claimed: number;
    completed: number;
    requeued: number;
    errors: Array<{ outboxId: string; error: string }>;
  } = {
    claimed: parsed.data.length,
    completed: 0,
    requeued: 0,
    errors: [],
  };

  for (const claim of parsed.data) {
    try {
      await refreshLeadSummary({
        companyId: claim.company_id,
        opportunityId: claim.opportunity_id,
        originalContext: claim.original_context,
      });
      await transition(
        client,
        "complete_external_intake_post_commit_outbox_as_system",
        {
          p_outbox_id: claim.outbox_id,
          p_lease_token: claim.lease_token,
        }
      );
      result.completed += 1;
    } catch {
      try {
        await transition(
          client,
          "retry_external_intake_post_commit_outbox_as_system",
          {
            p_outbox_id: claim.outbox_id,
            p_lease_token: claim.lease_token,
            p_error_code: "summary_refresh_failed",
          }
        );
        result.requeued += 1;
      } catch {
        result.errors.push({
          outboxId: claim.outbox_id,
          error: "outbox retry transition failed",
        });
        continue;
      }
      result.errors.push({
        outboxId: claim.outbox_id,
        error: "summary_refresh_failed",
      });
    }
  }

  return result;
}
