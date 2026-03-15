import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendBetaAccessRequest } from "@/lib/email/sendgrid";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      user_id, user_email, user_name, company_id, company_name,
      whats_new_item_id, feature_flag_slug, feature_label,
      company_phone, company_address, company_size, company_industries,
    } = body;

    // Validate required fields
    if (!user_id || !user_email || !user_name || !company_id || !company_name) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    if (!whats_new_item_id && !feature_flag_slug) {
      return NextResponse.json({ error: "Must provide whats_new_item_id or feature_flag_slug" }, { status: 400 });
    }

    // Check for duplicate
    let duplicateQuery = supabaseAdmin
      .from("beta_access_requests")
      .select("id")
      .eq("user_id", user_id);

    if (feature_flag_slug) {
      duplicateQuery = duplicateQuery.eq("feature_flag_slug", feature_flag_slug);
    } else {
      duplicateQuery = duplicateQuery.eq("whats_new_item_id", whats_new_item_id);
    }

    const { data: existing } = await duplicateQuery.maybeSingle();

    if (existing) {
      return NextResponse.json({ error: "Already requested", request_id: existing.id }, { status: 409 });
    }

    // Resolve feature title for email
    let featureTitle = feature_label ?? "Unknown Feature";
    let featureDescription = "";

    if (whats_new_item_id) {
      const { data: item } = await supabaseAdmin
        .from("whats_new_items")
        .select("title, description")
        .eq("id", whats_new_item_id)
        .single();
      featureTitle = item?.title ?? featureTitle;
      featureDescription = item?.description ?? "";
    }

    // Insert request
    const insertData: Record<string, unknown> = {
      user_id,
      user_email,
      user_name,
      company_id,
      company_name,
    };
    if (whats_new_item_id) insertData.whats_new_item_id = whats_new_item_id;
    if (feature_flag_slug) insertData.feature_flag_slug = feature_flag_slug;

    const { data: request, error } = await supabaseAdmin
      .from("beta_access_requests")
      .insert(insertData)
      .select("id")
      .single();

    if (error) throw error;

    // Send email to jack@opsapp.co
    await sendBetaAccessRequest({
      userName: user_name,
      userEmail: user_email,
      companyName: company_name,
      companyPhone: company_phone ?? "",
      companyAddress: company_address ?? "",
      companySize: company_size ?? "",
      companyIndustries: company_industries ?? [],
      featureTitle,
      featureDescription,
      adminUrl: `${process.env.NEXT_PUBLIC_APP_URL}/admin/feature-releases`,
    });

    return NextResponse.json({ success: true, request_id: request.id });
  } catch (err) {
    console.error("[whats-new/request-access] POST error:", err);
    return NextResponse.json({ error: "Failed to submit request" }, { status: 500 });
  }
}
