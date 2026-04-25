/**
 * GET /api/cron/bug-triage/backlog?platform=ios&limit=200
 *
 * Returns the unified, unclaimed backlog for a single platform. Unifies
 * bug_reports and qa_bugs into one sortable stream so the nightly triage
 * orchestrator can batch without joining in-agent.
 *
 * Excludes:
 *   - status not in ('new', 'triaged')
 *   - requires_human_review = true (operator or reporter flagged)
 *   - false_positive = true (qa_bugs only)
 *   - claimed_at within last 6 hours (active claim by another run)
 *
 * Auth: Bearer BUG_TRIAGE_AGENT_TOKEN.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { assertTriageAuth, isValidPlatform } from "../_lib/auth";

export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const authFailure = assertTriageAuth(request);
  if (authFailure) return authFailure;

  const { searchParams } = new URL(request.url);
  const platform = searchParams.get("platform");
  const limitParam = searchParams.get("limit");
  const limit = Math.min(Math.max(parseInt(limitParam ?? "200", 10) || 200, 1), 500);

  if (!isValidPlatform(platform)) {
    return NextResponse.json(
      { error: "platform must be 'ios' or 'web'" },
      { status: 400 }
    );
  }

  const supabase = getServiceRoleClient();
  const claimExpiryCutoff = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();

  const [bugReportsRes, qaBugsRes] = await Promise.all([
    supabase
      .from("bug_reports")
      .select(
        "id, description, category, priority, screen_name, url, created_at, claimed_at"
      )
      .eq("platform", platform)
      .in("status", ["new", "triaged"])
      .eq("requires_human_review", false)
      .or(`claimed_at.is.null,claimed_at.lt.${claimExpiryCutoff}`)
      .order("created_at", { ascending: true })
      .limit(limit),
    supabase
      .from("qa_bugs")
      .select(
        "id, title, actual_behavior, category, severity, suspected_file, suspected_component, page_or_screen, url, found_at, claimed_at"
      )
      .eq("platform", platform)
      .in("status", ["new", "triaged"])
      .eq("requires_human_review", false)
      .eq("false_positive", false)
      .or(`claimed_at.is.null,claimed_at.lt.${claimExpiryCutoff}`)
      .order("found_at", { ascending: true })
      .limit(limit),
  ]);

  if (bugReportsRes.error) {
    return NextResponse.json(
      { error: `bug_reports query failed: ${bugReportsRes.error.message}` },
      { status: 500 }
    );
  }
  if (qaBugsRes.error) {
    return NextResponse.json(
      { error: `qa_bugs query failed: ${qaBugsRes.error.message}` },
      { status: 500 }
    );
  }

  type UnifiedBug = {
    id: string;
    source: "bug_reports" | "qa_bugs";
    summary: string;
    category: string | null;
    severity_signal: string | null;
    screen_or_url: string | null;
    suspected_file: string | null;
    suspected_component: string | null;
    sort_ts: string;
  };

  const bugReports: UnifiedBug[] = (bugReportsRes.data ?? []).map((r) => ({
    id: r.id as string,
    source: "bug_reports",
    summary: truncate(r.description as string, 800),
    category: (r.category as string) ?? null,
    severity_signal: (r.priority as string) ?? null,
    screen_or_url: (r.screen_name as string) ?? (r.url as string) ?? null,
    suspected_file: null,
    suspected_component: null,
    sort_ts: r.created_at as string,
  }));

  const qaBugs: UnifiedBug[] = (qaBugsRes.data ?? []).map((r) => ({
    id: r.id as string,
    source: "qa_bugs",
    summary: truncate(`${r.title} :: ${r.actual_behavior}`, 800),
    category: (r.category as string) ?? null,
    severity_signal: (r.severity as string) ?? null,
    screen_or_url: (r.page_or_screen as string) ?? (r.url as string) ?? null,
    suspected_file: (r.suspected_file as string) ?? null,
    suspected_component: (r.suspected_component as string) ?? null,
    sort_ts: r.found_at as string,
  }));

  const unified = [...bugReports, ...qaBugs]
    .sort((a, b) => a.sort_ts.localeCompare(b.sort_ts))
    .slice(0, limit);

  return NextResponse.json({
    platform,
    fetched_at: new Date().toISOString(),
    count: unified.length,
    bugs: unified,
  });
}

function truncate(s: string | null | undefined, n: number): string {
  if (!s) return "";
  return s.length <= n ? s : s.slice(0, n) + "…";
}
