/**
 * PATCH /api/admin/data-setup/[id]
 *
 * Mutates a `data_setup_requests` row from the admin queue. Body shape is
 * a partial update — any subset of: status, scheduledAt, notes,
 * sourceSoftware, contactEmail, contactPhone.
 *
 * Status transitions cascade:
 *   - status='scheduled' → also writes `companies.data_setup_scheduled` so
 *     iOS / web pickers see the date.
 *   - status='completed' → also writes `companies.data_setup_completed=true`
 *     and `data_setup_requests.completed_at`. Marks the persistent
 *     "Data Setup purchased" rail notification as read for company admins.
 *   - status='cancelled' → leaves entitlement bits in place by default
 *     (the company already paid; cancellation is admin override / refund).
 *     Pass `clearEntitlement: true` to also flip
 *     `companies.data_setup_purchased=false` (refund flow).
 *
 * Each transition also fires a fresh standard notification so the company
 * admins see the update on the rail.
 */
import { NextRequest, NextResponse } from "next/server";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { isAdminEmail } from "@/lib/admin/admin-queries";
import { getAdminSupabase } from "@/lib/supabase/admin-client";
import type { DataSetupRequestStatus } from "@/lib/admin/data-setup-queries";

const VALID_STATUSES: DataSetupRequestStatus[] = [
  "pending",
  "scheduled",
  "in_progress",
  "completed",
  "cancelled",
];

interface PatchBody {
  status?: DataSetupRequestStatus;
  scheduledAt?: string | null;
  notes?: string | null;
  sourceSoftware?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  /** When status='cancelled', also flip companies.data_setup_purchased=false */
  clearEntitlement?: boolean;
}

async function requireAdmin(req: NextRequest) {
  const user = await verifyAdminAuth(req);
  if (!user || !user.email || !(await isAdminEmail(user.email))) return null;
  return user;
}

function isValidIso(s: string | null): boolean {
  if (s === null) return true;
  const d = new Date(s);
  return !Number.isNaN(d.getTime());
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const admin = await requireAdmin(req);
  if (!admin) {
    return NextResponse.json(
      { code: "unauthorized", message: "Admin access required" },
      { status: 401 }
    );
  }

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json(
      { code: "missing_id", message: "Request id required" },
      { status: 400 }
    );
  }

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json(
      { code: "bad_request", message: "Invalid JSON body" },
      { status: 400 }
    );
  }

  if (body.status && !VALID_STATUSES.includes(body.status)) {
    return NextResponse.json(
      {
        code: "invalid_status",
        message: `status must be one of: ${VALID_STATUSES.join(", ")}`,
      },
      { status: 400 }
    );
  }

  if (body.scheduledAt !== undefined && !isValidIso(body.scheduledAt)) {
    return NextResponse.json(
      { code: "invalid_date", message: "scheduledAt must be ISO 8601 or null" },
      { status: 400 }
    );
  }

  const db = getAdminSupabase();

  // Pull the existing row + company context for downstream cascades.
  const { data: existing, error: fetchErr } = await db
    .from("data_setup_requests")
    .select("id, company_id, status, scheduled_at")
    .eq("id", id)
    .maybeSingle();

  if (fetchErr) {
    return NextResponse.json(
      { code: "db_error", message: fetchErr.message },
      { status: 500 }
    );
  }
  if (!existing) {
    return NextResponse.json(
      { code: "not_found", message: "Request not found" },
      { status: 404 }
    );
  }

  // Build the row update payload.
  const requestUpdates: Record<string, unknown> = {};
  if (body.status) requestUpdates.status = body.status;
  if (body.scheduledAt !== undefined)
    requestUpdates.scheduled_at = body.scheduledAt;
  if (body.notes !== undefined) requestUpdates.notes = body.notes;
  if (body.sourceSoftware !== undefined)
    requestUpdates.source_software = body.sourceSoftware;
  if (body.contactEmail !== undefined)
    requestUpdates.contact_email = body.contactEmail;
  if (body.contactPhone !== undefined)
    requestUpdates.contact_phone = body.contactPhone;

  // status='completed' implies completed_at = NOW() unless explicitly set.
  if (body.status === "completed") {
    requestUpdates.completed_at = new Date().toISOString();
  }

  if (Object.keys(requestUpdates).length === 0) {
    return NextResponse.json(
      { code: "no_changes", message: "Request body had no updatable fields" },
      { status: 400 }
    );
  }

  const { data: updated, error: updateErr } = await db
    .from("data_setup_requests")
    .update(requestUpdates)
    .eq("id", id)
    .select()
    .single();

  if (updateErr) {
    return NextResponse.json(
      { code: "db_error", message: updateErr.message },
      { status: 500 }
    );
  }

  // Cascade companies.* entitlement bits when the operations status changes.
  const companyUpdates: Record<string, unknown> = {};
  if (body.status === "scheduled" && body.scheduledAt) {
    companyUpdates.data_setup_scheduled = body.scheduledAt;
  }
  if (body.status === "completed") {
    companyUpdates.data_setup_completed = true;
  }
  if (body.status === "cancelled" && body.clearEntitlement) {
    companyUpdates.data_setup_purchased = false;
    // Don't reset data_setup_completed if it had previously completed —
    // historical truth stays intact.
  }
  if (
    body.status === "pending" &&
    existing.status !== "pending" &&
    existing.scheduled_at
  ) {
    // Returning to pending wipes the schedule.
    companyUpdates.data_setup_scheduled = null;
  }
  if (Object.keys(companyUpdates).length > 0) {
    const { error: companyErr } = await db
      .from("companies")
      .update(companyUpdates)
      .eq("id", existing.company_id);
    if (companyErr) {
      console.error(
        `[admin/data-setup] Failed to cascade company update for ${existing.company_id}:`,
        companyErr.message
      );
      // Non-fatal: the row update already succeeded. Log and continue.
    }
  }

  // Notification rail side-effects on transitions. Skip if the status didn't
  // actually change (e.g. an admin only edited notes).
  if (body.status && body.status !== existing.status) {
    await fireStatusNotification(db, existing.company_id, body.status, {
      scheduledAt: body.scheduledAt ?? null,
    });
  }

  return NextResponse.json({ ok: true, request: updated });
}

interface NotificationDetails {
  scheduledAt: string | null;
}

async function fireStatusNotification(
  db: ReturnType<typeof getAdminSupabase>,
  companyId: string,
  status: DataSetupRequestStatus,
  details: NotificationDetails
): Promise<void> {
  const copy: Record<
    DataSetupRequestStatus,
    { title: string; body: string; persistent: boolean } | null
  > = {
    pending: {
      title: "Data Setup back to pending",
      body: "We've reset your migration. We'll be in touch within 24 hours to reschedule.",
      persistent: true,
    },
    scheduled: {
      title: "Migration scheduled",
      body: details.scheduledAt
        ? `Your data migration is locked for ${formatDate(details.scheduledAt)}.`
        : "Your data migration is locked.",
      persistent: false,
    },
    in_progress: {
      title: "Migration in progress",
      body: "We're moving your data over now. You'll get another note when it's done.",
      persistent: true,
    },
    completed: {
      title: "Data Setup complete",
      body: "Your data is in. Welcome aboard.",
      persistent: false,
    },
    cancelled: {
      title: "Data Setup cancelled",
      body: "Your migration request was cancelled. Reach out if this was unexpected.",
      persistent: false,
    },
  };

  const message = copy[status];
  if (!message) return;

  // Resolve admin user ids for the company. Falls back silently if there
  // are no admins (the rail just won't show a notification — non-fatal).
  const { data: admins } = await db
    .from("users")
    .select("id")
    .eq("company_id", companyId)
    .eq("is_company_admin", true);

  if (!admins || admins.length === 0) return;

  // Mark any previously-persistent "Data Setup purchased" notifications as
  // read so the rail clears the stale entry when status leaves pending.
  if (status !== "pending") {
    await db
      .from("notifications")
      .update({ is_read: true })
      .eq("company_id", companyId)
      .eq("type", "system")
      .eq("title", "Data Setup purchased")
      .eq("is_read", false);
  }

  await Promise.all(
    admins.map(async (u) => {
      const { error } = await db.rpc("create_notification_if_new", {
        p_user_id: u.id as string,
        p_company_id: companyId,
        p_type: "system",
        p_title: message.title,
        p_body: message.body,
        p_persistent: message.persistent,
        p_action_url: "/settings?tab=subscription",
        p_action_label: "View",
        p_project_id: null,
      });
      if (error) {
        console.error(
          `[admin/data-setup] notification RPC failed for ${u.id}:`,
          error.message
        );
      }
    })
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}
