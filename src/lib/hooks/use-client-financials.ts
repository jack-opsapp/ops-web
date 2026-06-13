/**
 * OPS Web — Client financial + activity aggregates (WEB OVERHAUL P3.3)
 *
 * Derived, cache-shared hooks for the rebuilt Clients surface. None of these
 * issue their own queries — they compose the existing `useInvoices`,
 * `useClientProjects`, and `useClientOpportunitiesWon` caches so a client's
 * money + timeline cost nothing beyond data already in flight.
 *
 * DB note (verified prod, ops-app): invoices link to clients via `client_id`
 * (NOT `client_ref`, which is 100% NULL). The mapped `Invoice.clientId` is
 * `client_id`, so grouping by it is correct. Soft-deleted invoices are already
 * excluded by `InvoiceService.fetchAllInvoices` (includeDeleted defaults off).
 */

import { useMemo } from "react";
import { useInvoices } from "./use-invoices";
import { useClientProjects } from "./use-client-projects";
import { useClientOpportunitiesWon } from "./use-client-opportunities";
import { usePermissionStore } from "../store/permissions-store";
import { InvoiceStatus, type Invoice } from "../types/pipeline";

// Statuses that carry a collectable balance. Mirrors the prod-verified
// outstanding set: everything except settled (paid), uncollectable
// (void / written_off), and not-yet-owed (draft).
const OUTSTANDING_STATUSES: ReadonlySet<InvoiceStatus> = new Set([
  InvoiceStatus.Sent,
  InvoiceStatus.AwaitingPayment,
  InvoiceStatus.PartiallyPaid,
  InvoiceStatus.PastDue,
]);

function isOutstanding(status: InvoiceStatus): boolean {
  return OUTSTANDING_STATUSES.has(status);
}

// ─── Per-client outstanding (list OUTSTANDING column + A/R banner) ───────────

export interface ClientOutstanding {
  /** Sum of balance_due across this client's unpaid invoices. */
  outstanding: number;
  /** Number of unpaid invoices. */
  openCount: number;
  /** Earliest due date among unpaid invoices (drives "oldest Nd"). */
  oldestDueDate: Date | null;
}

export interface ClientOutstandingResult {
  /** clientId → outstanding rollup. Absent key = nothing owed. */
  map: Map<string, ClientOutstanding>;
  totals: {
    /** Count of clients with a non-zero balance. */
    clientsOwing: number;
    /** Company-wide sum of outstanding balance. */
    amount: number;
    /** Earliest unpaid due date company-wide (drives the banner). */
    oldestDueDate: Date | null;
  };
  isLoading: boolean;
  /** False when the operator lacks invoices.view — hide money UI entirely. */
  canView: boolean;
}

export function useClientOutstandingMap(): ClientOutstandingResult {
  const canView = usePermissionStore((s) => s.can("invoices.view"));
  const { data: invoices, isLoading } = useInvoices();

  return useMemo<ClientOutstandingResult>(() => {
    const map = new Map<string, ClientOutstanding>();
    let amount = 0;
    let oldestDueDate: Date | null = null;

    for (const inv of invoices ?? []) {
      if (!inv.clientId || !isOutstanding(inv.status) || inv.balanceDue <= 0) {
        continue;
      }
      const entry = map.get(inv.clientId) ?? {
        outstanding: 0,
        openCount: 0,
        oldestDueDate: null,
      };
      entry.outstanding += inv.balanceDue;
      entry.openCount += 1;
      if (!entry.oldestDueDate || inv.dueDate < entry.oldestDueDate) {
        entry.oldestDueDate = inv.dueDate;
      }
      map.set(inv.clientId, entry);

      amount += inv.balanceDue;
      if (!oldestDueDate || inv.dueDate < oldestDueDate) {
        oldestDueDate = inv.dueDate;
      }
    }

    return {
      map,
      totals: { clientsOwing: map.size, amount, oldestDueDate },
      isLoading,
      canView,
    };
  }, [invoices, isLoading, canView]);
}

// ─── Per-client financial summary (MONEY tab) ────────────────────────────────

export interface ClientFinancials {
  invoiced: number;
  paid: number;
  outstanding: number;
  overdueCount: number;
  overdueBalance: number;
  invoiceCount: number;
  /** Non-deleted invoices for this client, newest issue date first. */
  invoices: Invoice[];
  isLoading: boolean;
  canView: boolean;
}

export function useClientFinancials(
  clientId: string | null | undefined,
): ClientFinancials {
  const canView = usePermissionStore((s) => s.can("invoices.view"));
  const { data: invoices, isLoading } = useInvoices(
    clientId ? { clientId } : undefined,
  );

  return useMemo<ClientFinancials>(() => {
    const rows = clientId ? (invoices ?? []) : [];
    let invoiced = 0;
    let paid = 0;
    let outstanding = 0;
    let overdueCount = 0;
    let overdueBalance = 0;

    for (const inv of rows) {
      // "Invoiced" = issued-and-valid only (drop drafts + voids).
      if (inv.status !== InvoiceStatus.Void && inv.status !== InvoiceStatus.Draft) {
        invoiced += inv.total;
      }
      paid += inv.amountPaid;
      if (isOutstanding(inv.status)) outstanding += inv.balanceDue;
      if (inv.status === InvoiceStatus.PastDue) {
        overdueCount += 1;
        overdueBalance += inv.balanceDue;
      }
    }

    const sorted = [...rows].sort(
      (a, b) => b.issueDate.getTime() - a.issueDate.getTime(),
    );

    return {
      invoiced,
      paid,
      outstanding,
      overdueCount,
      overdueBalance,
      invoiceCount: rows.length,
      invoices: sorted,
      isLoading: clientId ? isLoading : false,
      canView,
    };
  }, [clientId, invoices, isLoading, canView]);
}

// ─── Client activity timeline (ACTIVITY tab) ─────────────────────────────────

export type ClientActivityKind =
  | "project_created"
  | "invoice_sent"
  | "payment"
  | "past_due"
  | "won";

export interface ClientActivityEvent {
  id: string;
  date: Date;
  kind: ClientActivityKind;
  /** Subject of the event — project title / invoice number / opportunity title. */
  ref: string;
  /** Money amount where the event carries one (payment, won). */
  amount?: number;
}

export interface ClientActivityResult {
  events: ClientActivityEvent[];
  isLoading: boolean;
}

/**
 * Unified, newest-first client timeline composed from projects, invoices, and
 * won opportunities. Real composition over existing caches — not a placeholder.
 */
export function useClientActivity(
  clientId: string | null | undefined,
): ClientActivityResult {
  const projectsQ = useClientProjects(clientId);
  const wonQ = useClientOpportunitiesWon(clientId);
  const canView = usePermissionStore((s) => s.can("invoices.view"));
  const { data: invoices, isLoading: invoicesLoading } = useInvoices(
    clientId ? { clientId } : undefined,
  );

  return useMemo<ClientActivityResult>(() => {
    const events: ClientActivityEvent[] = [];

    for (const p of projectsQ.data ?? []) {
      if (p.createdAt) {
        events.push({
          id: `project:${p.id}`,
          date: p.createdAt,
          kind: "project_created",
          ref: p.title,
        });
      }
    }

    for (const inv of invoices ?? []) {
      if (inv.sentAt) {
        events.push({
          id: `inv-sent:${inv.id}`,
          date: inv.sentAt,
          kind: "invoice_sent",
          ref: inv.invoiceNumber,
        });
      }
      if (inv.paidAt) {
        events.push({
          id: `inv-paid:${inv.id}`,
          date: inv.paidAt,
          kind: "payment",
          ref: inv.invoiceNumber,
          amount: inv.total,
        });
      }
    }

    for (const o of wonQ.data ?? []) {
      if (o.actualCloseDate) {
        events.push({
          id: `won:${o.id}`,
          date: o.actualCloseDate,
          kind: "won",
          ref: o.title,
          amount: o.actualValue ?? o.estimatedValue ?? undefined,
        });
      }
    }

    events.sort((a, b) => b.date.getTime() - a.date.getTime());

    return {
      events,
      isLoading:
        projectsQ.isLoading || wonQ.isLoading || (canView && invoicesLoading),
    };
  }, [
    projectsQ.data,
    projectsQ.isLoading,
    wonQ.data,
    wonQ.isLoading,
    invoices,
    invoicesLoading,
    canView,
  ]);
}
