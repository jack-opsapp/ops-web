/**
 * GET /api/resolve-uuid?table=companies&bubble_id=...
 *
 * Resolves a Bubble ID to a Supabase UUID.
 * Uses the service role client (no auth required — lightweight lookup).
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

const ALLOWED_TABLES = ["companies", "users", "clients", "projects", "task_types"];

export async function GET(req: NextRequest) {
  const table = req.nextUrl.searchParams.get("table");
  const bubbleId = req.nextUrl.searchParams.get("bubble_id");

  if (!table || !bubbleId) {
    return NextResponse.json({ error: "Missing table or bubble_id" }, { status: 400 });
  }

  if (!ALLOWED_TABLES.includes(table)) {
    return NextResponse.json({ error: "Invalid table" }, { status: 400 });
  }

  try {
    const supabase = getServiceRoleClient();
    const { data, error } = await supabase
      .from(table)
      .select("id")
      .eq("bubble_id", bubbleId)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ uuid: data?.id ?? null });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
