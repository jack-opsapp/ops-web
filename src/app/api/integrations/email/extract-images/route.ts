/**
 * OPS Web - Legacy Attachment Extraction Compatibility Endpoint
 *
 * POST /api/integrations/email/extract-images
 *
 * Older import workers may still call this endpoint with an opportunity and
 * provider-thread payload. Attachment bytes now flow exclusively through the
 * durable, exact-message queue. This compatibility route translates legacy
 * payloads into missing scan rows without reading provider bytes, exposing
 * files publicly, or replacing an opportunity's image list.
 */

import { NextRequest, NextResponse } from "next/server";

import { EmailService } from "@/lib/api/services/email-service";
import { requireEmailPipelineSecret } from "@/lib/email/email-route-auth";
import { runWithSupabase } from "@/lib/supabase/helpers";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

export const maxDuration = 800;

interface OppThreadEntry {
  opportunityId?: string;
  threadIds?: string[];
  // Retained in the request shape for callers from before the durable queue.
  // Canonical attribution is resolved from the exact activity instead.
  allowedSenders?: string[];
}

interface ExactActivityRow {
  id: unknown;
  company_id: unknown;
  email_connection_id: unknown;
  email_thread_id: unknown;
  email_message_id: unknown;
}

interface AttachmentScanInsert {
  company_id: string;
  connection_id: string;
  activity_id: string;
  provider_thread_id: string;
  message_id: string;
  status: "pending";
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: NextRequest) {
  const authError = requireEmailPipelineSecret(request);
  if (authError) return authError;

  const { jobId, connectionId, companyId, oppThreadPayload } =
    (await request.json()) as {
      jobId?: string;
      connectionId?: string;
      companyId?: string;
      oppThreadPayload?: OppThreadEntry[];
    };

  if (
    !jobId ||
    !connectionId ||
    !companyId ||
    !Array.isArray(oppThreadPayload)
  ) {
    return NextResponse.json(
      { error: "jobId, connectionId, companyId, oppThreadPayload required" },
      { status: 400 }
    );
  }

  const supabase = getServiceRoleClient();
  const connection = await runWithSupabase(supabase, () =>
    EmailService.getConnection(connectionId)
  );

  if (!connection || connection.companyId !== companyId) {
    return NextResponse.json(
      { error: "Connection not found" },
      { status: 404 }
    );
  }

  const { data: job, error: jobError } = await supabase
    .from("gmail_scan_jobs")
    .select("id, connection_id, company_id")
    .eq("id", jobId)
    .single();
  if (
    jobError ||
    !job ||
    job.connection_id !== connectionId ||
    job.company_id !== companyId
  ) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const scanByActivityId = new Map<string, AttachmentScanInsert>();

  for (const entry of oppThreadPayload) {
    const opportunityId = cleanString(entry?.opportunityId);
    const providerThreadIds = Array.from(
      new Set(
        (Array.isArray(entry?.threadIds) ? entry.threadIds : [])
          .map(cleanString)
          .filter(Boolean)
      )
    );
    if (!opportunityId || providerThreadIds.length === 0) continue;

    const { data: activities, error: activitiesError } = await supabase
      .from("activities")
      .select(
        "id, company_id, email_connection_id, email_thread_id, email_message_id"
      )
      .eq("company_id", companyId)
      .eq("email_connection_id", connectionId)
      .eq("opportunity_id", opportunityId)
      .eq("type", "email")
      .in("email_thread_id", providerThreadIds);

    if (activitiesError) {
      console.error(
        "[extract-images] Failed to resolve exact email activities:",
        activitiesError.message
      );
      return NextResponse.json(
        { error: "Failed to queue attachment scans" },
        { status: 500 }
      );
    }

    for (const rawActivity of activities ?? []) {
      const activity = rawActivity as ExactActivityRow;
      const activityId = cleanString(activity.id);
      const providerThreadId = cleanString(activity.email_thread_id);
      const messageId = cleanString(activity.email_message_id);

      // Query filters are repeated here as a fail-closed boundary in case a
      // mocked or future data adapter returns rows outside the requested scope.
      if (
        !activityId ||
        !messageId ||
        !providerThreadIds.includes(providerThreadId) ||
        activity.company_id !== companyId ||
        activity.email_connection_id !== connectionId
      ) {
        continue;
      }

      scanByActivityId.set(activityId, {
        company_id: companyId,
        connection_id: connectionId,
        activity_id: activityId,
        provider_thread_id: providerThreadId,
        message_id: messageId,
        status: "pending",
      });
    }
  }

  const scanCandidates = Array.from(scanByActivityId.values());
  if (scanCandidates.length > 0) {
    // Do not reset a completed or in-flight scan. The activity trigger already
    // owns normal enqueueing; this insert only fills gaps from legacy callers.
    const { error: scanError } = await supabase
      .from("email_attachment_scans")
      .upsert(scanCandidates, {
        onConflict: "activity_id",
        ignoreDuplicates: true,
      });

    if (scanError) {
      console.error(
        "[extract-images] Failed to enqueue attachment scans:",
        scanError.message
      );
      return NextResponse.json(
        { error: "Failed to queue attachment scans" },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ ok: true, scanCandidates: scanCandidates.length });
}
