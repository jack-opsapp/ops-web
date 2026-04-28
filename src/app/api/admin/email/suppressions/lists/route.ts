/**
 * GET /api/admin/email/suppressions/lists
 * Returns the unique `list` values that exist in email_suppressions, with row
 * counts. Used by the Suppressions admin tab to populate a list filter.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, withAdmin } from "@/lib/admin/api-auth";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

export const GET = withAdmin(async (req: NextRequest) => {
  await requireAdmin(req);
  const db = getServiceRoleClient();
  const { data, error } = await db.from("email_suppressions").select("list");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const counts = new Map<string, number>();
  for (const r of data ?? []) {
    counts.set(r.list, (counts.get(r.list) ?? 0) + 1);
  }
  return NextResponse.json({
    lists: Array.from(counts.entries())
      .map(([list, count]) => ({ list, count }))
      .sort((a, b) => b.count - a.count),
  });
});
