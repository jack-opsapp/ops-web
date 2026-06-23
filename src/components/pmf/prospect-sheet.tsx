"use client";

/**
 * OPS Admin — PMF ProspectSheet
 *
 * Detail editor for a single prospect. Shows read-only prospect fields
 * (name / company / contact / source / first_contact_at) plus an
 * editable DEAL section.
 *
 * Data shape: GET /api/admin/pmf/prospects/[id] returns
 *   { data: { ...prospect, pmf_deals: Deal[], ... } }
 * — pmf_deals is nested via the Supabase select. We split it into
 * `prospect` and `deals` in local state.
 *
 * Stage / fee / deposit edits PATCH /api/admin/pmf/deals/[id] (the
 * generic update endpoint, not the /stage fast path — we sometimes
 * write multiple columns in one save). We RECONCILE local state from
 * the response row so trigger-set fields like stage_entered_at refresh
 * without a re-fetch.
 *
 * Tier A deals expose implementation_fee_cents + deposit_amount_cents
 * inputs because that's where the SOW / deposit lifecycle lives. Base
 * SaaS deals don't have these fields surfaced (their deal lifecycle is
 * driven by Stripe events, not manual entry).
 */
import { useEffect, useState } from "react";
import { PmfCard } from "@/components/pmf/ui/card";
import { PmfButton } from "@/components/pmf/ui/button";
import { SlashHeader } from "@/components/pmf/ui/slash-header";
import { Tag } from "@/components/pmf/ui/tag";
import { fmtDateTime, fmtUsd } from "@/lib/pmf/formatters";
import {
  SOURCE_LABEL,
  SOURCE_TAG_VARIANT,
} from "@/components/pmf/prospect-card";
import type { Prospect, Deal, DealStage } from "@/lib/pmf/types";

const STAGE_OPTIONS: DealStage[] = [
  "contacted",
  "qualified",
  "proposal",
  "negotiation",
  "signed",
  "in_delivery",
  "delivered",
  "closed_won",
  "closed_lost",
];

interface NestedProspect extends Prospect {
  pmf_deals?: Deal[];
}

interface ProspectSheetProps {
  prospectId: string;
}

interface SheetState {
  prospect: Prospect;
  deals: Deal[];
}

export function ProspectSheet({ prospectId }: ProspectSheetProps) {
  const [state, setState] = useState<SheetState | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(`/api/admin/pmf/prospects/${prospectId}`);
        if (!res.ok) {
          throw new Error(`fetch failed: ${res.status}`);
        }
        const json = (await res.json()) as { data: NestedProspect };
        if (cancelled) return;
        const { pmf_deals, ...rest } = json.data;
        setState({
          prospect: rest as Prospect,
          deals: pmf_deals ?? [],
        });
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setFetchError(err instanceof Error ? err.message : "load failed");
        setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [prospectId]);

  async function patchDeal(dealId: string, patch: Partial<Deal>) {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/admin/pmf/deals/${dealId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        let msg = `save failed: ${res.status}`;
        try {
          const json = (await res.json()) as { error?: string };
          if (json.error) msg = json.error;
        } catch {
          // body wasn't JSON — keep the status-only message
        }
        throw new Error(msg);
      }
      const json = (await res.json()) as { data: Deal };
      // Reconcile from the server row so trigger-set fields like
      // stage_entered_at update locally.
      setState((prev) =>
        prev
          ? {
              ...prev,
              deals: prev.deals.map((d) =>
                d.id === dealId ? { ...d, ...json.data } : d,
              ),
            }
          : prev,
      );
      setSaving(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "save failed");
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <PmfCard className="p-6">
        <SlashHeader variant="page-title">PROSPECT</SlashHeader>
        <div className="h-[400px] mt-6 animate-pulse bg-[rgba(255,255,255,0.02)] rounded" />
      </PmfCard>
    );
  }

  if (fetchError || !state) {
    return (
      <PmfCard className="p-6">
        <SlashHeader variant="page-title">PROSPECT</SlashHeader>
        <div className="font-mono text-[11px] text-[color:var(--rose)] py-12 text-center">
          {"// ERROR — FAILED TO LOAD"}
          <br />
          {fetchError ?? "no data"}
        </div>
      </PmfCard>
    );
  }

  const { prospect, deals } = state;

  return (
    <div className="space-y-6 max-w-[820px]">
      <PmfCard className="p-6">
        <div className="flex items-center justify-between gap-4">
          <SlashHeader variant="page-title">
            {prospect.company ?? prospect.name}
          </SlashHeader>
          <Tag variant={SOURCE_TAG_VARIANT[prospect.source]}>
            {SOURCE_LABEL[prospect.source]}
          </Tag>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-x-8 gap-y-3">
          <Row label="NAME" value={prospect.name} />
          <Row label="COMPANY" value={prospect.company ?? "—"} />
          <Row label="EMAIL" value={prospect.email ?? "—"} />
          <Row label="PHONE" value={prospect.phone ?? "—"} />
          <Row
            label="DEAL TYPE"
            value={
              <span className="font-mono uppercase text-[12px]">
                {prospect.deal_type === "tier_a" ? "TIER A" : "BASE SAAS"}
              </span>
            }
          />
          <Row
            label="FIRST CONTACT"
            value={
              <span className="font-mono text-[12px]">
                {fmtDateTime(prospect.first_contact_at)}
                <span className="text-[color:var(--text-3)] ml-2">
                  · {prospect.first_contact_direction.toUpperCase()}
                </span>
              </span>
            }
          />
        </div>

        {prospect.notes && (
          <div className="mt-6">
            <span className="font-mono uppercase text-[11px] tracking-[0.16em] text-[color:var(--text-3)] block mb-1">
              NOTES
            </span>
            <p className="font-mohave text-[14px] text-[color:var(--text-2)] whitespace-pre-wrap">
              {prospect.notes}
            </p>
          </div>
        )}
      </PmfCard>

      {deals.length === 0 ? (
        <PmfCard className="p-6">
          <SlashHeader variant="section">DEAL</SlashHeader>
          <div className="font-mono text-[11px] text-[color:var(--text-mute)] mt-4">
            {"// no deal attached"}
          </div>
        </PmfCard>
      ) : (
        deals.map((deal) => (
          <DealEditor
            key={deal.id}
            deal={deal}
            onPatch={(patch) => patchDeal(deal.id, patch)}
            saving={saving}
          />
        ))
      )}

      {saveError && (
        <div
          role="alert"
          className="font-mono text-[11px] text-[color:var(--rose)]"
        >
          {"// ERROR — "}{saveError}
        </div>
      )}
    </div>
  );
}

interface RowProps {
  label: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: any;
}

function Row({ label, value }: RowProps) {
  return (
    <div>
      <span className="font-mono uppercase text-[11px] tracking-[0.16em] text-[color:var(--text-3)] block mb-1">
        {label}
      </span>
      <div className="font-mohave text-[14px] text-[color:var(--text)]">
        {value}
      </div>
    </div>
  );
}

interface DealEditorProps {
  deal: Deal;
  onPatch: (patch: Partial<Deal>) => Promise<void>;
  saving: boolean;
}

function DealEditor({ deal, onPatch, saving }: DealEditorProps) {
  const [stage, setStage] = useState<DealStage>(deal.stage);
  const [implFee, setImplFee] = useState<string>(
    deal.implementation_fee_cents != null
      ? String(deal.implementation_fee_cents / 100)
      : "",
  );
  const [deposit, setDeposit] = useState<string>(
    deal.deposit_amount_cents != null
      ? String(deal.deposit_amount_cents / 100)
      : "",
  );

  // Re-sync local form state when the deal prop changes (e.g. after a
  // PATCH reconciles the server row into parent state).
  useEffect(() => {
    setStage(deal.stage);
    setImplFee(
      deal.implementation_fee_cents != null
        ? String(deal.implementation_fee_cents / 100)
        : "",
    );
    setDeposit(
      deal.deposit_amount_cents != null
        ? String(deal.deposit_amount_cents / 100)
        : "",
    );
  }, [deal]);

  const isTierA = deal.deal_type === "tier_a";

  function dollarsToCents(s: string): number | null {
    if (s.trim() === "") return null;
    const n = Number(s);
    if (!Number.isFinite(n)) return null;
    return Math.round(n * 100);
  }

  async function onSave() {
    const patch: Partial<Deal> = {};
    if (stage !== deal.stage) patch.stage = stage;
    if (isTierA) {
      const fee = dollarsToCents(implFee);
      if (fee !== deal.implementation_fee_cents) {
        patch.implementation_fee_cents = fee;
      }
      const dep = dollarsToCents(deposit);
      if (dep !== deal.deposit_amount_cents) {
        patch.deposit_amount_cents = dep;
      }
    }
    if (Object.keys(patch).length === 0) return;
    await onPatch(patch);
  }

  return (
    <PmfCard className="p-6">
      <div className="flex items-center justify-between">
        <SlashHeader variant="section">DEAL</SlashHeader>
        <span className="font-mono uppercase text-[11px] text-[color:var(--text-3)]">
          {deal.stage.toUpperCase()}
        </span>
      </div>

      <div className="mt-6 space-y-4">
        <label className="block">
          <span className="font-mono uppercase text-[11px] tracking-[0.16em] text-[color:var(--text-3)] block mb-1">
            STAGE
          </span>
          <select
            value={stage}
            onChange={(e) => setStage(e.target.value as DealStage)}
            className="pmf-input"
          >
            {STAGE_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s.toUpperCase().replace("_", " ")}
              </option>
            ))}
          </select>
        </label>

        {isTierA && (
          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="font-mono uppercase text-[11px] tracking-[0.16em] text-[color:var(--text-3)] block mb-1">
                IMPLEMENTATION FEE
              </span>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={implFee}
                onChange={(e) => setImplFee(e.target.value)}
                className="pmf-input"
                placeholder="0.00"
              />
              <span className="font-mono text-[11px] text-[color:var(--text-mute)] mt-1 block">
                [{fmtUsd(deal.implementation_fee_cents)}]
              </span>
            </label>

            <label className="block">
              <span className="font-mono uppercase text-[11px] tracking-[0.16em] text-[color:var(--text-3)] block mb-1">
                DEPOSIT
              </span>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={deposit}
                onChange={(e) => setDeposit(e.target.value)}
                className="pmf-input"
                placeholder="0.00"
              />
              <span className="font-mono text-[11px] text-[color:var(--text-mute)] mt-1 block">
                [{fmtUsd(deal.deposit_amount_cents)}]
              </span>
            </label>
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          <span className="font-mono text-[11px] text-[color:var(--text-3)]">
            STAGE ENTERED · {fmtDateTime(deal.stage_entered_at)}
          </span>
          <PmfButton
            type="button"
            variant="primary"
            onClick={onSave}
            disabled={saving}
          >
            {saving ? "SAVING…" : "SAVE"}
          </PmfButton>
        </div>
      </div>
    </PmfCard>
  );
}
