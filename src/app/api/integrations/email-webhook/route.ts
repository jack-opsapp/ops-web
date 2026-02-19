/**
 * OPS Web - Inbound Email Webhook
 *
 * POST /api/integrations/email-webhook
 * Receives parsed inbound emails from forwarding service and creates new RFQ projects (leads).
 */

import { NextRequest, NextResponse } from "next/server";

const BUBBLE_API_URL = process.env.NEXT_PUBLIC_BUBBLE_API_URL ?? "https://opsapp.co/version-test/api/1.1";
const BUBBLE_API_TOKEN = process.env.NEXT_PUBLIC_BUBBLE_API_TOKEN ?? "";

interface InboundEmail {
  to: string;
  from: string;
  fromName?: string;
  subject: string;
  body: string;
  html?: string;
}

/**
 * Extract companyId prefix from the forwarding address.
 * Format: leads-{companyIdPrefix}@inbound.opsapp.co
 */
function extractCompanyPrefix(toAddress: string): string | null {
  const match = toAddress.match(/^leads-([a-z0-9]+)@/i);
  return match ? match[1] : null;
}

export async function POST(request: NextRequest) {
  try {
    const body: InboundEmail = await request.json();

    if (!body.to || !body.from || !body.subject) {
      return NextResponse.json(
        { error: "Missing required fields: to, from, subject" },
        { status: 400 }
      );
    }

    const companyPrefix = extractCompanyPrefix(body.to);
    if (!companyPrefix) {
      return NextResponse.json(
        { error: "Invalid forwarding address format" },
        { status: 400 }
      );
    }

    // Create a new RFQ project via Bubble workflow
    const response = await fetch(`${BUBBLE_API_URL}/wf/create_lead_from_email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${BUBBLE_API_TOKEN}`,
      },
      body: JSON.stringify({
        company_prefix: companyPrefix,
        sender_email: body.from,
        sender_name: body.fromName ?? body.from.split("@")[0],
        subject: body.subject,
        body: body.body,
        status: "RFQ",
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Failed to create lead from email:", errorText);
      return NextResponse.json(
        { error: "Failed to create lead" },
        { status: 502 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Email webhook error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
