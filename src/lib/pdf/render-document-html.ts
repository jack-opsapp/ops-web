/**
 * OPS Web - Document HTML Renderer
 *
 * Produces a self-contained HTML string for PDF rendering via Puppeteer.
 * Uses template literals (not React) for server-side generation.
 * Includes inlined CSS variables and Google Fonts.
 */

import type { PortalBranding } from "@/lib/types/portal";
import type { FieldVisibility } from "@/lib/types/document-template";
import type { DocumentTemplate } from "@/lib/types/document-template";
import { DEFAULT_FIELD_VISIBILITY } from "@/lib/types/document-template";
import { generatePortalTheme, getTemplateFontImports } from "@/lib/portal/theme";
import { resolveTemplateBranding, getFieldVisibility } from "@/lib/portal/resolve-template-branding";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PartyInfo {
  name: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
}

interface LineItemData {
  name: string;
  description: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

interface PaymentData {
  amount: number;
  paymentMethod: string | null;
  paymentDate: string;
  referenceNumber: string | null;
}

export interface InvoiceRenderData {
  type: "invoice";
  invoiceNumber: string;
  subject: string | null;
  status: string;
  issueDate: string;
  dueDate: string;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  total: number;
  amountPaid: number;
  balanceDue: number;
  clientMessage: string | null;
  footer: string | null;
  terms: string | null;
  lineItems: LineItemData[];
  payments: PaymentData[];
}

export interface EstimateRenderData {
  type: "estimate";
  estimateNumber: string;
  title: string | null;
  status: string;
  issueDate: string;
  expirationDate: string | null;
  subtotal: number;
  discountAmount: number;
  discountType: string | null;
  discountValue: number | null;
  taxAmount: number;
  taxRate: number | null;
  total: number;
  depositAmount: number | null;
  clientMessage: string | null;
  terms: string | null;
  lineItems: LineItemData[];
}

export type DocumentRenderData = InvoiceRenderData | EstimateRenderData;

export interface RenderOptions {
  document: DocumentRenderData;
  branding: PortalBranding;
  template: DocumentTemplate | null;
  companyInfo: PartyInfo | null;
  clientInfo: PartyInfo | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function esc(str: string | null | undefined): string {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function fmtDate(date: string | null): string {
  if (!date) return "";
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtPaymentMethod(method: string | null): string {
  if (!method) return "Payment";
  const labels: Record<string, string> = {
    credit_card: "Credit Card",
    debit_card: "Debit Card",
    bank_transfer: "Bank Transfer",
    ach: "ACH",
    check: "Check",
    cash: "Cash",
    other: "Other",
  };
  return labels[method] ?? method.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Section Renderers ────────────────────────────────────────────────────────

function renderPartySection(label: string, info: PartyInfo): string {
  return `
    <div style="flex:1;min-width:180px;">
      <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--portal-text-tertiary);margin-bottom:6px;">${esc(label)}</div>
      <div style="font-size:13px;font-weight:600;color:var(--portal-text);">${esc(info.name)}</div>
      ${info.address ? `<div style="font-size:11px;color:var(--portal-text-secondary);margin-top:2px;">${esc(info.address)}</div>` : ""}
      ${info.phone ? `<div style="font-size:11px;color:var(--portal-text-secondary);margin-top:2px;">${esc(info.phone)}</div>` : ""}
      ${info.email ? `<div style="font-size:11px;color:var(--portal-text-secondary);margin-top:2px;">${esc(info.email)}</div>` : ""}
    </div>
  `;
}

function renderLineItemsTable(
  items: LineItemData[],
  v: FieldVisibility
): string {
  const showQty = v.showQuantities;
  const showPrice = v.showUnitPrices;
  const showTotal = v.showLineTotals;

  const headerCells = [
    `<th style="text-align:left;padding:8px 12px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--portal-text-tertiary);background:var(--portal-bg-secondary);">Item</th>`,
    showQty ? `<th style="text-align:right;padding:8px 12px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--portal-text-tertiary);background:var(--portal-bg-secondary);">Qty</th>` : "",
    showPrice ? `<th style="text-align:right;padding:8px 12px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--portal-text-tertiary);background:var(--portal-bg-secondary);">Unit Price</th>` : "",
    showTotal ? `<th style="text-align:right;padding:8px 12px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--portal-text-tertiary);background:var(--portal-bg-secondary);">Total</th>` : "",
  ].join("");

  const rows = items
    .map(
      (item, i) => `
      <tr style="border-bottom:${i < items.length - 1 ? "1px solid var(--portal-border)" : "none"};">
        <td style="padding:10px 12px;vertical-align:top;">
          <div style="font-size:13px;font-weight:500;color:var(--portal-text);">${esc(item.name)}</div>
          ${v.showDescriptions && item.description ? `<div style="font-size:11px;color:var(--portal-text-secondary);margin-top:2px;">${esc(item.description)}</div>` : ""}
        </td>
        ${showQty ? `<td style="padding:10px 12px;text-align:right;font-size:13px;color:var(--portal-text-secondary);vertical-align:top;">${item.quantity}</td>` : ""}
        ${showPrice ? `<td style="padding:10px 12px;text-align:right;font-size:13px;color:var(--portal-text-secondary);vertical-align:top;">${fmtCurrency(item.unitPrice)}</td>` : ""}
        ${showTotal ? `<td style="padding:10px 12px;text-align:right;font-size:13px;font-weight:500;color:var(--portal-text);vertical-align:top;">${fmtCurrency(item.lineTotal)}</td>` : ""}
      </tr>
    `
    )
    .join("");

  return `
    <table style="width:100%;border-collapse:collapse;">
      <thead><tr>${headerCells}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

// ─── Main Renderer ────────────────────────────────────────────────────────────

export function renderDocumentHtml(options: RenderOptions): string {
  const { document: doc, branding, template, companyInfo, clientInfo } = options;

  // Resolve branding with template overrides
  const resolved = resolveTemplateBranding(branding, template);
  const themeVars = generatePortalTheme(resolved);
  const v = getFieldVisibility(template);

  // Font imports
  const fontImports = getTemplateFontImports(resolved.template);
  const fontLinks = fontImports
    .filter(Boolean)
    .map((url) => `<link rel="stylesheet" href="${url}" />`)
    .join("\n");

  // CSS variables
  const cssVars = Object.entries(themeVars)
    .map(([key, value]) => `${key}: ${value};`)
    .join("\n    ");

  // Build sections
  const isInvoice = doc.type === "invoice";
  const docNumber = isInvoice
    ? (doc as InvoiceRenderData).invoiceNumber
    : (doc as EstimateRenderData).estimateNumber;
  const docLabel = isInvoice ? "Invoice" : "Estimate";

  // Header
  const headerHtml = `
    <div style="padding:24px;background:var(--portal-card);border:1px solid var(--portal-border);border-radius:var(--portal-radius-lg);margin-bottom:20px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;">
        <div>
          <h1 style="font-family:var(--portal-heading-font);font-weight:var(--portal-heading-weight);text-transform:var(--portal-heading-transform);font-size:20px;margin:0;color:var(--portal-text);">
            ${esc(docLabel)} #${esc(docNumber)}
          </h1>
          ${isInvoice && (doc as InvoiceRenderData).subject ? `<p style="font-size:13px;color:var(--portal-text-secondary);margin:4px 0 0;">${esc((doc as InvoiceRenderData).subject)}</p>` : ""}
          ${!isInvoice && (doc as EstimateRenderData).title ? `<p style="font-size:13px;color:var(--portal-text-secondary);margin:4px 0 0;">${esc((doc as EstimateRenderData).title)}</p>` : ""}
        </div>
        <div style="font-size:11px;font-weight:600;text-transform:uppercase;padding:4px 10px;border-radius:var(--portal-radius-sm);background:var(--portal-bg-secondary);color:var(--portal-text-secondary);">
          ${esc(doc.status)}
        </div>
      </div>
      <div style="font-size:12px;color:var(--portal-text-secondary);display:flex;gap:20px;">
        <span>Issued: ${fmtDate(doc.issueDate)}</span>
        ${isInvoice ? `<span>Due: ${fmtDate((doc as InvoiceRenderData).dueDate)}</span>` : ""}
        ${!isInvoice && (doc as EstimateRenderData).expirationDate ? `<span>Expires: ${fmtDate((doc as EstimateRenderData).expirationDate)}</span>` : ""}
      </div>
    </div>
  `;

  // From / To
  let fromToHtml = "";
  if ((v.showFromSection && companyInfo) || (v.showToSection && clientInfo)) {
    const parts: string[] = [];
    if (v.showFromSection && companyInfo) parts.push(renderPartySection("From", companyInfo));
    if (v.showToSection && clientInfo) parts.push(renderPartySection("To", clientInfo));
    fromToHtml = `
      <div style="padding:20px 24px;background:var(--portal-card);border:1px solid var(--portal-border);border-radius:var(--portal-radius-lg);margin-bottom:20px;display:flex;gap:24px;">
        ${parts.join("")}
      </div>
    `;
  }

  // Client message
  const messageHtml = doc.clientMessage
    ? `
      <div style="padding:20px 24px;background:var(--portal-card);border:1px solid var(--portal-border);border-radius:var(--portal-radius-lg);margin-bottom:20px;">
        <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--portal-text-tertiary);margin-bottom:8px;">
          Message
        </div>
        <p style="font-size:13px;color:var(--portal-text-secondary);margin:0;line-height:1.6;white-space:pre-wrap;">${esc(doc.clientMessage)}</p>
      </div>
    `
    : "";

  // Line items
  const lineItemsHtml = `
    <div style="background:var(--portal-card);border:1px solid var(--portal-border);border-radius:var(--portal-radius-lg);overflow:hidden;margin-bottom:20px;">
      <div style="padding:12px 16px;border-bottom:1px solid var(--portal-border);">
        <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--portal-text-tertiary);">Line Items</div>
      </div>
      ${renderLineItemsTable(doc.lineItems, v)}
    </div>
  `;

  // Totals
  const totalRows: string[] = [];
  totalRows.push(`
    <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px;">
      <span style="color:var(--portal-text-secondary);">Subtotal</span>
      <span style="color:var(--portal-text);">${fmtCurrency(doc.subtotal)}</span>
    </div>
  `);

  if (v.showDiscount && doc.discountAmount > 0) {
    totalRows.push(`
      <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px;">
        <span style="color:var(--portal-text-secondary);">Discount</span>
        <span style="color:var(--portal-success);">-${fmtCurrency(doc.discountAmount)}</span>
      </div>
    `);
  }

  if (v.showTax && doc.taxAmount > 0) {
    totalRows.push(`
      <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px;">
        <span style="color:var(--portal-text-secondary);">Tax</span>
        <span style="color:var(--portal-text);">${fmtCurrency(doc.taxAmount)}</span>
      </div>
    `);
  }

  totalRows.push(`
    <div style="border-top:1px solid var(--portal-border);padding-top:8px;margin-top:4px;display:flex;justify-content:space-between;">
      <span style="font-family:var(--portal-heading-font);font-weight:var(--portal-heading-weight);font-size:15px;color:var(--portal-text);">Total</span>
      <span style="font-family:var(--portal-heading-font);font-weight:700;font-size:17px;color:var(--portal-text);">${fmtCurrency(doc.total)}</span>
    </div>
  `);

  // Invoice-specific: balance due
  if (isInvoice) {
    const inv = doc as InvoiceRenderData;
    if (inv.amountPaid > 0) {
      totalRows.push(`
        <div style="display:flex;justify-content:space-between;font-size:13px;margin-top:6px;">
          <span style="color:var(--portal-text-secondary);">Amount Paid</span>
          <span style="color:var(--portal-success);">-${fmtCurrency(inv.amountPaid)}</span>
        </div>
      `);
    }
    totalRows.push(`
      <div style="border-top:2px solid var(--portal-border-strong);padding-top:10px;margin-top:8px;display:flex;justify-content:space-between;align-items:center;">
        <span style="font-family:var(--portal-heading-font);font-weight:var(--portal-heading-weight);font-size:15px;">Balance Due</span>
        <span style="font-family:var(--portal-heading-font);font-weight:700;font-size:22px;color:${inv.balanceDue > 0 ? "var(--portal-warning)" : "var(--portal-success)"};">${fmtCurrency(inv.balanceDue)}</span>
      </div>
    `);
  }

  // Estimate-specific: deposit
  if (!isInvoice) {
    const est = doc as EstimateRenderData;
    if (est.depositAmount != null && est.depositAmount > 0) {
      totalRows.push(`
        <div style="display:flex;justify-content:space-between;font-size:13px;margin-top:6px;">
          <span style="color:var(--portal-warning);">Deposit required</span>
          <span style="color:var(--portal-warning);">${fmtCurrency(est.depositAmount)}</span>
        </div>
      `);
    }
  }

  const totalsHtml = `
    <div style="padding:20px 24px;background:var(--portal-card);border:1px solid var(--portal-border);border-radius:var(--portal-radius-lg);margin-bottom:20px;">
      <div style="max-width:280px;margin-left:auto;">
        ${totalRows.join("")}
      </div>
    </div>
  `;

  // Payment history (invoice only)
  let paymentsHtml = "";
  if (isInvoice && v.showPaymentInfo) {
    const inv = doc as InvoiceRenderData;
    if (inv.payments.length > 0) {
      const paymentRows = inv.payments
        .map(
          (p, i) => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 16px;${i < inv.payments.length - 1 ? "border-bottom:1px solid var(--portal-border);" : ""}">
            <div>
              <div style="font-size:13px;font-weight:500;color:var(--portal-text);">${esc(fmtPaymentMethod(p.paymentMethod))}</div>
              <div style="font-size:11px;color:var(--portal-text-tertiary);">${fmtDate(p.paymentDate)}${p.referenceNumber ? ` · Ref: ${esc(p.referenceNumber)}` : ""}</div>
            </div>
            <span style="font-size:13px;font-weight:600;color:var(--portal-success);">${fmtCurrency(p.amount)}</span>
          </div>
        `
        )
        .join("");

      paymentsHtml = `
        <div style="background:var(--portal-card);border:1px solid var(--portal-border);border-radius:var(--portal-radius-lg);overflow:hidden;margin-bottom:20px;">
          <div style="padding:12px 16px;border-bottom:1px solid var(--portal-border);">
            <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--portal-text-tertiary);">Payment History</div>
          </div>
          ${paymentRows}
        </div>
      `;
    }
  }

  // Terms
  let termsHtml = "";
  if (v.showTerms && doc.terms) {
    termsHtml = `
      <div style="padding:20px 24px;background:var(--portal-card);border:1px solid var(--portal-border);border-radius:var(--portal-radius-lg);margin-bottom:20px;">
        <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--portal-text-tertiary);margin-bottom:8px;">Terms &amp; Conditions</div>
        <p style="font-size:12px;color:var(--portal-text-secondary);margin:0;line-height:1.6;white-space:pre-wrap;">${esc(doc.terms)}</p>
      </div>
    `;
  }

  // Footer (invoice only)
  let footerHtml = "";
  if (isInvoice && v.showFooter && (doc as InvoiceRenderData).footer) {
    footerHtml = `
      <p style="text-align:center;font-size:11px;color:var(--portal-text-tertiary);margin-top:20px;">
        ${esc((doc as InvoiceRenderData).footer)}
      </p>
    `;
  }

  // Assemble full HTML
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  ${fontLinks}
  <style>
    :root {
      ${cssVars}
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--portal-body-font);
      background: var(--portal-bg);
      color: var(--portal-text);
      line-height: 1.5;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    @page {
      size: A4;
      margin: 20mm 15mm;
    }
    @media print {
      body { background: transparent; }
    }
    .doc-container {
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
    }
  </style>
</head>
<body>
  <div class="doc-container">
    ${headerHtml}
    ${fromToHtml}
    ${messageHtml}
    ${lineItemsHtml}
    ${totalsHtml}
    ${paymentsHtml}
    ${termsHtml}
    ${footerHtml}
  </div>
</body>
</html>`;
}
