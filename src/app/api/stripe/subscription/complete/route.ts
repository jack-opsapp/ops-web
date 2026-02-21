/**
 * POST /api/stripe/subscription/complete
 *
 * Completes a subscription purchase (setup intent + subscription creation).
 * Delegates to the parent subscription route handler.
 */

import { type NextRequest, NextResponse } from "next/server";
import { POST as handleSubscription } from "../route";

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Inject the action into the request body and delegate
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const augmented = new Request(req.url, {
    method: "POST",
    headers: req.headers,
    body: JSON.stringify({ ...body, action: "complete" }),
  });
  return handleSubscription(augmented as NextRequest);
}
