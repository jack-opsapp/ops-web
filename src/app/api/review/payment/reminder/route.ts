import { NextRequest, NextResponse } from "next/server";
import {
  authenticateRequest,
  isErrorResponse,
} from "@/app/api/agent/_lib/auth";
import { PaymentReminderService } from "@/lib/api/services/payment-reminder-service";
import { checkPermissionById } from "@/lib/supabase/check-permission";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { runWithSupabase } from "@/lib/supabase/helpers";

interface ReminderRequestBody {
  projectId?: unknown;
}

export const maxDuration = 300;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  return runWithSupabase(getServiceRoleClient(), async () => {
    try {
      const auth = await authenticateRequest(request);
      if (isErrorResponse(auth)) return auth;

      const body = (await request.json()) as ReminderRequestBody;
      const projectId =
        typeof body.projectId === "string" ? body.projectId.trim() : "";
      if (!UUID_PATTERN.test(projectId)) {
        return NextResponse.json(
          { error: "A valid projectId is required" },
          { status: 400 }
        );
      }

      const [
        canEditProjects,
        canViewInvoices,
        canSendInvoices,
        canViewFinances,
      ] = await Promise.all([
        checkPermissionById(auth.id, "projects.edit", "all"),
        checkPermissionById(auth.id, "invoices.view", "all"),
        checkPermissionById(auth.id, "invoices.send", "all"),
        checkPermissionById(auth.id, "finances.view", "all"),
      ]);

      if (
        !canEditProjects ||
        !canViewInvoices ||
        !canSendInvoices ||
        !canViewFinances
      ) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      const result = await PaymentReminderService.queueProjectReminders(
        auth.companyId,
        auth.id,
        projectId
      );

      if (result.blockedReason) {
        const error =
          result.blockedReason === "mailbox_required"
            ? "Connect a company mailbox before queuing reminders"
            : result.blockedReason === "client_email_required"
              ? "Add a client email before queuing reminders"
              : result.blockedReason === "reminders_disabled"
                ? "Payment reminders are disabled for this company"
                : "Payment reminder automation is not enabled";
        return NextResponse.json({ error, ...result }, { status: 422 });
      }

      const clientEmailBlockedCount = result.clientEmailBlockedCount ?? 0;
      if (result.failedCount > 0 || clientEmailBlockedCount > 0) {
        const error =
          clientEmailBlockedCount > 0
            ? "Some payment reminders need a client email"
            : "Some payment reminders could not be queued";
        return NextResponse.json({ error, ...result }, { status: 503 });
      }

      if (result.eligibleCount === 0) {
        return NextResponse.json(
          {
            error: "No reminder is due for this project's outstanding invoices",
            ...result,
          },
          { status: 409 }
        );
      }

      return NextResponse.json(result, {
        status: result.queuedCount > 0 ? 201 : 200,
      });
    } catch (error) {
      console.error("[review/payment/reminder]", error);
      return NextResponse.json(
        { error: "Unable to queue payment reminder" },
        { status: 500 }
      );
    }
  });
}
