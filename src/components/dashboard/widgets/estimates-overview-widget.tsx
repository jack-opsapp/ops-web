"use client";

import { useMemo, useState, useCallback, useRef } from "react";
import { Loader2, Send, Check } from "lucide-react";
import { Card } from "@/components/ui/card";
import { WidgetLineItem } from "./shared/widget-line-item";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import { useReducedMotion } from "./shared/use-reduced-motion";
import { WT } from "@/lib/widget-tokens";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { EstimateStatus } from "@/lib/types/pipeline";
import type { Estimate } from "@/lib/types/pipeline";
import { getStatusLabel } from "./shared/widget-utils";
import { useEstimates, useSendEstimate, useClientMap } from "@/lib/hooks";
import { cn } from "@/lib/utils/cn";
import { useDictionary, useLocale } from "@/i18n/client";
import { getDateLocale } from "@/i18n/date-utils";
import type { Locale } from "@/i18n/types";
import { ScrollFade } from "./shared/scroll-fade";
import { WidgetMoreButton } from "./shared/widget-more-button";
import { WidgetTrendContext } from "./shared/widget-trend-context";

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

function getEstimateBarColor(status: EstimateStatus): string {
  switch (status) {
    case EstimateStatus.Draft:
    case EstimateStatus.Expired:
    case EstimateStatus.Superseded:
      return WT.muted;
    case EstimateStatus.Sent:
      return WT.accent;
    case EstimateStatus.Viewed:
    case EstimateStatus.ChangesRequested:
      return WT.warning;
    case EstimateStatus.Approved:
    case EstimateStatus.Converted:
      return WT.success;
    case EstimateStatus.Declined:
      return WT.error;
    default:
      return WT.muted;
  }
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
  const ref = useRef<HTMLDivElement>(null);
  const isVisible = useWidgetIntersection(ref);
  const reducedMotion = useReducedMotion();
  const filter = (config.statusFilter as StatusFilter) ?? "all";
  const { data: rawEstimates, isLoading } = useEstimates();
  const clientMap = useClientMap();

  const estimates = useMemo(() => {
    if (!rawEstimates) return [] as Estimate[];
    if (clientMap.size === 0) return rawEstimates;
    return rawEstimates.map((est) => {
      if (est.client?.name) return est;
      const c = clientMap.get(est.clientId);
      return c ? { ...est, client: c as Estimate["client"] } : est;
    });
  }, [rawEstimates, clientMap]);

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

  // ── SM: Hero + title + total value ──────────────────────────────────────
  if (size === "sm") {
    return (
      <Card className="h-full p-0">
        <div className="h-full flex flex-col p-3">
          <span className="font-mono text-data-lg font-bold leading-none text-text">
            {isLoading ? "—" : filtered.length}
          </span>
          <span className="font-kosugi text-micro text-text-3 uppercase tracking-wider mt-1">
            {t("estimatesOverview.title").replace("{filter}", statusFilterLabel[filter])}
          </span>
          <WidgetTrendContext variant="snapshot" label={t("trend.pending") ?? "Pending"} />
          {!isLoading && (
            <span className="font-mono text-micro text-text-3 mt-0.5">
              {formatCurrency(totalValue, locale)}
            </span>
          )}
        </div>
      </Card>
    );
  }

  // ── MD / LG: List with send button ───────────────────────────────────────
  const [listExpanded, setListExpanded] = useState(false);
  const defaultMax = size === "lg" ? 15 : 5;
  const maxItems = listExpanded ? filtered.length : defaultMax;
  const remaining = filtered.length - defaultMax;

  return (
    <Card className="h-full p-0" ref={ref}>
      <div className="h-full flex flex-col p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="font-kosugi text-micro uppercase tracking-wider text-text-3">
            {t("estimatesOverview.title").replace("{filter}", statusFilterLabel[filter])}
          </span>
          <span className="font-mono text-micro text-text-3">
            {isLoading
              ? "..."
              : `${filtered.length} \u00B7 ${formatCurrency(totalValue, locale)}`}
          </span>
        </div>
        <div className="flex-1 min-h-0 flex flex-col">
          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-[16px] h-[16px] text-text-mute animate-spin" />
              <span className="font-mono text-micro text-text-mute ml-1">
                {t("estimatesOverview.loadingEstimates")}
              </span>
            </div>
          ) : filtered.length === 0 ? (
            <p className="font-mohave text-body-sm text-text-mute py-2">
              {t("estimatesOverview.noEstimates").replace("{filter}", statusFilterLabel[filter].toLowerCase())}
            </p>
          ) : listExpanded ? (
            <ScrollFade>
              <div className="space-y-[2px]">
                {filtered.map((estimate, i) => (
                  <EstimateRow
                    key={estimate.id}
                    estimate={estimate}
                    showExpiration={size === "lg"}
                    index={i}
                    isVisible={isVisible}
                    reducedMotion={reducedMotion}
                  />
                ))}
              </div>
              <WidgetMoreButton remaining={remaining} expanded={listExpanded} onToggle={() => setListExpanded((v) => !v)} className="mt-1" />
            </ScrollFade>
          ) : (
            <div className="flex-1 flex flex-col min-h-0">
              <div className="space-y-[2px]">
                {filtered.slice(0, maxItems).map((estimate, i) => (
                  <EstimateRow
                    key={estimate.id}
                    estimate={estimate}
                    showExpiration={size === "lg"}
                    index={i}
                    isVisible={isVisible}
                    reducedMotion={reducedMotion}
                  />
                ))}
              </div>
              {remaining > 0 && (
                <WidgetMoreButton remaining={remaining} expanded={listExpanded} onToggle={() => setListExpanded((v) => !v)} className="mt-auto pt-1" />
              )}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Estimate Row with one-click send
// ---------------------------------------------------------------------------

function EstimateRow({
  estimate,
  showExpiration,
  index,
  isVisible,
  reducedMotion,
}: {
  estimate: Estimate;
  showExpiration: boolean;
  index: number;
  isVisible: boolean;
  reducedMotion: boolean | null;
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

  // Client name + date in secondary line
  const clientName = estimate.client?.name;
  const dateStr = formatDate(estimate.issueDate, locale);
  const expiringStr = expiring ? ` · ${t("estimatesOverview.expiringSoon")}` : "";
  const secondary = clientName
    ? `${clientName} · ${dateStr}${expiringStr}`
    : `${dateStr}${expiringStr}`;

  // Bar indicator — always shown, color + label from status
  const barColor = expiring ? WT.warning : getEstimateBarColor(estimate.status);
  const statusLabel = getStatusLabel(estimate.status, "estimate", t);

  // Send button — drafts only
  const actionSlot = isDraft ? (
    <button
      onClick={handleSend}
      disabled={sendState !== "idle"}
      className={cn(
        "shrink-0 flex items-center gap-0.5 px-1.5 py-[2px] rounded transition-all duration-200",
        "text-text-2 hover:text-ops-accent hover:bg-ops-accent/10",
        sendState === "sent" && "text-status-success"
      )}
      title={t("estimatesOverview.sendEstimate")}
      aria-label={t("estimatesOverview.sendEstimate")}
    >
      {sendState === "sending" ? (
        <Loader2 className="w-[12px] h-[12px] animate-spin" />
      ) : sendState === "sent" ? (
        <Check className="w-[12px] h-[12px]" />
      ) : (
        <>
          <Send className="w-[12px] h-[12px]" />
          <span className="font-mohave text-micro">{t("estimatesOverview.send")}</span>
        </>
      )}
    </button>
  ) : undefined;

  return (
    <WidgetLineItem
      indicator={{ type: "bar", color: barColor, label: statusLabel }}
      primary={displayName}
      secondary={secondary}
      metric={formatCurrency(estimate.total, locale)}
      badge={{ status: estimate.status, entity: "estimate" }}
      action={actionSlot}
      index={index}
      isVisible={isVisible}
      reducedMotion={reducedMotion}
    />
  );
}
