"use client";

import { useMemo, useState, useCallback } from "react";
import { Loader2, Send, Check, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { EstimateStatus } from "@/lib/types/pipeline";
import type { Estimate } from "@/lib/types/pipeline";
import { useEstimates, useSendEstimate } from "@/lib/hooks";
import { cn } from "@/lib/utils/cn";
import { useDictionary, useLocale } from "@/i18n/client";
import { getDateLocale } from "@/i18n/date-utils";
import type { Locale } from "@/i18n/types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface EstimatesOverviewWidgetProps {
  size: WidgetSize;
  config: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type StatusFilter = "all" | "draft" | "sent" | "viewed" | "approved" | "expired";

const STATUS_FILTER_LABEL: Record<StatusFilter, string> = {
  all: "All",
  draft: "Draft",
  sent: "Sent",
  viewed: "Viewed",
  approved: "Approved",
  expired: "Expired",
};

function matchesFilter(estimate: Estimate, filter: StatusFilter): boolean {
  if (filter === "all") return true;
  const map: Record<string, EstimateStatus> = {
    draft: EstimateStatus.Draft,
    sent: EstimateStatus.Sent,
    viewed: EstimateStatus.Viewed,
    approved: EstimateStatus.Approved,
    expired: EstimateStatus.Expired,
  };
  return estimate.status === map[filter];
}

function statusBadgeClasses(status: EstimateStatus): string {
  switch (status) {
    case EstimateStatus.Draft:
      return "text-text-disabled bg-text-disabled/15";
    case EstimateStatus.Sent:
      return "text-ops-accent bg-ops-accent/15";
    case EstimateStatus.Viewed:
      return "text-ops-amber bg-ops-amber/15";
    case EstimateStatus.Approved:
      return "text-status-success bg-status-success/15";
    case EstimateStatus.Expired:
      return "text-ops-error bg-ops-error/15";
    case EstimateStatus.ChangesRequested:
      return "text-ops-amber bg-ops-amber/15";
    case EstimateStatus.Declined:
      return "text-ops-error bg-ops-error/15";
    case EstimateStatus.Converted:
      return "text-status-success bg-status-success/15";
    case EstimateStatus.Superseded:
      return "text-text-disabled bg-text-disabled/15";
    default:
      return "text-text-disabled bg-text-disabled/15";
  }
}

function statusLabel(status: EstimateStatus, t: (key: string) => string): string {
  switch (status) {
    case EstimateStatus.Draft:
      return t("estimatesOverview.statusDraft");
    case EstimateStatus.Sent:
      return t("estimatesOverview.statusSent");
    case EstimateStatus.Viewed:
      return t("estimatesOverview.statusViewed");
    case EstimateStatus.Approved:
      return t("estimatesOverview.statusApproved");
    case EstimateStatus.Expired:
      return t("estimatesOverview.statusExpired");
    case EstimateStatus.ChangesRequested:
      return t("estimatesOverview.statusChanges");
    case EstimateStatus.Declined:
      return t("estimatesOverview.statusDeclined");
    case EstimateStatus.Converted:
      return t("estimatesOverview.statusConverted");
    case EstimateStatus.Superseded:
      return t("estimatesOverview.statusSuperseded");
    default:
      return status;
  }
}

function formatCurrency(amount: number, locale: Locale): string {
  return amount.toLocaleString(getDateLocale(locale), {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(date: Date | string, locale: Locale): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString(getDateLocale(locale), { month: "short", day: "numeric" });
}

function isExpiringWithin7Days(estimate: Estimate): boolean {
  if (!estimate.expirationDate) return false;
  if (
    estimate.status === EstimateStatus.Approved ||
    estimate.status === EstimateStatus.Converted ||
    estimate.status === EstimateStatus.Expired ||
    estimate.status === EstimateStatus.Superseded ||
    estimate.status === EstimateStatus.Declined
  ) {
    return false;
  }
  const expDate =
    typeof estimate.expirationDate === "string"
      ? new Date(estimate.expirationDate)
      : estimate.expirationDate;
  const now = new Date();
  const sevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  return expDate > now && expDate <= sevenDays;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EstimatesOverviewWidget({
  size,
  config,
}: EstimatesOverviewWidgetProps) {
  const { t } = useDictionary("dashboard");
  const { locale } = useLocale();
  const filter = (config.statusFilter as StatusFilter) ?? "all";
  const { data: estimates, isLoading } = useEstimates();

  const statusFilterLabel: Record<StatusFilter, string> = {
    all: t("estimatesOverview.filterAll"),
    draft: t("estimatesOverview.filterDraft"),
    sent: t("estimatesOverview.filterSent"),
    viewed: t("estimatesOverview.filterViewed"),
    approved: t("estimatesOverview.filterApproved"),
    expired: t("estimatesOverview.filterExpired"),
  };

  const filtered = useMemo(() => {
    if (!estimates) return [];
    return estimates
      .filter((est) => !est.deletedAt && matchesFilter(est, filter))
      .sort((a, b) => {
        const aDate = typeof a.createdAt === "string" ? new Date(a.createdAt).getTime() : a.createdAt.getTime();
        const bDate = typeof b.createdAt === "string" ? new Date(b.createdAt).getTime() : b.createdAt.getTime();
        return bDate - aDate;
      });
  }, [estimates, filter]);

  const totalValue = useMemo(
    () => filtered.reduce((sum, est) => sum + est.total, 0),
    [filtered]
  );

  // ── SM: Count + total value ──────────────────────────────────────────────
  if (size === "sm") {
    return (
      <Card className="p-2 h-full flex flex-col">
        <CardHeader className="pb-1 shrink-0">
          <CardTitle className="text-card-subtitle">
            {t("estimatesOverview.title").replace("{filter}", statusFilterLabel[filter])}
          </CardTitle>
        </CardHeader>
        <CardContent className="py-0 flex-1 overflow-y-auto min-h-0 scrollbar-hide">
          {isLoading ? (
            <div className="flex items-center gap-1">
              <Loader2 className="w-[14px] h-[14px] text-text-disabled animate-spin" />
              <span className="font-mono text-[11px] text-text-disabled">
                {t("estimatesOverview.loading")}
              </span>
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              <span className="font-mono text-data-lg text-text-primary">
                {filtered.length}
              </span>
              <span className="font-mono text-[11px] text-text-tertiary">
                {formatCurrency(totalValue, locale)}
              </span>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // ── MD / LG: List with send button ───────────────────────────────────────
  const maxItems = size === "lg" ? 7 : 3;

  return (
    <Card className="p-2 h-full flex flex-col">
      <CardHeader className="pb-1.5 shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-card-subtitle">
            {t("estimatesOverview.title").replace("{filter}", statusFilterLabel[filter])}
          </CardTitle>
          <span className="font-mono text-[11px] text-text-tertiary">
            {isLoading
              ? "..."
              : `${filtered.length} \u00B7 ${formatCurrency(totalValue, locale)}`}
          </span>
        </div>
      </CardHeader>
      <CardContent className="py-0 flex-1 overflow-y-auto min-h-0 scrollbar-hide">
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-[16px] h-[16px] text-text-disabled animate-spin" />
            <span className="font-mono text-[11px] text-text-disabled ml-1">
              {t("estimatesOverview.loadingEstimates")}
            </span>
          </div>
        ) : filtered.length === 0 ? (
          <p className="font-mohave text-body-sm text-text-disabled py-2">
            {t("estimatesOverview.noEstimates").replace("{filter}", statusFilterLabel[filter].toLowerCase())}
          </p>
        ) : (
          <div className="space-y-[6px]">
            {filtered.slice(0, maxItems).map((estimate) => (
              <EstimateRow
                key={estimate.id}
                estimate={estimate}
                showExpiration={size === "lg"}
              />
            ))}
            {filtered.length > maxItems && (
              <span className="font-mono text-[11px] text-text-disabled block px-1">
                {t("estimatesOverview.more").replace("{count}", String(filtered.length - maxItems))}
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Estimate Row with one-click send
// ---------------------------------------------------------------------------

function EstimateRow({
  estimate,
  showExpiration,
}: {
  estimate: Estimate;
  showExpiration: boolean;
}) {
  const { t } = useDictionary("dashboard");
  const { locale } = useLocale();
  const sendEstimate = useSendEstimate();
  const [sendState, setSendState] = useState<"idle" | "sending" | "sent">(
    "idle"
  );

  const handleSend = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (sendState !== "idle") return;
      setSendState("sending");
      sendEstimate.mutate(estimate.id, {
        onSuccess: () => {
          setSendState("sent");
          setTimeout(() => setSendState("idle"), 2000);
        },
        onError: () => {
          setSendState("idle");
        },
      });
    },
    [estimate.id, sendState, sendEstimate]
  );

  const displayName = estimate.title ?? estimate.estimateNumber;
  const isDraft = estimate.status === EstimateStatus.Draft;
  const expiring = showExpiration && isExpiringWithin7Days(estimate);

  return (
    <div
      className={cn(
        "flex items-center gap-1 px-1 py-[7px] rounded hover:bg-[rgba(255,255,255,0.04)] cursor-pointer transition-colors group",
        expiring && "ring-1 ring-ops-amber/30"
      )}
    >
      {/* Title / client info */}
      <div className="flex-1 min-w-0">
        <p className="font-mohave text-body-sm text-text-primary truncate">
          {displayName}
        </p>
        <div className="flex items-center gap-1">
          <span className="font-mono text-[11px] text-text-tertiary">
            {formatDate(estimate.issueDate, locale)}
          </span>
          {expiring && (
            <span className="flex items-center gap-0.5">
              <AlertTriangle className="w-[10px] h-[10px] text-ops-amber" />
              <span className="font-mono text-[10px] text-ops-amber">
                {t("estimatesOverview.expiringSoon")}
              </span>
            </span>
          )}
        </div>
      </div>

      {/* Amount */}
      <span className="font-mono text-[11px] text-text-secondary shrink-0">
        {formatCurrency(estimate.total, locale)}
      </span>

      {/* Status badge */}
      <span
        className={cn(
          "font-mohave text-status px-1.5 py-[1px] rounded-full shrink-0",
          statusBadgeClasses(estimate.status)
        )}
      >
        {statusLabel(estimate.status, t)}
      </span>

      {/* One-click Send (draft only) */}
      {isDraft && (
        <button
          onClick={handleSend}
          disabled={sendState !== "idle"}
          className={cn(
            "shrink-0 flex items-center gap-0.5 px-1.5 py-[2px] rounded transition-all duration-200",
            "text-text-secondary hover:text-ops-accent hover:bg-ops-accent/10",
            sendState === "sent" && "text-status-success"
          )}
          title={t("estimatesOverview.sendEstimate")}
        >
          {sendState === "sending" ? (
            <Loader2 className="w-[12px] h-[12px] animate-spin" />
          ) : sendState === "sent" ? (
            <Check className="w-[12px] h-[12px]" />
          ) : (
            <>
              <Send className="w-[12px] h-[12px]" />
              <span className="font-mohave text-[12px]">{t("estimatesOverview.send")}</span>
            </>
          )}
        </button>
      )}
    </div>
  );
}
