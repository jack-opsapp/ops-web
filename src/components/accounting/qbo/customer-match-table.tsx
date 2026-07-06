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
  QboMatchCandidate,
} from "@/lib/types/qbo-import";

export interface RowDecision {
  action: MatchAction;
  client_id?: string;
}

// needs_review is a SYSTEM-proposed state (ambiguous match), never a user choice —
// the operator must resolve it to link/create/skip. It shows as the current value
// (disabled) when proposed, but is not an option the operator can pick.
const SELECTABLE_ACTIONS: MatchAction[] = ["link", "create", "skip"];

// Radix Select forbids an empty-string item value; this sentinel maps to
// "no OPS client selected" and is normalised back to `undefined` on change.
const NO_CLIENT = "__none__";

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

/**
 * The match-quality qualifier for a candidate option. Exact matches carry no
 * similarity score (it arrives null and coerces to 0), so a percentage is
 * meaningless for them — show the basis instead ("email match" / "exact match").
 * Only a real fuzzy score (0 < score ≤ 1) renders a percentage. Returns null
 * when there is nothing honest to show (never a misleading "0%").
 */
function candidateQualifier(
  c: QboMatchCandidate,
  t: (key: string) => string
): string | null {
  if (c.basis === "email") return t("qbo.candidate.qualifier.email");
  if (c.basis === "name_exact") return t("qbo.candidate.qualifier.exact");
  if (c.basis === "name_fuzzy" && c.score > 0) return `${Math.round(c.score * 100)}%`;
  return null;
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
}: {
  matches: QboCustomerMatch[];
  decisions: Record<string, RowDecision>;
  onDecisionChange: (qbId: string, decision: RowDecision) => void;
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
            // needs_review is the one blocking state — it stops Apply, so it must
            // be the loudest thing in the row (bug: blockers weren't surfaced).
            const isBlocking = decision.action === "needs_review";

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

                {/* OPS client (candidate picker) */}
                <div role="cell" className="min-w-0">
                  {showPicker ? (
                    <Select
                      value={decision.client_id ?? NO_CLIENT}
                      onValueChange={(value) =>
                        onDecisionChange(m.customerQbId, {
                          action: decision.action,
                          client_id: value === NO_CLIENT ? undefined : value,
                        })
                      }
                    >
                      <SelectTrigger
                        data-testid={`match-candidate-${m.customerQbId}`}
                        className="font-mono text-caption"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_CLIENT}>
                          {t("qbo.candidate.none")}
                        </SelectItem>
                        {m.candidates.map((c) => {
                          const qualifier = candidateQualifier(c, t);
                          return (
                            <SelectItem key={c.clientId} value={c.clientId}>
                              <span className="font-mohave">
                                {c.name ?? c.clientId}
                              </span>
                              {qualifier && (
                                <>
                                  <span className="text-text-mute"> · </span>
                                  <span className="font-mono text-caption-sm text-text-3">
                                    {qualifier}
                                  </span>
                                </>
                              )}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
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
