/**
 * GET + PATCH + DELETE /api/integrations/email/auto-drafts
 *
 * Manage auto-generated drafts (status = 'auto_drafted').
 * - GET: Fetch pending auto-drafts for the current user, optionally filtered by threadId.
 * - PATCH: Update an auto-draft (user edits before sending).
 * - DELETE: Discard an auto-draft.
 *
 * All endpoints require Firebase auth.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";

export const maxDuration = 15;

// ─── GET: Fetch auto-drafted entries ────────────────────────────────────────

export async function GET(request: NextRequest) {
  const supabase = getServiceRoleClient();
  setSupabaseOverride(supabase);

  try {
    const authUser = await verifyAdminAuth(request);
    if (!authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const user = await findUserByAuth(authUser.uid, authUser.email, "id, company_id");
    if (!user) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const companyId = searchParams.get("companyId");
    const threadId = searchParams.get("threadId");

    if (!companyId) {
      return NextResponse.json(
        { error: "companyId is required" },
        { status: 400 }
      );
    }

    // Validate company ownership
    if (companyId !== user.company_id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let query = supabase
      .from("ai_draft_history")
      .select(
        "id, original_draft, thread_id, opportunity_id, profile_type, created_at, connection_id"
      )
      .eq("company_id", companyId)
      .eq("user_id", user.id)
      .eq("status", "auto_drafted")
      .order("created_at", { ascending: false });

    if (threadId) {
      query = query.eq("thread_id", threadId);
    }

    const { data, error } = await query.limit(50);

    if (error) {
      console.error("[auto-drafts] GET error:", error.message);
      return NextResponse.json(
        { error: "Failed to fetch auto-drafts" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      autoDrafts: (data || []).map((row) => ({
        id: row.id,
        draft: row.original_draft,
        threadId: row.thread_id,
        opportunityId: row.opportunity_id,
        profileType: row.profile_type,
        connectionId: row.connection_id,
        createdAt: row.created_at,
      })),
    });
  } catch (err) {
    console.error("[auto-drafts] GET unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  } finally {
    setSupabaseOverride(null);
  }
}

// ─── PATCH: Update an auto-draft ────────────────────────────────────────────

export async function PATCH(request: NextRequest) {
  const supabase = getServiceRoleClient();
  setSupabaseOverride(supabase);

  try {
    const authUser = await verifyAdminAuth(request);
    if (!authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const user = await findUserByAuth(authUser.uid, authUser.email, "id, company_id");
    if (!user) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const { id, companyId, draft } = body;

    if (!id || !companyId || !draft) {
      return NextResponse.json(
        { error: "id, companyId, and draft are required" },
        { status: 400 }
      );
    }

    // Validate company ownership
    if (companyId !== user.company_id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Verify ownership
    const { data: existing } = await supabase
      .from("ai_draft_history")
      .select("id")
      .eq("id", id)
      .eq("company_id", companyId)
      .eq("user_id", user.id)
      .eq("status", "auto_drafted")
      .single();

    if (!existing) {
      return NextResponse.json(
        { error: "Auto-draft not found" },
        { status: 404 }
      );
    }

    const { error } = await supabase
      .from("ai_draft_history")
      .update({ original_draft: draft })
      .eq("id", id)
      .eq("company_id", companyId);

    if (error) {
      console.error("[auto-drafts] PATCH error:", error.message);
      return NextResponse.json(
        { error: "Failed to update auto-draft" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[auto-drafts] PATCH unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  } finally {
    setSupabaseOverride(null);
  }
}

// ─── DELETE: Discard an auto-draft ──────────────────────────────────────────

export async function DELETE(request: NextRequest) {
  const supabase = getServiceRoleClient();
  setSupabaseOverride(supabase);

  try {
    const authUser = await verifyAdminAuth(request);
    if (!authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const user = await findUserByAuth(authUser.uid, authUser.email, "id, company_id");
    if (!user) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    const companyId = searchParams.get("companyId");

    if (!id || !companyId) {
      return NextResponse.json(
        { error: "id and companyId are required" },
        { status: 400 }
      );
    }

    // Validate company ownership
    if (companyId !== user.company_id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Verify ownership and only discard auto_drafted entries
    const { data: existing } = await supabase
      .from("ai_draft_history")
      .select("id")
      .eq("id", id)
      .eq("company_id", companyId)
      .eq("user_id", user.id)
      .eq("status", "auto_drafted")
      .single();

    if (!existing) {
      return NextResponse.json(
        { error: "Auto-draft not found" },
        { status: 404 }
      );
    }

    const { error } = await supabase
      .from("ai_draft_history")
      .update({ status: "discarded" })
      .eq("id", id)
      .eq("company_id", companyId);

    if (error) {
      console.error("[auto-drafts] DELETE error:", error.message);
      return NextResponse.json(
        { error: "Failed to discard auto-draft" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[auto-drafts] DELETE unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  } finally {
    setSupabaseOverride(null);
  }
}
