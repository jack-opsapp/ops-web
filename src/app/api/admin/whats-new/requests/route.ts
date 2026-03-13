import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendBetaAccessDecision } from "@/lib/email/sendgrid";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("beta_access_requests")
    .select("*, whats_new_items(title, description, feature_flag_slug)")
    .order("requested_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, status, admin_notes } = body;

  if (!id || !status) {
    return NextResponse.json({ error: "id and status required" }, { status: 400 });
  }

  if (!["approved", "rejected"].includes(status)) {
    return NextResponse.json({ error: "Status must be approved or rejected" }, { status: 400 });
  }

  // Fetch the request with item info
  const { data: request, error: fetchError } = await supabaseAdmin
    .from("beta_access_requests")
    .select("*, whats_new_items(title, feature_flag_slug)")
    .eq("id", id)
    .single();

  if (fetchError || !request) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }

  // Update request
  const { error: updateError } = await supabaseAdmin
    .from("beta_access_requests")
    .update({
      status,
      admin_notes: admin_notes ?? null,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  // If approved and item has a feature_flag_slug, create override
  if (status === "approved" && request.whats_new_items?.feature_flag_slug) {
    const slug = request.whats_new_items.feature_flag_slug;

    const { data: existingOverride } = await supabaseAdmin
      .from("feature_flag_overrides")
      .select("id")
      .eq("flag_slug", slug)
      .eq("user_id", request.user_id)
      .maybeSingle();

    if (!existingOverride) {
      await supabaseAdmin
        .from("feature_flag_overrides")
        .insert({ flag_slug: slug, user_id: request.user_id });
    }
  }

  // Send decision email
  try {
    await sendBetaAccessDecision({
      userEmail: request.user_email,
      userName: request.user_name,
      featureTitle: request.whats_new_items?.title ?? "Feature",
      approved: status === "approved",
      adminNotes: admin_notes ?? null,
    });
  } catch (emailErr) {
    console.error("[whats-new/requests] Email send error:", emailErr);
  }

  return NextResponse.json({ success: true });
}
