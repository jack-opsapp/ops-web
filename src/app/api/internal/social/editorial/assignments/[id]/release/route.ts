import type { NextRequest } from "next/server";
import { editorialHandoffHandlers } from "@/lib/social/editorial/handoff-runtime";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await context.params;
  return await editorialHandoffHandlers().release(request, id);
}
