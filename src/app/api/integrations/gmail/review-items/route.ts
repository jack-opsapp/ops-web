/**
 * OPS Web - Gmail Review Items
 *
 * GET /api/integrations/gmail/review-items?companyId=...
 * Returns activities that need review (unmatched or low-confidence matches).
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";

export async function GET(request: NextRequest) {
  const supabase = getServiceRoleClient();
  setSupabaseOverride(supabase);

  try {
    const { searchParams } = new URL(request.url);
    const companyId = searchParams.get("companyId");

    if (!companyId) {
      return NextResponse.json({ error: "companyId is required" }, { status: 400 });
    }

    // Step 1: Fetch activities needing review
    const { data: activities, error } = await supabase
      .from("activities")
      .select(
        "id, subject, content, from_email, match_confidence, suggested_client_id, client_id, email_thread_id, created_at"
      )
      .eq("type", "email")
      .eq("company_id", companyId)
      .eq("is_read", false)
      .or("match_needs_review.eq.true,match_confidence.eq.unmatched")
      .order("created_at", { ascending: false });

    if (error) throw error;

    if (!activities || activities.length === 0) {
      return NextResponse.json({ ok: true, items: [] });
    }

    // Step 2: Collect unique client IDs (suggested + assigned)
    const clientIds = new Set<string>();
    for (const a of activities) {
      if (a.suggested_client_id) clientIds.add(a.suggested_client_id as string);
      if (a.client_id) clientIds.add(a.client_id as string);
    }

    // Step 3: Fetch client names in a second query
    const clientMap: Record<string, string> = {};
    if (clientIds.size > 0) {
      const { data: clients, error: clientError } = await supabase
        .from("clients")
        .select("id, name")
        .in("id", Array.from(clientIds));

      if (clientError) throw clientError;

      for (const c of clients ?? []) {
        clientMap[c.id as string] = c.name as string;
      }
    }

    // Step 4: Map activities with client names
    const items = activities.map((a) => ({
      id: a.id,
      subject: a.subject,
      content: a.content,
      fromEmail: a.from_email,
      matchConfidence: a.match_confidence,
      suggestedClientId: a.suggested_client_id,
      suggestedClientName: a.suggested_client_id
        ? clientMap[a.suggested_client_id as string] ?? null
        : null,
      clientId: a.client_id,
      clientName: a.client_id
        ? clientMap[a.client_id as string] ?? null
        : null,
      emailThreadId: a.email_thread_id,
      createdAt: a.created_at,
    }));

    return NextResponse.json({ ok: true, items });
  } catch (err) {
    console.error("[gmail-review-items]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  } finally {
    setSupabaseOverride(null);
  }
}
