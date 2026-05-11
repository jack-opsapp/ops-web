/**
 * POST /api/stripe/subscription/cancel
 *
 * Cancels the company's active Stripe subscription.
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
    body: JSON.stringify({ ...body, action: "cancel" }),
  });
  return handleSubscription(augmented as NextRequest);
}
