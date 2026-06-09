"use client";

import { useMemo, useState, useTransition } from "react";
import type {
  SpecAdCampaignRow,
  SpecAnalyticsPayload,
  SpecDailySpendPoint,
  SpecEventLedgerRow,
  SpecFunnelStep,
  SpecSearchTermRow,
} from "@/lib/admin/spec-analytics-types";
import { formatCents, formatCentsCompact, formatCount } from "../../_components/format";

interface SpecAnalyticsContentProps {
  initialPayload: SpecAnalyticsPayload;
}

const pctFormatter = new Intl.NumberFormat("en-CA", {
  style: "percent",
  maximumFractionDigits: 1,
});

export function SpecAnalyticsContent({ initialPayload }: SpecAnalyticsContentProps) {
  const [payload, setPayload] = useState(initialPayload);
  const [from, setFrom] = useState(initialPayload.range.from);
  const [to, setTo] = useState(initialPayload.range.to);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function refresh() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin/spec/analytics?from=${from}&to=${to}`, {
          cache: "no-store",
          credentials: "include",
        });
        if (!res.ok) throw new Error(`analytics refresh failed · ${res.status}`);
        const next = await res.json() as SpecAnalyticsPayload;
        setPayload(next);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  const exportHref = `/api/admin/spec/analytics/export?from=${payload.range.from}&to=${payload.range.to}`;

  return (
    <>
      <section aria-label="SPEC launch controls" className="border-b border-white/[0.08] px-8 py-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-3">
              <span className="text-text-mute">[</span>
              PAID VALIDATION · TWO-WEEK READ
              <span className="text-text-mute">]</span>
            </p>
            <h2 className="mt-1 font-cakemono text-[20px] font-light uppercase leading-none text-text">
              <span aria-hidden="true" className="mr-2 font-mono text-text-mute">
                {"//"}
              </span>
              SPEC MARKET SIGNAL
            </h2>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <DateField label="FROM" value={from} onChange={setFrom} />
            <DateField label="TO" value={to} onChange={setTo} />
            <button
              type="button"
              onClick={refresh}
              disabled={isPending}
              className="h-10 rounded-[5px] border border-white/[0.12] px-4 font-cakemono text-[13px] font-light uppercase text-text transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-white/[0.05] disabled:cursor-wait disabled:text-text-mute"
            >
              {isPending ? "SYNCING" : "REFRESH"}
            </button>
          </div>
        </div>

        {error && (
          <p className="mt-4 rounded-[6px] border border-rose/30 bg-rose/10 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-rose">
            SYS :: {error}
          </p>
        )}
      </section>

      <SummaryStrip payload={payload} />
      <FunnelSection steps={payload.funnel} />
      <SpendSection payload={payload} />
      <SearchTermSection rows={payload.searchTerms} />
      <EventLedgerSection rows={payload.events} />
      <ExportSection exportHref={exportHref} payload={payload} />
    </>
  );
}

function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.16em] text-text-mute">
        {label}
      </span>
      <input
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 rounded-[5px] border border-white/[0.10] bg-white/[0.04] px-3 font-mono text-[12px] tabular-nums text-text outline-none transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] focus:border-[#6F94B0] focus:ring-1 focus:ring-[#6F94B0]"
      />
    </label>
  );
}

function SummaryStrip({ payload }: { payload: SpecAnalyticsPayload }) {
  const { summary } = payload;
  const spendLabel = `${formatCents(summary.spendCents)} / ${formatCents(summary.budgetCapCents)}`;
  const budgetPct = clampPct(summary.budgetSpentRate);
  const targetLow = 2;
  const targetHigh = 5;
  const depositTone = summary.paidDeposits < targetLow
    ? "text-tan"
    : summary.paidDeposits <= targetHigh
      ? "text-olive"
      : "text-rose";

  const items = [
    {
      label: "AD SPEND",
      value: spendLabel,
      meta: pctFormatter.format(summary.budgetSpentRate),
      bar: budgetPct,
      tone: budgetPct >= 100 ? "#B58289" : "#C4A868",
    },
    {
      label: "DEPOSITS",
      value: formatCount(summary.paidDeposits),
      meta: "TARGET 2-5",
      bar: clampPct(summary.paidDeposits / targetHigh),
      tone: summary.paidDeposits > targetHigh ? "#B58289" : "#9DB582",
      valueClassName: depositTone,
    },
    {
      label: "COST / DEPOSIT",
      value: formatCents(summary.costPerDepositCents),
      meta: summary.paidDeposits === 0 ? "NO PAID READ" : "BLENDED CPA",
      bar: summary.costPerDepositCents ? clampPct(summary.costPerDepositCents / 100_000) : 0,
      tone: "#C4A868",
    },
    {
      label: "DEFAULT OPS",
      value: formatCount(summary.defaultOpsSignups),
      meta: "SETUP ATTRIBUTION",
      bar: clampPct(summary.defaultOpsSignups / Math.max(1, summary.payDepositClicks)),
      tone: "rgba(255,255,255,0.14)", // --fill-neutral; accent is reserved for CTA/focus only
    },
    {
      label: "DEPOSIT REVENUE",
      value: formatCents(summary.depositRevenueCents),
      meta: "STRIPE PAID",
      bar: summary.spendCents > 0 ? clampPct(summary.depositRevenueCents / summary.spendCents) : 0,
      tone: "#9DB582",
    },
  ];

  return (
    <section aria-label="SPEC launch summary" className="border-b border-white/[0.08] px-8 py-6">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 className="font-cakemono text-[18px] font-light uppercase leading-none text-text">
          <span aria-hidden="true" className="mr-2 font-mono text-text-mute">
            {"//"}
          </span>
          LAUNCH READ
        </h2>
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-mute">
          <span className="text-text-mute">[</span>
          {payload.range.from} → {payload.range.to} · {summary.ga4Configured ? "GA4 LIVE" : "GA4 OFFLINE"}
          <span className="text-text-mute">]</span>
        </span>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        {items.map((item) => (
          <MetricPanel key={item.label} {...item} />
        ))}
      </div>
    </section>
  );
}

function MetricPanel({
  label,
  value,
  meta,
  bar,
  tone,
  valueClassName = "text-text",
}: {
  label: string;
  value: string;
  meta: string;
  bar: number;
  tone: string;
  valueClassName?: string;
}) {
  return (
    <div className="glass-surface p-5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-3">{label}</p>
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-mute">{meta}</span>
      </div>
      <p className={`mt-3 font-mono text-[22px] tabular-nums leading-none ${valueClassName}`}>
        {value}
      </p>
      <div
        className="mt-4 h-[3px] overflow-hidden rounded-[2px] bg-white/[0.06]"
        role="img"
        aria-label={`${label}: ${value}`}
      >
        <div
          aria-hidden="true"
          style={{ width: `${bar}%`, backgroundColor: tone }}
          className="h-full transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
        />
      </div>
    </div>
  );
}

function FunnelSection({ steps }: { steps: SpecFunnelStep[] }) {
  const peak = Math.max(1, ...steps.map((step) => step.count));

  return (
    <section aria-label="SPEC conversion funnel" className="border-b border-white/[0.08] px-8 py-6">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="font-cakemono text-[18px] font-light uppercase leading-none text-text">
          <span aria-hidden="true" className="mr-2 font-mono text-text-mute">
            {"//"}
          </span>
          FUNNEL
        </h2>
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-mute">
          <span className="text-text-mute">[</span>OUTBOX + GA4 MAX COUNTS
          <span className="text-text-mute">]</span>
        </span>
      </div>
      <div className="glass-surface p-5">
        <div className="grid gap-3 lg:grid-cols-4">
          {steps.map((step) => (
            <div key={step.eventName} className="border-b border-white/[0.06] pb-3 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-4 last:border-0">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-3">
                  {step.label}
                </span>
                <span className="font-mono text-[16px] tabular-nums text-text">
                  {formatCount(step.count)}
                </span>
              </div>
              <div className="mt-2 h-[3px] overflow-hidden rounded-[2px] bg-white/[0.06]">
                <div
                  aria-hidden="true"
                  style={{ width: `${clampPct(step.count / peak)}%`, backgroundColor: "rgba(255,255,255,0.14)" }}
                  className="h-full transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
                />
              </div>
              <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-text-mute">
                {step.rateFromPrevious == null ? "ENTRY" : `${pctFormatter.format(step.rateFromPrevious)} FROM PRIOR`}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function SpendSection({ payload }: { payload: SpecAnalyticsPayload }) {
  return (
    <section aria-label="SPEC ad spend" className="border-b border-white/[0.08] px-8 py-6">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="font-cakemono text-[18px] font-light uppercase leading-none text-text">
          <span aria-hidden="true" className="mr-2 font-mono text-text-mute">
            {"//"}
          </span>
          ADS
        </h2>
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-mute">
          <span className="text-text-mute">[</span>{payload.summary.adCampaignFilter}
          <span className="text-text-mute">]</span>
        </span>
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr,1fr]">
        <DailySpendChart points={payload.dailySpend} />
        <CampaignTable rows={payload.campaigns} />
      </div>
    </section>
  );
}

function DailySpendChart({ points }: { points: SpecDailySpendPoint[] }) {
  const path = useMemo(() => buildSpendPath(points), [points]);
  const peak = Math.max(0, ...points.map((point) => point.spendCents));

  return (
    <div className="glass-surface p-5">
      <div className="flex items-baseline justify-between">
        <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-3">
          DAILY SPEND
        </h3>
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-mute">
          <span className="text-text-mute">[</span>PEAK {formatCentsCompact(peak)}
          <span className="text-text-mute">]</span>
        </span>
      </div>

      <svg
        viewBox="0 0 480 150"
        className="mt-4 h-[180px] w-full"
        role="img"
        aria-label={`Daily ad spend chart for ${points.length} days`}
        preserveAspectRatio="none"
      >
        <line x1="0" y1="126" x2="480" y2="126" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
        {path ? (
          <>
            <path d={path.fill} fill="rgba(196,168,104,0.10)" />
            <path
              d={path.line}
              fill="none"
              stroke="#C4A868"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.4"
              vectorEffect="non-scaling-stroke"
            />
          </>
        ) : (
          <text x="12" y="78" fill="#6A6A6A" className="font-mono text-[11px] uppercase tracking-[0.14em]">
            —
          </text>
        )}
      </svg>

      <table className="sr-only">
        <caption>Daily SPEC ad spend</caption>
        <thead>
          <tr>
            <th>Date</th>
            <th>Spend</th>
            <th>Clicks</th>
            <th>Conversions</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.date}>
              <td>{point.date}</td>
              <td>{formatCents(point.spendCents)}</td>
              <td>{point.clicks}</td>
              <td>{point.conversions}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-1 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.12em] text-text-mute">
        <span>{points[0]?.date ?? "—"}</span>
        <span>{points.at(-1)?.date ?? "—"}</span>
      </div>
    </div>
  );
}

function CampaignTable({ rows }: { rows: SpecAdCampaignRow[] }) {
  return (
    <div className="glass-surface overflow-hidden">
      <div className="border-b border-white/[0.08] px-5 py-4">
        <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-3">
          CAMPAIGNS
        </h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] text-left font-mono text-[11px] uppercase tracking-[0.10em]">
          <thead className="text-text-mute">
            <tr className="border-b border-white/[0.06]">
              <th className="px-5 py-3 font-normal">Campaign</th>
              <th className="px-3 py-3 text-right font-normal">Spend</th>
              <th className="px-3 py-3 text-right font-normal">Clicks</th>
              <th className="px-3 py-3 text-right font-normal">CPA</th>
              <th className="px-5 py-3 text-right font-normal">CTR</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-6 text-text-mute">— no campaign rows</td>
              </tr>
            ) : rows.map((row) => (
              <tr key={row.campaignName} className="border-b border-white/[0.04] last:border-0">
                <td className="max-w-[240px] truncate px-5 py-3 text-text">{row.campaignName}</td>
                <td className="px-3 py-3 text-right tabular-nums text-tan">{formatCents(row.spendCents)}</td>
                <td className="px-3 py-3 text-right tabular-nums text-text">{formatCount(row.clicks)}</td>
                <td className="px-3 py-3 text-right tabular-nums text-text">{formatCents(row.cpaCents)}</td>
                <td className="px-5 py-3 text-right tabular-nums text-text">{pctFormatter.format(row.ctr)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SearchTermSection({ rows }: { rows: SpecSearchTermRow[] }) {
  return (
    <section aria-label="SPEC search terms" className="border-b border-white/[0.08] px-8 py-6">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="font-cakemono text-[18px] font-light uppercase leading-none text-text">
          <span aria-hidden="true" className="mr-2 font-mono text-text-mute">
            {"//"}
          </span>
          SEARCH TERMS
        </h2>
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-mute">
          <span className="text-text-mute">[</span>TOP {rows.length}
          <span className="text-text-mute">]</span>
        </span>
      </div>
      <div className="glass-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left font-mono text-[11px] uppercase tracking-[0.10em]">
            <thead className="text-text-mute">
              <tr className="border-b border-white/[0.06]">
                <th className="px-5 py-3 font-normal">Term</th>
                <th className="px-3 py-3 font-normal">Campaign</th>
                <th className="px-3 py-3 font-normal">Ad group</th>
                <th className="px-3 py-3 text-right font-normal">Spend</th>
                <th className="px-3 py-3 text-right font-normal">Clicks</th>
                <th className="px-3 py-3 text-right font-normal">CPA</th>
                <th className="px-5 py-3 text-right font-normal">Flag</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-6 text-text-mute">— no search terms synced</td>
                </tr>
              ) : rows.map((row) => (
                <tr key={`${row.campaignName}:${row.adGroupName}:${row.searchTerm}`} className="border-b border-white/[0.04] last:border-0">
                  <td className="max-w-[260px] truncate px-5 py-3 text-text">{row.searchTerm}</td>
                  <td className="max-w-[180px] truncate px-3 py-3 text-text-3">{row.campaignName}</td>
                  <td className="max-w-[180px] truncate px-3 py-3 text-text-3">{row.adGroupName ?? "—"}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-tan">{formatCents(row.spendCents)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-text">{formatCount(row.clicks)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-text">{formatCents(row.cpaCents)}</td>
                  <td className="px-5 py-3 text-right">
                    <span className={row.wasteFlag ? "text-rose" : "text-text-mute"}>
                      {row.wasteFlag ?? "—"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function EventLedgerSection({ rows }: { rows: SpecEventLedgerRow[] }) {
  return (
    <section aria-label="SPEC event ledger" className="border-b border-white/[0.08] px-8 py-6">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="font-cakemono text-[18px] font-light uppercase leading-none text-text">
          <span aria-hidden="true" className="mr-2 font-mono text-text-mute">
            {"//"}
          </span>
          EVENT LEDGER
        </h2>
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-mute">
          <span className="text-text-mute">[</span>LAST {rows.length}
          <span className="text-text-mute">]</span>
        </span>
      </div>
      <div className="glass-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left font-mono text-[11px] uppercase tracking-[0.10em]">
            <thead className="text-text-mute">
              <tr className="border-b border-white/[0.06]">
                <th className="px-5 py-3 font-normal">Event</th>
                <th className="px-3 py-3 font-normal">Source</th>
                <th className="px-3 py-3 font-normal">Campaign</th>
                <th className="px-3 py-3 font-normal">Tier</th>
                <th className="px-3 py-3 text-right font-normal">Value</th>
                <th className="px-5 py-3 text-right font-normal">Time</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-6 text-text-mute">— no event rows</td>
                </tr>
              ) : rows.slice(0, 50).map((row) => (
                <tr key={row.id} className="border-b border-white/[0.04] last:border-0">
                  <td className="px-5 py-3 text-text">{row.eventName}</td>
                  <td className="px-3 py-3 text-text-3">{row.source ?? "—"}</td>
                  <td className="max-w-[180px] truncate px-3 py-3 text-text-3">{row.campaign ?? "—"}</td>
                  <td className="px-3 py-3 text-text-3">{row.tier ?? "—"}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-tan">{formatCents(row.valueCents)}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-text-mute">{formatTimestamp(row.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function SensitiveExport({ href }: { href: string }) {
  const [armed, setArmed] = useState(false);

  if (!armed) {
    return (
      <button
        type="button"
        onClick={() => setArmed(true)}
        className="inline-flex h-11 items-center justify-center rounded-[5px] border border-rose/35 font-cakemono text-[13px] font-light uppercase text-rose transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-rose/10"
      >
        EXPORT SENSITIVE
      </button>
    );
  }

  return (
    <div className="grid gap-2">
      <a
        href={href}
        onClick={() => setArmed(false)}
        className="inline-flex h-11 items-center justify-center rounded-[5px] border border-rose bg-rose/15 font-cakemono text-[13px] font-light uppercase text-rose transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-rose/25"
      >
        CONFIRM · UNREDACTED
      </a>
      <button
        type="button"
        onClick={() => setArmed(false)}
        className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-mute transition-colors duration-150 hover:text-text-3"
      >
        CANCEL
      </button>
    </div>
  );
}

function ExportSection({
  exportHref,
  payload,
}: {
  exportHref: string;
  payload: SpecAnalyticsPayload;
}) {
  return (
    <section aria-label="SPEC analytics export" className="px-8 py-6">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr,420px]">
        <div className="glass-surface p-5">
          <h2 className="font-cakemono text-[18px] font-light uppercase leading-none text-text">
            <span aria-hidden="true" className="mr-2 font-mono text-text-mute">
              {"//"}
            </span>
            EXPORT
          </h2>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <a
              href={`${exportHref}&mode=default`}
              className="inline-flex h-11 items-center justify-center rounded-[5px] border border-white/[0.12] font-cakemono text-[13px] font-light uppercase text-text transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-white/[0.05]"
            >
              EXPORT REDACTED
            </a>
            <SensitiveExport href={`${exportHref}&mode=sensitive`} />
          </div>
          <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-text-mute">
            <span className="text-text-mute">[</span> SENSITIVE EXPORT INCLUDES UNREDACTED CONTACT + FINANCIAL DATA <span className="text-text-mute">]</span>
          </p>
        </div>

        <div className="glass-surface p-5">
          <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-3">
            PACKAGE
          </h3>
          <dl className="mt-4 space-y-2 font-mono text-[11px] uppercase tracking-[0.12em]">
            <Row label="RANGE" value={`${payload.range.from} → ${payload.range.to}`} />
            <Row label="EVENTS" value={formatCount(payload.events.length)} />
            <Row label="CAMPAIGNS" value={formatCount(payload.campaigns.length)} />
            <Row label="SEARCH TERMS" value={formatCount(payload.searchTerms.length)} />
            <Row label="WEB SESSIONS" value={formatCount(payload.web.sessions)} />
          </dl>
        </div>
      </div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-text-mute">{label}</dt>
      <dd className="tabular-nums text-text">{value}</dd>
    </div>
  );
}

function clampPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value * 100)));
}

function buildSpendPath(points: SpecDailySpendPoint[]): { line: string; fill: string } | null {
  if (points.length < 2) return null;
  const max = Math.max(...points.map((point) => point.spendCents));
  if (max <= 0) return null;

  const width = 480;
  const height = 150;
  const baseY = 126;
  const topY = 14;
  const step = width / (points.length - 1);

  const line = points.map((point, index) => {
    const x = index * step;
    const y = baseY - (point.spendCents / max) * (baseY - topY);
    return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  return {
    line,
    fill: `${line} L${width},${baseY} L0,${baseY} Z`,
  };
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-CA", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
