/**
 * GET    /api/admin/email/suppressions/[email]      — fetch a single suppression
 * DELETE /api/admin/email/suppressions/[email]      — remove suppression (unblock)
 *
 * `[email]` should be URL-encoded by the client.
 * `?list=` query param scopes the operation to a specific list (default 'global').
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, withAdmin } from "@/lib/admin/api-auth";
import { getAdminSupabase } from "@/lib/supabase/admin-client";
import { removeSuppression } from "@/lib/email/suppressions";

type RouteContext = { params: { email: string } };

export const GET = withAdmin(async (req: NextRequest, ctx: RouteContext) => {
  await requireAdmin(req);
  const email = decodeURIComponent(ctx.params.email).toLowerCase().trim();
  if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });

  const list = new URL(req.url).searchParams.get("list") ?? "global";

  const db = getAdminSupabase();
  const { data, error } = await db
    .from("email_suppressions")
    .select("*")
    .ilike("email", email)
    .eq("list", list)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ suppression: data });
});

export const DELETE = withAdmin(async (req: NextRequest, ctx: RouteContext) => {
  const adminUser = await requireAdmin(req);
  const email = decodeURIComponent(ctx.params.email).toLowerCase().trim();
  if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });

  const list = new URL(req.url).searchParams.get("list") ?? "global";

  const removed = await removeSuppression(email, list);
  console.warn(
    `[admin/email/suppressions] removed email=${email} list=${list} by=${adminUser.email} hadRow=${removed}`
  );
  return NextResponse.json({ removed });
});
