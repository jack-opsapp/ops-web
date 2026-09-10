import { NextResponse } from "next/server";

/**
 * Retired 2026-09-10. The weekly OpenAI ads briefing is replaced by the Google
 * Ads engine: the Claude routine's run summary is the briefing, and the
 * briefings archive stays readable at /admin/google-ads/briefings. This route
 * answers 410 so a stray scheduled or manual call can never spend OpenAI.
 */
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  return NextResponse.json(
    {
      code: "GONE",
      replacement: "/api/cron/ads-engine",
      detail: "The weekly ads briefing was retired for the Google Ads engine; see ops-web/docs/ads/engine-routine.md.",
    },
    { status: 410, headers: { "cache-control": "no-store" } }
  );
}
