/**
 * GET /api/auth/validate-code?code=XXXX
 *
 * Validates a company code (external_id) and returns a preview.
 * Public endpoint — no auth required.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const code = req.nextUrl.searchParams.get("code")?.trim().toUpperCase();

  if (!code) {
    return NextResponse.json(
      { valid: false, error: "Missing code parameter" },
      { status: 400 }
    );
  }

  const db = getServiceRoleClient();

  const { data: company } = await db
    .from("companies")
    .select("id, name, logo_url, company_code")
    .ilike("company_code", code)
    .is("deleted_at", null)
    .maybeSingle();

  if (!company) {
    return NextResponse.json(
      { valid: false, error: "No company found with this code" },
      { status: 404 }
    );
  }

  return NextResponse.json({
    valid: true,
    companyId: company.id,
    companyName: company.name,
    companyLogo: company.logo_url,
    companyCode: company.company_code,
  });
}
