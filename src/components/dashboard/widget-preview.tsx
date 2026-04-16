"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import type { WidgetSize, WidgetTypeId } from "@/lib/types/dashboard-widgets";
import {
  WIDGET_TYPE_REGISTRY,
  WIDGET_SIZE_LABELS,
  getDefaultConfig,
} from "@/lib/types/dashboard-widgets";

// New/redesigned widgets
import { RevenuePulseWidget } from "@/components/dashboard/widgets/revenue-pulse-widget";
import { ReceivablesAgingWidget } from "@/components/dashboard/widgets/receivables-aging-widget";
import { ProfitGaugeWidget } from "@/components/dashboard/widgets/profit-gauge-widget";
import { ExpenseTrackerWidget } from "@/components/dashboard/widgets/expense-tracker-widget";
import { CashPositionWidget } from "@/components/dashboard/widgets/cash-position-widget";
import { PipelineFunnelWidget } from "@/components/dashboard/widgets/pipeline-funnel-widget";
import { WinRateWidget } from "@/components/dashboard/widgets/win-rate-widget";
import { BacklogDepthWidget } from "@/components/dashboard/widgets/backlog-depth-widget";
import { BookingRateWidget } from "@/components/dashboard/widgets/booking-rate-widget";
import { TaskPulseWidget } from "@/components/dashboard/widgets/task-pulse-widget";
import { TodaysScheduleWidget } from "@/components/dashboard/widgets/todays-schedule-widget";
import { CrewBoardWidget } from "@/components/dashboard/widgets/crew-board-widget";
import { TopClientsWidget } from "@/components/dashboard/widgets/top-clients-widget";
import { ActionRequiredWidget } from "@/components/dashboard/widgets/action-required-widget";
import { LeadSourcesWidget } from "@/components/dashboard/widgets/lead-sources-widget";
// Kept widgets
import { TaskListWidget } from "@/components/dashboard/widgets/task-list-widget";
import { InvoiceListWidget } from "@/components/dashboard/widgets/invoice-list-widget";
import { PaymentsRecentWidget } from "@/components/dashboard/widgets/payments-recent-widget";
import { EstimatesOverviewWidget } from "@/components/dashboard/widgets/estimates-overview-widget";
import { PipelineListWidget } from "@/components/dashboard/widgets/pipeline-list-widget";
import { ClientListWidget } from "@/components/dashboard/widgets/client-list-widget";
import { ClientAttentionWidget } from "@/components/dashboard/widgets/client-attention-widget";
import { ActivityWidget } from "@/components/dashboard/widgets/activity-feed-widget";
import { NotificationsWidget } from "@/components/dashboard/widgets/notifications-widget";
import { ExpenseReviewWidget } from "@/components/dashboard/widgets/expense-review-widget";
import { MyExpensesWidget } from "@/components/dashboard/widgets/my-expenses-widget";

// No-op navigate for preview
const noop = () => {};

// Stub date for preview
const PREVIEW_TODAY = new Date();

/**
 * Renders actual widget content with empty/stub data for preview purposes.
 * Self-contained widgets use their internal hooks normally.
 * Data-passed widgets get empty arrays so they show their empty states.
 */
function renderPreviewContent(typeId: WidgetTypeId, size: WidgetSize): ReactNode {
  const config = getDefaultConfig(typeId);

  switch (typeId) {
    // ── MONEY ──
    case "revenue-pulse":
      return <RevenuePulseWidget size={size} config={config} invoices={[]} isLoading={false} onNavigate={noop} />;
    case "receivables-aging":
      return <ReceivablesAgingWidget size={size} invoices={[]} isLoading={false} onNavigate={noop} />;
    case "profit-gauge":
      return <ProfitGaugeWidget size={size} config={config} invoices={[]} expenses={[]} isLoading={false} />;
    case "expense-tracker":
      return <ExpenseTrackerWidget size={size} config={config} expenses={[]} isLoading={false} onNavigate={noop} />;
    case "cash-position":
      return <CashPositionWidget size={size} config={config} invoices={[]} expenses={[]} isLoading={false} onNavigate={noop} />;
    case "invoice-list":
      return <InvoiceListWidget size={size} config={config} />;
    case "payments-recent":
      return <PaymentsRecentWidget size={size} />;
    case "my-expenses":
      return <MyExpensesWidget size={size} config={config} isLoading={false} onNavigate={noop} />;

    // ── PIPELINE ──
    case "pipeline-funnel":
      return <PipelineFunnelWidget size={size} projects={[]} isLoading={false} onNavigate={noop} />;
    case "win-rate":
      return <WinRateWidget size={size} config={config} estimates={[]} isLoading={false} onNavigate={noop} />;
    case "backlog-depth":
      return <BacklogDepthWidget size={size} projects={[]} isLoading={false} onNavigate={noop} />;
    case "booking-rate":
      return <BookingRateWidget size={size} projects={[]} isLoading={false} onNavigate={noop} />;
    case "estimates-overview":
      return <EstimatesOverviewWidget size={size} config={config} />;
    case "pipeline-list":
      return <PipelineListWidget size={size} config={config} />;
    case "lead-sources":
      return <LeadSourcesWidget size={size} opportunities={[]} isLoading={false} onNavigate={noop} />;

    // ── OPERATIONS ──
    case "task-pulse":
      return <TaskPulseWidget size={size} tasks={[]} isLoading={false} onNavigate={noop} />;
    case "todays-schedule":
      return <TodaysScheduleWidget size={size} config={config} events={[]} isLoading={false} onNavigate={noop} />;
    case "task-list":
      return <TaskListWidget size={size} tasks={[]} isLoading={false} today={PREVIEW_TODAY} onNavigate={noop} />;
    case "crew-board":
      return <CrewBoardWidget size={size} teamMembers={[]} tasks={[]} isLoading={false} onNavigate={noop} />;

    // ── CLIENTS ──
    case "top-clients":
      return <TopClientsWidget size={size} config={config} clients={[]} invoices={[]} projects={[]} isLoading={false} onNavigate={noop} />;
    case "client-attention":
      return <ClientAttentionWidget size={size} />;
    case "client-list":
      return <ClientListWidget size={size} config={config} />;

    // ── ALERTS & ACTIVITY ──
    case "action-required":
      return <ActionRequiredWidget size={size} tasks={[]} invoices={[]} opportunities={[]} estimates={[]} isLoading={false} onNavigate={noop} />;
    case "activity-feed":
      return <ActivityWidget size={size} config={config} onNavigate={noop} />;
    case "notifications":
      return <NotificationsWidget size={size} config={config} />;
    case "expense-review":
      return <ExpenseReviewWidget size={size} isLoading={false} onNavigate={noop} />;

    default:
      return (
        <div className="h-full rounded-lg bg-background-card border border-border p-2 flex items-center justify-center">
          <span className="font-mono text-[9px] text-text-mute">{typeId}</span>
        </div>
      );
  }
}

// Scale factor for the miniature preview
const PREVIEW_SCALE = 0.6;

// Approximate pixel dimensions for each widget size at full scale
const SIZE_DIMENSIONS: Record<WidgetSize, { width: number; height: number }> = {
  xs: { width: 140, height: 140 },
  sm: { width: 280, height: 140 },
  md: { width: 560, height: 280 },
  lg: { width: 560, height: 560 },
  xl: { width: 560, height: 840 },
};

interface WidgetPreviewProps {
  typeId: WidgetTypeId;
}

export function WidgetPreview({ typeId }: WidgetPreviewProps) {
  const entry = WIDGET_TYPE_REGISTRY[typeId];
  const [previewSize, setPreviewSize] = useState<WidgetSize>(entry?.defaultSize ?? "sm");

  if (!entry) return null;

  const hasMultipleSizes = entry.supportedSizes.length > 1;

  const dims = SIZE_DIMENSIONS[previewSize];
  const scaledWidth = dims.width * PREVIEW_SCALE;
  const scaledHeight = dims.height * PREVIEW_SCALE;

  return (
    <div className="flex flex-col" style={{ width: scaledWidth }}>
      {/* Size pills — top right */}
      {hasMultipleSizes && (
        <div
          className="flex items-center gap-[3px] justify-end mb-[4px]"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {entry.supportedSizes.map((s: WidgetSize) => {
            const isSelected = previewSize === s;
            return (
              <button
                key={s}
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  setPreviewSize(s);
                }}
                className={cn(
                  "px-[6px] py-[1px] rounded-sm font-mono text-[8px] border transition-all duration-150",
                  isSelected
                    ? "bg-ops-accent-muted border-ops-accent text-text"
                    : "border-transparent text-text-mute hover:text-text-2"
                )}
              >
                {WIDGET_SIZE_LABELS[s]}
              </button>
            );
          })}
        </div>
      )}

      {/* Scaled preview container */}
      <div
        className="rounded-md overflow-hidden"
        style={{ width: scaledWidth, height: scaledHeight }}
      >
        <div
          className="origin-top-left pointer-events-none"
          style={{
            width: dims.width,
            height: dims.height,
            transform: `scale(${PREVIEW_SCALE})`,
          }}
        >
          {renderPreviewContent(typeId, previewSize)}
        </div>
      </div>

      {/* Label */}
      <p className="font-mohave text-[11px] text-text-2 leading-tight mt-[4px] truncate">
        {entry.label}
      </p>
    </div>
  );
}
