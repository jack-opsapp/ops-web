"use client";

import { useCallback, useRef, useState, memo, type MouseEvent } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Minus, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import {
  useInvoiceDetailPopoverStore,
  type InvoicePopoverTab,
  type InvoiceDetailPopoverState,
} from "@/stores/invoice-detail-popover-store";
import { useInvoice } from "@/lib/hooks/use-invoices";
import { useClientMap } from "@/lib/hooks/use-clients";
import {
  INVOICE_STATUS_COLORS,
  InvoiceStatus,
  formatCurrency,
} from "@/lib/types/pipeline";
import type { Invoice, LineItem, Payment } from "@/lib/types/pipeline";

// ── Easing ──
const EASE_SMOOTH: [number, number, number, number] = [0.22, 1, 0.36, 1];

// ── Tab definitions ──
const TABS: { id: InvoicePopoverTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "payments", label: "Payments" },
  { id: "activity", label: "Activity" },
];

// ── Helpers ──
function getInvoiceStatusName(status: InvoiceStatus): string {
  const names: Record<InvoiceStatus, string> = {
    [InvoiceStatus.Draft]: "Draft",
    [InvoiceStatus.Sent]: "Sent",
    [InvoiceStatus.AwaitingPayment]: "Awaiting Payment",
    [InvoiceStatus.PartiallyPaid]: "Partially Paid",
    [InvoiceStatus.PastDue]: "Past Due",
    [InvoiceStatus.Paid]: "Paid",
    [InvoiceStatus.Void]: "Void",
    [InvoiceStatus.WrittenOff]: "Written Off",
  };
  return names[status] ?? status;
}

function getDaysSinceIssued(invoice: Invoice): number {
  const issued = invoice.issueDate ? new Date(invoice.issueDate) : new Date();
  const now = new Date();
  const diffMs = now.getTime() - issued.getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

function formatDate(date: Date | null | undefined): string | null {
  if (!date) return null;
  return new Date(date).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getPaymentMethodName(method: string | null): string | null {
  if (!method) return null;
  const names: Record<string, string> = {
    credit_card: "Credit Card",
    debit_card: "Debit Card",
    ach: "ACH",
    cash: "Cash",
    check: "Check",
    bank_transfer: "Bank Transfer",
    stripe: "Stripe",
    other: "Other",
  };
  return names[method] ?? method;
}

// ── Instance component ──

interface InvoiceDetailPopoverInstanceProps {
  state: InvoiceDetailPopoverState;
}

const InvoiceDetailPopoverInstance = memo(function InvoiceDetailPopoverInstance({
  state,
}: InvoiceDetailPopoverInstanceProps) {
  const reduced = useReducedMotion();

  const {
    closePopover,
    focusPopover,
    minimizePopover,
    updatePosition,
    updateSize,
    setActiveTab,
  } = useInvoiceDetailPopoverStore();

  const { data: invoice } = useInvoice(state.id);
  const clientMap = useClientMap();
  const clientName = invoice
    ? clientMap.get(invoice.clientId)?.name ?? ""
    : "";

  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0 });

  const statusColor = invoice
    ? INVOICE_STATUS_COLORS[invoice.status]
    : state.color;

  // ── Drag handling (title bar) ──
  const handleDragStart = useCallback(
    (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest("button")) return;
      e.preventDefault();
      focusPopover(state.id);
      setIsDragging(true);
      dragOffset.current = {
        x: e.clientX - state.position.x,
        y: e.clientY - state.position.y,
      };

      const handleMouseMove = (moveEvent: globalThis.MouseEvent) => {
        const newX = Math.max(
          0,
          Math.min(
            moveEvent.clientX - dragOffset.current.x,
            globalThis.innerWidth - state.size.width
          )
        );
        const newY = Math.max(
          0,
          Math.min(
            moveEvent.clientY - dragOffset.current.y,
            globalThis.innerHeight - state.size.height
          )
        );
        updatePosition(state.id, { x: newX, y: newY });
      };

      const handleMouseUp = () => {
        setIsDragging(false);
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [
      state.id,
      state.position,
      state.size.width,
      state.size.height,
      focusPopover,
      updatePosition,
    ]
  );

  // ── Resize handling (bottom-right corner) ──
  const handleResizeStart = useCallback(
    (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      focusPopover(state.id);
      setIsResizing(true);
      resizeStart.current = {
        x: e.clientX,
        y: e.clientY,
        w: state.size.width,
        h: state.size.height,
      };

      const handleMouseMove = (moveEvent: globalThis.MouseEvent) => {
        const dw = moveEvent.clientX - resizeStart.current.x;
        const dh = moveEvent.clientY - resizeStart.current.y;
        updateSize(state.id, {
          width: resizeStart.current.w + dw,
          height: resizeStart.current.h + dh,
        });
      };

      const handleMouseUp = () => {
        setIsResizing(false);
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [state.id, state.size, focusPopover, updateSize]
  );

  if (state.isMinimized) return null;

  return (
    <motion.div
      initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.2, ease: EASE_SMOOTH }}
      className={cn(
        "fixed flex flex-col overflow-hidden",
        "bg-[rgba(10,10,10,0.70)] backdrop-blur-[20px] saturate-[1.2]",
        "border border-[rgba(255,255,255,0.08)] rounded-[4px]",
        (isDragging || isResizing) && "select-none"
      )}
      style={{
        left: state.position.x,
        top: state.position.y,
        width: state.size.width,
        height: state.size.height,
        zIndex: state.zIndex,
      }}
      onMouseDown={() => focusPopover(state.id)}
    >
      {/* ── Title bar ── */}
      <div
        className="flex items-center justify-between px-3 py-2 border-b border-[rgba(255,255,255,0.06)] cursor-grab shrink-0"
        onMouseDown={handleDragStart}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div
            className="w-1.5 h-1.5 rounded-[1px] shrink-0"
            style={{ backgroundColor: statusColor }}
          />
          <span className="font-mohave text-[13px] font-semibold text-text truncate">
            {state.title}
          </span>
        </div>
        <div className="flex items-center gap-[2px] shrink-0 ml-2">
          <button
            onClick={() => minimizePopover(state.id)}
            className="w-5 h-5 rounded-[2px] flex items-center justify-center text-text-3 hover:text-text-2 hover:bg-[rgba(255,255,255,0.06)] transition-colors"
          >
            <Minus className="w-3 h-3" />
          </button>
          <button
            onClick={() => closePopover(state.id)}
            className="w-5 h-5 rounded-[2px] flex items-center justify-center text-text-3 hover:text-ops-error hover:bg-ops-error-muted transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* ── Info strip ── */}
      <div className="px-3 py-1.5 border-b border-[rgba(255,255,255,0.06)] shrink-0 space-y-1">
        {/* Row 1: Client name */}
        <div className="flex items-center gap-2 min-w-0">
          {clientName ? (
            <span className="font-kosugi text-[10px] text-text-3 truncate">
              {clientName}
            </span>
          ) : (
            <span className="font-kosugi text-[10px] text-text-mute">
              No client
            </span>
          )}
        </div>

        {/* Row 2: Status + days since issued */}
        <div className="flex items-center gap-1.5">
          <span
            className="font-kosugi text-[9px] uppercase tracking-wide"
            style={{ color: statusColor }}
          >
            {invoice
              ? getInvoiceStatusName(invoice.status)
              : state.title}
          </span>
          {invoice && (
            <span className="font-kosugi text-[9px] text-text-mute">
              · {getDaysSinceIssued(invoice)}d
            </span>
          )}
        </div>
      </div>

      {/* ── Tab bar ── */}
      <div className="flex items-center border-b border-[rgba(255,255,255,0.06)] shrink-0">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(state.id, tab.id)}
            className={cn(
              "px-3 py-2 font-mohave text-[11px] uppercase tracking-[0.5px] transition-colors relative",
              tab.id === state.activeTab
                ? "text-text"
                : "text-text-mute hover:text-text-2"
            )}
          >
            {tab.label}
            {tab.id === state.activeTab && (
              <div className="absolute bottom-0 left-3 right-3 h-[2px] bg-ops-accent" />
            )}
          </button>
        ))}
      </div>

      {/* ── Tab content ── */}
      <div className="flex-1 overflow-y-auto scrollbar-hide p-3">
        {state.activeTab === "overview" && invoice && (
          <InvoiceOverviewTab invoice={invoice} clientName={clientName} />
        )}
        {state.activeTab === "payments" && invoice && (
          <InvoicePaymentsTab payments={invoice.payments} />
        )}
        {state.activeTab === "activity" && (
          <div className="flex items-center justify-center h-full">
            <span className="font-kosugi text-micro text-text-mute uppercase">
              Activity — coming soon
            </span>
          </div>
        )}
      </div>

      {/* ── Resize handle (bottom-right) ── */}
      <div
        className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
        onMouseDown={handleResizeStart}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          className="opacity-15 hover:opacity-30 transition-opacity absolute bottom-[2px] right-[2px]"
        >
          <line x1="12" y1="4" x2="4" y2="12" stroke="white" strokeWidth="1" />
          <line x1="12" y1="8" x2="8" y2="12" stroke="white" strokeWidth="1" />
        </svg>
      </div>
    </motion.div>
  );
});

// ── Overview tab ──

function InvoiceOverviewTab({
  invoice,
  clientName,
}: {
  invoice: Invoice;
  clientName: string;
}) {
  const issueDate = formatDate(invoice.issueDate);
  const dueDate = formatDate(invoice.dueDate);
  const sortedLineItems = invoice.lineItems
    ? [...invoice.lineItems].sort((a, b) => a.sortOrder - b.sortOrder)
    : [];

  return (
    <div className="flex flex-col gap-4">
      {/* Dates */}
      {(issueDate || dueDate) && (
        <div>
          <span className="font-kosugi text-micro text-text-mute uppercase tracking-widest">
            Dates
          </span>
          <div className="flex flex-col gap-1 mt-1">
            {issueDate && (
              <div className="flex items-center justify-between">
                <span className="font-mohave text-body-sm text-text-2">
                  Issued
                </span>
                <span className="font-mohave text-body-sm text-text">
                  {issueDate}
                </span>
              </div>
            )}
            {dueDate && (
              <div className="flex items-center justify-between">
                <span className="font-mohave text-body-sm text-text-2">
                  Due
                </span>
                <span className="font-mohave text-body-sm text-text">
                  {dueDate}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Financial summary */}
      <div>
        <span className="font-kosugi text-micro text-text-mute uppercase tracking-widest">
          Summary
        </span>
        <div className="flex flex-col gap-1 mt-1">
          <div className="flex items-center justify-between">
            <span className="font-mohave text-body-sm text-text-2">
              Subtotal
            </span>
            <span className="font-mono text-[12px] text-text">
              {formatCurrency(invoice.subtotal)}
            </span>
          </div>
          {invoice.discountAmount > 0 && (
            <div className="flex items-center justify-between">
              <span className="font-mohave text-body-sm text-text-2">
                Discount
              </span>
              <span className="font-mono text-[12px] text-text">
                -{formatCurrency(invoice.discountAmount)}
              </span>
            </div>
          )}
          {invoice.taxAmount > 0 && (
            <div className="flex items-center justify-between">
              <span className="font-mohave text-body-sm text-text-2">
                Tax
              </span>
              <span className="font-mono text-[12px] text-text">
                {formatCurrency(invoice.taxAmount)}
              </span>
            </div>
          )}
          <div className="flex items-center justify-between border-t border-[rgba(255,255,255,0.06)] pt-1">
            <span className="font-mohave text-body-sm text-text font-bold">
              Total
            </span>
            <span className="font-mono text-[12px] text-text font-bold">
              {formatCurrency(invoice.total)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-mohave text-body-sm text-text-2">
              Amount Paid
            </span>
            <span className="font-mono text-[12px] text-text">
              {formatCurrency(invoice.amountPaid)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-mohave text-body-sm text-text-2">
              Balance Due
            </span>
            <span className="font-mono text-[12px] text-text">
              {formatCurrency(invoice.balanceDue)}
            </span>
          </div>
        </div>
      </div>

      {/* Line items */}
      {sortedLineItems.length > 0 && (
        <div>
          <span className="font-kosugi text-micro text-text-mute uppercase tracking-widest">
            Line Items
          </span>
          <div className="flex flex-col gap-2 mt-1">
            {sortedLineItems.map((item) => (
              <LineItemRow key={item.id} item={item} />
            ))}
          </div>
        </div>
      )}

      {/* Subject / notes */}
      {invoice.subject && (
        <div>
          <span className="font-kosugi text-micro text-text-mute uppercase tracking-widest">
            Subject
          </span>
          <p className="font-mohave text-body-sm text-text-2 mt-1 leading-relaxed">
            {invoice.subject}
          </p>
        </div>
      )}
      {invoice.clientMessage && (
        <div>
          <span className="font-kosugi text-micro text-text-mute uppercase tracking-widest">
            Message
          </span>
          <p className="font-mohave text-body-sm text-text-2 mt-1 leading-relaxed">
            {invoice.clientMessage}
          </p>
        </div>
      )}
      {invoice.internalNotes && (
        <div>
          <span className="font-kosugi text-micro text-text-mute uppercase tracking-widest">
            Internal Notes
          </span>
          <p className="font-mohave text-body-sm text-text-2 mt-1 leading-relaxed">
            {invoice.internalNotes}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Line item row ──

function LineItemRow({ item }: { item: LineItem }) {
  return (
    <div className="flex items-start justify-between gap-2 py-1 border-b border-[rgba(255,255,255,0.04)] last:border-b-0">
      <div className="flex flex-col min-w-0 flex-1">
        <span className="font-mohave text-body-sm text-text truncate">
          {item.name}
        </span>
        <span className="font-mono text-[10px] text-text-mute">
          {item.quantity} x {formatCurrency(item.unitPrice)}
        </span>
      </div>
      <span className="font-mono text-[12px] text-text shrink-0">
        {formatCurrency(item.lineTotal)}
      </span>
    </div>
  );
}

// ── Payments tab ──

function InvoicePaymentsTab({
  payments,
}: {
  payments: Payment[] | undefined;
}) {
  if (!payments || payments.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="font-kosugi text-micro text-text-mute uppercase">
          No payments recorded
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {payments.map((payment) => (
        <PaymentRow key={payment.id} payment={payment} />
      ))}
    </div>
  );
}

// ── Payment row ──

function PaymentRow({ payment }: { payment: Payment }) {
  const date = formatDate(payment.paymentDate);
  const methodName = getPaymentMethodName(
    payment.paymentMethod as string | null
  );

  return (
    <div className="flex flex-col gap-1 py-2 border-b border-[rgba(255,255,255,0.04)] last:border-b-0">
      <div className="flex items-center justify-between">
        {date && (
          <span className="font-mohave text-body-sm text-text-2">
            {date}
          </span>
        )}
        <span className="font-mono text-[12px] text-text">
          {formatCurrency(payment.amount)}
        </span>
      </div>
      {methodName && (
        <span className="font-mohave text-[11px] text-text-3">
          {methodName}
        </span>
      )}
      {payment.referenceNumber && (
        <span className="font-mono text-[10px] text-text-mute">
          {payment.referenceNumber}
        </span>
      )}
    </div>
  );
}

// ── Root renderer ──

export function InvoiceDetailPopover() {
  const popovers = useInvoiceDetailPopoverStore((s) => s.popovers);

  return (
    <AnimatePresence>
      {Array.from(popovers.values()).map((state) => (
        <InvoiceDetailPopoverInstance key={state.id} state={state} />
      ))}
    </AnimatePresence>
  );
}
