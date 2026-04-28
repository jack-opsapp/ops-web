/**
 * POST /api/admin/email/audience/preview
 *
 * Body: { filter: AudienceFilterNode }
 * Returns: { count: number, sample: Array<{user_id, email}> }
 *
 * Backed by SECURITY DEFINER RPCs email_audience_count + email_audience_filter
 * (migration 093). Errors from the RPC (typically allowlist violations) are
 * surfaced as 400s so the UI can show validation feedback.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, withAdmin } from "@/lib/admin/api-auth";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

export const POST = withAdmin(async (req: NextRequest) => {
  await requireAdmin(req);

  let body: { filter?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const filter = body.filter ?? {};
  const db = getServiceRoleClient();

  const [{ data: countData, error: countErr }, { data: sampleData, error: sampleErr }] =
    await Promise.all([
      db.rpc("email_audience_count", { p_filter: filter }),
      db.rpc("email_audience_filter", { p_filter: filter }).limit(10),
    ]);

  if (countErr) {
    return NextResponse.json({ error: countErr.message }, { status: 400 });
  }
  if (sampleErr) {
    return NextResponse.json({ error: sampleErr.message }, { status: 400 });
  }

  return NextResponse.json({
    count: (countData as number) ?? 0,
    sample: sampleData ?? [],
  });
});
