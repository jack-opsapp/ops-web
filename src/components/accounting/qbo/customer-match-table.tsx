"use client";

import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import type {
  MatchAction,
  QboCustomerMatch,
  QboMatchCandidate,
} from "@/lib/types/qbo-import";

export interface RowDecision {
  action: MatchAction;
  client_id?: string;
}

const ACTIONS: MatchAction[] = ["link", "create", "skip", "needs_review"];

const CONFIDENCE_COLOR: Record<string, string> = {
  high: "text-status-success",
  medium: "text-[#C4A868]",
  low: "text-[#B58289]",
};

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
 * The QB customer's display label — the QuickBooks DisplayName carried on the
 * match, falling back to the QB customer id so every row is always
 * identifiable. (The matched OPS client, if any, is shown separately in the
 * OPS-client column, not here.)
 */
function resolveName(m: QboCustomerMatch): string {
  return m.displayName ?? m.customerQbId;
}

function candidateLabel(c: QboMatchCandidate): string {
  const name = c.name ?? c.clientId;
  const pct = ` · ${Math.round(c.score * 100)}%`;
  return `${name}${pct}`;
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
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left font-mono text-micro text-text-mute uppercase tracking-wider px-1.5 py-1">
              {t("qbo.customers.title")}
            </th>
            <th className="text-left font-mono text-micro text-text-mute uppercase tracking-wider px-1.5 py-1">
              {t("qbo.customers.basis")}
            </th>
            <th className="text-left font-mono text-micro text-text-mute uppercase tracking-wider px-1.5 py-1">
              {t("qbo.customers.confidence")}
            </th>
            <th className="text-left font-mono text-micro text-text-mute uppercase tracking-wider px-1.5 py-1">
              {t("qbo.customers.action")}
            </th>
            <th className="text-left font-mono text-micro text-text-mute uppercase tracking-wider px-1.5 py-1">
              {t("qbo.customers.match")}
            </th>
          </tr>
        </thead>
        <tbody>
          {matches.map((m) => {
            const decision = resolveDecision(m, decisions);
            const showPicker =
              decision.action === "link" || decision.action === "needs_review";
            return (
              <tr
                key={m.customerQbId}
                className="border-b border-border last:border-0 hover:bg-[rgba(255,255,255,0.02)]"
              >
                <td className="px-1.5 py-1 font-mono text-caption text-text-2 truncate max-w-[220px]">
                  {resolveName(m)}
                </td>
                <td
                  data-testid={`match-basis-${m.customerQbId}`}
                  className="px-1.5 py-1 font-mono text-caption-sm text-text-3"
                >
                  {t(`qbo.basis.${m.matchBasis ?? "none"}`)}
                </td>
                <td
                  data-testid={`match-confidence-${m.customerQbId}`}
                  className={cn(
                    "px-1.5 py-1 font-mono text-caption-sm uppercase tracking-wider",
                    m.confidence ? CONFIDENCE_COLOR[m.confidence] : "text-text-mute"
                  )}
                >
                  {m.confidence ? t(`qbo.confidence.${m.confidence}`) : "—"}
                </td>
                <td className="px-1.5 py-1">
                  <select
                    data-testid={`match-action-${m.customerQbId}`}
                    value={decision.action}
                    onChange={(e) =>
                      onDecisionChange(m.customerQbId, {
                        action: e.target.value as MatchAction,
                        client_id:
                          e.target.value === "link" ||
                          e.target.value === "needs_review"
                            ? decision.client_id
                            : undefined,
                      })
                    }
                    className="h-[36px] rounded-btn bg-[rgba(255,255,255,0.04)] border border-border px-2 font-mono text-caption text-text-2 focus:border-ops-accent focus:outline-none"
                  >
                    {ACTIONS.map((a) => (
                      <option key={a} value={a}>
                        {t(`qbo.action.${a}`)}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-1.5 py-1">
                  {showPicker ? (
                    <select
                      data-testid={`match-candidate-${m.customerQbId}`}
                      value={decision.client_id ?? ""}
                      onChange={(e) =>
                        onDecisionChange(m.customerQbId, {
                          action: decision.action,
                          client_id: e.target.value || undefined,
                        })
                      }
                      className="h-[36px] rounded-btn bg-[rgba(255,255,255,0.04)] border border-border px-2 font-mono text-caption text-text-2 focus:border-ops-accent focus:outline-none max-w-[220px]"
                    >
                      <option value="">{t("qbo.candidate.none")}</option>
                      {m.candidates.map((c) => (
                        <option key={c.clientId} value={c.clientId}>
                          {candidateLabel(c)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="font-mono text-caption-sm text-text-mute">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
