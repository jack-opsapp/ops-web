/**
 * GET /api/invites/[code]
 *
 * Public endpoint (no auth required) that returns invite details
 * for the join page: company name, logo, role, and validity status.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

interface InviteResponse {
  valid: boolean;
  companyName: string;
  companyLogo: string | null;
  roleName: string | null;
  error?: "expired" | "used" | "not_found";
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  if (!code) {
    return NextResponse.json(
      { valid: false, companyName: "", companyLogo: null, roleName: null, error: "not_found" } satisfies InviteResponse,
      { status: 400 }
    );
  }

  const db = getServiceRoleClient();

  // Look up invitation by invite_code
  const { data: invitation } = await db
    .from("team_invitations")
    .select(`
      id,
      status,
      expires_at,
      role_id,
      company_id
    `)
    .eq("invite_code", code)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // If not found by invite_code, try finding company by external_id
  // (the invite email may use company external_id as the code)
  if (!invitation) {
    const { data: company } = await db
      .from("companies")
      .select("id, name, logo_url")
      .eq("external_id", code)
      .is("deleted_at", null)
      .maybeSingle();

    if (company) {
      return NextResponse.json({
        valid: true,
        companyName: company.name as string,
        companyLogo: (company.logo_url as string) ?? null,
        roleName: null,
      } satisfies InviteResponse);
    }

    return NextResponse.json(
      { valid: false, companyName: "", companyLogo: null, roleName: null, error: "not_found" } satisfies InviteResponse,
      { status: 404 }
    );
  }

  // Get company details
  const { data: company } = await db
    .from("companies")
    .select("id, name, logo_url")
    .eq("id", invitation.company_id)
    .maybeSingle();

  const companyName = (company?.name as string) ?? "";
  const companyLogo = (company?.logo_url as string) ?? null;

  // Check if invitation was already used
  if (invitation.status === "accepted") {
    return NextResponse.json(
      { valid: false, companyName, companyLogo, roleName: null, error: "used" } satisfies InviteResponse,
      { status: 410 }
    );
  }

  // Check if invitation expired
  if (invitation.expires_at && new Date(invitation.expires_at as string) < new Date()) {
    return NextResponse.json(
      { valid: false, companyName, companyLogo, roleName: null, error: "expired" } satisfies InviteResponse,
      { status: 410 }
    );
  }

  // Look up role name if role_id is set
  let roleName: string | null = null;
  if (invitation.role_id) {
    const { data: role } = await db
      .from("roles")
      .select("name")
      .eq("id", invitation.role_id)
      .maybeSingle();
    roleName = (role?.name as string) ?? null;
  }

  return NextResponse.json({
    valid: true,
    companyName,
    companyLogo,
    roleName,
  } satisfies InviteResponse);
}
