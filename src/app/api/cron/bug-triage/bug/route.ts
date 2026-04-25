/**
 * GET /api/cron/bug-triage/bug?id=UUID&source=bug_reports
 *
 * Returns the FULL row for a single bug. Agents call this after picking a
 * bug from the backlog, to get console logs, breadcrumbs, state snapshot,
 * reproduction steps, etc.
 *
 * Auth: Bearer BUG_TRIAGE_AGENT_TOKEN.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { assertTriageAuth, isValidSource } from "../_lib/auth";

export const maxDuration = 15;

export async function GET(request: NextRequest) {
  const authFailure = assertTriageAuth(request);
  if (authFailure) return authFailure;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const source = searchParams.get("source");

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  if (!isValidSource(source)) {
    return NextResponse.json(
      { error: "source must be 'bug_reports' or 'qa_bugs'" },
      { status: 400 }
    );
  }

  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from(source)
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    // PGRST116 = no rows returned
    const status = error.code === "PGRST116" ? 404 : 500;
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status }
    );
  }

  return NextResponse.json({ source, bug: data });
}
