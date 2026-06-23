import type { NextRequest } from "next/server";
import type { Granularity } from "@/lib/admin/types";

const VALID: Granularity[] = ["hourly", "daily", "weekly", "monthly"];

/** Parse ?from&to&granularity from an admin request; defaults to last 30 days, daily. */
export function parseRange(req: NextRequest): { from: string; to: string; granularity: Granularity } {
  const u = new URL(req.url);
  const to = u.searchParams.get("to") ?? new Date().toISOString();
  const from = u.searchParams.get("from") ?? new Date(Date.now() - 30 * 86_400_000).toISOString();
  const g = (u.searchParams.get("granularity") ?? "daily") as Granularity;
  return { from, to, granularity: VALID.includes(g) ? g : "daily" };
}
