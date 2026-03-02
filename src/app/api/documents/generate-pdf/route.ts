/**
 * POST /api/documents/generate-pdf
 *
 * Generates a PDF for an invoice or estimate.
 * Auth: Firebase/Supabase auth (admin users).
 *
 * Body: { documentId: string, documentType: "invoice" | "estimate" }
 * Returns: { pdfUrl: string }
 *
 * Flow:
 *   1. Verify auth, fetch document + template + branding + company + client
 *   2. Resolve branding overrides
 *   3. Render self-contained HTML
 *   4. Puppeteer → PDF buffer
 *   5. Upload to S3 via presigned URL
 *   6. Update pdf_storage_path on document
 *   7. Return public URL
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { checkPermission } from "@/lib/supabase/check-permission";
import { renderDocumentHtml } from "@/lib/pdf/render-document-html";
import type { InvoiceRenderData, EstimateRenderData } from "@/lib/pdf/render-document-html";
import type { PortalBranding, PortalTemplate, PortalThemeMode } from "@/lib/types/portal";
import type { DocumentTemplate } from "@/lib/types/document-template";
import { DiscountType } from "@/lib/types/pipeline";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

// Vercel function config
export const maxDuration = 60;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mapTemplateFromDb(row: Record<string, unknown>): DocumentTemplate {
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    name: row.name as string,
    documentType: row.document_type as DocumentTemplate["documentType"],
    isDefault: (row.is_default as boolean) ?? false,
    showQuantities: (row.show_quantities as boolean) ?? true,
    showUnitPrices: (row.show_unit_prices as boolean) ?? true,
    showLineTotals: (row.show_line_totals as boolean) ?? true,
    showDescriptions: (row.show_descriptions as boolean) ?? true,
    showTax: (row.show_tax as boolean) ?? true,
    showDiscount: (row.show_discount as boolean) ?? true,
    showTerms: (row.show_terms as boolean) ?? true,
    showFooter: (row.show_footer as boolean) ?? true,
    showPaymentInfo: (row.show_payment_info as boolean) ?? true,
    showFromSection: (row.show_from_section as boolean) ?? true,
    showToSection: (row.show_to_section as boolean) ?? true,
    overrideLogoUrl: (row.override_logo_url as string) ?? null,
    overrideAccentColor: (row.override_accent_color as string) ?? null,
    overrideTemplate: (row.override_template as DocumentTemplate["overrideTemplate"]) ?? null,
    overrideThemeMode: (row.override_theme_mode as DocumentTemplate["overrideThemeMode"]) ?? null,
    overrideFontCombo: (row.override_font_combo as DocumentTemplate["overrideFontCombo"]) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapBrandingFromDb(row: Record<string, unknown>): PortalBranding {
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    logoUrl: (row.logo_url as string) ?? null,
    accentColor: (row.accent_color as string) ?? "#417394",
    template: (row.template as PortalTemplate) ?? "modern",
    themeMode: (row.theme_mode as PortalThemeMode) ?? "dark",
    fontCombo: (row.font_combo as PortalTemplate) ?? "modern",
    welcomeMessage: (row.welcome_message as string) ?? null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

const REGION = process.env.AWS_REGION || "us-east-1";
const BUCKET = process.env.AWS_S3_BUCKET || "";

function getS3Client(): S3Client {
  return new S3Client({
    region: REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
    },
  });
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    // Auth
    const user = await verifyAdminAuth(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as {
      documentId?: string;
      documentType?: "invoice" | "estimate";
    };
    const { documentId, documentType } = body;

    if (!documentId || !documentType) {
      return NextResponse.json(
        { error: "Missing required fields: documentId, documentType" },
        { status: 400 }
      );
    }

    // Check permission based on document type
    const requiredPerm = documentType === "invoice" ? "invoices.view" : "estimates.view";
    const allowed = await checkPermission(user.uid, requiredPerm);
    if (!allowed) {
      return NextResponse.json(
        { error: "You don't have permission to generate this document" },
        { status: 403 }
      );
    }

    const supabase = getServiceRoleClient();

    // ── Fetch document ─────────────────────────────────────────────────────
    let docData: Record<string, unknown>;
    let lineItems: Record<string, unknown>[];
    let payments: Record<string, unknown>[] = [];

    if (documentType === "invoice") {
      const [invoiceRes, liRes, payRes] = await Promise.all([
        supabase.from("invoices").select("*").eq("id", documentId).single(),
        supabase.from("line_items").select("*").eq("invoice_id", documentId).order("sort_order"),
        supabase.from("payments").select("*").eq("invoice_id", documentId).is("voided_at", null).order("payment_date", { ascending: false }),
      ]);
      if (invoiceRes.error) throw new Error(`Invoice not found: ${invoiceRes.error.message}`);
      if (liRes.error) throw new Error(`Line items error: ${liRes.error.message}`);
      if (payRes.error) throw new Error(`Payments error: ${payRes.error.message}`);
      docData = invoiceRes.data;
      lineItems = liRes.data ?? [];
      payments = payRes.data ?? [];
    } else {
      const [estimateRes, liRes] = await Promise.all([
        supabase.from("estimates").select("*").eq("id", documentId).single(),
        supabase.from("line_items").select("*").eq("estimate_id", documentId).order("sort_order"),
      ]);
      if (estimateRes.error) throw new Error(`Estimate not found: ${estimateRes.error.message}`);
      if (liRes.error) throw new Error(`Line items error: ${liRes.error.message}`);
      docData = estimateRes.data;
      lineItems = liRes.data ?? [];
    }

    // Verify company ownership — look up user's company from the users table
    const companyId = docData.company_id as string;
    const { data: userRow } = await supabase
      .from("users")
      .select("company_id")
      .eq("auth_id", user.uid)
      .single();
    if (!userRow || userRow.company_id !== companyId) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // ── Fetch related data ─────────────────────────────────────────────────
    const templateId = docData.template_id as string | null;
    const clientId = docData.client_id as string;

    const [brandingRes, clientRes, companyRes, templateRes] = await Promise.all([
      supabase.from("portal_branding").select("*").eq("company_id", companyId).maybeSingle(),
      supabase.from("clients").select("*").eq("id", clientId).single(),
      supabase.from("companies").select("*").eq("id", companyId).single(),
      templateId
        ? supabase.from("document_templates").select("*").eq("id", templateId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);

    // Default branding if none exists
    const branding: PortalBranding = brandingRes.data
      ? mapBrandingFromDb(brandingRes.data)
      : {
          id: "",
          companyId,
          logoUrl: null,
          accentColor: "#417394",
          template: "modern",
          themeMode: "light",
          fontCombo: "modern",
          welcomeMessage: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

    const template: DocumentTemplate | null = templateRes.data
      ? mapTemplateFromDb(templateRes.data)
      : null;

    const companyInfo = companyRes.data
      ? {
          name: companyRes.data.name as string,
          address: (companyRes.data.address as string) ?? null,
          phone: (companyRes.data.phone as string) ?? null,
          email: (companyRes.data.email as string) ?? null,
        }
      : null;

    const clientInfo = clientRes.data
      ? {
          name: clientRes.data.name as string,
          address: (clientRes.data.address as string) ?? null,
          phone: (clientRes.data.phone_number as string) ?? null,
          email: (clientRes.data.email as string) ?? null,
        }
      : null;

    // ── Build render data ──────────────────────────────────────────────────
    const mappedLineItems = lineItems.map((li) => ({
      name: li.name as string,
      description: (li.description as string) ?? null,
      quantity: Number(li.quantity ?? 0),
      unitPrice: Number(li.unit_price ?? 0),
      lineTotal: Number(li.line_total ?? 0),
    }));

    let documentRenderData: InvoiceRenderData | EstimateRenderData;

    if (documentType === "invoice") {
      documentRenderData = {
        type: "invoice",
        invoiceNumber: docData.invoice_number as string,
        subject: (docData.subject as string) ?? null,
        status: docData.status as string,
        issueDate: docData.issue_date as string,
        dueDate: docData.due_date as string,
        subtotal: Number(docData.subtotal ?? 0),
        discountAmount: Number(docData.discount_amount ?? 0),
        taxAmount: Number(docData.tax_amount ?? 0),
        total: Number(docData.total ?? 0),
        amountPaid: Number(docData.amount_paid ?? 0),
        balanceDue: Number(docData.balance_due ?? 0),
        clientMessage: (docData.client_message as string) ?? null,
        footer: (docData.footer as string) ?? null,
        terms: (docData.terms as string) ?? null,
        lineItems: mappedLineItems,
        payments: payments.map((p) => ({
          amount: Number(p.amount ?? 0),
          paymentMethod: (p.payment_method as string) ?? null,
          paymentDate: p.payment_date as string,
          referenceNumber: (p.reference_number as string) ?? null,
        })),
      };
    } else {
      documentRenderData = {
        type: "estimate",
        estimateNumber: docData.estimate_number as string,
        title: (docData.title as string) ?? null,
        status: docData.status as string,
        issueDate: docData.issue_date as string,
        expirationDate: (docData.expiration_date as string) ?? null,
        subtotal: Number(docData.subtotal ?? 0),
        discountAmount: Number(docData.discount_amount ?? 0),
        discountType: (docData.discount_type as string) ?? null,
        discountValue: docData.discount_value != null ? Number(docData.discount_value) : null,
        taxAmount: Number(docData.tax_amount ?? 0),
        taxRate: docData.tax_rate != null ? Number(docData.tax_rate) : null,
        total: Number(docData.total ?? 0),
        depositAmount: docData.deposit_amount != null ? Number(docData.deposit_amount) : null,
        clientMessage: (docData.client_message as string) ?? null,
        terms: (docData.terms as string) ?? null,
        lineItems: mappedLineItems,
      };
    }

    // ── Render HTML ────────────────────────────────────────────────────────
    const html = renderDocumentHtml({
      document: documentRenderData,
      branding,
      template,
      companyInfo,
      clientInfo,
    });

    // ── Generate PDF via Puppeteer ─────────────────────────────────────────
    let chromium: typeof import("@sparticuz/chromium");
    let puppeteer: typeof import("puppeteer-core");

    try {
      chromium = await import("@sparticuz/chromium");
      puppeteer = await import("puppeteer-core");
    } catch (e) {
      console.error("[generate-pdf] Failed to import puppeteer/chromium:", e);
      return NextResponse.json(
        { error: "PDF generation dependencies not available" },
        { status: 500 }
      );
    }

    const browser = await puppeteer.default.launch({
      args: chromium.default.args,
      defaultViewport: { width: 1200, height: 800 },
      executablePath: await chromium.default.executablePath(),
      headless: true,
    });

    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "networkidle0" });
      const pdfBuffer = await page.pdf({
        format: "A4",
        printBackground: true,
        margin: { top: "20mm", bottom: "20mm", left: "15mm", right: "15mm" },
      });

      // ── Upload to S3 ──────────────────────────────────────────────────────
      const timestamp = Date.now();
      const randomId = Math.random().toString(36).slice(2, 10);
      const filename = `${documentType}-${docData[documentType === "invoice" ? "invoice_number" : "estimate_number"]}.pdf`;
      const key = `documents/${companyId}/${timestamp}-${randomId}-${filename}`;

      const s3 = getS3Client();
      await s3.send(
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: key,
          Body: Buffer.from(pdfBuffer),
          ContentType: "application/pdf",
        })
      );

      const publicUrl = `https://${BUCKET}.s3.${REGION}.amazonaws.com/${key}`;

      // ── Update document with pdf_storage_path ─────────────────────────────
      const table = documentType === "invoice" ? "invoices" : "estimates";
      await supabase
        .from(table)
        .update({ pdf_storage_path: publicUrl })
        .eq("id", documentId);

      return NextResponse.json({ pdfUrl: publicUrl });
    } finally {
      await browser.close();
    }
  } catch (error) {
    console.error("[generate-pdf] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "PDF generation failed" },
      { status: 500 }
    );
  }
}
