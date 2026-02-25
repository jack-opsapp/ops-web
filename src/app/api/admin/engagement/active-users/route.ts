import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, withAdmin } from "@/lib/admin/api-auth";
import { getActiveUsersTimeline } from "@/lib/admin/admin-queries";
import { listAllAuthUsers } from "@/lib/firebase/admin-sdk";
import type { Granularity } from "@/lib/admin/types";

export const GET = withAdmin(async (req: NextRequest) => {
  await requireAdmin(req);

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from") ?? new Date(Date.now() - 90 * 86_400_000).toISOString();
  const to = searchParams.get("to") ?? new Date().toISOString();
  const granularity = (searchParams.get("granularity") ?? "daily") as Granularity;

  const authUsers = await listAllAuthUsers();
  const data = getActiveUsersTimeline(authUsers, from, to, granularity);

  return NextResponse.json({ data });
});
