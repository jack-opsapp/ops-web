/**
 * OPS Web - Inbox Archive Writeback Preference
 *
 * POST /api/inbox/writeback-preference
 *   body: { connectionId: string, preference: ArchiveWritebackPreference }
 *
 * Sets email_connections.archive_writeback_preference. Called by the UI after
 * the user picks a choice in the first-archive modal.
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
import type { ArchiveWritebackPreference } from "@/lib/types/email-thread";

const VALID_PREFERENCES: ArchiveWritebackPreference[] = [
  "ask",
  "archive_in_gmail",
  "mark_read_only",
  "ops_only",
];

export async function POST(request: NextRequest) {
  const authUser = await verifyAdminAuth(request);
  if (!authUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json()) as {
    connectionId?: string;
    preference?: ArchiveWritebackPreference;
  };

  if (!body.connectionId || !body.preference) {
    return NextResponse.json(
      { error: "connectionId and preference required" },
      { status: 400 }
    );
  }

  if (!VALID_PREFERENCES.includes(body.preference)) {
    return NextResponse.json(
      {
        error: `preference must be one of: ${VALID_PREFERENCES.join(", ")}`,
      },
      { status: 400 }
    );
  }

  const user = await findUserByAuth(authUser.uid, authUser.email, "id, company_id");
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const allowed = await checkPermissionById(user.id as string, "inbox.archive");
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const supabase = getServiceRoleClient();

  // Verify connection belongs to user's company
  const { data: connRow } = await supabase
    .from("email_connections")
    .select("id, company_id")
    .eq("id", body.connectionId)
    .maybeSingle();

  if (!connRow || (connRow.company_id as string) !== (user.company_id as string)) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }

  try {
    await runWithSupabase(supabase, () =>
      EmailThreadService.setWritebackPreference(body.connectionId!, body.preference!)
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[/api/inbox/writeback-preference] failed:", err);
    return NextResponse.json(
      { error: `Failed to set preference: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}
