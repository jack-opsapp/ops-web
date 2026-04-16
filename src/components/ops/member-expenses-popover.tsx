"use client";

import { useCallback, useRef, useState, useMemo, memo, type MouseEvent } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Minus, X, ArrowUpRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils/cn";
import {
  useMemberExpensesPopoverStore,
  type MemberExpensesPopoverState,
} from "@/stores/member-expenses-popover-store";
import { useAllExpenses } from "@/lib/hooks/use-expense-approval";
import { formatCompactCurrency } from "@/components/dashboard/widgets/shared/widget-utils";
import { useDictionary } from "@/i18n/client";

// ── Easing ──
const EASE_SMOOTH: [number, number, number, number] = [0.22, 1, 0.36, 1];

// ── Instance component ──

interface MemberExpensesPopoverInstanceProps {
  state: MemberExpensesPopoverState;
}

const MemberExpensesPopoverInstance = memo(function MemberExpensesPopoverInstance({
  state,
}: MemberExpensesPopoverInstanceProps) {
  const reduced = useReducedMotion();
  const router = useRouter();
  const { t } = useDictionary("dashboard");

  const {
    closePopover,
    focusPopover,
    minimizePopover,
    updatePosition,
    updateSize,
  } = useMemberExpensesPopoverStore();

  // ── Data: filter company expenses to this member ──
  const { data: allExpenses } = useAllExpenses();
  const memberExpenses = useMemo(() => {
    if (!allExpenses) return [];
    return allExpenses
      .filter((e) => {
        if (e.deletedAt) return false;
        if (e.status !== "approved") return false;
        return e.submittedBy === state.id;
      })
      .sort((a, b) => {
        const da = a.expenseDate ? new Date(a.expenseDate).getTime() : 0;
        const db = b.expenseDate ? new Date(b.expenseDate).getTime() : 0;
        return db - da;
      });
  }, [allExpenses, state.id]);

  const totalAmount = useMemo(
    () => memberExpenses.reduce((sum, e) => sum + e.amount, 0),
    [memberExpenses],
  );

  // ── Drag / resize state ──
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0 });

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
            globalThis.innerWidth - state.size.width,
          ),
        );
        const newY = Math.max(
          0,
          Math.min(
            moveEvent.clientY - dragOffset.current.y,
            globalThis.innerHeight - state.size.height,
          ),
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
    [state.id, state.position, state.size.width, state.size.height, focusPopover, updatePosition],
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
    [state.id, state.size, focusPopover, updateSize],
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
        (isDragging || isResizing) && "select-none",
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
          <div className="w-[22px] h-[22px] rounded-full bg-fill-neutral-dim flex items-center justify-center shrink-0">
            <span className="font-kosugi text-[8px] text-text-3 uppercase">
              {state.title.slice(0, 2)}
            </span>
          </div>
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
      <div className="px-3 py-1.5 border-b border-[rgba(255,255,255,0.06)] shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[11px] text-text-2">
            {formatCompactCurrency(totalAmount)}
          </span>
          <span className="font-kosugi text-[9px] text-text-mute">
            · {memberExpenses.length} {memberExpenses.length === 1 ? (t("expenseTracker.popover.item") ?? "item") : (t("expenseTracker.popover.items") ?? "items")}
          </span>
        </div>
      </div>

      {/* ── Expense list ── */}
      <div className="flex-1 overflow-y-auto scrollbar-hide">
        {memberExpenses.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <span className="font-kosugi text-micro text-text-mute uppercase">
              {t("expenseTracker.popover.noExpenses") ?? "No expenses"}
            </span>
          </div>
        ) : (
          memberExpenses.map((expense) => (
            <div
              key={expense.id}
              className="px-3 py-2 flex items-center gap-2 border-b border-[rgba(255,255,255,0.04)] last:border-b-0 hover:bg-[rgba(255,255,255,0.04)] transition-colors cursor-pointer"
              onClick={() => {
                router.push("/accounting");
                closePopover(state.id);
              }}
            >
              <div className="flex-1 min-w-0">
                <p className="font-mohave text-body-sm text-text truncate">
                  {expense.merchantName ?? expense.description ?? (t("expenseTracker.popover.untitled") ?? "Untitled")}
                </p>
                <p className="font-kosugi text-[10px] text-text-mute truncate">
                  {expense.categoryName ?? "\u2014"}
                  {expense.expenseDate && (
                    <> · {new Date(expense.expenseDate).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</>
                  )}
                </p>
              </div>
              <span className="font-mono text-[12px] text-text shrink-0">
                {formatCompactCurrency(expense.amount)}
              </span>
            </div>
          ))
        )}
      </div>

      {/* ── Footer ── */}
      <div className="px-3 py-1.5 border-t border-[rgba(255,255,255,0.06)] shrink-0">
        <button
          onClick={() => {
            router.push("/accounting");
            closePopover(state.id);
          }}
          className="flex items-center gap-1 font-mohave text-[11px] text-text-mute hover:text-ops-accent transition-colors"
        >
          {t("expenseTracker.viewAll") ?? "View Expenses"}
          <ArrowUpRight className="w-[10px] h-[10px]" />
        </button>
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

// ── Root renderer ──

export function MemberExpensesPopover() {
  const popovers = useMemberExpensesPopoverStore((s) => s.popovers);

  return (
    <AnimatePresence>
      {Array.from(popovers.values()).map((state) => (
        <MemberExpensesPopoverInstance key={state.id} state={state} />
      ))}
    </AnimatePresence>
  );
}
