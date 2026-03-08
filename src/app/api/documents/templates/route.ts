/**
 * GET  /api/documents/templates?companyId=...  — list templates for a company
 * POST /api/documents/templates                — create a new template
 *
 * Uses the service-role client to bypass RLS.
 * Auth: Firebase/Supabase JWT verified via verifyAdminAuth.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

// ─── Auth helper ─────────────────────────────────────────────────────────────

async function getAuthenticatedCompanyId(
  req: NextRequest
): Promise<{ companyId: string } | NextResponse> {
  const user = await verifyAdminAuth(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getServiceRoleClient();

  // Try auth_id first, then firebase_uid, then email fallback
  let dbUser: { company_id: string } | null = null;

  const { data: byAuthId } = await db
    .from("users")
    .select("company_id")
    .eq("auth_id", user.uid)
    .is("deleted_at", null)
    .maybeSingle();
  dbUser = byAuthId;

  if (!dbUser) {
    const { data: byFirebaseUid } = await db
      .from("users")
      .select("company_id")
      .eq("firebase_uid", user.uid)
      .is("deleted_at", null)
      .maybeSingle();
    dbUser = byFirebaseUid;
  }

  if (!dbUser && user.email) {
    const { data: byEmail } = await db
      .from("users")
      .select("company_id")
      .eq("email", user.email)
      .is("deleted_at", null)
      .maybeSingle();
    dbUser = byEmail;
  }

  if (!dbUser?.company_id) {
    return NextResponse.json({ error: "No company found" }, { status: 403 });
  }

  return { companyId: dbUser.company_id };
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const authResult = await getAuthenticatedCompanyId(req);
  if (authResult instanceof NextResponse) return authResult;
  const { companyId } = authResult;

  try {
    const db = getServiceRoleClient();
    const { data, error } = await db
      .from("document_templates")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: true });

    if (error) throw new Error(error.message);
    return NextResponse.json(data ?? []);
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch templates" },
      { status: 500 }
    );
  }
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const authResult = await getAuthenticatedCompanyId(req);
  if (authResult instanceof NextResponse) return authResult;
  const { companyId } = authResult;

  try {
    const body = await req.json();

    if (!body.name || !body.document_type) {
      return NextResponse.json(
        { error: "name and document_type are required" },
        { status: 400 }
      );
    }

    // Ensure the company_id matches the authenticated user's company
    body.company_id = companyId;

    const db = getServiceRoleClient();

    // If setting as default, clear existing defaults for this type
    if (body.is_default) {
      const docType = body.document_type;
      await db
        .from("document_templates")
        .update({ is_default: false })
        .eq("company_id", companyId)
        .in(
          "document_type",
          docType === "both"
            ? ["invoice", "estimate", "both"]
            : [docType, "both"]
        )
        .eq("is_default", true);
    }

    const { data, error } = await db
      .from("document_templates")
      .insert(body)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return NextResponse.json(data, { status: 201 });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create template" },
      { status: 500 }
    );
  }
}
