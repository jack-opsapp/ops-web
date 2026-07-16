/**
 * GET /api/integrations/email/attachment?id=<email_attachments.id>
 *
 * Streams one canonical email attachment from private OPS storage. Provider
 * message, mailbox, tenant, MIME, and filename values are never accepted from
 * the caller; the canonical database row is the sole authority.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  canRenderAttachmentInline,
  safeAttachmentFilename,
} from "@/lib/api/services/email-attachments/attachment-policy";
import { resolveEmailOpportunityAccess } from "@/lib/email/email-opportunity-access";
import { resolveEmailRouteActor } from "@/lib/email/email-route-auth";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

const ATTACHMENT_BUCKET = "email-attachments";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface StoredAttachmentRow {
  id: string;
  company_id: string;
  connection_id: string;
  provider_thread_id: string;
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
  const actorResolution = await resolveEmailRouteActor(request);
  if (!actorResolution.ok) return actorResolution.response;
  const { actor } = actorResolution;

  const attachmentId =
    new URL(request.url).searchParams.get("id")?.trim() ?? "";
  if (!UUID_RE.test(attachmentId)) {
    return NextResponse.json(
      { error: "A canonical attachment id is required" },
      { status: 400 }
    );
  }

  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("email_attachments")
    .select(
      "id, company_id, connection_id, provider_thread_id, opportunity_id, filename, mime_type, detected_mime_type, storage_backend, storage_path, ingest_status, attribution_status"
    )
    .eq("id", attachmentId)
    .eq("company_id", actor.companyId)
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

  const { data: threadRow, error: threadError } = await supabase
    .from("email_threads")
    .select("id")
    .eq("company_id", actor.companyId)
    .eq("connection_id", attachment.connection_id)
    .eq("provider_thread_id", attachment.provider_thread_id)
    .maybeSingle();
  if (threadError) {
    console.error("[email-attachment] canonical thread lookup failed", {
      attachmentId,
      error: threadError.message,
    });
    return NextResponse.json(
      { error: "Failed to load attachment" },
      { status: 500 }
    );
  }
  if (!threadRow?.id) return unavailable();

  const access = await resolveEmailOpportunityAccess({
    actor,
    operation: "read",
    threadId: threadRow.id as string,
    connectionId: attachment.connection_id,
    providerThreadId: attachment.provider_thread_id,
    opportunityId: attachment.opportunity_id ?? undefined,
    supabase,
  });
  if (!access.allowed) {
    return unavailable();
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
