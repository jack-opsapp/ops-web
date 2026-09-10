/**
 * POST /api/internal/ads/setup/enable
 * Body: { "campaigns": ["PRICING · US", …], "confirm": "ENABLE" | "PAUSE" }
 *
 * The only path in the system that changes a campaign's status.
 *
 * Enabling refuses unless the campaign carries the `engine` label — proof the
 * blueprint built it rather than a hand edit — and unless Google has approved
 * at least two of its ads. Pausing has no gate: stopping spend is always
 * allowed, which is what makes this the emergency stop as well as the switch.
 *
 * Nothing schedules this. It runs when Jackson says the word, and it says in
 * its response exactly which campaigns changed and which it refused, with the
 * reason.
 *
 * Auth: CRON_SECRET bearer.
 */
import { NextRequest, NextResponse } from "next/server";
import { enableCampaigns, type EnableConfirm } from "@/lib/ads/blueprint-apply";
import { googleGateway, warehouseRepository } from "@/lib/ads/blueprint-runtime";

export const runtime = "nodejs";
export const maxDuration = 60;

const NO_STORE = { "cache-control": "no-store" };
const CONFIRMS: EnableConfirm[] = ["ENABLE", "PAUSE"];

export async function GET() {
  return NextResponse.json(
    { error: "Method not allowed" },
    { status: 405, headers: { ...NO_STORE, allow: "POST" } }
  );
}

export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });

  let body: { campaigns?: unknown; confirm?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400, headers: NO_STORE });
  }

  const campaigns = Array.isArray(body.campaigns)
    ? body.campaigns.filter((name): name is string => typeof name === "string" && name.length > 0)
    : [];
  const confirm = body.confirm as EnableConfirm;

  if (campaigns.length === 0)
    return NextResponse.json(
      { error: "Name at least one campaign in `campaigns`." },
      { status: 400, headers: NO_STORE }
    );
  if (!CONFIRMS.includes(confirm))
    return NextResponse.json(
      { error: 'Set `confirm` to "ENABLE" or "PAUSE". Nothing changes without it.' },
      { status: 400, headers: NO_STORE }
    );

  try {
    const outcome = await enableCampaigns({
      names: campaigns,
      confirm,
      gateway: googleGateway(),
      repository: warehouseRepository(),
    });
    return NextResponse.json(outcome, {
      status: outcome.result?.failures.length ? 422 : 200,
      headers: NO_STORE,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[ads-setup] enable failed:", message);
    return NextResponse.json({ error: message }, { status: 500, headers: NO_STORE });
  }
}
