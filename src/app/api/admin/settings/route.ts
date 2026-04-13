import { NextRequest, NextResponse } from "next/server";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { isAdminEmail } from "@/lib/admin/admin-queries";
import { getAdminSupabase } from "@/lib/supabase/admin-client";

async function requireAdmin(req: NextRequest) {
  const user = await verifyAdminAuth(req);
  if (!user || !user.email || !(await isAdminEmail(user.email))) {
    return null;
  }
  return user;
}

export async function GET(req: NextRequest) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(req.url);
    const keysParam = url.searchParams.get("keys");
    if (!keysParam) {
      return NextResponse.json(
        { error: "keys query param required (comma-separated)" },
        { status: 400 }
      );
    }
    const keys = keysParam
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    if (keys.length === 0) {
      return NextResponse.json({});
    }

    const { data, error } = await getAdminSupabase()
      .from("app_settings")
      .select("key, value")
      .in("key", keys);
    if (error) throw error;

    const result: Record<string, unknown> = {};
    for (const row of (data ?? []) as Array<{ key: string; value: unknown }>) {
      result[row.key] = row.value;
    }
    return NextResponse.json(result);
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch settings" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { key, value } = body as { key?: string; value?: unknown };
    if (!key || typeof key !== "string") {
      return NextResponse.json({ error: "key is required" }, { status: 400 });
    }

    const { error } = await getAdminSupabase()
      .from("app_settings")
      .upsert(
        { key, value, updated_at: new Date().toISOString() },
        { onConflict: "key" }
      );
    if (error) throw error;

    return NextResponse.json({ key, value });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update setting" },
      { status: 500 }
    );
  }
}
