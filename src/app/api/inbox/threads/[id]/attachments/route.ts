/**
 * OPS Web - Inbox Thread Attachments
 *
 * GET /api/inbox/threads/{id}/attachments
 *
 * Returns every attachment surfaced from the provider for the given OPS
 * thread UUID. Email attachments are not persisted to OPS storage — they
 * live in Gmail/M365 and are fetched live. This route walks the thread
 * via `provider.getAttachmentsFromThread()` and shapes the result so the
 * inbox FILES tab can render thumbnails (cookie-authed <img src>) and
 * downloadable file rows without each entry needing its own auth dance.
 *
 * Each returned item carries `url` — a same-origin link to the existing
 * `/api/integrations/email/attachment` proxy. Cookie auth on that proxy
 * is what lets the bytes flow through to the client without exposing the
 * raw Gmail/M365 OAuth scope to the browser.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { runWithSupabase } from "@/lib/supabase/helpers";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { checkPermissionById } from "@/lib/supabase/check-permission";
import { EmailThreadService } from "@/lib/api/services/email-thread-service";
import { EmailService } from "@/lib/api/services/email-service";

export interface ThreadAttachmentDto {
  /** Synthetic id — stable across renders, used as React key. */
  id: string;
  messageId: string;
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
  fromEmail: string;
  /** ISO-8601 send/receive time of the parent message. */
  date: string;
  /** Same-origin URL that streams the bytes through the auth-gated proxy. */
  url: string;
}

function buildProxyUrl(
  companyId: string,
  messageId: string,
  attachmentId: string,
  mimeType: string,
): string {
  const params = new URLSearchParams({
    companyId,
    messageId,
    attachmentId,
    mimeType,
  });
  return `/api/integrations/email/attachment?${params.toString()}`;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authUser = await verifyAdminAuth(request);
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const user = await findUserByAuth(authUser.uid, authUser.email, "id, company_id");
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const canView = await checkPermissionById(user.id as string, "inbox.view");
  if (!canView) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = getServiceRoleClient();

  try {
    const thread = await runWithSupabase(supabase, () =>
      EmailThreadService.getThread(id, user.company_id as string),
    );
    if (!thread) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const connection = await runWithSupabase(supabase, () =>
      EmailService.getConnection(thread.connectionId),
    );
    if (!connection) {
      // Thread row exists but its owning connection is gone (deleted /
      // disconnected). Return an empty list rather than a 500 — the FILES
      // tab simply has nothing to show.
      return NextResponse.json({ attachments: [] as ThreadAttachmentDto[] });
    }

    const provider = EmailService.getProvider(connection);
    const raw = await provider.getAttachmentsFromThread(thread.providerThreadId);

    const attachments: ThreadAttachmentDto[] = raw.map((a) => ({
      id: `${a.messageId}:${a.attachmentId}`,
      messageId: a.messageId,
      attachmentId: a.attachmentId,
      filename: a.filename,
      mimeType: a.mimeType,
      size: a.size,
      fromEmail: a.fromEmail,
      date: a.date.toISOString(),
      url: buildProxyUrl(
        thread.companyId,
        a.messageId,
        a.attachmentId,
        a.mimeType,
      ),
    }));

    // Newest attachment first — same ordering convention as the rest of the
    // FILES tab (estimates/invoices are sorted by updated_at desc).
    attachments.sort((a, b) => b.date.localeCompare(a.date));

    return NextResponse.json({ attachments });
  } catch (err) {
    console.error("[/api/inbox/threads/:id/attachments] failed:", err);
    return NextResponse.json(
      {
        error: `Failed to load attachments: ${(err as Error).message}`,
        attachments: [] as ThreadAttachmentDto[],
      },
      { status: 500 },
    );
  }
}
