import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  try {
    const { data: categories, error: catError } = await supabaseAdmin
      .from("whats_new_categories")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });

    if (catError) throw catError;

    const { data: items, error: itemError } = await supabaseAdmin
      .from("whats_new_items")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });

    if (itemError) throw itemError;

    const result = (categories ?? []).map((cat) => ({
      ...cat,
      items: (items ?? []).filter((item) => item.category_id === cat.id),
    }));

    return NextResponse.json(result);
  } catch (err) {
    console.error("[whats-new] GET error:", err);
    return NextResponse.json({ error: "Failed to fetch" }, { status: 500 });
  }
}
