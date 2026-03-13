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
    const { user_id, user_email, user_name, company_id, company_name, whats_new_item_id,
            company_phone, company_address, company_size, company_industries } = body;

    if (!user_id || !user_email || !user_name || !company_id || !company_name || !whats_new_item_id) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Check for duplicate
    const { data: existing } = await supabaseAdmin
      .from("beta_access_requests")
      .select("id")
      .eq("user_id", user_id)
      .eq("whats_new_item_id", whats_new_item_id)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ error: "Already requested", request_id: existing.id }, { status: 409 });
    }

    // Fetch the item title for the email
    const { data: item } = await supabaseAdmin
      .from("whats_new_items")
      .select("title, description")
      .eq("id", whats_new_item_id)
      .single();

    // Insert request
    const { data: request, error } = await supabaseAdmin
      .from("beta_access_requests")
      .insert({
        user_id,
        user_email,
        user_name,
        company_id,
        company_name,
        whats_new_item_id,
      })
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
      featureTitle: item?.title ?? "Unknown Feature",
      featureDescription: item?.description ?? "",
      adminUrl: `${process.env.NEXT_PUBLIC_APP_URL}/admin/feature-releases`,
    });

    return NextResponse.json({ success: true, request_id: request.id });
  } catch (err) {
    console.error("[whats-new/request-access] POST error:", err);
    return NextResponse.json({ error: "Failed to submit request" }, { status: 500 });
  }
}
