/**
 * OPS Web - Inbox Batch Archive
 *
 * POST /api/inbox/threads/batch-archive
 *   body: {
 *     threadIds: string[],
 *     archiveOpportunityId: string | null,
 *   }
 *
 * Archives multiple threads in one call, plus optionally archives a linked
 * pipeline opportunity. Used by the multi-select archive confirmation modal
 * after the user has already chosen which siblings + lead to act on.
 *
 * Each thread independently honors its own connection's
 * archive_writeback_preference for provider write-back. Per-thread failures
 * do not block the rest — the response surfaces both successes and failures
 * so the UI can present a partial-success toast.
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
    archiveOpportunityId?: string | null;
  };

  if (!body.threadIds || !Array.isArray(body.threadIds) || body.threadIds.length === 0) {
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
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

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

  const archiveOpportunityId = body.archiveOpportunityId ?? null;
  if (
    archiveOpportunityId &&
    accessDecisions.some(
      (decision) =>
        !decision.allowed || decision.opportunityId !== archiveOpportunityId
    )
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const result = await runWithSupabase(supabase, () =>
      EmailThreadService.archiveBatch({
        companyId: actor.companyId,
        threadIds,
        archiveOpportunityId,
      })
    );
    return NextResponse.json({
      ok: true,
      archivedThreadIds: result.archivedThreadIds,
      failedThreadIds: result.failedThreadIds,
      leadArchivedOpportunityId: result.leadArchivedOpportunityId,
    });
  } catch (err) {
    console.error("[/api/inbox/threads/batch-archive] failed:", err);
    return NextResponse.json(
      { error: `Batch archive failed: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}
