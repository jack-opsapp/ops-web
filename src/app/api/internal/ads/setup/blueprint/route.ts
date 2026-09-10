/**
 * POST /api/internal/ads/setup/blueprint[?validateOnly=1]
 *
 * Build the account from `config/ads/blueprint.json`. Refreshes the entity
 * snapshot, plans the difference, validates it with Google, and applies it
 * with partial failure OFF so a rejected ad fails the whole tree instead of
 * leaving half an account behind. Idempotent: a second run plans nothing.
 *
 * `?validateOnly=1` is the dry run — Google checks every operation and writes
 * nothing. Without it the apply still validates first and proceeds only on a
 * clean pass.
 *
 * This route can create and update. It cannot enable: every campaign it
 * creates is PAUSED, and only the enable route changes a campaign's status.
 *
 * Auth: CRON_SECRET bearer. Operator-run, never scheduled.
 */
import { NextRequest, NextResponse } from "next/server";
import { loadBlueprint } from "@/lib/ads/blueprint";
import { applyBlueprint } from "@/lib/ads/blueprint-apply";
import { googleGateway, warehouseRepository } from "@/lib/ads/blueprint-runtime";

export const runtime = "nodejs";
export const maxDuration = 300;

const NO_STORE = { "cache-control": "no-store" };

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

  const validateOnly = request.nextUrl.searchParams.get("validateOnly") !== "0";

  try {
    const outcome = await applyBlueprint({
      blueprint: loadBlueprint(),
      gateway: googleGateway(),
      repository: warehouseRepository(),
      validateOnly,
    });
    return NextResponse.json(outcome, {
      status: outcome.failures.length > 0 ? 422 : 200,
      headers: NO_STORE,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[ads-setup] blueprint apply failed:", message);
    return NextResponse.json({ error: message }, { status: 500, headers: NO_STORE });
  }
}
