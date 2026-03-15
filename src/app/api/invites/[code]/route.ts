/**
 * GET /api/invites/[code]
 *
 * Public endpoint (no auth required) that returns invite details
 * for the join page: company name, logo, role, team members,
 * industry, and validity status.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

interface TeamMember {
  firstName: string;
  lastName: string;
  profileImageUrl: string | null;
}

interface InviteResponse {
  valid: boolean;
  companyName: string;
  companyLogo: string | null;
  roleName: string | null;
  industries: string[];
  teamMembers: TeamMember[];
  teamSize: number;
  error?: "expired" | "used" | "not_found";
}

const EMPTY_RESPONSE: InviteResponse = {
  valid: false,
  companyName: "",
  companyLogo: null,
  roleName: null,
  industries: [],
  teamMembers: [],
  teamSize: 0,
};

/** Fetch active team members for a company (first 8 for avatars, plus total count). */
async function fetchTeamInfo(
  db: ReturnType<typeof getServiceRoleClient>,
  companyId: string
): Promise<{ members: TeamMember[]; total: number }> {
  const { data: users, count } = await db
    .from("users")
    .select("first_name, last_name, profile_image_url", { count: "exact" })
    .eq("company_id", companyId)
    .eq("is_active", true)
    .is("deleted_at", null)
    .limit(8);

  const members: TeamMember[] = (users ?? []).map((u) => ({
    firstName: (u.first_name as string) ?? "",
    lastName: (u.last_name as string) ?? "",
    profileImageUrl: (u.profile_image_url as string) ?? null,
  }));

  return { members, total: count ?? members.length };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  if (!code) {
    return NextResponse.json(
      { ...EMPTY_RESPONSE, error: "not_found" } satisfies InviteResponse,
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

  // If not found by invite_code, try finding company by company_code
  if (!invitation) {
    const { data: company } = await db
      .from("companies")
      .select("id, name, logo_url, industries")
      .ilike("company_code", code)
      .is("deleted_at", null)
      .maybeSingle();

    if (company) {
      const { members, total } = await fetchTeamInfo(db, company.id as string);
      return NextResponse.json({
        valid: true,
        companyName: company.name as string,
        companyLogo: (company.logo_url as string) ?? null,
        roleName: null,
        industries: (company.industries as string[]) ?? [],
        teamMembers: members,
        teamSize: total,
      } satisfies InviteResponse);
    }

    return NextResponse.json(
      { ...EMPTY_RESPONSE, error: "not_found" } satisfies InviteResponse,
      { status: 404 }
    );
  }

  // Get company details
  const { data: company } = await db
    .from("companies")
    .select("id, name, logo_url, industries")
    .eq("id", invitation.company_id)
    .maybeSingle();

  const companyName = (company?.name as string) ?? "";
  const companyLogo = (company?.logo_url as string) ?? null;
  const industries = (company?.industries as string[]) ?? [];

  // Fetch team info
  const { members, total } = company
    ? await fetchTeamInfo(db, company.id as string)
    : { members: [], total: 0 };

  // Check if invitation was already used
  if (invitation.status === "accepted") {
    return NextResponse.json(
      { ...EMPTY_RESPONSE, companyName, companyLogo, error: "used" } satisfies InviteResponse,
      { status: 410 }
    );
  }

  // Check if invitation expired
  if (invitation.expires_at && new Date(invitation.expires_at as string) < new Date()) {
    return NextResponse.json(
      { ...EMPTY_RESPONSE, companyName, companyLogo, error: "expired" } satisfies InviteResponse,
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
    industries,
    teamMembers: members,
    teamSize: total,
  } satisfies InviteResponse);
}
