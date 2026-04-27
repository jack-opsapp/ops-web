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
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { checkPermissionById } from "@/lib/supabase/check-permission";
import { EmailThreadService } from "@/lib/api/services/email-thread-service";

export async function POST(request: NextRequest) {
  const authUser = await verifyAdminAuth(request);
  if (!authUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json()) as {
    threadIds?: string[];
    unarchiveOpportunityId?: string | null;
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
      EmailThreadService.unarchiveBatch({
        companyId: user.company_id as string,
        threadIds: body.threadIds!,
        unarchiveOpportunityId: body.unarchiveOpportunityId ?? null,
      })
    );
    return NextResponse.json({
      ok: true,
      unarchivedThreadIds: result.unarchivedThreadIds,
      failedThreadIds: result.failedThreadIds,
      unarchivedOpportunityId: result.unarchivedOpportunityId,
    });
  } catch (err) {
    console.error("[/api/inbox/threads/batch-unarchive] failed:", err);
    return NextResponse.json(
      { error: `Batch unarchive failed: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}
