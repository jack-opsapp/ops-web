/**
 * GET + PATCH + DELETE /api/integrations/email/auto-drafts
 *
 * Manage auto-generated drafts (status = 'auto_drafted').
 * - GET: Fetch pending auto-drafts for the current user, optionally filtered by threadId.
 * - PATCH: Update an auto-draft (user edits before sending).
 * - DELETE: Discard an auto-draft.
 *
 * Every operation resolves the canonical OPS actor and rechecks the draft's
 * live internal thread, lead assignment, inbox scope, and sender authority.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { resolveEmailRouteActor } from "@/lib/email/email-route-auth";
import { resolveEmailDraftAccess } from "@/lib/email/email-draft-access";
import { resolveEmailOpportunityAccess } from "@/lib/email/email-opportunity-access";

export const maxDuration = 15;

// ─── GET: Fetch auto-drafted entries ────────────────────────────────────────

export async function GET(request: NextRequest) {
  const supabase = getServiceRoleClient();
  setSupabaseOverride(supabase);

  try {
    const actorResolution = await resolveEmailRouteActor(request);
    if (!actorResolution.ok) return actorResolution.response;
    const actor = actorResolution.actor;

    const { searchParams } = new URL(request.url);
    const threadId = searchParams.get("threadId");

    let query = supabase
      .from("ai_draft_history")
      .select(
        "id, original_draft, thread_id, opportunity_id, profile_type, created_at, connection_id, origin"
      )
      .eq("company_id", actor.companyId)
      .eq("user_id", actor.userId)
      .eq("status", "auto_drafted")
      .order("created_at", { ascending: false });

    if (threadId) {
      const threadAccess = await resolveEmailOpportunityAccess({
        actor,
        operation: "read",
        threadId,
        supabase,
      });
      if (!threadAccess.allowed || !threadAccess.providerThreadId) {
        return NextResponse.json(
          { error: "Thread not found" },
          { status: 404 }
        );
      }
      query = query
        .eq("connection_id", threadAccess.connectionId)
        .eq("thread_id", threadAccess.providerThreadId);
    }

    const { data, error } = await query.limit(50);

    if (error) {
      console.error("[auto-drafts] GET error:", error.message);
      return NextResponse.json(
        { error: "Failed to fetch auto-drafts" },
        { status: 500 }
      );
    }

    const currentAccess = await Promise.all(
      (data ?? []).map(async (row) => ({
        row,
        access: await resolveEmailDraftAccess({
          actor,
          draftHistoryId: String(row.id),
          operation: "read",
          supabase,
        }),
      }))
    );

    return NextResponse.json({
      autoDrafts: currentAccess
        .filter(({ access }) => access.allowed)
        .map(({ row, access }) => ({
          id: row.id,
          draft: row.original_draft,
          threadId: access.allowed ? access.threadId : null,
          opportunityId: access.allowed ? access.opportunityId : null,
          profileType: row.profile_type,
          connectionId: access.allowed ? access.connectionId : null,
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
    const actorResolution = await resolveEmailRouteActor(request);
    if (!actorResolution.ok) return actorResolution.response;
    const actor = actorResolution.actor;

    const body = await request.json();
    const { id, draft } = body;

    if (
      typeof id !== "string" ||
      !id.trim() ||
      typeof draft !== "string" ||
      !draft.trim()
    ) {
      return NextResponse.json(
        { error: "id and draft are required" },
        { status: 400 }
      );
    }

    const access = await resolveEmailDraftAccess({
      actor,
      draftHistoryId: id,
      operation: "send",
      supabase,
    });
    if (!access.allowed || access.draft.status !== "auto_drafted") {
      return NextResponse.json(
        { error: "Auto-draft not found" },
        { status: 404 }
      );
    }

    const { error } = await supabase
      .from("ai_draft_history")
      .update({ original_draft: draft })
      .eq("id", id)
      .eq("company_id", actor.companyId)
      .eq("user_id", actor.userId)
      .eq("status", "auto_drafted");

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
    const actorResolution = await resolveEmailRouteActor(request);
    if (!actorResolution.ok) return actorResolution.response;
    const actor = actorResolution.actor;

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const access = await resolveEmailDraftAccess({
      actor,
      draftHistoryId: id,
      operation: "send",
      supabase,
    });
    if (!access.allowed || access.draft.status !== "auto_drafted") {
      return NextResponse.json(
        { error: "Auto-draft not found" },
        { status: 404 }
      );
    }

    const { error } = await supabase
      .from("ai_draft_history")
      .update({
        status: "discarded",
        discarded_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("company_id", actor.companyId)
      .eq("user_id", actor.userId)
      .eq("status", "auto_drafted");

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
