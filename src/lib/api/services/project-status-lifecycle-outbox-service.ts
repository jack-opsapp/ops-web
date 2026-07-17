import "server-only";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { runWithSupabase } from "@/lib/supabase/helpers";
import { ProjectLifecycleService } from "./project-lifecycle-service";

interface ProjectStatusLifecycleClaim {
  event_id: string;
  lease_token: string;
  company_id: string;
  project_id: string;
  actor_user_id: string | null;
  old_status: string;
  new_status: string;
  project_status_version: number;
  project_updated_at: string;
  requested_at: string;
  attempt: number;
}

export interface ProjectStatusLifecycleBatchResult {
  claimed: number;
  completed: number;
  requeued: number;
  failed: number;
  terminalFailed: number;
  errors: Array<{ eventId: string; message: string }>;
}

function assertClaim(
  value: unknown
): asserts value is ProjectStatusLifecycleClaim {
  if (!value || typeof value !== "object") {
    throw new Error("Project lifecycle claim was not an object");
  }
  const row = value as Record<string, unknown>;
  for (const key of [
    "event_id",
    "lease_token",
    "company_id",
    "project_id",
    "old_status",
    "new_status",
    "project_updated_at",
    "requested_at",
  ]) {
    if (typeof row[key] !== "string" || row[key] === "") {
      throw new Error(`Project lifecycle claim is missing ${key}`);
    }
  }
  if (
    typeof row.project_status_version !== "number" ||
    !Number.isSafeInteger(row.project_status_version) ||
    row.project_status_version < 1
  ) {
    throw new Error("Project lifecycle claim has an invalid status version");
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const ProjectStatusLifecycleOutboxService = {
  async processBatch(
    db: SupabaseClient,
    options: { limit?: number; leaseSeconds?: number; workerId?: string } = {}
  ): Promise<ProjectStatusLifecycleBatchResult> {
    const limit = Math.max(1, Math.min(Math.floor(options.limit ?? 25), 100));
    const leaseSeconds = Math.max(
      30,
      Math.min(Math.floor(options.leaseSeconds ?? 180), 900)
    );
    const { data: terminalized, error: terminalizeError } = await db.rpc(
      "terminalize_expired_project_status_lifecycle_events"
    );
    if (
      terminalizeError ||
      typeof terminalized !== "number" ||
      !Number.isSafeInteger(terminalized) ||
      terminalized < 0
    ) {
      throw new Error(
        `Failed to terminalize project lifecycle events: ${terminalizeError?.message ?? "invalid result"}`
      );
    }
    const workerId = options.workerId ?? randomUUID();
    const result: ProjectStatusLifecycleBatchResult = {
      claimed: 0,
      completed: 0,
      requeued: 0,
      failed: 0,
      terminalFailed: terminalized,
      errors: [],
    };

    // Claim immediately before work so a slow earlier event cannot consume a
    // later row's lease/attempt without ever trying that row.
    for (let index = 0; index < limit; index += 1) {
      const { data, error } = await db.rpc(
        "claim_project_status_lifecycle_events",
        {
          p_worker_id: workerId,
          p_limit: 1,
          p_lease_seconds: leaseSeconds,
        }
      );
      if (error) {
        throw new Error(
          `Failed to claim project lifecycle events: ${error.message}`
        );
      }
      const claims = (data ?? []) as unknown[];
      if (claims.length === 0) break;
      if (claims.length !== 1) {
        throw new Error("Project lifecycle claim returned multiple rows");
      }
      const rawClaim = claims[0];
      assertClaim(rawClaim);
      const claim = rawClaim;
      result.claimed += 1;
      try {
        let actorName: string | undefined;
        if (claim.actor_user_id) {
          const { data: actor, error: actorError } = await db
            .from("users")
            .select("first_name, last_name")
            .eq("id", claim.actor_user_id)
            .eq("company_id", claim.company_id)
            .is("deleted_at", null)
            .maybeSingle();
          if (actorError) throw actorError;
          actorName =
            [actor?.first_name, actor?.last_name]
              .filter(
                (part): part is string =>
                  typeof part === "string" && part.trim() !== ""
              )
              .join(" ") || undefined;
          actorName ||= "A team member";
        }

        await runWithSupabase(db, () =>
          ProjectLifecycleService.onProjectStageChange(
            claim.company_id,
            claim.project_id,
            claim.old_status,
            claim.new_status,
            claim.actor_user_id ?? undefined,
            actorName,
            claim.event_id,
            true,
            claim.project_status_version,
            claim.project_updated_at
          )
        );

        const { data: completed, error: completeError } = await db.rpc(
          "complete_project_status_lifecycle_event",
          {
            p_event_id: claim.event_id,
            p_lease_token: claim.lease_token,
          }
        );
        if (completeError || completed !== true) {
          throw new Error(
            completeError?.message ?? "Project lifecycle lease was lost"
          );
        }
        result.completed += 1;
      } catch (error) {
        const failure = message(error);
        const { data: disposition, error: persistError } = await db.rpc(
          "fail_project_status_lifecycle_event",
          {
            p_event_id: claim.event_id,
            p_lease_token: claim.lease_token,
            p_error: failure,
            p_retryable: true,
          }
        );
        if (persistError) {
          result.errors.push({
            eventId: claim.event_id,
            message: `${failure}; failure persistence: ${persistError.message}`,
          });
          result.failed += 1;
        } else if (disposition === "pending") {
          result.requeued += 1;
          result.errors.push({ eventId: claim.event_id, message: failure });
        } else {
          result.failed += 1;
          result.errors.push({ eventId: claim.event_id, message: failure });
        }
      }
    }

    return result;
  },
};
