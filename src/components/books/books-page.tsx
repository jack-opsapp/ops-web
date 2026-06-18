"use client";

/**
 * BOOKS — the unified financial hub (WEB OVERHAUL P3.1, direction A).
 * Absorbs Estimates, Invoices, Accounting (A/R + integrations + QB import),
 * the expense review hub, and the cashflow placeholder route.
 *
 * URL contract (master plan §2 + capability inventory §6):
 *   /books?segment=invoices|estimates|expenses|sync
 *         &view=aging|connections|import
 *         &status=<document status filter>
 *         &action=new
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { usePageTitle } from "@/lib/hooks/use-page-title";
import { useDictionary } from "@/i18n/client";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { useClients, useEstimates, useExpenseBatches, useInvoices } from "@/lib/hooks";
import { isBatchNeedsReview } from "@/lib/types/expense-approval";
import { EstimateStatus, InvoiceStatus } from "@/lib/types/pipeline";
import type { BooksPeriod } from "@/lib/api/services/books-service";
import { BOOKS_PERIODS } from "@/lib/api/services/books-service";
import { LedgerStrip } from "./ledger-strip";
import { BooksSegmentControl, type BooksSegmentOption } from "./segment-toolbar";
import { InvoicesSegment, type InvoicesView } from "./segments/invoices-segment";
import { EstimatesSegment } from "./segments/estimates-segment";
import { ExpensesSegment } from "./segments/expenses-segment";
import { SyncSegment, type SyncView } from "./segments/sync-segment";

export type BooksSegment = "invoices" | "estimates" | "expenses" | "sync";

const SEGMENT_ORDER: BooksSegment[] = ["invoices", "estimates", "expenses", "sync"];

/** Per-segment gate (capability inventory §7). Never role names.
 *  invoices also admits accounting.view-only users — they land on the
 *  A/R aging view (old /accounting parity) without the document list. */
const SEGMENT_ALLOWED: Record<BooksSegment, (can: (p: string) => boolean) => boolean> = {
  invoices: (can) => can("invoices.view") || can("accounting.view"),
  estimates: (can) => can("estimates.view"),
  expenses: (can) => can("expenses.approve"),
  sync: (can) => can("accounting.manage_connections"),
};

const PERIOD_STORAGE_KEY = "books.period";
const SEGMENT_STORAGE_KEY = "books.segment";

function isBooksPeriod(value: string | null): value is BooksPeriod {
  return !!value && (BOOKS_PERIODS as string[]).includes(value);
}

export function BooksPage() {
  const { t } = useDictionary("books");
  usePageTitle(t("title", "Books"));
  const router = useRouter();
  const searchParams = useSearchParams();
  const can = usePermissionStore((s) => s.can);

  // ── Visible segments ──────────────────────────────────────────────────
  const visibleSegments = useMemo(
    () => SEGMENT_ORDER.filter((s) => SEGMENT_ALLOWED[s](can)),
    [can],
  );

  // ── URL state ─────────────────────────────────────────────────────────
  const segmentParam = searchParams.get("segment") as BooksSegment | null;
  const viewParam = searchParams.get("view");
  const statusParam = searchParams.get("status");
  const actionParam = searchParams.get("action");

  // The stored default hydrates in an effect (this route prerenders, so a
  // lazy initializer would mismatch). Until it lands, a no-?segment visit
  // resolves no segment — one skeleton frame — so the first paint can
  // neither flash the wrong segment nor clobber the stored value.
  const [storedSegment, setStoredSegment] = useState<BooksSegment | null>(null);
  const [segmentHydrated, setSegmentHydrated] = useState(false);
  useEffect(() => {
    const stored = window.localStorage.getItem(SEGMENT_STORAGE_KEY) as BooksSegment | null;
    if (stored && SEGMENT_ORDER.includes(stored)) setStoredSegment(stored);
    setSegmentHydrated(true);
  }, []);

  const activeSegment: BooksSegment | null = useMemo(() => {
    if (segmentParam && visibleSegments.includes(segmentParam)) return segmentParam;
    if (!segmentHydrated) return null;
    if (storedSegment && visibleSegments.includes(storedSegment)) return storedSegment;
    return visibleSegments[0] ?? null;
  }, [segmentParam, storedSegment, segmentHydrated, visibleSegments]);

  useEffect(() => {
    if (segmentHydrated && activeSegment) {
      window.localStorage.setItem(SEGMENT_STORAGE_KEY, activeSegment);
    }
  }, [activeSegment, segmentHydrated]);

  const updateParams = useCallback(
    (next: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(next)) {
        if (value === null) params.delete(key);
        else params.set(key, value);
      }
      const qs = params.toString();
      router.replace(qs ? `/books?${qs}` : "/books", { scroll: false });
    },
    [router, searchParams],
  );

  // ── Period (iOS PeriodPill parity, persisted) ─────────────────────────
  const [period, setPeriod] = useState<BooksPeriod>("30d");
  useEffect(() => {
    const stored = window.localStorage.getItem(PERIOD_STORAGE_KEY);
    if (isBooksPeriod(stored)) setPeriod(stored);
  }, []);
  const handlePeriodChange = useCallback((p: BooksPeriod) => {
    setPeriod(p);
    window.localStorage.setItem(PERIOD_STORAGE_KEY, p);
  }, []);

  // ── Drill state (ledger strip → filtered segment + rose chip) ─────────
  const [drilled, setDrilled] = useState(false);

  const drillOverdue = useCallback(() => {
    setDrilled(true);
    // "overdue" is the date-based virtual filter (any open balance past its
    // due date) — the A/R tile counts by date, and most overdue invoices sit
    // in sent/awaiting_payment/partially_paid, never the past_due enum.
    updateParams({ segment: "invoices", status: "overdue", view: null });
  }, [updateParams]);

  const clearDrill = useCallback(() => {
    setDrilled(false);
    updateParams({ status: null });
  }, [updateParams]);

  // ── Status filters (lifted to the URL; D10 honors widget deep links) ──
  const invoiceStatusFilter: "all" | "overdue" | InvoiceStatus = useMemo(() => {
    if (statusParam === "overdue") return "overdue";
    const values = Object.values(InvoiceStatus) as string[];
    return statusParam && values.includes(statusParam) ? (statusParam as InvoiceStatus) : "all";
  }, [statusParam]);

  const estimateStatusFilter: "all" | EstimateStatus = useMemo(() => {
    const values = Object.values(EstimateStatus) as string[];
    return statusParam && values.includes(statusParam) ? (statusParam as EstimateStatus) : "all";
  }, [statusParam]);

  // ── Views ─────────────────────────────────────────────────────────────
  const invoicesView: InvoicesView = viewParam === "aging" ? "aging" : "list";
  const syncView: SyncView = viewParam === "import" ? "import" : "connections";

  // ── Counts for the segment control ────────────────────────────────────
  const { data: invoices = [] } = useInvoices();
  const { data: estimates = [] } = useEstimates();
  const { data: batches = [] } = useExpenseBatches();
  const reviewCount = useMemo(
    () => batches.filter((b) => isBatchNeedsReview(b.status)).length,
    [batches],
  );

  const segmentOptions = useMemo<BooksSegmentOption<BooksSegment>[]>(() => {
    const counts: Partial<Record<BooksSegment, number>> = {
      invoices: invoices.length,
      estimates: estimates.length,
      expenses: reviewCount,
    };
    return visibleSegments.map((s) => ({
      value: s,
      label: t(`segment.${s}`),
      count: counts[s],
    }));
  }, [visibleSegments, invoices.length, estimates.length, reviewCount, t]);

  const handleSegmentChange = useCallback(
    (segment: BooksSegment) => {
      setDrilled(false);
      updateParams({ segment, view: null, status: null, action: null });
    },
    [updateParams],
  );

  // ── Top-chase client name resolver for the A/R tile ───────────────────
  const { data: clientsData } = useClients();
  const clientName = useCallback(
    (clientId: string) => clientsData?.clients.find((c) => c.id === clientId)?.name,
    [clientsData],
  );

  // ── Render ────────────────────────────────────────────────────────────
  const segmentControl = activeSegment ? (
    <BooksSegmentControl
      options={segmentOptions}
      value={activeSegment}
      onChange={handleSegmentChange}
    />
  ) : null;

  const showStrip = can("accounting.view");
  const openCreate = actionParam === "new";
  const handleCreateHandled = useCallback(() => updateParams({ action: null }), [updateParams]);

  return (
    <div className="space-y-3">
      {showStrip && (
        <LedgerStrip
          period={period}
          onPeriodChange={handlePeriodChange}
          onDrillOverdue={can("invoices.view") ? drillOverdue : undefined}
          clientName={clientName}
        />
      )}

      {activeSegment === "invoices" && (
        <InvoicesSegment
          segmentControl={segmentControl}
          listAllowed={can("invoices.view")}
          view={invoicesView}
          onViewChange={(view) => updateParams({ view: view === "aging" ? "aging" : null })}
          statusFilter={invoiceStatusFilter}
          onStatusFilterChange={(status) => {
            setDrilled(false);
            updateParams({ status: status === "all" ? null : status });
          }}
          drilled={drilled}
          onClearDrill={clearDrill}
          openCreate={openCreate}
          onCreateHandled={handleCreateHandled}
        />
      )}

      {activeSegment === "estimates" && (
        <EstimatesSegment
          segmentControl={segmentControl}
          statusFilter={estimateStatusFilter}
          onStatusFilterChange={(status) => {
            setDrilled(false);
            updateParams({ status: status === "all" ? null : status });
          }}
          drilled={drilled}
          onClearDrill={clearDrill}
          openCreate={openCreate}
          onCreateHandled={handleCreateHandled}
        />
      )}

      {activeSegment === "expenses" && <ExpensesSegment segmentControl={segmentControl} />}

      {activeSegment === "sync" && (
        <SyncSegment
          segmentControl={segmentControl}
          view={syncView}
          onViewChange={(view) =>
            updateParams({ view: view === "import" ? "import" : null })
          }
        />
      )}

      {/* No visible segment: the route gate should prevent this, but never
          render a blank canvas — show the tactical empty state. (Suppressed
          during the one-frame localStorage hydration.) */}
      {segmentHydrated && !activeSegment && (
        <div className="flex flex-col items-start py-8">
          <span className="font-mono text-micro uppercase tracking-[0.16em] text-text-3">
            <span className="text-text-mute">{"// "}</span>
            {t("ledger.noData")}
          </span>
        </div>
      )}
    </div>
  );
}
