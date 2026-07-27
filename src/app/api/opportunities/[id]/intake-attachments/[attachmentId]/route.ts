import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { resolveEmailRouteActor } from "@/lib/email/email-route-auth";
import { createExternalAttachmentDeliveryUrl } from "@/lib/external-api/uploads/cloudfront-delivery";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const uuidSchema = z.string().uuid();
const resolvedAttachmentSchema = z
  .object({
    storage_object_key: z.string().min(1),
    delivery_mode: z.enum(["attachment", "inline_image"]),
    filename: z.string().min(1).max(255),
  })
  .strict();

function notFound(): NextResponse {
  return NextResponse.json(
    { error: "Attachment not found" },
    {
      status: 404,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
      },
    }
  );
}

export async function GET(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ id: string; attachmentId: string }>;
  }
) {
  const actorResolution = await resolveEmailRouteActor(request);
  if (!actorResolution.ok) return actorResolution.response;

  const { id, attachmentId } = await params;
  const mode = new URL(request.url).searchParams.get("mode");
  if (
    !uuidSchema.safeParse(id).success ||
    !uuidSchema.safeParse(attachmentId).success ||
    (mode !== "preview" && mode !== "download")
  ) {
    return notFound();
  }

  const { data, error } = await getServiceRoleClient().rpc(
    "resolve_external_intake_attachment_as_system",
    {
      p_actor_user_id: actorResolution.actor.userId,
      p_opportunity_id: id,
      p_public_upload_id: attachmentId,
      p_mode: mode,
    }
  );
  if (error) {
    console.error("[intake-attachment] guarded resolution failed", {
      opportunityId: id,
      attachmentId,
      mode,
      error: error.message,
    });
    return NextResponse.json(
      { error: "Attachment unavailable" },
      { status: 500 }
    );
  }
  const resolved = resolvedAttachmentSchema.safeParse(data);
  if (!resolved.success) return notFound();
  if (
    (mode === "preview" && resolved.data.delivery_mode !== "inline_image") ||
    (mode === "download" && resolved.data.delivery_mode !== "attachment")
  ) {
    return notFound();
  }

  let capability: ReturnType<typeof createExternalAttachmentDeliveryUrl>;
  try {
    capability = createExternalAttachmentDeliveryUrl({
      objectKey: resolved.data.storage_object_key,
      mode: mode === "preview" ? "inline-image" : "attachment",
      expiresInSeconds: 60,
    });
  } catch {
    return NextResponse.json(
      { error: "Attachment unavailable" },
      {
        status: 500,
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
        },
      }
    );
  }
  const response = NextResponse.redirect(capability.url, 307);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Content-Security-Policy", "default-src 'none'");
  return response;
}
