import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, withAdmin } from "@/lib/admin/api-auth";
import { getAdminSupabase } from "@/lib/supabase/admin-client";

/** GET — return all 11 lifecycle email config rows */
export const GET = withAdmin(async (req: NextRequest) => {
  await requireAdmin(req);

  const supabase = getAdminSupabase();
  const { data, error } = await supabase
    .from("lifecycle_email_config")
    .select("*")
    .order("email_type_key");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ rows: data });
});

/** PATCH — update a single row by email_type_key */
export const PATCH = withAdmin(async (req: NextRequest) => {
  const user = await requireAdmin(req);

  const body = await req.json();
  const { email_type_key, enabled, min_days, max_days } = body;

  if (!email_type_key || typeof email_type_key !== "string") {
    return NextResponse.json(
      { error: "Missing email_type_key" },
      { status: 400 }
    );
  }

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    updated_by: user.email ?? "admin",
  };

  if (typeof enabled === "boolean") updates.enabled = enabled;
  if (typeof min_days === "number") updates.min_days = min_days;
  if (typeof max_days === "number") updates.max_days = max_days;

  const supabase = getAdminSupabase();
  const { data, error } = await supabase
    .from("lifecycle_email_config")
    .update(updates)
    .eq("email_type_key", email_type_key)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ row: data });
});
