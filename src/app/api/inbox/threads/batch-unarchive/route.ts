/**
 * OPS Web - Inbox Batch Unarchive
 *
 * POST /api/inbox/threads/batch-unarchive
 *   body: { threadIds: string[], unarchiveOpportunityId: string | null }
 *
 * Reverses a batch archive — used by the undo path on the multi-archive
 * confirmation toast.
 *
 * Auth: Firebase/Supabase JWT. Permission: inbox.archive.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { runWithSupabase } from "@/lib/supabase/helpers";
import { checkPermissionById } from "@/lib/supabase/check-permission";
import { EmailThreadService } from "@/lib/api/services/email-thread-service";
import { resolveEmailOpportunityAccess } from "@/lib/email/email-opportunity-access";
import { resolveEmailRouteActor } from "@/lib/email/email-route-auth";

export async function POST(request: NextRequest) {
  const actorResolution = await resolveEmailRouteActor(request);
  if (!actorResolution.ok) return actorResolution.response;
  const { actor } = actorResolution;

  const body = (await request.json()) as {
    threadIds?: string[];
    unarchiveOpportunityId?: string | null;
  };

  if (
    !body.threadIds ||
    !Array.isArray(body.threadIds) ||
    body.threadIds.length === 0
  ) {
    return NextResponse.json(
      { error: "threadIds (non-empty array) required" },
      { status: 400 }
    );
  }

  const threadIds = [
    ...new Set(
      body.threadIds.filter(
        (threadId): threadId is string =>
          typeof threadId === "string" && threadId.trim().length > 0
      )
    ),
  ];
  if (threadIds.length === 0) {
    return NextResponse.json(
      { error: "threadIds must contain valid thread ids" },
      { status: 400 }
    );
  }

  const allowed = await checkPermissionById(actor.userId, "inbox.archive");
  if (!allowed)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const supabase = getServiceRoleClient();
  const accessDecisions = await Promise.all(
    threadIds.map((threadId) =>
      resolveEmailOpportunityAccess({
        actor,
        operation: "mutate",
        threadId,
        supabase,
      })
    )
  );
  if (accessDecisions.some((decision) => !decision.allowed)) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  const unarchiveOpportunityId = body.unarchiveOpportunityId ?? null;
  if (
    unarchiveOpportunityId &&
    accessDecisions.some(
      (decision) =>
        !decision.allowed || decision.opportunityId !== unarchiveOpportunityId
    )
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const result = await runWithSupabase(supabase, () =>
      EmailThreadService.unarchiveBatch({
        companyId: actor.companyId,
        threadIds,
        unarchiveOpportunityId,
        authorizeProviderMutation: async (threadId) =>
          (
            await resolveEmailOpportunityAccess({
              actor,
              operation: "mutate",
              threadId,
              supabase,
            })
          ).allowed,
      })
    );
    const failed =
      result.failedThreadIds.length > 0 || Boolean(result.failedOpportunityId);
    return NextResponse.json(
      {
        ok: !failed,
        ...(failed
          ? {
              error:
                "Some threads could not be restored. Refresh and try again.",
            }
          : {}),
        unarchivedThreadIds: result.unarchivedThreadIds,
        failedThreadIds: result.failedThreadIds,
        unarchivedOpportunityId: result.unarchivedOpportunityId,
        failedOpportunityId: result.failedOpportunityId,
      },
      { status: failed ? 502 : 200 }
    );
  } catch (err) {
    console.error("[/api/inbox/threads/batch-unarchive] failed:", err);
    return NextResponse.json(
      { error: `Batch unarchive failed: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}
