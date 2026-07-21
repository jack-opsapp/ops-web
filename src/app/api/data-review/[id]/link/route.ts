/**
 * POST /api/data-review/[id]/link
 *
 * Re-points a split provider thread's activities onto the operator-chosen
 * owning opportunity — the confident re-point the auto-resolver refused, now
 * operator-authorized. `[id]` is the provider thread id; the body carries the
 * chosen target. All re-point logic + the single-client guard live in
 * LeadDataReviewService.linkThread (idempotent, allow-listed writes only —
 * never a raw multi-write).
 *
 * Body: { targetOpportunityId: string }
 *
 * On success, reconciles one idempotent dismissible rail notification. The
 * guarded RPC requires canonical lead edit + inbox view for every owner.
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

  const body = await request.json();
  const { targetOpportunityId, connectionId, kind } = body as {
    targetOpportunityId?: unknown;
    connectionId?: unknown;
    kind?: unknown;
  };
  if (!targetOpportunityId || typeof targetOpportunityId !== "string") {
    return NextResponse.json(
      { error: "targetOpportunityId is required" },
      { status: 400 }
    );
  }
  if (!connectionId || typeof connectionId !== "string") {
    return NextResponse.json(
      { error: "connectionId is required" },
      { status: 400 }
    );
  }
  if (!providerThreadId) {
    return NextResponse.json(
      { error: "provider thread id is required" },
      { status: 400 }
    );
  }
  const exactConnectionId = connectionId.trim();
  const exactProviderThreadId = providerThreadId.trim();
  const exactTargetOpportunityId = targetOpportunityId.trim();
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
  if (!exactTargetOpportunityId) {
    return NextResponse.json(
      { error: "targetOpportunityId is required" },
      { status: 400 }
    );
  }
  // The resolving action branches on item kind: "split" re-points activities,
  // "terminal_live" aligns the NULL-canonical cache row. Default to "split".
  if (kind !== undefined && kind !== "split" && kind !== "terminal_live") {
    return NextResponse.json(
      { error: "invalid review item kind" },
      { status: 400 }
    );
  }
  const itemKind: ReviewItemKind =
    kind === "terminal_live" ? "terminal_live" : "split";

  const db = getServiceRoleClient();

  try {
    const result = await runWithSupabase(db, () =>
      LeadDataReviewService.linkThread({
        actorUserId,
        companyId,
        connectionId: exactConnectionId,
        providerThreadId: exactProviderThreadId,
        targetOpportunityId: exactTargetOpportunityId,
        kind: itemKind,
      })
    );

    // Standard dismissible rail notification — the operator already acted.
    // Localized server-side against the company locale; purpose-named type so
    // the rail buckets it as a data-review outcome (not a duplicates scan).
    let notificationStatus: "created" | "existing" | "failed" = "failed";
    try {
      const subjectLabel = result.targetTitle?.trim() || "thread";
      const [title, notifBody, actionLabel] = await Promise.all([
        renderForCompany(companyId, "data-review", "queue.notif.linkedTitle", {
          subject: subjectLabel,
        }),
        renderForCompany(companyId, "data-review", "queue.notif.linkedBody", {
          count: result.activitiesRepointed,
          subject: subjectLabel,
        }),
        renderForCompany(companyId, "data-review", "queue.notif.actionLabel"),
      ]);
      const notification = await createTrustedNotifications(
        {
          companyId,
          recipientUserIds: [actorUserId],
          type: "data_review_resolved",
          title,
          body: notifBody,
          persistent: false,
          actionUrl: `/dashboard?openProject=${result.targetOpportunityId}&mode=view`,
          actionLabel,
          dedupeKey: `data_review_resolution:v1:link:${exactConnectionId}:${result.providerThreadId}:${itemKind}:${result.targetOpportunityId}:r${result.resolutionVersion}`,
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
        "[DataReview] link notification reconciliation failed:",
        notificationError
      );
    }

    return NextResponse.json({ ok: true, result, notificationStatus });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[DataReview] link error:", message);
    return NextResponse.json(
      { error: message },
      { status: isDataReviewAccessDenied(err) ? 403 : 500 }
    );
  }
}
