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
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useRouter, useSearchParams } from "next/navigation";
import { usePageTitle } from "@/lib/hooks/use-page-title";
import { useDictionary, useLocale } from "@/i18n/client";
import { getDateLocale } from "@/i18n/date-utils";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { useClients, useEstimates, useExpenseBatches, useInvoices, useInvoiceMetrics } from "@/lib/hooks";
import { formatMetricValue } from "./segment-toolbar";
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
import { scheduleViewVariants, scheduleViewVariantsReduced } from "@/lib/utils/motion";

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
  const reducedMotion = useReducedMotion();

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
  // Optional client seed for ?action=new (client window → NEW INVOICE). Read
  // once, seeds the create form's client field, then strips with `action`.
  const clientParam = searchParams.get("client");

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

  // ── Drill chip (rose "overdue" chip) ──────────────────────────────────
  // A/R overdue is pure URL state now — metric cells flip to their formula, they
  // never navigate. The rose chip surfaces whenever invoices are scoped to
  // overdue (from the status control or a dashboard deep link alike) and clears
  // by dropping the status param. "overdue" is the date-based virtual filter
  // (any open balance past its due date): most overdue invoices sit in
  // sent/awaiting_payment/partially_paid, never the past_due enum.
  const drilled = statusParam === "overdue";

  const clearDrill = useCallback(() => {
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
  // Strip `client` alongside `action` — the segment has already captured the
  // seed into local state by the time this fires, so dropping it here just
  // keeps the URL clean (a lingering seed would re-preselect on the next open).
  const handleCreateHandled = useCallback(
    () => updateParams({ action: null, client: null }),
    [updateParams],
  );

  // The ledger is shared across every segment and PINNED in the TableShell's
  // metrics slot (WEB OVERHAUL P6-2). Build it once here and pass the node down;
  // each segment mounts it as the shell's `metrics` so it never scrolls away.
  // Invoices-only A/R enrichment: the collection-health readouts that folded up
  // out of the retired invoices statline (REWORK 7). Company-wide, all-invoices
  // figures — a semantic match for the A/R cell (always all-open). Gated on the
  // active segment so the shared strip only carries them on the invoices tab.
  const { locale } = useLocale();
  const numLocale = getDateLocale(locale);
  const { data: invoiceMetrics = [] } = useInvoiceMetrics();
  const arExtra = useMemo(() => {
    if (activeSegment !== "invoices" || invoiceMetrics.length === 0) return undefined;
    const find = (needle: string) =>
      invoiceMetrics.find((m) => m.label.toLowerCase().includes(needle));
    const collected = find("revenue") ?? find("collected");
    const collection = find("collection");
    const avgDays = find("days");
    if (!collected && !collection && !avgDays) return undefined;
    return (
      <span className="inline-flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        {collected && (
          <span className="inline-flex items-baseline gap-[5px]">
            <span className="uppercase">{t("stat.collected")}</span>
            <span className="text-olive">{formatMetricValue(collected, numLocale)}</span>
          </span>
        )}
        {collection && (
          <span className="inline-flex items-baseline gap-[5px]">
            <span aria-hidden className="text-text-mute">·</span>
            <span className="uppercase">{t("stat.collectionRate")}</span>
            <span className="text-text-2">{formatMetricValue(collection, numLocale)}</span>
          </span>
        )}
        {avgDays && (
          <span className="inline-flex items-baseline gap-[5px]">
            <span aria-hidden className="text-text-mute">·</span>
            <span className="uppercase">{t("stat.avgShort")}</span>
            <span className="text-text-2">{formatMetricValue(avgDays, numLocale)}</span>
          </span>
        )}
      </span>
    );
  }, [activeSegment, invoiceMetrics, numLocale, t]);

  const ledger = showStrip ? (
    <LedgerStrip
      period={period}
      onPeriodChange={handlePeriodChange}
      clientName={clientName}
      arExtra={arExtra}
    />
  ) : null;

  return (
    // Fixed-viewport: the page never scrolls — each segment's TableShell owns an
    // internal scroll body under the pinned metrics + workbar (WEB OVERHAUL P6-2).
    <div className="flex h-full min-h-0 flex-col">
      {/* Segment body swap — one keyed motion.div per active segment. mode="wait"
          fades the outgoing segment out before the incoming fades in, so only one
          TableShell (and its query subscriptions) mounts at a time. The pinned
          chrome geometry is now constant across all four segments, so the swap
          reads as one surface breathing rather than the chrome jumping. */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={activeSegment ?? "none"}
          className="flex h-full min-h-0 flex-col"
          variants={reducedMotion ? scheduleViewVariantsReduced : scheduleViewVariants}
          initial="enter"
          animate="center"
          exit="exit"
        >
          {activeSegment === "invoices" && (
            <InvoicesSegment
              metrics={ledger}
              segmentControl={segmentControl}
              listAllowed={can("invoices.view")}
              view={invoicesView}
              onViewChange={(view) => updateParams({ view: view === "aging" ? "aging" : null })}
              statusFilter={invoiceStatusFilter}
              onStatusFilterChange={(status) => {
                updateParams({ status: status === "all" ? null : status });
              }}
              drilled={drilled}
              onClearDrill={clearDrill}
              openCreate={openCreate}
              createClientId={clientParam}
              onCreateHandled={handleCreateHandled}
            />
          )}

          {activeSegment === "estimates" && (
            <EstimatesSegment
              metrics={ledger}
              segmentControl={segmentControl}
              statusFilter={estimateStatusFilter}
              onStatusFilterChange={(status) => {
                updateParams({ status: status === "all" ? null : status });
              }}
              drilled={drilled}
              onClearDrill={clearDrill}
              openCreate={openCreate}
              onCreateHandled={handleCreateHandled}
            />
          )}

          {activeSegment === "expenses" && (
            <ExpensesSegment metrics={ledger} segmentControl={segmentControl} />
          )}

          {activeSegment === "sync" && (
            <SyncSegment
              metrics={ledger}
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
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
