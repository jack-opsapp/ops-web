/**
 * OPS Web - Inbound Email Webhook
 *
 * POST /api/integrations/email-webhook
 * Creates new RFQ projects from forwarded inbound emails.
 * Bubble dependency removed — writes directly to Supabase.
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

function extractCompanyPrefix(toAddress: string): string | null {
  const match = toAddress.match(/^leads-([a-z0-9-]+)@/i);
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

    // Look up company by UUID prefix (cast id to text for ILIKE)
    const { data: companies } = await supabase
      .from("companies")
      .select("id, name")
      .ilike("id::text", `${companyPrefix}%`)
      .limit(1);

    const company = companies?.[0];
    if (!company) {
      console.warn(`[email-webhook] No company found for prefix: ${companyPrefix}`);
      return NextResponse.json({ success: true }); // Silent success — don't leak info
    }

    const senderName = body.fromName ?? body.from.split("@")[0];
    const projectTitle = `Lead: ${body.subject.slice(0, 100)}`;

    // Insert new RFQ project
    const { error: projectError } = await supabase
      .from("projects")
      .insert({
        company_id: company.id,
        title: projectTitle,
        status: "RFQ",
        description: `From: ${body.from}\n\n${body.body}`,
        notes: `Inbound email lead from ${senderName} (${body.from})`,
      });

    if (projectError) {
      console.error("[email-webhook] Failed to create project:", projectError.message);
      return NextResponse.json({ error: "Failed to create lead" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Email webhook error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
