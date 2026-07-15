/**
 * GET /api/integrations/email/attachment?id=<email_attachments.id>
 *
 * Streams one canonical email attachment from private OPS storage. Provider
 * message, mailbox, tenant, MIME, and filename values are never accepted from
 * the caller; the canonical database row is the sole authority.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import {
  canRenderAttachmentInline,
  safeAttachmentFilename,
} from "@/lib/api/services/email-attachments/attachment-policy";
import { canAccessEmailMailbox } from "@/lib/email/server-mailbox-access";
import { checkPermissionById } from "@/lib/supabase/check-permission";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

const ATTACHMENT_BUCKET = "email-attachments";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface StoredAttachmentRow {
  id: string;
  company_id: string;
  connection_id: string;
  opportunity_id: string | null;
  filename: string | null;
  mime_type: string | null;
  detected_mime_type: string | null;
  storage_backend: string | null;
  storage_path: string | null;
  ingest_status: string;
  attribution_status: string;
}

function unavailable(): NextResponse {
  return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
}

export async function GET(request: NextRequest) {
  const authUser = await verifyAdminAuth(request);
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const attachmentId =
    new URL(request.url).searchParams.get("id")?.trim() ?? "";
  if (!UUID_RE.test(attachmentId)) {
    return NextResponse.json(
      { error: "A canonical attachment id is required" },
      { status: 400 }
    );
  }

  const user = await findUserByAuth(
    authUser.uid,
    authUser.email,
    "id, company_id"
  );
  if (!user?.id || !user.company_id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [canViewInbox, canViewCompany, canViewPipeline] = await Promise.all([
    checkPermissionById(user.id as string, "inbox.view"),
    checkPermissionById(user.id as string, "inbox.view_company"),
    checkPermissionById(user.id as string, "pipeline.view"),
  ]);
  if (!canViewInbox && !canViewPipeline) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("email_attachments")
    .select(
      "id, company_id, connection_id, opportunity_id, filename, mime_type, detected_mime_type, storage_backend, storage_path, ingest_status, attribution_status"
    )
    .eq("id", attachmentId)
    .eq("company_id", user.company_id as string)
    .maybeSingle();

  if (error) {
    console.error("[email-attachment] canonical lookup failed", {
      attachmentId,
      error: error.message,
    });
    return NextResponse.json(
      { error: "Failed to load attachment" },
      { status: 500 }
    );
  }

  const attachment = data as StoredAttachmentRow | null;
  if (
    !attachment ||
    attachment.ingest_status !== "stored" ||
    attachment.storage_backend !== "supabase" ||
    !attachment.storage_path
  ) {
    return unavailable();
  }

  const canViewAttributedLeadFile =
    canViewPipeline &&
    attachment.attribution_status === "attributed" &&
    Boolean(attachment.opportunity_id);
  if (!canViewAttributedLeadFile) {
    if (!canViewInbox) {
      return unavailable();
    }

    try {
      const canAccessMailbox = await canAccessEmailMailbox({
        supabase,
        companyId: user.company_id as string,
        userId: user.id as string,
        connectionId: attachment.connection_id,
        canViewCompany,
      });
      if (!canAccessMailbox) {
        return unavailable();
      }
    } catch (mailboxError) {
      console.error("[email-attachment] mailbox authorization failed", {
        attachmentId,
        error: (mailboxError as Error).message,
      });
      return NextResponse.json(
        { error: "Failed to load attachment" },
        { status: 500 }
      );
    }
  }

  const { data: storedFile, error: downloadError } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .download(attachment.storage_path);
  if (downloadError || !storedFile) {
    console.error("[email-attachment] private storage download failed", {
      attachmentId,
      error: downloadError?.message ?? "empty storage response",
    });
    return unavailable();
  }

  const mimeType =
    attachment.detected_mime_type?.trim().toLowerCase() ||
    attachment.mime_type?.trim().toLowerCase() ||
    "application/octet-stream";
  const filename = safeAttachmentFilename(attachment.filename);
  const disposition = canRenderAttachmentInline(mimeType)
    ? "inline"
    : "attachment";

  return new NextResponse(storedFile, {
    status: 200,
    headers: {
      "Content-Type": mimeType,
      "Content-Length": String(storedFile.size),
      "Content-Disposition": `${disposition}; filename="${filename}"`,
      "Cache-Control": "private, max-age=3600",
      "Content-Security-Policy": "sandbox; default-src 'none'",
      "Cross-Origin-Resource-Policy": "same-origin",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
