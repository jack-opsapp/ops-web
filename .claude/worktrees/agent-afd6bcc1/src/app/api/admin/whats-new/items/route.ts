import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { category_id, title, description, icon, status, feature_flag_slug, sort_order } = body;

  if (!category_id || !title) {
    return NextResponse.json({ error: "category_id and title required" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("whats_new_items")
    .insert({
      category_id,
      title,
      description: description ?? "",
      icon: icon ?? "star",
      status: status ?? "planned",
      feature_flag_slug: feature_flag_slug || null,
      sort_order: sort_order ?? 0,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, ...updates } = body;

  if (!id) return NextResponse.json({ error: "ID required" }, { status: 400 });

  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from("whats_new_items")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest) {
  const body = await req.json();
  const { id } = body;

  if (!id) return NextResponse.json({ error: "ID required" }, { status: 400 });

  const { error } = await supabaseAdmin
    .from("whats_new_items")
    .delete()
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
