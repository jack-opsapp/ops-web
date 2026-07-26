/**
 * GET /api/cron/phase-c-graduation-check (daily)
 *
 * Walks every proof-backed OPS actor × mailbox × primary category. For each
 * (company, mailbox, user, category) tuple where:
 *   - the mapped profile_type has >= 20 finalized drafts
 *   - AND approval rate >= 0.95
 *   - AND the current autonomy level is still `auto_draft` (not yet graduated)
 * …creates a PERSISTENT notification inviting the user to graduate that
 * category to auto_send.
 *
 * Each actor-mailbox attempt is durably rotated and retried. Category prompts
 * have a lifetime dedupe key, so reading or resolving one never creates spam.
 *
 * Auth via CRON_SECRET Bearer header.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { runWithSupabase } from "@/lib/supabase/helpers";
import { PhaseCCategoryAutonomy } from "@/lib/api/services/phase-c-category-autonomy-service";
import { AutonomyMilestoneService } from "@/lib/api/services/autonomy-milestone-service";
import {
  EMAIL_THREAD_CATEGORIES,
  type EmailThreadCategory,
} from "@/lib/types/email-thread";
import { categoryLabel } from "@/lib/email/email-thread-category-metadata";
import { buildPhaseCGraduationActionUrl } from "@/lib/email/phase-c-graduation-action";
import {
  CronDatabaseOperationError,
  isDatabasePressureError,
  runWithCronWorkloadControl,
} from "@/lib/api/services/cron-workload-control-service";

export const maxDuration = 300;

const MAX_ACTOR_SCOPES_PER_RUN = 10;
const GRADUATION_LEASE_SECONDS = 15 * 60;
const WORKLOAD_LEASE_SECONDS = 270;
const WORKLOAD_KEY = "phase-c-graduation-check";

type GraduationScope = {
  company_id: string;
  connection_id: string;
  actor_user_id: string;
  lease_token: string;
};

async function completeScope(
  supabase: ReturnType<typeof getServiceRoleClient>,
  scope: GraduationScope,
  succeeded: boolean,
  errorMessage: string | null
): Promise<void> {
  const { error } = await supabase.rpc(
    "complete_phase_c_graduation_scope_check_as_system",
    {
      p_company_id: scope.company_id,
      p_connection_id: scope.connection_id,
      p_actor_user_id: scope.actor_user_id,
      p_lease_token: scope.lease_token,
      p_succeeded: succeeded,
      p_error: errorMessage,
    }
  );
  if (error) {
    throw new CronDatabaseOperationError(
      "Phase C graduation completion failed",
      { cause: error }
    );
  }
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 500 }
    );
  }
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getServiceRoleClient();

  try {
    const controlled = await runWithCronWorkloadControl({
      supabase,
      workloadKey: WORKLOAD_KEY,
      leaseSeconds: WORKLOAD_LEASE_SECONDS,
      work: async () => {
        const { data: actorScopes, error: actorScopesError } =
          await supabase.rpc(
            "claim_phase_c_graduation_actor_scopes_as_system",
            {
              p_limit: MAX_ACTOR_SCOPES_PER_RUN,
              p_lease_seconds: GRADUATION_LEASE_SECONDS,
            }
          );
        if (actorScopesError) {
          throw new CronDatabaseOperationError(
            "Phase C graduation scope claim failed",
            { cause: actorScopesError }
          );
        }

        const rows = (actorScopes as GraduationScope[] | null) ?? [];

        let checked = 0;
        let notified = 0;
        let failed = 0;

        for (const scope of rows) {
          let scopeSucceeded = false;
          try {
            await runWithSupabase(supabase, async () => {
              try {
                await AutonomyMilestoneService.checkMilestonesAfterSync(
                  scope.company_id,
                  scope.actor_user_id,
                  scope.connection_id,
                  { throwOnError: true }
                );
                await AutonomyMilestoneService.checkMilestonesAfterDraftFeedback(
                  scope.company_id,
                  scope.actor_user_id,
                  scope.connection_id,
                  { throwOnError: true }
                );

                const levels = await PhaseCCategoryAutonomy.get(
                  scope.connection_id,
                  scope.actor_user_id
                );

                for (const category of EMAIL_THREAD_CATEGORIES as readonly EmailThreadCategory[]) {
                  checked += 1;

                  // Only categories where the user is currently at auto_draft
                  // are candidates — below auto_draft means they have not
                  // opted in yet, above auto_draft means they graduated.
                  if (levels[category] !== "auto_draft") continue;

                  const status = await PhaseCCategoryAutonomy.isGraduated(
                    scope.company_id,
                    scope.connection_id,
                    scope.actor_user_id,
                    category
                  );
                  if (!status.ready) continue;

                  const label = categoryLabel(category);
                  const { data: promptCreated, error: promptError } =
                    await supabase.rpc(
                      "record_phase_c_graduation_prompt_as_system",
                      {
                        p_company_id: scope.company_id,
                        p_connection_id: scope.connection_id,
                        p_actor_user_id: scope.actor_user_id,
                        p_category: category,
                        p_title: `Auto-send is ready for ${label.toLowerCase()} email`,
                        p_body: `${Math.round(status.approvalRate * 100)}% approved across ${status.sampleSize} drafts. Review and turn it on.`,
                        p_action_url: buildPhaseCGraduationActionUrl(
                          scope.connection_id,
                          category
                        ),
                        p_action_label: "Review auto-send",
                      }
                    );
                  if (promptError) {
                    throw new CronDatabaseOperationError(
                      "Phase C graduation prompt write failed",
                      { cause: promptError }
                    );
                  }
                  if (typeof promptCreated !== "boolean") {
                    throw new Error(
                      "Graduation prompt recorder returned invalid data"
                    );
                  }
                  if (promptCreated) notified += 1;
                }
              } catch (cause) {
                if (cause instanceof CronDatabaseOperationError) throw cause;
                throw new CronDatabaseOperationError(
                  "Phase C graduation database operation failed",
                  { cause }
                );
              }
            });
            scopeSucceeded = true;
          } catch (err) {
            if (isDatabasePressureError(err)) {
              throw err;
            }

            failed += 1;
            const errorMessage =
              err instanceof Error ? err.message : String(err);
            await completeScope(supabase, scope, false, errorMessage);
            console.error(
              "[cron/phase-c-graduation-check] failed for",
              `${scope.connection_id}:${scope.actor_user_id}`,
              errorMessage
            );
          }

          if (scopeSucceeded) {
            await completeScope(supabase, scope, true, null);
          }
        }

        return {
          ok: true,
          actorScopes: rows.length,
          checked,
          notified,
          failed,
        };
      },
    });

    if (controlled.status === "skipped") {
      const alreadyRunning = controlled.reason === "lease_held";
      return NextResponse.json(
        {
          ok: alreadyRunning,
          ran: false,
          reason: alreadyRunning ? "already_running" : controlled.reason,
        },
        { status: alreadyRunning ? 200 : 503 }
      );
    }

    return NextResponse.json({ ran: true, ...controlled.value });
  } catch (err) {
    console.error("[cron/phase-c-graduation-check] fatal:", err);
    return NextResponse.json(
      { error: `Cron failed: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}
