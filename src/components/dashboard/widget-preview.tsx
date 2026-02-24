"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import type { WidgetSize, WidgetTypeId } from "@/lib/types/dashboard-widgets";
import {
  WIDGET_TYPE_REGISTRY,
  WIDGET_SIZE_LABELS,
  getDefaultConfig,
} from "@/lib/types/dashboard-widgets";

// Widget components — same imports as page.tsx
import { StatWidget } from "@/components/dashboard/widgets/stat-widget";
import { CalendarWidget } from "@/components/dashboard/widgets/calendar-widget";
import { CrewWidget } from "@/components/dashboard/widgets/crew-status-widget";
import { TaskListWidget } from "@/components/dashboard/widgets/task-list-widget";
import { ActivityWidget } from "@/components/dashboard/widgets/activity-feed-widget";
import { PipelineWidget } from "@/components/dashboard/widgets/pipeline-funnel-widget";
import { RevenueWidget } from "@/components/dashboard/widgets/revenue-chart-widget";
import { AlertsWidget } from "@/components/dashboard/widgets/action-bar-widget";
import { InvoiceListWidget } from "@/components/dashboard/widgets/invoice-list-widget";
import { InvoiceAgingWidget } from "@/components/dashboard/widgets/invoice-aging-widget";
import { PaymentsRecentWidget } from "@/components/dashboard/widgets/payments-recent-widget";
import { ExpenseSummaryWidget } from "@/components/dashboard/widgets/expense-summary-widget";
import { PipelineListWidget } from "@/components/dashboard/widgets/pipeline-list-widget";
import { PipelineValueWidget } from "@/components/dashboard/widgets/pipeline-value-widget";
import { PipelineVelocityWidget } from "@/components/dashboard/widgets/pipeline-velocity-widget";
import { PipelineSourcesWidget } from "@/components/dashboard/widgets/pipeline-sources-widget";
import { ClientListWidget } from "@/components/dashboard/widgets/client-list-widget";
import { ClientRevenueWidget } from "@/components/dashboard/widgets/client-revenue-widget";
import { ClientActivityWidget } from "@/components/dashboard/widgets/client-activity-widget";
import { ClientAttentionWidget } from "@/components/dashboard/widgets/client-attention-widget";
import { EstimatesOverviewWidget } from "@/components/dashboard/widgets/estimates-overview-widget";
import { EstimatesFunnelWidget } from "@/components/dashboard/widgets/estimates-funnel-widget";
import { OverdueTasksWidget } from "@/components/dashboard/widgets/overdue-tasks-widget";
import { PastDueInvoicesWidget } from "@/components/dashboard/widgets/past-due-invoices-widget";
import { NotificationsWidget } from "@/components/dashboard/widgets/notifications-widget";
import { FollowUpsDueWidget } from "@/components/dashboard/widgets/follow-ups-due-widget";
import { SiteVisitsWidget } from "@/components/dashboard/widgets/site-visits-widget";
import { CrewLocationsWidget } from "@/components/dashboard/widgets/crew-locations-widget";
import { ClientRankingWidget, ProjectRankingWidget } from "@/components/dashboard/widgets/ranking-widget";

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
    // ── STAT WIDGETS (self-contained) ──
    case "stat-projects":
    case "stat-tasks":
    case "stat-events":
    case "stat-clients":
    case "stat-team":
    case "stat-revenue":
    case "stat-invoices":
    case "stat-estimates":
    case "stat-opportunities":
    // Per-status projects
    case "stat-projects-rfq":
    case "stat-projects-estimated":
    case "stat-projects-accepted":
    case "stat-projects-in-progress":
    case "stat-projects-completed":
    // Per-status tasks
    case "stat-tasks-booked":
    case "stat-tasks-in-progress":
    case "stat-tasks-completed":
    case "stat-tasks-overdue":
    // Client segment
    case "stat-clients-active":
    // Financial
    case "stat-receivables":
    case "stat-collect":
      return <StatWidget typeId={typeId} size={size} config={config} />;

    // ── RANKING WIDGETS ──
    case "stat-client-ranking":
      return <ClientRankingWidget size={size} config={config} />;
    case "stat-project-ranking":
      return <ProjectRankingWidget size={size} config={config} />;

    // ── SCHEDULE (need data props → pass empty) ──
    case "calendar":
      return <CalendarWidget size={size} events={[]} isLoading={false} onNavigate={noop} />;
    case "task-list":
      return <TaskListWidget size={size} tasks={[]} isLoading={false} today={PREVIEW_TODAY} onNavigate={noop} />;

    // ── TEAM (need data props → pass empty) ──
    case "crew-status":
      return <CrewWidget size={size} teamMembers={[]} isLoading={false} onNavigate={noop} />;
    case "crew-locations":
      return <CrewLocationsWidget size={size} />;

    // ── PIPELINE ──
    case "pipeline-funnel":
      return <PipelineWidget size={size} projects={[]} isLoading={false} onNavigate={noop} />;
    case "pipeline-list":
      return <PipelineListWidget size={size} config={config} />;
    case "pipeline-value":
      return <PipelineValueWidget size={size} />;
    case "pipeline-velocity":
      return <PipelineVelocityWidget size={size} />;
    case "pipeline-sources":
      return <PipelineSourcesWidget size={size} />;

    // ── FINANCIAL ──
    case "revenue-chart":
      return <RevenueWidget size={size} />;
    case "invoice-list":
      return <InvoiceListWidget size={size} config={config} />;
    case "invoice-aging":
      return <InvoiceAgingWidget size={size} />;
    case "payments-recent":
      return <PaymentsRecentWidget size={size} />;
    case "expense-summary":
      return <ExpenseSummaryWidget size={size} config={config} />;

    // ── CLIENTS ──
    case "client-list":
      return <ClientListWidget size={size} config={config} />;
    case "client-revenue":
      return <ClientRevenueWidget size={size} config={config} />;
    case "client-activity":
      return <ClientActivityWidget size={size} />;
    case "client-attention":
      return <ClientAttentionWidget size={size} />;

    // ── ESTIMATES ──
    case "estimates-overview":
      return <EstimatesOverviewWidget size={size} config={config} />;
    case "estimates-funnel":
      return <EstimatesFunnelWidget size={size} />;

    // ── ACTIVITY ──
    case "activity-feed":
      return <ActivityWidget />;
    case "follow-ups-due":
      return <FollowUpsDueWidget size={size} />;
    case "site-visits":
      return <SiteVisitsWidget size={size} config={config} />;

    // ── ALERTS (need data props → pass stubs) ──
    case "action-bar":
      return (
        <AlertsWidget
          activeProjectCount={0}
          weekEventCount={0}
          teamMemberCount={0}
          isDataLoading={false}
          onNavigate={noop}
        />
      );
    case "overdue-tasks":
      return <OverdueTasksWidget size={size} />;
    case "past-due-invoices":
      return <PastDueInvoicesWidget size={size} />;
    case "notifications":
      return <NotificationsWidget size={size} config={config} />;

    default:
      return (
        <div className="h-full rounded-lg bg-background-card border border-border p-2 flex items-center justify-center">
          <span className="font-mono text-[9px] text-text-disabled">{typeId}</span>
        </div>
      );
  }
}

// Scale factor for the miniature preview
const PREVIEW_SCALE = 0.45;

// Approximate pixel dimensions for each widget size at full scale
const SIZE_DIMENSIONS: Record<WidgetSize, { width: number; height: number }> = {
  xs: { width: 140, height: 140 },
  sm: { width: 280, height: 140 },
  md: { width: 560, height: 140 },
  lg: { width: 560, height: 280 },
  full: { width: 1120, height: 140 },
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
                    ? "bg-ops-accent-muted border-ops-accent text-text-primary"
                    : "border-transparent text-text-disabled hover:text-text-secondary"
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
        className="rounded-md overflow-hidden border border-border/50"
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
      <p className="font-mohave text-[11px] text-text-secondary leading-tight mt-[4px] truncate">
        {entry.label}
      </p>
    </div>
  );
}
