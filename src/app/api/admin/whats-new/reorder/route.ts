import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const { type, updates } = body as {
    type: "items" | "categories";
    updates: Array<{ id: string; sort_order: number }>;
  };

  if (!type || !updates?.length) {
    return NextResponse.json({ error: "type and updates[] required" }, { status: 400 });
  }

  const table = type === "items" ? "whats_new_items" : "whats_new_categories";

  const results = await Promise.all(
    updates.map(({ id, sort_order }) =>
      supabaseAdmin.from(table).update({ sort_order }).eq("id", id)
    )
  );

  const failed = results.find((r) => r.error);
  if (failed?.error) {
    return NextResponse.json({ error: failed.error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
