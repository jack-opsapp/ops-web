/**
 * POST /api/estimates/[id]/send
 *
 * Server-side estimate-send route. Replaces the previous client-only flow
 * that flipped status to 'sent' and wrote sent_at without ever emailing the
 * customer (bug a0bd0021).
 *
 * Flow:
 *   1. Authenticate the caller (Firebase / Supabase admin token).
 *   2. Load the estimate, its client, the company, and portal branding.
 *   3. Mint a portal magic-link token for the recipient email.
 *   4. Send the estimate-ready email via SendGrid (sendEstimateReady).
 *   5. Mark the estimate as sent and stamp sent_at.
 *
 * Body: { email: string }
 * Returns: { success: true, sent_at: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { PortalAuthService } from "@/lib/api/services/portal-auth-service";
import { PortalBrandingService } from "@/lib/api/services/portal-branding-service";
import { sendEstimateReady } from "@/lib/email/sendgrid";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const admin = await verifyAdminAuth(req);
    if (!admin) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "Missing estimate id" }, { status: 400 });
    }

    const body = (await req.json().catch(() => ({}))) as { email?: string };
    const overrideEmail =
      typeof body.email === "string" && body.email.trim().length > 0
        ? body.email.trim()
        : null;

    const supabase = getServiceRoleClient();

    // Load estimate
    const { data: estimate, error: estimateError } = await supabase
      .from("estimates")
      .select("id, company_id, client_id, estimate_number, deleted_at")
      .eq("id", id)
      .single();
    if (estimateError || !estimate) {
      return NextResponse.json({ error: "Estimate not found" }, { status: 404 });
    }
    if (estimate.deleted_at) {
      return NextResponse.json(
        { error: "Estimate has been deleted" },
        { status: 410 }
      );
    }

    // Load client (for email fallback)
    const { data: client, error: clientError } = await supabase
      .from("clients")
      .select("id, email")
      .eq("id", estimate.client_id)
      .single();
    if (clientError || !client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const recipient = overrideEmail ?? client.email;
    if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      return NextResponse.json(
        {
          error:
            "No valid email on file for this client. Add a client email or pass one in the request body.",
          code: "missing_recipient_email",
        },
        { status: 400 }
      );
    }

    // Load company (name + physical address for compliance footer)
    const { data: company, error: companyError } = await supabase
      .from("companies")
      .select("id, name, physical_address")
      .eq("id", estimate.company_id)
      .single();
    if (companyError || !company) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    // Portal branding (accent color, logo) — service auto-creates defaults.
    const branding = await PortalBrandingService.getBranding(estimate.company_id);

    // Mint a fresh portal token bound to this client + email so the customer
    // can click straight through to /portal/estimates/{id} without login.
    const token = await PortalAuthService.createPortalToken(
      estimate.company_id,
      estimate.client_id,
      recipient
    );
    const portalUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/portal/verify?token=${token.token}&redirect=/portal/estimates/${estimate.id}`;

    // Actually send the email. Throws on SendGrid failure — we let it bubble
    // up so the route returns 500 and the UI shows the error instead of
    // marking the estimate "sent" when nothing was delivered.
    await sendEstimateReady({
      email: recipient,
      estimateNumber: estimate.estimate_number,
      companyName: company.name,
      portalUrl,
      accentColor: branding.accentColor,
      logoUrl: branding.logoUrl ?? null,
      companyPhysicalAddress: company.physical_address ?? null,
    });

    // Email succeeded — now record the send. Service-role write bypasses RLS;
    // the auth check above is the gate.
    const sentAt = new Date().toISOString();
    const { error: updateError } = await supabase
      .from("estimates")
      .update({ status: "sent", sent_at: sentAt })
      .eq("id", id);
    if (updateError) {
      // The email DID send but the DB write failed. Log loudly so ops can
      // reconcile, and still return 200 — the customer received the doc, and
      // a manual retry would email them again. UI will refetch and observe
      // the stale status, but better than double-sending.
      console.error(
        "[estimates/send] Email sent but failed to mark estimate sent:",
        updateError.message
      );
    }

    return NextResponse.json({ success: true, sent_at: sentAt });
  } catch (error) {
    console.error("[estimates/send] Error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to send estimate",
      },
      { status: 500 }
    );
  }
}
