/**
 * PUT    /api/documents/templates/[id]  — update a template
 * DELETE /api/documents/templates/[id]  — delete a template
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

// ─── PUT ──────────────────────────────────────────────────────────────────────

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await getAuthenticatedCompanyId(req);
  if (authResult instanceof NextResponse) return authResult;
  const { companyId } = authResult;
  const { id } = await params;

  try {
    const body = await req.json();
    const db = getServiceRoleClient();

    // Verify template belongs to user's company
    const { data: existing } = await db
      .from("document_templates")
      .select("company_id, document_type")
      .eq("id", id)
      .single();

    if (!existing || existing.company_id !== companyId) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    // If setting as default, clear existing defaults for this type
    if (body.is_default) {
      const docType = body.document_type ?? existing.document_type;
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
        .eq("is_default", true)
        .neq("id", id);
    }

    // Don't allow changing company_id
    delete body.company_id;
    body.updated_at = new Date().toISOString();

    const { data, error } = await db
      .from("document_templates")
      .update(body)
      .eq("id", id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return NextResponse.json(data);
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update template" },
      { status: 500 }
    );
  }
}

// ─── DELETE ───────────────────────────────────────────────────────────────────

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await getAuthenticatedCompanyId(req);
  if (authResult instanceof NextResponse) return authResult;
  const { companyId } = authResult;
  const { id } = await params;

  try {
    const db = getServiceRoleClient();

    // Verify template belongs to user's company
    const { data: existing } = await db
      .from("document_templates")
      .select("company_id")
      .eq("id", id)
      .single();

    if (!existing || existing.company_id !== companyId) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    const { error } = await db
      .from("document_templates")
      .delete()
      .eq("id", id);

    if (error) throw new Error(error.message);
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to delete template" },
      { status: 500 }
    );
  }
}
