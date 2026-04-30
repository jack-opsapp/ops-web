/**
 * Admin queries for the Data Setup queue.
 *
 * Fetches `data_setup_requests` rows joined with their owning company and
 * computes the dashboard stats (pending count, scheduled this week,
 * in-progress, completed this month). Service-role client — bypasses RLS
 * because the queue is operator-only and the admin layout already gates
 * access via `isAdminEmail()`.
 */
import { getAdminSupabase } from "@/lib/supabase/admin-client";

export type DataSetupRequestStatus =
  | "pending"
  | "scheduled"
  | "in_progress"
  | "completed"
  | "cancelled";

export interface DataSetupQueueRow {
  id: string;
  companyId: string;
  companyName: string;
  companyEmail: string | null;
  companyPhone: string | null;
  status: DataSetupRequestStatus;
  scheduledAt: string | null;
  completedAt: string | null;
  notes: string | null;
  stripePaymentIntentId: string | null;
  amountPaidCents: number | null;
  sourceSoftware: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  createdAt: string;
  updatedAt: string;
  /** First+last name of the user who initiated the purchase (best-effort). */
  requesterName: string | null;
  requesterEmail: string | null;
}

export interface DataSetupQueueStats {
  pending: number;
  scheduled: number;
  inProgress: number;
  completed: number;
  cancelled: number;
  total: number;
  /** Pending count currently breaching the 24h SLA. */
  pendingSlaBreach: number;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export async function getDataSetupQueue(): Promise<DataSetupQueueRow[]> {
  const supabase = getAdminSupabase();
  // Pull all columns + the company name and contacts in a single query via
  // the FK relationship. `requested_by` joins to users for the requester
  // name/email so the queue surfaces who purchased without a second roundtrip.
  const { data, error } = await supabase
    .from("data_setup_requests")
    .select(
      `
        id,
        company_id,
        status,
        scheduled_at,
        completed_at,
        notes,
        stripe_payment_intent_id,
        amount_paid_cents,
        source_software,
        contact_email,
        contact_phone,
        created_at,
        updated_at,
        companies:company_id ( name, email, phone ),
        requester:requested_by ( first_name, last_name, email )
      `
    )
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Failed to fetch data setup queue: ${error.message}`);

  type Row = {
    id: string;
    company_id: string;
    status: DataSetupRequestStatus;
    scheduled_at: string | null;
    completed_at: string | null;
    notes: string | null;
    stripe_payment_intent_id: string | null;
    amount_paid_cents: number | null;
    source_software: string | null;
    contact_email: string | null;
    contact_phone: string | null;
    created_at: string;
    updated_at: string;
    companies: { name: string; email: string | null; phone: string | null } | null;
    requester:
      | { first_name: string; last_name: string; email: string | null }
      | null;
  };

  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    companyId: r.company_id,
    companyName: r.companies?.name ?? "(unknown company)",
    companyEmail: r.companies?.email ?? null,
    companyPhone: r.companies?.phone ?? null,
    status: r.status,
    scheduledAt: r.scheduled_at,
    completedAt: r.completed_at,
    notes: r.notes,
    stripePaymentIntentId: r.stripe_payment_intent_id,
    amountPaidCents: r.amount_paid_cents,
    sourceSoftware: r.source_software,
    contactEmail: r.contact_email,
    contactPhone: r.contact_phone,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    requesterName: r.requester
      ? `${r.requester.first_name} ${r.requester.last_name}`.trim() || null
      : null,
    requesterEmail: r.requester?.email ?? null,
  }));
}

export function computeQueueStats(rows: DataSetupQueueRow[]): DataSetupQueueStats {
  const now = Date.now();
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const startOfMonthMs = startOfMonth.getTime();

  let pending = 0;
  let scheduled = 0;
  let inProgress = 0;
  let completed = 0;
  let cancelled = 0;
  let pendingSlaBreach = 0;

  for (const r of rows) {
    switch (r.status) {
      case "pending":
        pending++;
        if (now - new Date(r.createdAt).getTime() > ONE_DAY_MS) {
          pendingSlaBreach++;
        }
        break;
      case "scheduled":
        scheduled++;
        break;
      case "in_progress":
        inProgress++;
        break;
      case "completed":
        if (r.completedAt && new Date(r.completedAt).getTime() >= startOfMonthMs) {
          completed++;
        }
        break;
      case "cancelled":
        cancelled++;
        break;
    }
  }

  return {
    pending,
    scheduled,
    inProgress,
    completed,
    cancelled,
    total: rows.length,
    pendingSlaBreach,
  };
}
