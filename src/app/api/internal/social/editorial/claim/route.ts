import type { NextRequest } from "next/server";
import { editorialHandoffHandlers } from "@/lib/social/editorial/handoff-runtime";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest): Promise<Response> {
  return await editorialHandoffHandlers().claim(request);
}
