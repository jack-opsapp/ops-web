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
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { checkPermissionById } from "@/lib/supabase/check-permission";
import { EmailThreadService } from "@/lib/api/services/email-thread-service";

export async function POST(request: NextRequest) {
  const authUser = await verifyAdminAuth(request);
  if (!authUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

  const user = await findUserByAuth(authUser.uid, authUser.email, "id, company_id");
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const allowed = await checkPermissionById(user.id as string, "inbox.archive");
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const supabase = getServiceRoleClient();

  try {
    const result = await runWithSupabase(supabase, () =>
      EmailThreadService.archiveBatch({
        companyId: user.company_id as string,
        threadIds: body.threadIds!,
        archiveOpportunityId: body.archiveOpportunityId ?? null,
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
