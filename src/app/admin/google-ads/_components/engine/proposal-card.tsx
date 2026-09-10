"use client";

/**
 * One engine proposal, for a decision. OPS-authored summary on top, the
 * routine's rationale in the agent palette (the only lavender on the page),
 * the evidence as a mono table, a kind-specific body, and the two actions.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Tag } from "@/components/ui/tag";
import { RejectDialog } from "@/components/agent/reject-dialog";
import type { AdminProposalRow } from "@/lib/ads/engine/admin";
import { cn } from "@/lib/utils/cn";
import { BUTTONS, CARD, KIND_TAGS, OUTCOME_TAGS, REJECT_DIALOG } from "./copy";
import { ago, daysUntil, money } from "./format";
import { RsaPreview } from "./rsa-preview";
import type { ReviewOutcome } from "@/lib/hooks/use-ads-engine";

export interface ProposalCardProps {
  proposal: AdminProposalRow;
  outcome?: ReviewOutcome | null;
  busy?: boolean;
  error?: string | null;
  onReview: (id: string, decision: "approve" | "reject", notes?: string) => void;
  now?: Date;
}

const str = (value: unknown): string => (typeof value === "string" ? value : typeof value === "number" ? String(value) : "");
const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

function summaryOf(p: AdminProposalRow): string {
  const d = p.payload;
  switch (p.kind) {
    case "add_negatives":
      return `${str(d.list)} · ${CARD.terms(Array.isArray(d.terms) ? d.terms.length : 0)}`;
    case "pause_keyword":
      return `"${str(d.text)}" [${str(d.matchType)}] in ${str(d.adGroupName) || str(d.adGroup)}`;
    case "add_keywords":
      return `${CARD.keywords(Array.isArray(d.terms) ? d.terms.length : 0)} for ${str(d.adGroupName) || str(d.ad_group)}`;
    case "create_rsa_challenger":
      return `Challenger for ${str(d.adGroupName) || str(d.ad_group)}`;
    case "promote_challenger":
      return `Promote the challenger in ${str(d.adGroupName) || str(d.adGroup)}`;
    case "pause_ad":
      return `Pause an ad in ${str(d.adGroupName) || str(d.adGroup)}`;
    case "adjust_budget":
      return `${str(d.campaignName)} · ${money(num(d.currentDailyAmount), true)} → ${money(num(d.new_daily_amount), true)} per day`;
    case "adjust_cpc_cap":
      return `${str(d.campaignName)} · CPC cap ${money(num(d.currentCpcCap))} → ${money(num(d.new_cpc_cap))}`;
    case "set_bidding_strategy":
      return `${str(d.campaignName)} · ${str(d.currentStrategy).replaceAll("_", " ").toLowerCase()} → ${str(d.strategy).replaceAll("_", " ").toLowerCase()}`;
    case "add_ad_group":
      return `${str(d.name)} in ${str(d.campaignName)} · ${CARD.keywords(Array.isArray(d.keywords) ? d.keywords.length : 0)} · ${CARD.ads(Array.isArray(d.ads) ? d.ads.length : 0)}`;
    case "observation":
      return str(d.text).slice(0, 140);
  }
}

function TermChips({ terms }: { terms: unknown }) {
  if (!Array.isArray(terms) || terms.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-0.5">
      {terms.map((term, index) => {
        const t = term as { text?: string; matchType?: string };
        return (
          <li key={`${t.text}-${index}`}>
            <Tag variant="neutral">
              {t.text}
              {t.matchType && <span className="text-text-3">{t.matchType.slice(0, 1)}</span>}
            </Tag>
          </li>
        );
      })}
    </ul>
  );
}

function EvidenceTable({ evidence }: { evidence: unknown[] }) {
  const rows = evidence.filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null && !Array.isArray(row));
  if (rows.length === 0) return null;
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))].slice(0, 8);
  return (
    <div className="overflow-x-auto">
      <p className="font-mono text-micro uppercase tracking-wider text-text-mute">{CARD.evidence}</p>
      <table className="mt-0.5 w-full">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column} className="pb-0.5 pr-2 text-left font-mono text-micro uppercase tracking-wider text-text-3">
                {column.replaceAll("_", " ")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 12).map((row, index) => (
            <tr key={index} className="border-t border-border-subtle">
              {columns.map((column) => {
                const value = row[column];
                const numeric = typeof value === "number";
                return (
                  <td key={column} className={cn("py-0.5 pr-2 font-mono text-micro tabular-nums", numeric ? "text-text-2" : "text-text-3")}>
                    {value == null ? "—" : numeric ? (Number.isInteger(value) ? String(value) : value.toFixed(2)) : String(value)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Body({ p }: { p: AdminProposalRow }) {
  const d = p.payload;
  switch (p.kind) {
    case "add_negatives":
    case "add_keywords":
      return <TermChips terms={d.terms} />;
    case "create_rsa_challenger":
      return (
        <div className="space-y-1">
          <RsaPreview
            headlines={(d.headlines as Array<{ text: string; pinnedField?: string }>) ?? []}
            descriptions={(d.descriptions as Array<{ text: string }>) ?? []}
            path1={str(d.path1) || null}
            path2={str(d.path2) || null}
            finalUrl={str(d.final_url)}
          />
          {str(d.hypothesis) && (
            <p className="font-mohave text-body-sm text-text-2">
              <span className="font-mono text-micro uppercase tracking-wider text-text-3">{CARD.hypothesis} </span>
              {str(d.hypothesis)}
            </p>
          )}
        </div>
      );
    case "add_ad_group":
      return (
        <div className="space-y-1">
          <p className="font-mono text-micro text-text-3">{str(d.final_url)}</p>
          <TermChips terms={d.keywords} />
          {Array.isArray(d.ads) &&
            (d.ads as Array<Record<string, unknown>>).map((ad, index) => (
              <RsaPreview
                key={index}
                headlines={(ad.headlines as Array<{ text: string; pinnedField?: string }>) ?? []}
                descriptions={(ad.descriptions as Array<{ text: string }>) ?? []}
                path1={str(ad.path1) || null}
                path2={str(ad.path2) || null}
                finalUrl={str(ad.final_url) || str(d.final_url)}
              />
            ))}
        </div>
      );
    case "pause_keyword": {
      const metrics = (d.metrics as Record<string, unknown> | undefined) ?? {};
      return (
        <p className="font-mono text-micro tabular-nums text-text-2">
          {num(metrics.clicks) ?? "—"} clicks · {money(num(metrics.spend))} spent · {num(metrics.conversions) ?? "—"} trials
        </p>
      );
    }
    case "observation":
      return <p className="whitespace-pre-line font-mohave text-body-sm text-text-2">{str(d.text)}</p>;
    default:
      return null;
  }
}

function outcomeTag(outcome: ReviewOutcome): { label: string; variant: "olive" | "rose" | "tan" | "dim" } {
  switch (outcome.state) {
    case "applied":
      return { label: OUTCOME_TAGS.applied, variant: "olive" };
    case "failed":
      return { label: OUTCOME_TAGS.failed, variant: "rose" };
    case "validated":
      return { label: OUTCOME_TAGS.validated, variant: "tan" };
    case "rejected":
      return { label: OUTCOME_TAGS.rejected, variant: "dim" };
    case "pending":
      return { label: outcome.reason === "google_unavailable" ? OUTCOME_TAGS.pending_google_unavailable : OUTCOME_TAGS.pending_apply_timeout, variant: "tan" };
  }
}

export function ProposalCard({ proposal, outcome, busy = false, error, onReview, now = new Date() }: ProposalCardProps) {
  const [rejecting, setRejecting] = useState(false);
  const decided = proposal.state !== "proposed" || !!outcome;
  const tag = outcome ? outcomeTag(outcome) : null;
  const rejectCopy = (key: string) => {
    switch (key) {
      case "reject.title":
        return REJECT_DIALOG.title;
      case "reject.description":
        return REJECT_DIALOG.description;
      case "reject.placeholder":
        return REJECT_DIALOG.placeholder;
      case "reject.cancel":
        return REJECT_DIALOG.cancel;
      case "reject.confirm":
        return REJECT_DIALOG.confirm;
      default:
        return key;
    }
  };

  return (
    <article className="glass-surface rounded-panel p-2" data-testid="proposal-card" data-kind={proposal.kind}>
      <header className="flex flex-wrap items-start justify-between gap-1">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-0.5">
            <Tag variant="neutral">{KIND_TAGS[proposal.kind]}</Tag>
            {proposal.mode_at_submit === "auto" && <Tag variant="tan">{CARD.auto}</Tag>}
            {proposal.run_id && proposal.evidence.some((row) => typeof row === "object" && row !== null && "arm" in (row as Record<string, unknown>)) && (
              <Tag variant="dim">{CARD.worker}</Tag>
            )}
          </div>
          <h3 className="mt-0.5 font-mohave text-body text-text">{summaryOf(proposal)}</h3>
        </div>
        <p className="shrink-0 font-mono text-micro tabular-nums text-text-3">{ago(proposal.created_at, now)}</p>
      </header>

      {proposal.rationale && (
        <div className="mt-1 rounded-chip border border-agent-border bg-agent-bg px-1.5 py-1">
          <p className="font-mono text-micro uppercase tracking-wider text-agent-text2">{CARD.engine}</p>
          <p className="mt-0.5 font-mohave text-body-sm text-agent-text">{proposal.rationale}</p>
        </div>
      )}

      <div className="mt-1">
        <Body p={proposal} />
      </div>

      {proposal.evidence.length > 0 && (
        <div className="mt-1">
          <EvidenceTable evidence={proposal.evidence} />
        </div>
      )}

      <footer className="mt-1.5 flex flex-wrap items-center justify-between gap-1">
        <div className="flex flex-wrap items-center gap-1">
          {tag && <Tag variant={tag.variant}>{tag.label}</Tag>}
          {outcome?.state === "failed" && <p className="font-mono text-micro text-rose">{outcome.error}</p>}
          {!tag && proposal.state !== "proposed" && (
            <p className="font-mono text-micro text-text-3">
              {proposal.reviewed_by ? CARD.reviewedBy(proposal.reviewed_by) : proposal.state}
              {proposal.review_notes ? ` · ${proposal.review_notes}` : ""}
            </p>
          )}
          {error && <p className="font-mono text-micro text-rose">{error}</p>}
          {!decided && <p className="font-mono text-micro text-text-mute">{CARD.expires(daysUntil(proposal.expires_at, now))}</p>}
        </div>
        {!decided && (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setRejecting(true)}>
              {BUTTONS.reject}
            </Button>
            <Button variant="default" size="sm" loading={busy} onClick={() => onReview(proposal.id, "approve")}>
              {proposal.kind === "observation" ? BUTTONS.noted : BUTTONS.approve}
            </Button>
          </div>
        )}
      </footer>

      <RejectDialog
        open={rejecting}
        onClose={() => setRejecting(false)}
        onConfirm={(notes) => {
          setRejecting(false);
          onReview(proposal.id, "reject", notes);
        }}
        t={rejectCopy}
      />
    </article>
  );
}
