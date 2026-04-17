"use client";

import { useCallback, useRef, useState, memo, useMemo, type MouseEvent } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Minus, X, Phone, Mail, MapPin } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useClient } from "@/lib/hooks/use-clients";
import { useProjects } from "@/lib/hooks/use-projects";
import { useInvoices } from "@/lib/hooks/use-invoices";
import { PROJECT_STATUS_COLORS } from "@/lib/types/models";
import type { Project } from "@/lib/types/models";
import {
  INVOICE_STATUS_COLORS,
  InvoiceStatus,
  formatCurrency,
} from "@/lib/types/pipeline";
import type { Invoice } from "@/lib/types/pipeline";
import {
  useClientDetailPopoverStore,
  type ClientPopoverTab,
  type ClientDetailPopoverState,
} from "@/stores/client-detail-popover-store";

// ── Easing ──
const EASE_SMOOTH: [number, number, number, number] = [0.22, 1, 0.36, 1];

// ── Tab definitions ──
const TABS: { id: ClientPopoverTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "projects", label: "Projects" },
  { id: "financial", label: "Financial" },
  { id: "activity", label: "Activity" },
];

// ── Helpers ──
function getStatusName(status: string): string {
  const names: Record<string, string> = {
    RFQ: "RFQ",
    Estimated: "Estimated",
    Accepted: "Accepted",
    "In Progress": "In Progress",
    Completed: "Completed",
    Closed: "Closed",
    Archived: "Archived",
  };
  return names[status] ?? status;
}

function getInvoiceStatusLabel(status: InvoiceStatus): string {
  const labels: Record<InvoiceStatus, string> = {
    [InvoiceStatus.Draft]: "Draft",
    [InvoiceStatus.Sent]: "Sent",
    [InvoiceStatus.AwaitingPayment]: "Awaiting Payment",
    [InvoiceStatus.PartiallyPaid]: "Partially Paid",
    [InvoiceStatus.PastDue]: "Past Due",
    [InvoiceStatus.Paid]: "Paid",
    [InvoiceStatus.Void]: "Void",
    [InvoiceStatus.WrittenOff]: "Written Off",
  };
  return labels[status] ?? status;
}

// ── Instance component ──

const ClientDetailPopoverInstance = memo(function ClientDetailPopoverInstance({
  state,
}: {
  state: ClientDetailPopoverState;
}) {
  const reduced = useReducedMotion();

  const {
    closePopover,
    focusPopover,
    minimizePopover,
    updatePosition,
    updateSize,
    setActiveTab,
  } = useClientDetailPopoverStore();

  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0 });

  // ── Data fetching ──
  const { data: client } = useClient(state.id);
  const { data: projectsData } = useProjects({ clientId: state.id });
  const { data: invoices } = useInvoices({ clientId: state.id });

  const projects = projectsData?.projects ?? [];

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
            style={{ backgroundColor: state.color }}
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
      <div className="px-3 py-1.5 border-b border-[rgba(255,255,255,0.06)] shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {client?.email ? (
            <div className="flex items-center gap-1 text-text-3 min-w-0">
              <Mail className="w-2.5 h-2.5 shrink-0" />
              <span className="font-mono text-micro truncate">
                {client.email}
              </span>
            </div>
          ) : (
            <span className="font-mono text-micro text-text-mute">
              No email
            </span>
          )}
          {client?.phoneNumber && (
            <>
              <span className="font-mono text-micro text-text-mute">
                ·
              </span>
              <div className="flex items-center gap-1 text-text-3 min-w-0">
                <Phone className="w-2.5 h-2.5 shrink-0" />
                <span className="font-mono text-micro truncate">
                  {client.phoneNumber}
                </span>
              </div>
            </>
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
              <div className="absolute bottom-0 left-3 right-3 h-[2px] bg-text-2" />
            )}
          </button>
        ))}
      </div>

      {/* ── Tab content ── */}
      <div className="flex-1 overflow-y-auto scrollbar-hide p-3">
        {state.activeTab === "overview" && (
          <ClientOverviewTab client={client ?? null} />
        )}
        {state.activeTab === "projects" && (
          <ClientProjectsTab projects={projects} />
        )}
        {state.activeTab === "financial" && (
          <ClientFinancialTab invoices={invoices ?? []} />
        )}
        {state.activeTab === "activity" && (
          <div className="flex items-center justify-center h-full">
            <span className="font-mono text-micro text-text-mute uppercase">
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

function ClientOverviewTab({
  client,
}: {
  client: {
    email: string | null;
    phoneNumber: string | null;
    address: string | null;
    notes: string | null;
    createdAt: Date | null;
  } | null;
}) {
  if (!client) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="font-mono text-micro text-text-mute uppercase">
          Loading...
        </span>
      </div>
    );
  }

  const memberSince = client.createdAt
    ? new Date(client.createdAt).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;

  return (
    <div className="flex flex-col gap-4">
      {/* Contact — Email */}
      {client.email && (
        <div>
          <span className="font-mono text-micro text-text-mute uppercase tracking-widest">
            Email
          </span>
          <div className="flex items-center gap-1.5 mt-1">
            <Mail className="w-3 h-3 text-text-3 shrink-0" />
            <a
              href={`mailto:${client.email}`}
              className="font-mohave text-body-sm text-text hover:text-text-2 transition-colors"
            >
              {client.email}
            </a>
          </div>
        </div>
      )}

      {/* Contact — Phone */}
      {client.phoneNumber && (
        <div>
          <span className="font-mono text-micro text-text-mute uppercase tracking-widest">
            Phone
          </span>
          <div className="flex items-center gap-1.5 mt-1">
            <Phone className="w-3 h-3 text-text-3 shrink-0" />
            <a
              href={`tel:${client.phoneNumber}`}
              className="font-mohave text-body-sm text-text hover:text-text-2 transition-colors"
            >
              {client.phoneNumber}
            </a>
          </div>
        </div>
      )}

      {/* Address */}
      {client.address && (
        <div>
          <span className="font-mono text-micro text-text-mute uppercase tracking-widest">
            Address
          </span>
          <div className="flex items-center gap-1.5 mt-1">
            <MapPin className="w-3 h-3 text-text-3 shrink-0" />
            <p className="font-mohave text-body-sm text-text">
              {client.address}
            </p>
          </div>
        </div>
      )}

      {/* Notes */}
      {client.notes && (
        <div>
          <span className="font-mono text-micro text-text-mute uppercase tracking-widest">
            Notes
          </span>
          <p className="font-mohave text-body-sm text-text-2 mt-1 leading-relaxed">
            {client.notes}
          </p>
        </div>
      )}

      {/* Member since */}
      {memberSince && (
        <div>
          <span className="font-mono text-micro text-text-mute uppercase tracking-widest">
            Member Since
          </span>
          <p className="font-mohave text-body-sm text-text mt-1">
            {memberSince}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Projects tab ──

function ClientProjectsTab({ projects }: { projects: Project[] }) {
  if (projects.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="font-mono text-micro text-text-mute uppercase">
          No projects
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {projects.map((project) => (
        <div
          key={project.id}
          className="flex items-center gap-2.5 px-2 py-2 rounded-[2px] hover:bg-[rgba(255,255,255,0.04)] transition-colors"
        >
          <div
            className="w-2 h-2 rounded-full shrink-0"
            style={{
              backgroundColor:
                PROJECT_STATUS_COLORS[project.status] ?? "#9CA3AF",
            }}
          />
          <div className="flex flex-col min-w-0">
            <span className="font-mohave text-body-sm text-text truncate">
              {project.title}
            </span>
            <span className="font-mono text-micro text-text-mute uppercase">
              {getStatusName(project.status)}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Financial tab ──

function ClientFinancialTab({ invoices }: { invoices: Invoice[] }) {
  const summary = useMemo(() => {
    let totalInvoiced = 0;
    let amountPaid = 0;
    let outstanding = 0;

    for (const inv of invoices) {
      totalInvoiced += inv.total;
      amountPaid += inv.amountPaid;
      outstanding += inv.balanceDue;
    }

    return { totalInvoiced, amountPaid, outstanding };
  }, [invoices]);

  const sortedInvoices = useMemo(() => {
    return [...invoices].sort((a, b) => {
      const dateA = a.issueDate ? new Date(a.issueDate).getTime() : 0;
      const dateB = b.issueDate ? new Date(b.issueDate).getTime() : 0;
      return dateB - dateA;
    });
  }, [invoices]);

  if (invoices.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="font-mono text-micro text-text-mute uppercase">
          No invoices
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Summary metrics */}
      <div className="grid grid-cols-3 gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-micro text-text-mute uppercase tracking-widest">
            Invoiced
          </span>
          <span className="font-mono text-[11px] text-text">
            {formatCurrency(summary.totalInvoiced)}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-micro text-text-mute uppercase tracking-widest">
            Paid
          </span>
          <span className="font-mono text-[11px] text-text">
            {formatCurrency(summary.amountPaid)}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-micro text-text-mute uppercase tracking-widest">
            Outstanding
          </span>
          <span className="font-mono text-[11px] text-text">
            {formatCurrency(summary.outstanding)}
          </span>
        </div>
      </div>

      {/* Divider */}
      <div className="border-t border-[rgba(255,255,255,0.06)]" />

      {/* Invoice list */}
      <div className="flex flex-col gap-1">
        {sortedInvoices.map((invoice) => (
          <div
            key={invoice.id}
            className="flex items-center justify-between px-2 py-2 rounded-[2px] hover:bg-[rgba(255,255,255,0.04)] transition-colors"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{
                  backgroundColor:
                    INVOICE_STATUS_COLORS[invoice.status] ?? "#9CA3AF",
                }}
              />
              <div className="flex flex-col min-w-0">
                <span className="font-mono text-[11px] text-text truncate">
                  {invoice.invoiceNumber}
                </span>
                <span className="font-mono text-micro text-text-mute uppercase">
                  {getInvoiceStatusLabel(invoice.status)}
                </span>
              </div>
            </div>
            <span className="font-mono text-[11px] text-text shrink-0 ml-2">
              {formatCurrency(invoice.total)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Root renderer ──

export function ClientDetailPopover() {
  const popovers = useClientDetailPopoverStore((s) => s.popovers);

  return (
    <AnimatePresence>
      {Array.from(popovers.values()).map((state) => (
        <ClientDetailPopoverInstance key={state.id} state={state} />
      ))}
    </AnimatePresence>
  );
}
