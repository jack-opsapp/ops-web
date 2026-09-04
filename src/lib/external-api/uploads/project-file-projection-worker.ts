import "server-only";

import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const claimedProjectionSchema = z
  .object({
    id: z.string().uuid(),
    company_id: z.string().uuid(),
    project_id: z.string().uuid(),
    opportunity_id: z.string().uuid(),
    submission_id: z.string().uuid(),
    intent_id: z.string().uuid(),
    attempt_count: z.coerce.number().int().positive(),
    lease_generation: z.coerce.number().int().positive(),
    lease_token: z.string().uuid(),
  })
  .strict();

const finishResultSchema = z
  .object({
    status: z.enum(["complete", "retrying", "blocked", "stale"]),
  })
  .strict();

interface RpcClient {
  rpc(
    name: string,
    args: Record<string, unknown>
  ): PromiseLike<{ data: unknown; error: { message?: string } | null }>;
}

interface ProjectionWorkerOptions {
  limit?: number;
  leaseSeconds?: number;
  workerId?: string;
}

export interface ProjectFileProjectionWorkerResult {
  claimed: number;
  completed: number;
  requeued: number;
  blocked: number;
  stale: number;
  errors: number;
}

function bounded(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.trunc(value as number)));
}

function retryAt(attempt: number): string {
  const delay = Math.min(
    60_000 * 2 ** Math.min(Math.max(attempt - 1, 0), 20),
    24 * 60 * 60 * 1_000
  );
  return new Date(Date.now() + delay).toISOString();
}

async function rpc(
  client: RpcClient,
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error("external_intake_project_file_database_retry");
  return data;
}

export async function processExternalIntakeProjectFileProjectionBatch(
  supabase: SupabaseClient,
  options: ProjectionWorkerOptions = {}
): Promise<ProjectFileProjectionWorkerResult> {
  const client = supabase as unknown as RpcClient;
  const workerId = options.workerId ?? `project-file-${randomUUID()}`;
  const limit = bounded(options.limit, 10, 1, 25);
  const leaseSeconds = bounded(options.leaseSeconds, 360, 30, 900);
  const claimed = z.array(claimedProjectionSchema).parse(
    (await rpc(
      client,
      "claim_external_intake_project_file_projections_as_system",
      {
        p_worker_id: workerId,
        p_limit: limit,
        p_lease_seconds: leaseSeconds,
      }
    )) ?? []
  );
  const result: ProjectFileProjectionWorkerResult = {
    claimed: claimed.length,
    completed: 0,
    requeued: 0,
    blocked: 0,
    stale: 0,
    errors: 0,
  };

  for (const job of claimed) {
    const lease = {
      p_job_id: job.id,
      p_worker_id: workerId,
      p_generation: job.lease_generation,
      p_lease_token: job.lease_token,
    };
    try {
      const finish = finishResultSchema.parse(
        await rpc(
          client,
          "finish_external_intake_project_file_projection_as_system",
          {
            ...lease,
            p_outcome: "project",
            p_safe_code: null,
            p_available_at: null,
          }
        )
      );
      if (finish.status === "complete") result.completed += 1;
      if (finish.status === "retrying") result.requeued += 1;
      if (finish.status === "blocked") result.blocked += 1;
      if (finish.status === "stale") result.stale += 1;
    } catch {
      result.errors += 1;
      try {
        const finish = finishResultSchema.parse(
          await rpc(
            client,
            "finish_external_intake_project_file_projection_as_system",
            {
              ...lease,
              p_outcome: "retry",
              p_safe_code: "projection_retry",
              p_available_at: retryAt(job.attempt_count),
            }
          )
        );
        if (finish.status === "retrying") result.requeued += 1;
        if (finish.status === "stale") result.stale += 1;
      } catch {
        // Lease expiry safely returns this job to the durable queue.
      }
    }
  }
  return result;
}
