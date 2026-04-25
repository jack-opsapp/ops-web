/**
 * Bearer-token auth helper for the bug-triage endpoints.
 *
 * Why a dedicated token (not CRON_SECRET): this token is inlined into the
 * remote Claude agent's prompt text, which persists in Anthropic's infra.
 * Giving the bug-triage agents a scoped token keeps that surface separate
 * from Vercel's cron secret.
 *
 * The token must be set as BUG_TRIAGE_AGENT_TOKEN in Vercel env. If the
 * env var is missing, all requests 500 — this endpoint is not safe to run
 * without auth.
 */

import { NextRequest, NextResponse } from "next/server";

export function assertTriageAuth(request: NextRequest): NextResponse | null {
  const expected = process.env.BUG_TRIAGE_AGENT_TOKEN;
  if (!expected) {
    return NextResponse.json(
      { error: "BUG_TRIAGE_AGENT_TOKEN not configured on server" },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}

export type BugSource = "bug_reports" | "qa_bugs";

export function isValidSource(v: unknown): v is BugSource {
  return v === "bug_reports" || v === "qa_bugs";
}

export function isValidPlatform(v: unknown): v is "ios" | "web" {
  return v === "ios" || v === "web";
}
