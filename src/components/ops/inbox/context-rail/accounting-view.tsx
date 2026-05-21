"use client";

/**
 * AccountingView — body of the ACCOUNTING tab in the inbox right rail.
 *
 * The tab is a financial readout, not a document archive. Estimates and
 * invoices render here with compact value/status/date rows; provider
 * attachments stay in FILES. Status tone mapping lives at the bottom of this
 * file so new source statuses land in one place.
 */

import { useMemo } from "react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import { SlashLabel } from "../voice/slash-label";
import { StateTag, type StateTagTone } from "../state-tag";
import type { ProjectDocument } from "@/lib/api/services/project-file-service";
import { AccountingTotals } from "./accounting-totals";

interface AccountingViewProps {
  /** Estimates + invoices (and, later, other document types) for the
   *  current client. Order is "most recent activity first" — the
   *  upstream service already sorts by updatedAt DESC. */
  documents: ProjectDocument[];
  /** Fired when the operator taps a row. The caller decides whether to
   *  open the PDF in a new tab, route to the source record, etc. */
  onOpenDocument?: (doc: ProjectDocument) => void;
  className?: string;
}

const TNUM_ZERO = { fontFeatureSettings: '"tnum" 1, "zero" 1' };

type TFn = (key: string, fallback: string) => string;
type StatusClassifier = (status: string | null) => {
  label: string;
  tone: StateTagTone;
};

export function AccountingView({
  documents,
  onOpenDocument,
  className,
}: AccountingViewProps) {
  const { t } = useDictionary("inbox");

  const estimates = useMemo(
    () => documents.filter((d) => d.sourceType === "estimate"),
    [documents]
  );
  const invoices = useMemo(
    () => documents.filter((d) => d.sourceType === "invoice"),
    [documents]
  );

  const estimateStatus = useMemo(() => createEstimateClassifier(t), [t]);
  const invoiceStatus = useMemo(() => createInvoiceClassifier(t), [t]);

  const totals = useMemo(
    () => ({
      estimatesTotal: sumDocumentValues(estimates),
      invoicesTotal: sumDocumentValues(invoices),
      outstanding: sumInvoiceBucket(invoices, "outstanding"),
      paid: sumInvoiceBucket(invoices, "paid"),
      overdue: sumInvoiceBucket(invoices, "overdue"),
    }),
    [estimates, invoices]
  );

  const everythingEmpty = estimates.length === 0 && invoices.length === 0;

  return (
    <div className={cn("flex min-h-full flex-col", className)}>
      <AccountingTotals
        className="-mx-3 -mt-3 mb-3"
        estimatesTotal={totals.estimatesTotal}
        invoicesTotal={totals.invoicesTotal}
        outstanding={totals.outstanding}
        paid={totals.paid}
        overdue={totals.overdue}
      />
      <div className="flex flex-1 flex-col gap-3">
        {everythingEmpty ? (
          <p className="font-mono text-[11px] text-text-3">
            {t("rail.empty.accounting", "[—] no financial documents")}
          </p>
        ) : (
          <>
            {estimates.length > 0 && (
              <DocumentSection
                testId="accounting-view-estimates"
                label={t("rail.sectionEstimates", "// ESTIMATES")}
                docs={estimates}
                kindLabel={t("rail.docTypeEstimate", "ESTIMATE")}
                classify={estimateStatus}
                onOpenDocument={onOpenDocument}
              />
            )}
            {invoices.length > 0 && (
              <DocumentSection
                testId="accounting-view-invoices"
                label={t("rail.sectionInvoices", "// INVOICES")}
                docs={invoices}
                kindLabel={t("rail.docTypeInvoice", "INVOICE")}
                classify={invoiceStatus}
                onOpenDocument={onOpenDocument}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Section ────────────────────────────────────────────────────────────────

interface DocumentSectionProps {
  label: string;
  docs: ProjectDocument[];
  kindLabel: string;
  classify: StatusClassifier;
  onOpenDocument?: (doc: ProjectDocument) => void;
  testId?: string;
}

function DocumentSection({
  label,
  docs,
  kindLabel,
  classify,
  onOpenDocument,
  testId,
}: DocumentSectionProps) {
  return (
    <section data-testid={testId}>
      <SectionHeader label={label} count={docs.length} />
      <ul className="mt-1.5 border-y border-line/70">
        {docs.map((doc) => (
          <li key={doc.id} className="border-b border-line/60 last:border-b-0">
            <DocumentRow
              doc={doc}
              kindLabel={kindLabel}
              classify={classify}
              onOpenDocument={onOpenDocument}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

interface SectionHeaderProps {
  label: string;
  count: number;
}

function SectionHeader({ label, count }: SectionHeaderProps) {
  return (
    <div className="flex items-baseline justify-between px-0.5 pb-1">
      <SlashLabel label={label} tone="text-2" />
      <span
        className="font-mono text-[11px] tracking-[0.18em] text-text-mute"
        style={TNUM_ZERO}
      >
        {count}
      </span>
    </div>
  );
}

// ─── Row ────────────────────────────────────────────────────────────────────

interface DocumentRowProps {
  doc: ProjectDocument;
  kindLabel: string;
  classify: StatusClassifier;
  onOpenDocument?: (doc: ProjectDocument) => void;
}

function DocumentRow({
  doc,
  kindLabel,
  classify,
  onOpenDocument,
}: DocumentRowProps) {
  const status = classify(doc.status);
  const ref = documentReference(doc);
  return (
    <button
      type="button"
      data-testid={`accounting-document-row-${doc.id}`}
      onClick={() => onOpenDocument?.(doc)}
      className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-1 px-1.5 py-2 text-left transition-colors hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black"
    >
      <span className="min-w-0 font-mono text-[11px] uppercase tracking-[0.12em] text-text-mute">
        {kindLabel}
      </span>
      <StateTag
        tone={status.tone}
        variant="outline"
        prefix={status.label}
        bracketed
        className="justify-self-end"
      />
      <span
        className="min-w-0 truncate font-mono text-[11px] uppercase text-text-2"
        style={TNUM_ZERO}
      >
        {ref}
      </span>
      <span
        className="flex justify-self-end font-mono text-[11px] uppercase tracking-[0.02em]"
        style={TNUM_ZERO}
      >
        <span
          className={cn(
            "font-medium",
            doc.value === null ? "text-text-mute" : "text-text"
          )}
        >
          {formatCurrency(doc.value)}
        </span>
        <span className="px-1.5 text-text-mute">·</span>
        <span className="text-text-mute">{formatDate(doc.updatedAt)}</span>
      </span>
    </button>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d
    .toLocaleDateString("en-US", { month: "short", day: "numeric" })
    .toUpperCase();
}

function formatCurrency(value: number | null): string {
  if (value === null) return "—";
  const rounded = Math.round(value);
  const abs = Math.abs(rounded).toLocaleString("en-US");
  return rounded < 0 ? `-$${abs}` : `$${abs}`;
}

function documentReference(doc: ProjectDocument): string {
  const stem = doc.filename.replace(/\.[^.]+$/, "").trim();
  const ref = stem
    .replace(/^estimate\s+/i, "")
    .replace(/^invoice\s+/i, "")
    .trim();
  return ref || doc.sourceId.slice(0, 8).toUpperCase();
}

function numericValue(doc: ProjectDocument): number | null {
  return typeof doc.value === "number" && Number.isFinite(doc.value)
    ? doc.value
    : null;
}

function sumDocumentValues(docs: ProjectDocument[]): number | null {
  let hasValue = false;
  let total = 0;
  for (const doc of docs) {
    const value = numericValue(doc);
    if (value === null) continue;
    hasValue = true;
    total += value;
  }
  return hasValue ? total : null;
}

function sumInvoiceBucket(
  invoices: ProjectDocument[],
  bucket: "outstanding" | "paid" | "overdue"
): number | null {
  const hasInvoiceValue = invoices.some(
    (invoice) => numericValue(invoice) !== null
  );
  if (!hasInvoiceValue) return null;

  let total = 0;
  for (const invoice of invoices) {
    if (classifyInvoice(invoice.status) !== bucket) continue;
    const value = numericValue(invoice);
    if (value !== null) total += value;
  }
  return total;
}

/** Classifies an invoice's status into a totals-bucket. Used by the
 *  totals reducer; the StateTag-facing variant below ({label, tone})
 *  layers presentation on top of this. */
function classifyInvoice(
  status: string | null
): "paid" | "outstanding" | "overdue" | "draft" | "other" {
  const norm = (status ?? "").toLowerCase().trim();
  if (norm === "paid" || norm === "paid_in_full") return "paid";
  if (
    norm === "outstanding" ||
    norm === "sent" ||
    norm === "pending" ||
    norm === "unpaid" ||
    norm === "partial" ||
    norm === "partially_paid"
  ) {
    return "outstanding";
  }
  if (norm === "overdue" || norm === "past_due" || norm === "late") {
    return "overdue";
  }
  if (norm === "draft") return "draft";
  return "other";
}

function createInvoiceClassifier(t: TFn): StatusClassifier {
  return (status) => {
    switch (classifyInvoice(status)) {
      case "paid":
        return { label: t("rail.statusPaid", "PAID"), tone: "olive" };
      case "outstanding":
        return {
          label: t("rail.statusOutstanding", "OUTSTANDING"),
          tone: "tan",
        };
      case "overdue":
        return { label: t("rail.statusOverdue", "OVERDUE"), tone: "rose" };
      case "draft":
        return { label: t("rail.statusDraft", "DRAFT"), tone: "neutral" };
      case "other":
      default:
        return { label: statusLabel(status, t), tone: "neutral" };
    }
  };
}

function createEstimateClassifier(t: TFn): StatusClassifier {
  return (status) => {
    const norm = (status ?? "").toLowerCase().trim();
    switch (norm) {
      case "draft":
        return { label: t("rail.statusDraft", "DRAFT"), tone: "neutral" };
      case "sent":
        return { label: t("rail.statusSent", "SENT"), tone: "tan" };
      case "approved":
        return { label: t("rail.statusApproved", "APPROVED"), tone: "olive" };
      case "accepted":
        return { label: t("rail.statusAccepted", "ACCEPTED"), tone: "olive" };
      case "converted":
        return { label: t("rail.statusConverted", "CONVERTED"), tone: "olive" };
      case "changes_requested":
        return {
          label: t("rail.statusChangesRequested", "CHANGES REQUESTED"),
          tone: "tan",
        };
      case "declined":
        return { label: t("rail.statusDeclined", "DECLINED"), tone: "rose" };
      case "expired":
        return { label: t("rail.statusExpired", "EXPIRED"), tone: "rose" };
      default:
        return { label: statusLabel(status, t), tone: "neutral" };
    }
  };
}

function statusLabel(status: string | null, t: TFn): string {
  const normalized = (status ?? "").trim();
  if (!normalized) return t("rail.statusEmpty", "—");
  return normalized.replace(/[_-]+/g, " ").toUpperCase();
}
