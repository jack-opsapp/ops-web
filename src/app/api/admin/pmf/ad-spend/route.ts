/**
 * OPS Admin — PMF Ad Spend manual entry
 *
 * POST /api/admin/pmf/ad-spend
 *   Body: { channel, month: "YYYY-MM", spend_cents, impressions?,
 *           clicks?, downloads? }  (validated by AdSpendEntrySchema)
 *
 *   Splits spend_cents evenly across days of the supplied month.
 *   Any cents that don't divide evenly are added to day 1 so the
 *   monthly total is preserved exactly.
 *
 *   Writes via .upsert(rows, { onConflict: "channel,spend_date" })
 *   so re-submitting the same month overwrites prior manual entries
 *   (and overrides any auto_sync rows for those days). The `source`
 *   column is stamped 'manual_entry' and `entered_by` is the admin's
 *   email (from requireAdmin).
 *
 *   Returns { ok: true, days: <daysInMonth> } on success.
 */

import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { requireAdmin, withAdmin } from "@/lib/admin/api-auth";
import { getAdminSupabase } from "@/lib/supabase/admin-client";
import { AdSpendEntrySchema } from "@/lib/pmf/schemas";

async function handlePOST(req: NextRequest) {
  const user = await requireAdmin(req);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = AdSpendEntrySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const { channel, month, spend_cents, impressions, clicks, downloads } =
    parsed.data;

  // Days in month: Date.UTC(year, month, 0) returns the last day of the
  // PREVIOUS month — so passing m (1-indexed) gives us the last day of
  // the requested month.
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();

  const perDayCents = Math.floor(spend_cents / daysInMonth);
  const remainder = spend_cents - perDayCents * daysInMonth;

  const rows = Array.from({ length: daysInMonth }, (_, i) => ({
    channel,
    spend_date: `${month}-${String(i + 1).padStart(2, "0")}`,
    spend_cents: perDayCents + (i === 0 ? remainder : 0),
    impressions: impressions ?? null,
    clicks: clicks ?? null,
    downloads: downloads ?? null,
    source: "manual_entry" as const,
    entered_by: user.email,
  }));

  const sb = getAdminSupabase();
  const { error } = await sb
    .from("ad_spend_log")
    .upsert(rows, { onConflict: "channel,spend_date" });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  revalidateTag("pmf-state");
  return NextResponse.json({ ok: true, days: daysInMonth });
}

export const POST = withAdmin(handlePOST);
