"use client";

import { useMemo } from "react";
import { Loader2, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import type { Client } from "@/lib/types/models";
import { InvoiceStatus, EstimateStatus } from "@/lib/types/pipeline";
import type { Invoice, Estimate } from "@/lib/types/pipeline";
import { useClients, useInvoices, useEstimates } from "@/lib/hooks";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ClientAttentionWidgetProps {
  size: WidgetSize;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AttentionReason = "past-due-invoice" | "estimate-expiring";

interface AttentionClient {
  clientId: string;
  clientName: string;
  reasons: AttentionReason[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function reasonLabel(reason: AttentionReason, t: (key: string) => string): string {
  switch (reason) {
    case "past-due-invoice":
      return t("clientAttention.pastDueInvoice");
    case "estimate-expiring":
      return t("clientAttention.estimateExpiring");
  }
}

function reasonBadgeClasses(reason: AttentionReason): string {
  switch (reason) {
    case "past-due-invoice":
      return "text-ops-error bg-ops-error/10";
    case "estimate-expiring":
      return "text-ops-amber bg-ops-amber/10";
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ClientAttentionWidget({ size }: ClientAttentionWidgetProps) {
  const { t } = useDictionary("dashboard");
  const { data: clientsData, isLoading: clientsLoading } = useClients();
  const { data: invoices, isLoading: invoicesLoading } = useInvoices();
  const { data: estimates, isLoading: estimatesLoading } = useEstimates();

  const isLoading = clientsLoading || invoicesLoading || estimatesLoading;

  // Build client name lookup
  const clientNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    if (!clientsData?.clients) return map;
    for (const c of clientsData.clients) {
      map[c.id] = c.name;
    }
    return map;
  }, [clientsData]);

  // Identify clients needing attention
  const attentionClients = useMemo(() => {
    const reasonsMap: Record<string, Set<AttentionReason>> = {};

    // Clients with past-due invoices
    if (invoices) {
      for (const inv of invoices) {
        if (inv.deletedAt) continue;
        if (inv.status === InvoiceStatus.PastDue) {
          if (!reasonsMap[inv.clientId]) {
            reasonsMap[inv.clientId] = new Set();
          }
          reasonsMap[inv.clientId].add("past-due-invoice");
        }
      }
    }

    // Clients with estimates expiring in next 7 days
    if (estimates) {
      const now = new Date();
      const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

      for (const est of estimates) {
        if (est.deletedAt) continue;
        if (
          est.status === EstimateStatus.Approved ||
          est.status === EstimateStatus.Converted ||
          est.status === EstimateStatus.Declined ||
          est.status === EstimateStatus.Expired ||
          est.status === EstimateStatus.Superseded
        ) {
          continue;
        }
        if (!est.expirationDate) continue;

        const expDate =
          typeof est.expirationDate === "string"
            ? new Date(est.expirationDate)
            : est.expirationDate;

        if (expDate > now && expDate <= sevenDaysFromNow) {
          if (!reasonsMap[est.clientId]) {
            reasonsMap[est.clientId] = new Set();
          }
          reasonsMap[est.clientId].add("estimate-expiring");
        }
      }
    }

    const result: AttentionClient[] = Object.entries(reasonsMap).map(
      ([clientId, reasons]) => ({
        clientId,
        clientName: clientNameMap[clientId] ?? t("clientAttention.unknownClient"),
        reasons: Array.from(reasons),
      })
    );

    // Sort: past-due first, then expiring
    result.sort((a, b) => {
      const aHasPastDue = a.reasons.includes("past-due-invoice") ? 0 : 1;
      const bHasPastDue = b.reasons.includes("past-due-invoice") ? 0 : 1;
      return aHasPastDue - bHasPastDue;
    });

    return result;
  }, [invoices, estimates, clientNameMap, t]);

  const count = attentionClients.length;

  // ── SM: Count with red accent if > 0 ─────────────────────────────────────
  if (size === "sm") {
    return (
      <Card className="p-2 h-full flex flex-col">
        <CardHeader className="pb-1 shrink-0">
          <CardTitle className="text-card-subtitle">{t("clientAttention.title")}</CardTitle>
        </CardHeader>
        <CardContent className="py-0 flex-1 overflow-hidden min-h-0">
          {isLoading ? (
            <div className="flex items-center gap-1">
              <Loader2 className="w-[14px] h-[14px] text-text-disabled animate-spin" />
              <span className="font-mono text-[11px] text-text-disabled">
                {t("clientAttention.loading")}
              </span>
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              <span
                className={cn(
                  "font-mono text-data-lg",
                  count > 0 ? "text-ops-error" : "text-text-primary"
                )}
              >
                {count}
              </span>
              <span className="font-mono text-[11px] text-text-tertiary">
                {count === 1 ? t("clientAttention.client") : t("clientAttention.clients")}
              </span>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // ── MD / LG: List of clients with attention reasons ─────────────────────
  const maxItems = size === "lg" ? 7 : 3;

  return (
    <Card className="p-2 h-full flex flex-col">
      <CardHeader className="pb-1.5 shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-card-subtitle">{t("clientAttention.title")}</CardTitle>
          <span
            className={cn(
              "font-mono text-[11px]",
              count > 0 ? "text-ops-error" : "text-text-tertiary"
            )}
          >
            {isLoading ? "..." : `${count} ${count === 1 ? t("clientAttention.client") : t("clientAttention.clients")}`}
          </span>
        </div>
      </CardHeader>
      <CardContent className="py-0 flex-1 overflow-hidden min-h-0">
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-[16px] h-[16px] text-text-disabled animate-spin" />
            <span className="font-mono text-[11px] text-text-disabled ml-1">
              {t("clientAttention.loading")}
            </span>
          </div>
        ) : count === 0 ? (
          <div className="flex flex-col items-center gap-1 py-3">
            <AlertCircle className="w-[16px] h-[16px] text-status-success" />
            <p className="font-mohave text-body-sm text-text-disabled">
              {t("clientAttention.allGood")}
            </p>
          </div>
        ) : (
          <div className="space-y-[6px]">
            {attentionClients.slice(0, maxItems).map((client) => (
              <div
                key={client.clientId}
                className="flex items-center gap-1.5 px-1 py-[7px] rounded hover:bg-[rgba(255,255,255,0.04)] cursor-pointer transition-colors"
              >
                {/* Client name */}
                <div className="flex-1 min-w-0">
                  <p className="font-mohave text-body-sm text-text-primary truncate">
                    {client.clientName}
                  </p>
                </div>

                {/* Reason badges */}
                <div className="flex items-center gap-1 shrink-0">
                  {client.reasons.map((reason) => (
                    <span
                      key={reason}
                      className={cn(
                        "font-mohave text-[11px] px-1.5 py-[1px] rounded-full whitespace-nowrap",
                        reasonBadgeClasses(reason)
                      )}
                    >
                      {reasonLabel(reason, t)}
                    </span>
                  ))}
                </div>
              </div>
            ))}
            {count > maxItems && (
              <span className="font-mono text-[11px] text-text-disabled block px-1">
                {t("clientAttention.more").replace("{count}", String(count - maxItems))}
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
