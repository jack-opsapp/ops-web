"use client";

/**
 * Client-side wrappers for the admin data-setup PATCH endpoint. Returns the
 * canonical row shape consumed by the queue UI. Throws on non-2xx responses
 * with a useful message extracted from the API's `{code,message}` envelope.
 */
import type { DataSetupQueueRow } from "@/lib/admin/data-setup-queries";

interface PatchPayload {
  status?: "pending" | "scheduled" | "in_progress" | "completed" | "cancelled";
  scheduledAt?: string | null;
  notes?: string | null;
  sourceSoftware?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  clearEntitlement?: boolean;
}

interface ApiRow {
  id: string;
  company_id: string;
  status: DataSetupQueueRow["status"];
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
}

export async function patchDataSetupRequest(
  id: string,
  payload: PatchPayload
): Promise<DataSetupQueueRow> {
  const { getIdToken } = await import("@/lib/firebase/auth");
  const token = await getIdToken();
  const res = await fetch(`/api/admin/data-setup/${id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  });

  const json = (await res.json()) as
    | { ok: true; request: ApiRow }
    | { code?: string; message?: string };

  if (!res.ok || !("request" in json)) {
    const message =
      "message" in json && json.message
        ? json.message
        : `Failed (${res.status})`;
    throw new Error(message);
  }

  // The API returns the raw DB row. Merge it into the existing queue row
  // shape (which carries the joined company + requester fields) so the UI
  // can keep showing the company name without another fetch. Caller is
  // responsible for splicing this into its `rows` state.
  const r = json.request;
  return {
    id: r.id,
    companyId: r.company_id,
    companyName: "", // patched below by callers that have the original row
    companyEmail: null,
    companyPhone: null,
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
    requesterName: null,
    requesterEmail: null,
  };
}

/**
 * Variant that preserves the joined fields (company name / requester /
 * contacts) the API doesn't return. Callers that already have the original
 * row should use this — it's the version the UI components consume.
 */
export async function patchAndMerge(
  current: DataSetupQueueRow,
  payload: PatchPayload
): Promise<DataSetupQueueRow> {
  const patched = await patchDataSetupRequest(current.id, payload);
  return {
    ...current,
    ...patched,
    companyName: current.companyName,
    companyEmail: current.companyEmail,
    companyPhone: current.companyPhone,
    requesterName: current.requesterName,
    requesterEmail: current.requesterEmail,
  };
}
