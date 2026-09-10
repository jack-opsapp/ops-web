import type { NextRequest } from "next/server";
import { engineHandoffHandlers } from "@/lib/ads/engine/handoff-runtime";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest): Promise<Response> {
  return await engineHandoffHandlers().claim(request);
}
