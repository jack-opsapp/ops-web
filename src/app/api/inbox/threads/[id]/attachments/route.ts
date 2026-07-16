/**
 * GET /api/inbox/threads/{id}/attachments
 *
 * Returns canonical attachments already copied into private OPS storage for
 * this exact email thread and mailbox. This route never calls Gmail or
 * Microsoft, so stored files remain available after a mailbox disconnects.
 */

import { NextRequest, NextResponse } from "next/server";
import { safeAttachmentFilename } from "@/lib/api/services/email-attachments/attachment-policy";
import { resolveEmailOpportunityAccess } from "@/lib/email/email-opportunity-access";
import { resolveEmailRouteActor } from "@/lib/email/email-route-auth";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

export interface ThreadAttachmentDto {
  id: string;
  messageId: string;
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
  fromEmail: string;
  date: string;
  availability: ThreadAttachmentAvailability;
  url: string | null;
}

type ThreadAttachmentAvailability =
  | "stored"
  | "external"
  | "oversized"
  | "unavailable"
  | "failed";

const REVIEWABLE_ATTACHMENT_STATUSES: ThreadAttachmentAvailability[] = [
  "stored",
  "external",
  "oversized",
  "unavailable",
  "failed",
];

interface ThreadAttachmentRow {
  id: string;
  message_id: string;
  attachment_id: string;
  filename: string | null;
  mime_type: string | null;
  detected_mime_type: string | null;
  size_bytes: number | null;
  verified_size_bytes: number | null;
  from_email: string | null;
  occurred_at: string | null;
  created_at: string | null;
  storage_backend: string | null;
  storage_path: string | null;
  source_url: string | null;
  ingest_status: string;
}

function buildProxyUrl(id: string, filename: string): string {
  return `/api/integrations/email/attachment?${new URLSearchParams({
    id,
    filename: safeAttachmentFilename(filename),
  }).toString()}`;
}

function safeExternalReferenceUrl(value: string | null): string | null {
  const candidate = value?.trim();
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
      return null;
    }
    return candidate;
  } catch {
    return null;
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const actorResolution = await resolveEmailRouteActor(request);
  if (!actorResolution.ok) return actorResolution.response;
  const { actor } = actorResolution;
  const supabase = getServiceRoleClient();
  const access = await resolveEmailOpportunityAccess({
    actor,
    operation: "read",
    threadId: id,
    supabase,
  });
  if (!access.allowed) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const { data, error } = await supabase
      .from("email_attachments")
      .select(
        "id, message_id, attachment_id, filename, mime_type, detected_mime_type, size_bytes, verified_size_bytes, from_email, occurred_at, created_at, storage_backend, storage_path, source_url, ingest_status"
      )
      .eq("company_id", actor.companyId)
      .eq("connection_id", access.connectionId)
      .eq("provider_thread_id", access.providerThreadId)
      .in("ingest_status", REVIEWABLE_ATTACHMENT_STATUSES)
      .order("occurred_at", { ascending: false });

    if (error) {
      throw new Error(`canonical attachment query failed: ${error.message}`);
    }

    const rows = (data ?? []) as ThreadAttachmentRow[];
    const attachments: ThreadAttachmentDto[] = rows.map((row) => {
      const filename = row.filename?.trim() || "attachment";
      const availability = row.ingest_status as ThreadAttachmentAvailability;
      const url =
        availability === "stored" &&
        row.storage_backend === "supabase" &&
        Boolean(row.storage_path)
          ? buildProxyUrl(row.id, filename)
          : availability === "external"
            ? safeExternalReferenceUrl(row.source_url)
            : null;

      return {
        id: row.id,
        messageId: row.message_id,
        attachmentId: row.attachment_id,
        filename,
        mimeType:
          row.detected_mime_type?.trim().toLowerCase() ||
          row.mime_type?.trim().toLowerCase() ||
          "application/octet-stream",
        size: row.verified_size_bytes ?? row.size_bytes ?? 0,
        fromEmail: row.from_email ?? "",
        date: row.occurred_at ?? row.created_at ?? new Date(0).toISOString(),
        availability,
        url,
      };
    });

    return NextResponse.json({ attachments });
  } catch (err) {
    console.error("[/api/inbox/threads/:id/attachments] failed:", err);
    return NextResponse.json(
      {
        error: `Failed to load attachments: ${(err as Error).message}`,
        attachments: [] as ThreadAttachmentDto[],
      },
      { status: 500 }
    );
  }
}
