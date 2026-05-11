/**
 * POST /api/invoices/[id]/send
 *
 * Server-side invoice-send route. Replaces the previous client-only flow
 * that flipped status to 'sent' and wrote sent_at without ever emailing the
 * customer (bug a0bd0021).
 *
 * Body: { email?: string } — optional override. If omitted, falls back to the
 * client's email on file.
 * Returns: { success: true, sent_at: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { PortalAuthService } from "@/lib/api/services/portal-auth-service";
import { PortalBrandingService } from "@/lib/api/services/portal-branding-service";
import { sendInvoiceReady } from "@/lib/email/sendgrid";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

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
      return NextResponse.json({ error: "Missing invoice id" }, { status: 400 });
    }

    const body = (await req.json().catch(() => ({}))) as { email?: string };
    const overrideEmail =
      typeof body.email === "string" && body.email.trim().length > 0
        ? body.email.trim()
        : null;

    const supabase = getServiceRoleClient();

    // Load invoice
    const { data: invoice, error: invoiceError } = await supabase
      .from("invoices")
      .select("id, company_id, client_id, invoice_number, total, deleted_at")
      .eq("id", id)
      .single();
    if (invoiceError || !invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }
    if (invoice.deleted_at) {
      return NextResponse.json(
        { error: "Invoice has been deleted" },
        { status: 410 }
      );
    }

    // Load client (for email fallback)
    const { data: client, error: clientError } = await supabase
      .from("clients")
      .select("id, email")
      .eq("id", invoice.client_id)
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

    const { data: company, error: companyError } = await supabase
      .from("companies")
      .select("id, name, physical_address")
      .eq("id", invoice.company_id)
      .single();
    if (companyError || !company) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    const branding = await PortalBrandingService.getBranding(invoice.company_id);

    const token = await PortalAuthService.createPortalToken(
      invoice.company_id,
      invoice.client_id,
      recipient
    );
    const portalUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/portal/verify?token=${token.token}&redirect=/portal/invoices/${invoice.id}`;

    await sendInvoiceReady({
      email: recipient,
      invoiceNumber: invoice.invoice_number,
      amount: formatCurrency(Number(invoice.total ?? 0)),
      companyName: company.name,
      portalUrl,
      accentColor: branding.accentColor,
      logoUrl: branding.logoUrl ?? null,
      companyPhysicalAddress: company.physical_address ?? null,
    });

    const sentAt = new Date().toISOString();
    const { error: updateError } = await supabase
      .from("invoices")
      .update({ status: "sent", sent_at: sentAt })
      .eq("id", id);
    if (updateError) {
      console.error(
        "[invoices/send] Email sent but failed to mark invoice sent:",
        updateError.message
      );
    }

    return NextResponse.json({ success: true, sent_at: sentAt });
  } catch (error) {
    console.error("[invoices/send] Error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to send invoice",
      },
      { status: 500 }
    );
  }
}
