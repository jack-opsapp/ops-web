"use client";

/**
 * AccountingView — body of the ACCOUNTING tab in the inbox right rail
 * (spec § 6.4). Three sections stacked over a sticky totals strip:
 *
 *   // ESTIMATES · {n}
 *   { rows: filename · [STATUS] · MMM DD }
 *
 *   // INVOICES · {n}
 *   { rows: filename · [STATUS] · MMM DD }
 *
 *   // OTHER · {n}           (hidden when empty — today's project-file
 *                              service only emits estimates+invoices,
 *                              so this section is structurally inert
 *                              but kept in place for forthcoming
 *                              receipts / contracts / change-orders.)
 *
 *   ───────────────────────────────────────────────────  (sticky bottom)
 *   [OUTSTANDING] $X   [PAID 30D] $Y   [OVERDUE] $Z
 *
 * Status tone mapping lives at the bottom of this file — keep it
 * close to the row renderer so future status additions land in one
 * place rather than scattered across the section components.
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

/** Trailing-30d window used for the [PAID 30D] total. */
const PAID_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export function AccountingView({
  documents,
  onOpenDocument,
  className,
}: AccountingViewProps) {
  const { t } = useDictionary("inbox");

  const estimates = useMemo(
    () => documents.filter((d) => d.sourceType === "estimate"),
    [documents],
  );
  const invoices = useMemo(
    () => documents.filter((d) => d.sourceType === "invoice"),
    [documents],
  );
  const other = useMemo(
    () =>
      documents.filter(
        (d) => d.sourceType !== "estimate" && d.sourceType !== "invoice",
      ),
    [documents],
  );

  // Totals are derived from the invoice list only — estimates don't
  // contribute to AR. Window math is wall-clock, not a stored value,
  // so re-renders pick up the rolling 30-day boundary naturally.
  const { outstanding, paid30d, overdue } = useMemo(() => {
    const now = Date.now();
    let out = 0;
    let paid = 0;
    let due = 0;
    for (const inv of invoices) {
      const v = inv.value ?? 0;
      if (v === 0) continue;
      const cat = classifyInvoice(inv.status);
      if (cat === "outstanding") out += v;
      else if (cat === "overdue") due += v;
      else if (cat === "paid") {
        const updated = new Date(inv.updatedAt).getTime();
        if (Number.isFinite(updated) && now - updated <= PAID_WINDOW_MS) {
          paid += v;
        }
      }
    }
    return { outstanding: out, paid30d: paid, overdue: due };
  }, [invoices]);

  const everythingEmpty =
    estimates.length === 0 && invoices.length === 0 && other.length === 0;

  return (
    <div className={cn("flex min-h-full flex-col", className)}>
      <div className="flex flex-1 flex-col gap-4">
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
                classify={classifyEstimate}
                onOpenDocument={onOpenDocument}
              />
            )}
            {invoices.length > 0 && (
              <DocumentSection
                testId="accounting-view-invoices"
                label={t("rail.sectionInvoices", "// INVOICES")}
                docs={invoices}
                classify={classifyInvoiceTag}
                onOpenDocument={onOpenDocument}
              />
            )}
            {other.length > 0 && (
              <DocumentSection
                testId="accounting-view-other"
                label={t("rail.sectionOther", "// OTHER")}
                docs={other}
                classify={classifyOther}
                onOpenDocument={onOpenDocument}
              />
            )}
          </>
        )}
      </div>
      <AccountingTotals
        className="sticky bottom-0 mt-4 -mx-3 -mb-3"
        outstanding={outstanding}
        paid30d={paid30d}
        overdue={overdue}
      />
    </div>
  );
}

// ─── Section ────────────────────────────────────────────────────────────────

interface DocumentSectionProps {
  label: string;
  docs: ProjectDocument[];
  classify: (status: string | null) => { label: string; tone: StateTagTone };
  onOpenDocument?: (doc: ProjectDocument) => void;
  testId?: string;
}

function DocumentSection({
  label,
  docs,
  classify,
  onOpenDocument,
  testId,
}: DocumentSectionProps) {
  return (
    <section data-testid={testId}>
      <SectionHeader label={label} count={docs.length} />
      <ul className="mt-2 flex flex-col gap-1.5">
        {docs.map((doc) => (
          <li key={doc.id}>
            <DocumentRow
              doc={doc}
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
  classify: (status: string | null) => { label: string; tone: StateTagTone };
  onOpenDocument?: (doc: ProjectDocument) => void;
}

function DocumentRow({ doc, classify, onOpenDocument }: DocumentRowProps) {
  const status = classify(doc.status);
  return (
    <button
      type="button"
      onClick={() => onOpenDocument?.(doc)}
      className="flex w-full items-center gap-2.5 rounded-[2.5px] border border-line bg-inbox-panel px-2.5 py-2 text-left hover:bg-inbox-elev"
    >
      <span
        className="min-w-0 flex-1 truncate font-mono text-[11px] uppercase text-text-2"
        style={TNUM_ZERO}
      >
        {doc.filename}
      </span>
      <StateTag
        tone={status.tone}
        variant="solid"
        prefix={status.label}
        bracketed
      />
      <span
        className="shrink-0 font-mono text-[11px] uppercase tracking-[0.18em] text-text-mute"
        style={TNUM_ZERO}
      >
        {formatDate(doc.updatedAt)}
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

/** Classifies an invoice's status into a totals-bucket. Used by the
 *  totals reducer; the StateTag-facing variant below ({label, tone})
 *  layers presentation on top of this. */
function classifyInvoice(
  status: string | null,
): "paid" | "outstanding" | "overdue" | "draft" | "other" {
  const norm = (status ?? "").toLowerCase().trim();
  if (norm === "paid") return "paid";
  if (norm === "outstanding" || norm === "sent" || norm === "pending") {
    return "outstanding";
  }
  if (norm === "overdue") return "overdue";
  if (norm === "draft") return "draft";
  return "other";
}

function classifyInvoiceTag(status: string | null): { label: string; tone: StateTagTone } {
  switch (classifyInvoice(status)) {
    case "paid":
      return { label: "PAID", tone: "olive" };
    case "outstanding":
      return { label: "OUTSTANDING", tone: "tan" };
    case "overdue":
      return { label: "OVERDUE", tone: "rose" };
    case "draft":
      return { label: "DRAFT", tone: "neutral" };
    case "other":
    default:
      return { label: (status ?? "").toUpperCase() || "—", tone: "neutral" };
  }
}

function classifyEstimate(status: string | null): { label: string; tone: StateTagTone } {
  const norm = (status ?? "").toLowerCase().trim();
  switch (norm) {
    case "draft":
      return { label: "DRAFT", tone: "neutral" };
    case "sent":
      return { label: "SENT", tone: "accent" };
    case "accepted":
      return { label: "ACCEPTED", tone: "olive" };
    case "declined":
      return { label: "DECLINED", tone: "rose" };
    default:
      return { label: (status ?? "").toUpperCase() || "—", tone: "neutral" };
  }
}

function classifyOther(status: string | null): { label: string; tone: StateTagTone } {
  return { label: (status ?? "").toUpperCase() || "—", tone: "neutral" };
}
