"use client";

import { useCallback, useRef, useState, memo, type MouseEvent } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Minus, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useEstimate } from "@/lib/hooks/use-estimates";
import { useClientMap } from "@/lib/hooks/use-clients";
import {
  useEstimateDetailPopoverStore,
  type EstimatePopoverTab,
  type EstimateDetailPopoverState,
} from "@/stores/estimate-detail-popover-store";
import {
  ESTIMATE_STATUS_COLORS,
  EstimateStatus,
  DiscountType,
  formatCurrency,
} from "@/lib/types/pipeline";
import type { Estimate, LineItem } from "@/lib/types/pipeline";

// ── Easing ──
const EASE_SMOOTH: [number, number, number, number] = [0.22, 1, 0.36, 1];

// ── Tab definitions ──
const TABS: { id: EstimatePopoverTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "activity", label: "Activity" },
];

// ── Helpers ──

function getEstimateStatusName(status: EstimateStatus): string {
  const names: Record<EstimateStatus, string> = {
    [EstimateStatus.Draft]: "Draft",
    [EstimateStatus.Sent]: "Sent",
    [EstimateStatus.Viewed]: "Viewed",
    [EstimateStatus.Approved]: "Approved",
    [EstimateStatus.ChangesRequested]: "Changes Requested",
    [EstimateStatus.Declined]: "Declined",
    [EstimateStatus.Converted]: "Converted",
    [EstimateStatus.Expired]: "Expired",
    [EstimateStatus.Superseded]: "Superseded",
  };
  return names[status] ?? status;
}

function getDaysSinceIssued(estimate: Estimate): number {
  const issued = estimate.issueDate
    ? new Date(estimate.issueDate)
    : new Date();
  const now = new Date();
  const diffMs = now.getTime() - issued.getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

function formatDate(date: Date | string | null | undefined): string | null {
  if (!date) return null;
  return new Date(date).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ── Instance component ──

interface EstimateDetailPopoverInstanceProps {
  state: EstimateDetailPopoverState;
}

const EstimateDetailPopoverInstance = memo(
  function EstimateDetailPopoverInstance({
    state,
  }: EstimateDetailPopoverInstanceProps) {
    const reduced = useReducedMotion();
    const { data: estimate } = useEstimate(state.id);
    const clientMap = useClientMap();

    const {
      closePopover,
      focusPopover,
      minimizePopover,
      updatePosition,
      updateSize,
      setActiveTab,
    } = useEstimateDetailPopoverStore();

    const [isDragging, setIsDragging] = useState(false);
    const [isResizing, setIsResizing] = useState(false);
    const dragOffset = useRef({ x: 0, y: 0 });
    const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0 });

    const statusColor = estimate
      ? ESTIMATE_STATUS_COLORS[estimate.status]
      : state.color;
    const clientName = estimate
      ? (clientMap.get(estimate.clientId)?.name ?? "")
      : "";
    const daysSinceIssued = estimate ? getDaysSinceIssued(estimate) : 0;

    // ── Drag handling (title bar) — document addEventListener pattern ──
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
          "bg-glass glass-surface backdrop-blur-[20px] saturate-[1.2]",
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
              <span className="font-kosugi text-micro text-text-3 truncate">
                {clientName}
              </span>
            ) : (
              <span className="font-kosugi text-micro text-text-mute">
                No client
              </span>
            )}
          </div>

          {/* Row 2: Status + days since issued */}
          <div className="flex items-center gap-1.5">
            <span
              className="font-kosugi text-micro uppercase tracking-wide"
              style={{ color: statusColor }}
            >
              {estimate
                ? getEstimateStatusName(estimate.status)
                : state.title}
            </span>
            <span className="font-kosugi text-micro text-text-mute">
              · {daysSinceIssued}d
            </span>
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
          {state.activeTab === "overview" && estimate && (
            <EstimateOverviewTab estimate={estimate} clientName={clientName} />
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
            <line
              x1="12"
              y1="4"
              x2="4"
              y2="12"
              stroke="white"
              strokeWidth="1"
            />
            <line
              x1="12"
              y1="8"
              x2="8"
              y2="12"
              stroke="white"
              strokeWidth="1"
            />
          </svg>
        </div>
      </motion.div>
    );
  }
);

// ── Overview tab ──

function EstimateOverviewTab({
  estimate,
  clientName,
}: {
  estimate: Estimate;
  clientName: string;
}) {
  const issueDateFormatted = formatDate(estimate.issueDate);
  const expirationDateFormatted = formatDate(estimate.expirationDate);

  const hasDiscount =
    estimate.discountAmount !== 0 &&
    estimate.discountType !== null &&
    estimate.discountValue !== null;

  const hasTax =
    estimate.taxRate !== null &&
    estimate.taxRate !== 0 &&
    estimate.taxAmount !== 0;

  const hasDeposit =
    estimate.depositAmount !== null && estimate.depositAmount !== 0;

  const sortedLineItems = estimate.lineItems
    ? [...estimate.lineItems].sort((a, b) => a.sortOrder - b.sortOrder)
    : [];

  return (
    <div className="flex flex-col gap-4">
      {/* Title */}
      {estimate.title && (
        <div>
          <span className="font-kosugi text-micro text-text-mute uppercase tracking-widest">
            Title
          </span>
          <p className="font-mohave text-body-sm text-text mt-1">
            {estimate.title}
          </p>
        </div>
      )}

      {/* Dates */}
      {(issueDateFormatted || expirationDateFormatted) && (
        <div>
          <span className="font-kosugi text-micro text-text-mute uppercase tracking-widest">
            Dates
          </span>
          <div className="flex flex-col gap-0.5 mt-1">
            {issueDateFormatted && (
              <div className="flex items-center gap-2">
                <span className="font-kosugi text-micro text-text-mute uppercase tracking-wide w-16 shrink-0">
                  Issued
                </span>
                <span className="font-mohave text-body-sm text-text">
                  {issueDateFormatted}
                </span>
              </div>
            )}
            {expirationDateFormatted && (
              <div className="flex items-center gap-2">
                <span className="font-kosugi text-micro text-text-mute uppercase tracking-wide w-16 shrink-0">
                  Expires
                </span>
                <span className="font-mohave text-body-sm text-text">
                  {expirationDateFormatted}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Financial summary */}
      <div>
        <span className="font-kosugi text-micro text-text-mute uppercase tracking-widest">
          Financial
        </span>
        <div className="flex flex-col gap-0.5 mt-1">
          {/* Subtotal */}
          <div className="flex items-center justify-between">
            <span className="font-mohave text-body-sm text-text-2">
              Subtotal
            </span>
            <span className="font-mono text-body-sm text-text">
              {formatCurrency(estimate.subtotal)}
            </span>
          </div>

          {/* Discount */}
          {hasDiscount && (
            <div className="flex items-center justify-between">
              <span className="font-mohave text-body-sm text-text-2">
                Discount
                {estimate.discountType === DiscountType.Percentage &&
                  estimate.discountValue !== null && (
                    <span className="text-text-mute ml-1">
                      ({estimate.discountValue}%)
                    </span>
                  )}
              </span>
              <span className="font-mono text-body-sm text-text">
                -{formatCurrency(estimate.discountAmount)}
              </span>
            </div>
          )}

          {/* Tax */}
          {hasTax && (
            <div className="flex items-center justify-between">
              <span className="font-mohave text-body-sm text-text-2">
                Tax
                {estimate.taxRate !== null && (
                  <span className="text-text-mute ml-1">
                    ({estimate.taxRate}%)
                  </span>
                )}
              </span>
              <span className="font-mono text-body-sm text-text">
                {formatCurrency(estimate.taxAmount)}
              </span>
            </div>
          )}

          {/* Total */}
          <div className="flex items-center justify-between pt-1 border-t border-[rgba(255,255,255,0.06)]">
            <span className="font-mohave text-body-sm font-semibold text-text">
              Total
            </span>
            <span className="font-mono text-body-sm font-semibold text-text">
              {formatCurrency(estimate.total)}
            </span>
          </div>

          {/* Deposit */}
          {hasDeposit && (
            <div className="flex items-center justify-between pt-0.5">
              <span className="font-mohave text-body-sm text-text-2">
                Deposit required
              </span>
              <span className="font-mono text-body-sm text-text">
                {formatCurrency(estimate.depositAmount!)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Line items */}
      {sortedLineItems.length > 0 && (
        <div>
          <span className="font-kosugi text-micro text-text-mute uppercase tracking-widest">
            Line Items
          </span>
          <div className="flex flex-col gap-1.5 mt-1">
            {sortedLineItems.map((item) => (
              <LineItemRow key={item.id} item={item} />
            ))}
          </div>
        </div>
      )}

      {/* Client message */}
      {estimate.clientMessage && (
        <div>
          <span className="font-kosugi text-micro text-text-mute uppercase tracking-widest">
            Client Message
          </span>
          <p className="font-mohave text-body-sm text-text-2 mt-1 leading-relaxed">
            {estimate.clientMessage}
          </p>
        </div>
      )}

      {/* Terms */}
      {estimate.terms && (
        <div>
          <span className="font-kosugi text-micro text-text-mute uppercase tracking-widest">
            Terms
          </span>
          <p className="font-mohave text-body-sm text-text-2 mt-1 leading-relaxed">
            {estimate.terms}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Line item row ──

function LineItemRow({ item }: { item: LineItem }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="flex flex-col min-w-0 flex-1">
        <span className="font-mohave text-body-sm text-text truncate">
          {item.name}
          {item.isOptional && (
            <span className="font-mohave text-body-sm text-text-mute ml-1">
              (optional)
            </span>
          )}
        </span>
        <span className="font-kosugi text-micro text-text-mute">
          {item.quantity} {item.unit} x{" "}
          <span className="font-mono">{formatCurrency(item.unitPrice)}</span>
        </span>
      </div>
      <span className="font-mono text-body-sm text-text shrink-0">
        {formatCurrency(item.lineTotal)}
      </span>
    </div>
  );
}

// ── Root renderer — maps over all open popovers, wraps in AnimatePresence ──

export function EstimateDetailPopover() {
  const popovers = useEstimateDetailPopoverStore((s) => s.popovers);

  return (
    <AnimatePresence>
      {Array.from(popovers.values()).map((state) => (
        <EstimateDetailPopoverInstance key={state.id} state={state} />
      ))}
    </AnimatePresence>
  );
}
