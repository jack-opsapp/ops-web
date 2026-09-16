"use client";

import { AlertTriangle } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import { Tag } from "@/components/ui/tag";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  MatchAction,
  MatchConfidence,
  QboCustomerMatch,
} from "@/lib/types/qbo-import";
import { isUnresolvedDecision } from "@/lib/api/services/qbo-apply-decisions";
import { ClientLinkPicker, type LinkableClient } from "./client-link-picker";

export interface RowDecision {
  action: MatchAction;
  client_id?: string;
}

// needs_review is a SYSTEM-proposed state (ambiguous match), never a user choice —
// the operator must resolve it to link/create/skip. It shows as the current value
// (disabled) when proposed, but is not an option the operator can pick.
const SELECTABLE_ACTIONS: MatchAction[] = ["link", "create", "skip"];

// Confidence → earth-tone tag (DESIGN.md § earth-tone semantics): olive = strong,
// tan = attention, rose = weak. Color always ships with the text label (a11y).
const CONFIDENCE_TONE: Record<MatchConfidence, "olive" | "tan" | "rose"> = {
  high: "olive",
  medium: "tan",
  low: "rose",
};

// Shared column template so the header and every row stay in lockstep.
const GRID =
  "grid grid-cols-[minmax(0,1.5fr)_84px_96px_148px_minmax(0,1.35fr)] items-center gap-2";

function resolveDecision(
  m: QboCustomerMatch,
  decisions: Record<string, RowDecision>
): RowDecision {
  return (
    decisions[m.customerQbId] ?? {
      action: m.proposedAction,
      client_id: m.matchedClientId ?? undefined,
    }
  );
}

function ColumnHead({ children }: { children: React.ReactNode }) {
  return (
    <span
      role="columnheader"
      className="font-mono text-micro uppercase tracking-[0.16em] text-text-mute"
    >
      {children}
    </span>
  );
}

export function CustomerMatchTable({
  matches,
  decisions,
  onDecisionChange,
  clients,
  clientsLoading = false,
}: {
  matches: QboCustomerMatch[];
  decisions: Record<string, RowDecision>;
  onDecisionChange: (qbId: string, decision: RowDecision) => void;
  /** Every OPS client in the company — the Link picker searches all of them. */
  clients: LinkableClient[];
  clientsLoading?: boolean;
}) {
  const { t } = useDictionary("accounting");

  return (
    <div role="table" className="overflow-x-auto">
      <div className="min-w-[720px]">
        {/* Header */}
        <div
          role="row"
          className={cn(GRID, "border-b border-border px-1.5 pb-1")}
        >
          <ColumnHead>{t("qbo.customers.title")}</ColumnHead>
          <ColumnHead>{t("qbo.customers.basis")}</ColumnHead>
          <ColumnHead>{t("qbo.customers.confidence")}</ColumnHead>
          <ColumnHead>{t("qbo.customers.action")}</ColumnHead>
          <ColumnHead>{t("qbo.customers.match")}</ColumnHead>
        </div>

        {/* Rows */}
        <div className="mt-1 space-y-0.5">
          {matches.map((m) => {
            const decision = resolveDecision(m, decisions);
            const showPicker =
              decision.action === "link" || decision.action === "needs_review";
            // Blocking rows stop Apply, so they must be the loudest thing in the
            // row: an unresolved needs_review, or a Link with no client chosen
            // (applied, it would drop this customer's invoices and payments).
            const isBlocking = isUnresolvedDecision(decision);

            return (
              <div
                role="row"
                key={m.customerQbId}
                data-testid={`match-row-${m.customerQbId}`}
                data-blocking={isBlocking || undefined}
                className={cn(
                  GRID,
                  "rounded px-1.5 py-1.5 border transition-colors duration-150",
                  isBlocking
                    ? "border-rose-line bg-rose-soft"
                    : "border-transparent hover:bg-surface-hover-subtle"
                )}
              >
                {/* Customer */}
                <div role="cell" className="min-w-0 flex items-center gap-1.5">
                  {isBlocking && (
                    <AlertTriangle
                      size={13}
                      className="shrink-0 text-rose"
                      aria-hidden
                    />
                  )}
                  <div className="min-w-0">
                    <div className="truncate font-mohave text-body-sm text-text">
                      {m.companyName ?? m.displayName ?? m.customerQbId}
                    </div>
                    {m.companyName && m.contactName && (
                      <div className="truncate font-mono text-micro text-text-3">
                        <span className="text-text-mute">
                          {t("qbo.customers.contactLabel")}{" "}
                        </span>
                        {m.contactName}
                      </div>
                    )}
                  </div>
                </div>

                {/* Match basis */}
                <span
                  role="cell"
                  data-testid={`match-basis-${m.customerQbId}`}
                  className="font-mono text-micro uppercase tracking-wider text-text-3"
                >
                  {t(`qbo.basis.${m.matchBasis ?? "none"}`)}
                </span>

                {/* Confidence */}
                <span role="cell" data-testid={`match-confidence-${m.customerQbId}`}>
                  {m.confidence ? (
                    <Tag variant={CONFIDENCE_TONE[m.confidence]}>
                      {t(`qbo.confidence.${m.confidence}`)}
                    </Tag>
                  ) : (
                    <span className="font-mono text-micro text-text-mute">—</span>
                  )}
                </span>

                {/* Action */}
                <div role="cell">
                  <Select
                    value={decision.action}
                    onValueChange={(value) =>
                      onDecisionChange(m.customerQbId, {
                        action: value as MatchAction,
                        client_id:
                          value === "link" ? decision.client_id : undefined,
                      })
                    }
                  >
                    <SelectTrigger
                      data-testid={`match-action-${m.customerQbId}`}
                      className="font-mono text-caption"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {decision.action === "needs_review" && (
                        <SelectItem value="needs_review" disabled>
                          {t("qbo.action.needs_review")}
                        </SelectItem>
                      )}
                      {SELECTABLE_ACTIONS.map((a) => (
                        <SelectItem key={a} value={a}>
                          {t(`qbo.action.${a}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* OPS client (searches every company client) */}
                <div role="cell" className="min-w-0">
                  {showPicker ? (
                    <ClientLinkPicker
                      customerQbId={m.customerQbId}
                      value={decision.client_id}
                      candidates={m.candidates}
                      clients={clients}
                      clientsLoading={clientsLoading}
                      onChange={(clientId) =>
                        onDecisionChange(m.customerQbId, {
                          // Choosing a client IS the decision: on a needs_review
                          // row it resolves to Link. Clearing never changes the
                          // action — a Link with no client stays visibly blocked.
                          action: clientId ? "link" : decision.action,
                          client_id: clientId,
                        })
                      }
                    />
                  ) : (
                    <span className="font-mono text-micro text-text-mute">—</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
