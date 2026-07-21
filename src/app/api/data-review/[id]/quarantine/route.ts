/**
 * POST /api/data-review/[id]/quarantine
 *
 * Marks a split provider thread reviewed-and-left-as-is by re-pointing its
 * activities onto a synthetic `legacy:<providerThreadId>` thread id — the same
 * quarantine marker the DW1 de-aggregation uses — so the item drops out of the
 * actionable queue and the lifecycle cron's fragmentation skip covers it. No
 * opportunity links change, no rows are deleted. All logic lives in
 * LeadDataReviewService.quarantineThread (idempotent, allow-listed write only).
 *
 * `[id]` is the mailbox-scoped provider thread id. On success, reconciles one
 * idempotent rail notification after canonical lead edit + inbox view checks.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveEmailRouteActor } from "@/lib/email/email-route-auth";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { runWithSupabase } from "@/lib/supabase/helpers";
import {
  isDataReviewAccessDenied,
  LeadDataReviewService,
} from "@/lib/api/services/lead-data-review-service";
import type { ReviewItemKind } from "@/lib/api/services/lead-data-review-service";
import { renderForCompany } from "@/i18n/server-render";
import { createTrustedNotifications } from "@/lib/notifications/server-notification-service";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: providerThreadId } = await params;

  const actorResolution = await resolveEmailRouteActor(request);
  if (!actorResolution.ok) return actorResolution.response;
  const { userId: actorUserId, companyId } = actorResolution.actor;

  if (!providerThreadId) {
    return NextResponse.json(
      { error: "provider thread id is required" },
      { status: 400 }
    );
  }

  // Optional body carries the item kind so terminal_live (cache-only, no owning
  // activities) resolves gracefully instead of erroring. Default to "split".
  let itemKind: ReviewItemKind = "split";
  let connectionId: string | null = null;
  try {
    const body = await request.json();
    if (
      typeof (body as { connectionId?: unknown })?.connectionId === "string"
    ) {
      connectionId = (body as { connectionId: string }).connectionId;
    }
    if ((body as { kind?: unknown })?.kind === "terminal_live") {
      itemKind = "terminal_live";
    } else if (
      (body as { kind?: unknown })?.kind !== undefined &&
      (body as { kind?: unknown })?.kind !== "split"
    ) {
      return NextResponse.json(
        { error: "invalid review item kind" },
        { status: 400 }
      );
    }
  } catch {
    // The exact mailbox selector is mandatory, so malformed/missing JSON is
    // rejected by the validation below.
  }
  if (!connectionId) {
    return NextResponse.json(
      { error: "connectionId is required" },
      { status: 400 }
    );
  }
  const exactConnectionId = connectionId.trim();
  const exactProviderThreadId = providerThreadId.trim();
  if (!exactConnectionId) {
    return NextResponse.json(
      { error: "connectionId is required" },
      { status: 400 }
    );
  }
  if (!exactProviderThreadId) {
    return NextResponse.json(
      { error: "provider thread id is required" },
      { status: 400 }
    );
  }

  const db = getServiceRoleClient();

  try {
    const result = await runWithSupabase(db, () =>
      LeadDataReviewService.quarantineThread({
        actorUserId,
        companyId,
        connectionId: exactConnectionId,
        providerThreadId: exactProviderThreadId,
        kind: itemKind,
      })
    );

    // Standard dismissible rail notification — localized, purpose-named type.
    let notificationStatus: "created" | "existing" | "failed" = "failed";
    try {
      const subjectLabel = result.subject?.trim() || "thread";
      const [title, notifBody] = await Promise.all([
        renderForCompany(
          companyId,
          "data-review",
          "queue.notif.quarantinedTitle",
          { subject: subjectLabel }
        ),
        renderForCompany(
          companyId,
          "data-review",
          "queue.notif.quarantinedBody"
        ),
      ]);
      const notification = await createTrustedNotifications(
        {
          companyId,
          recipientUserIds: [actorUserId],
          type: "data_review_resolved",
          title,
          body: notifBody,
          persistent: false,
          dedupeKey: `data_review_resolution:v1:quarantine:${exactConnectionId}:${result.providerThreadId}:${itemKind}:r${result.resolutionVersion}`,
          durableDedupe: true,
        },
        db
      );
      notificationStatus =
        notification.errors > 0
          ? "failed"
          : notification.createdNotifications.length > 0
            ? "created"
            : "existing";
    } catch (notificationError) {
      console.error(
        "[DataReview] quarantine notification reconciliation failed:",
        notificationError
      );
    }

    return NextResponse.json({ ok: true, result, notificationStatus });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[DataReview] quarantine error:", message);
    return NextResponse.json(
      { error: message },
      { status: isDataReviewAccessDenied(err) ? 403 : 500 }
    );
  }
}
