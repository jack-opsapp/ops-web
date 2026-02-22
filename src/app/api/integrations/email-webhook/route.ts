/**
 * OPS Web - Inbound Email Webhook
 *
 * POST /api/integrations/email-webhook
 * Receives parsed inbound emails and creates new opportunity (lead) in Supabase.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

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

    const supabase = getServiceRoleClient();

    // Resolve company by matching the prefix against id or external_id
    const { data: companies } = await supabase
      .from("companies")
      .select("id")
      .or(`id.like.${companyPrefix}%,external_id.like.${companyPrefix}%`)
      .limit(1);

    const companyId = companies?.[0]?.id;
    if (!companyId) {
      console.error("[email-webhook] No company found for prefix:", companyPrefix);
      return NextResponse.json(
        { error: "Company not found" },
        { status: 404 }
      );
    }

    // Create opportunity (lead) in Supabase
    const senderName = body.fromName ?? body.from.split("@")[0];
    const { error: insertError } = await supabase
      .from("opportunities")
      .insert({
        company_id: companyId,
        title: body.subject,
        contact_email: body.from,
        contact_name: senderName,
        description: body.body?.slice(0, 5000) || null,
        stage: "new_lead",
      });

    if (insertError) {
      console.error("[email-webhook] Failed to create opportunity:", insertError.message);
      return NextResponse.json(
        { error: "Failed to create lead" },
        { status: 500 }
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
