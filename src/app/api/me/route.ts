/**
 * GET /api/me?email=...
 *
 * Returns Supabase profile fields for a user by email.
 * Used after login (Bubble or Google) to hydrate fields that Bubble
 * doesn't return, such as dev_permission and is_company_admin.
 *
 * Uses service role (no user auth required — returns only safe boolean fields).
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get("email");

  if (!email) {
    return NextResponse.json({ error: "Missing email" }, { status: 400 });
  }

  try {
    const supabase = getServiceRoleClient();
    const { data, error } = await supabase
      .from("users")
      .select("dev_permission, is_company_admin")
      .eq("email", email)
      .is("deleted_at", null)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      devPermission: data?.dev_permission ?? false,
      isCompanyAdmin: data?.is_company_admin ?? false,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
