import { NextRequest, NextResponse } from "next/server";

import { LeadAssignmentDeliveryService } from "@/lib/api/services/lead-assignment-delivery-service";
import { OpportunityConversionNotificationDeliveryService } from "@/lib/api/services/opportunity-conversion-notification-delivery-service";
import { ProjectStatusLifecycleOutboxService } from "@/lib/api/services/project-status-lifecycle-outbox-service";
import { TaskMutationAutomationOutboxService } from "@/lib/api/services/task-mutation-automation-outbox-service";
import { UnassignedLeadAssignmentDeliveryService } from "@/lib/api/services/unassigned-lead-assignment-delivery-service";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET not configured" },
      { status: 500 }
    );
  }

  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const db = getServiceRoleClient();
    const [
      result,
      unassignedLeadAssignments,
      projectLifecycle,
      taskAutomation,
      conversionNotifications,
    ] = await Promise.all([
      LeadAssignmentDeliveryService.processBatch(db, {
        limit: 50,
        leaseSeconds: 360,
      }),
      UnassignedLeadAssignmentDeliveryService.processBatch(db, {
        limit: 50,
        leaseSeconds: 360,
      }),
      ProjectStatusLifecycleOutboxService.processBatch(db, {
        limit: 25,
        leaseSeconds: 360,
      }),
      TaskMutationAutomationOutboxService.processBatch(db, {
        limit: 25,
        leaseSeconds: 360,
      }),
      OpportunityConversionNotificationDeliveryService.processBatch(db, {
        limit: 25,
        leaseSeconds: 360,
      }),
    ]);
    const ok =
      result.errors.length === 0 &&
      result.requeued === 0 &&
      result.terminalFailed === 0 &&
      unassignedLeadAssignments.errors.length === 0 &&
      unassignedLeadAssignments.requeued === 0 &&
      unassignedLeadAssignments.terminalFailed === 0 &&
      projectLifecycle.errors.length === 0 &&
      projectLifecycle.requeued === 0 &&
      projectLifecycle.failed === 0 &&
      projectLifecycle.terminalFailed === 0 &&
      taskAutomation.errors.length === 0 &&
      taskAutomation.requeued === 0 &&
      taskAutomation.failed === 0 &&
      taskAutomation.terminalFailed === 0 &&
      conversionNotifications.errors.length === 0 &&
      conversionNotifications.requeued === 0 &&
      conversionNotifications.terminalFailed === 0;

    return NextResponse.json(
      {
        ok,
        ...result,
        unassignedLeadAssignments,
        projectLifecycle,
        taskAutomation,
        conversionNotifications,
      },
      { status: ok ? 200 : 503 }
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Lead assignment delivery worker failed";
    console.error("[cron/lead-assignment-deliveries]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
