import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("whats_new_categories")
    .select("*, whats_new_items(*)")
    .order("sort_order", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const sorted = (data ?? []).map((cat) => ({
    ...cat,
    whats_new_items: (cat.whats_new_items ?? []).sort(
      (a: { sort_order: number }, b: { sort_order: number }) => a.sort_order - b.sort_order
    ),
  }));

  return NextResponse.json(sorted);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, icon, sort_order } = body;

  if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from("whats_new_categories")
    .insert({ name, icon: icon ?? "star", sort_order: sort_order ?? 0 })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, ...updates } = body;

  if (!id) return NextResponse.json({ error: "ID required" }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from("whats_new_categories")
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
    .from("whats_new_categories")
    .delete()
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
