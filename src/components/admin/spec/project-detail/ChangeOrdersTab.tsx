"use client";

import { useState } from "react";
import { createChangeOrder } from "@/app/admin/spec/[id]/_actions/create-change-order";
import type {
  SpecChangeOrderRow,
  SpecChangeOrderStatus,
  SpecChangeOrderType,
  SpecChangeOrdersTab,
} from "@/lib/admin/spec-types";
import { formatCents, formatDate, formatHours, statusLabel } from "./format";

interface ChangeOrdersTabProps {
  data: SpecChangeOrdersTab;
  projectId: string;
}

const TYPE_LABEL: Record<SpecChangeOrderType, string> = {
  minor_hourly: "MINOR · HOURLY",
  major_fixed: "MAJOR · FIXED",
  polish_budget: "POLISH BUDGET",
  platform_compat_rebuild: "PLATFORM REBUILD",
  tier_upgrade: "TIER UPGRADE",
};

const STATUS_TONE: Record<SpecChangeOrderStatus, string> = {
  proposed: "text-tan border-tan/40",
  customer_approved: "text-olive border-olive/40",
  customer_declined: "text-rose border-rose/40",
  in_progress: "text-olive border-olive/40",
  completed: "text-olive border-olive/40",
  paid: "text-olive border-olive/40",
};

const STRIPE_DASHBOARD_BASE =
  process.env.NEXT_PUBLIC_STRIPE_DASHBOARD_BASE ?? "https://dashboard.stripe.com";

export function ChangeOrdersTab({ data, projectId }: ChangeOrdersTabProps) {
  const [wizardOpen, setWizardOpen] = useState(false);
  const polishRemaining = Math.max(0, data.polishHoursBudget - data.polishHoursUsed);

  return (
    <div className="space-y-6">
      <section
        aria-label="Change orders summary"
        className="glass-surface p-5"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="font-cakemono text-[14px] font-light uppercase leading-none text-text">
            <span aria-hidden="true" className="mr-2 font-mono text-text-mute">
              {"//"}
            </span>
            CHANGE ORDERS
          </h2>
          <button
            type="button"
            onClick={() => setWizardOpen((v) => !v)}
            className="rounded-[5px] border border-ops-accent px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-ops-accent transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-ops-accent hover:text-black"
          >
            {wizardOpen ? "CLOSE WIZARD" : "NEW CHANGE ORDER"}
          </button>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          <Kpi label="PROPOSED" value={countByStatus(data.rows, "proposed")} />
          <Kpi
            label="APPROVED"
            value={countByStatus(data.rows, "customer_approved") + countByStatus(data.rows, "in_progress")}
            tone="text-olive"
          />
          <Kpi label="COMPLETED" value={countByStatus(data.rows, "completed") + countByStatus(data.rows, "paid")} />
          <Kpi
            label="POLISH HRS"
            value={`${formatHours(data.polishHoursUsed)} / ${formatHours(data.polishHoursBudget)}`}
            tone={polishRemaining <= 0 ? "text-rose" : "text-text"}
          />
        </div>

        {wizardOpen && <ChangeOrderWizard projectId={projectId} onCancel={() => setWizardOpen(false)} />}
      </section>

      {data.rows.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="overflow-x-auto glass-surface">
          <table className="w-full min-w-[920px] border-collapse">
            <thead>
              <tr className="border-b border-white/[0.08] text-left">
                <Th>TYPE</Th>
                <Th>TITLE</Th>
                <Th>STATUS</Th>
                <Th align="right">EST</Th>
                <Th align="right">COST</Th>
                <Th>DELIVERY +</Th>
                <Th>PROPOSED</Th>
                <Th>ACCEPTED</Th>
                <Th>INVOICE</Th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <ChangeOrderRow key={row.id} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-mute">
        <span className="text-text-mute">[</span>
        MINOR HOURLY @ $225/HR · BUCKETED TO 30 MIN · ≥ 4H REQUIRES FIXED QUOTE
        <span className="text-text-mute">]</span>
      </p>
    </div>
  );
}

function ChangeOrderRow({ row }: { row: SpecChangeOrderRow }) {
  const acceptedAt = row.approvedAt ?? row.declinedAt;
  const finalCost = row.finalCostCents ?? row.fixedPriceCents ?? null;
  return (
    <tr className="border-b border-white/[0.04] last:border-b-0">
      <Td>
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-mute">
          {TYPE_LABEL[row.changeType]}
        </span>
      </Td>
      <Td>
        <span className="block max-w-[260px] truncate text-[13px] text-text" title={row.title}>
          {row.title}
        </span>
        {row.description && (
          <span
            className="mt-0.5 block max-w-[260px] truncate font-mono text-[10px] text-text-3"
            title={row.description}
          >
            {row.description}
          </span>
        )}
      </Td>
      <Td>
        <span
          className={`rounded-[4px] border px-1.5 py-px font-mono text-[10px] uppercase tracking-[0.16em] ${STATUS_TONE[row.status]}`}
        >
          {statusLabel(row.status)}
        </span>
      </Td>
      <Td align="right">
        <span className="font-mono text-[12px] tabular-nums text-text">
          {row.estimatedHours != null ? `${formatHours(row.estimatedHours)}h` : "—"}
        </span>
      </Td>
      <Td align="right">
        <span className="font-mono text-[12px] tabular-nums text-text">
          {finalCost != null ? formatCents(finalCost) : "—"}
        </span>
      </Td>
      <Td>
        <span className="font-mono text-[11px] tabular-nums text-text-2">
          {row.deliveryImpactDays > 0 ? `+${row.deliveryImpactDays}d` : "—"}
        </span>
      </Td>
      <Td>
        <span className="font-mono text-[11px] tabular-nums text-text-2">
          {formatDate(row.proposedAt)}
        </span>
      </Td>
      <Td>
        <span
          className={`font-mono text-[11px] tabular-nums ${
            row.approvedAt ? "text-olive" : row.declinedAt ? "text-rose" : "text-text-mute"
          }`}
        >
          {formatDate(acceptedAt)}
        </span>
      </Td>
      <Td>
        {row.stripeInvoiceId ? (
          <a
            href={`${STRIPE_DASHBOARD_BASE}/invoices/${row.stripeInvoiceId}`}
            target="_blank"
            rel="noreferrer"
            title={row.stripeInvoiceId}
            className="font-mono text-[11px] tabular-nums text-text-2 transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:text-text"
          >
            {row.stripeInvoiceId.length > 14
              ? `${row.stripeInvoiceId.slice(0, 14)}…`
              : row.stripeInvoiceId}{" "}
            ↗
          </a>
        ) : (
          <span className="font-mono text-[11px] text-text-mute">—</span>
        )}
      </Td>
    </tr>
  );
}

function ChangeOrderWizard({
  projectId,
  onCancel,
}: {
  projectId: string;
  onCancel: () => void;
}) {
  const [changeType, setChangeType] = useState<SpecChangeOrderType>("minor_hourly");

  return (
    <form
      action={createChangeOrder}
      className="mt-5 space-y-4 rounded-[10px] border border-white/[0.10] bg-black/40 p-4"
    >
      <input type="hidden" name="project_id" value={projectId} />

      <FieldRow label="TYPE">
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Change order type">
          <RadioPill
            value="minor_hourly"
            current={changeType}
            onChange={setChangeType}
            label="MINOR · HOURLY"
            sub="< 4h @ $225/hr"
          />
          <RadioPill
            value="major_fixed"
            current={changeType}
            onChange={setChangeType}
            label="MAJOR · FIXED"
            sub="≥ 4h fixed quote"
          />
          <RadioPill
            value="tier_upgrade"
            current={changeType}
            onChange={setChangeType}
            label="TIER UPGRADE"
            sub="upgrade quote"
          />
          <input type="hidden" name="change_type" value={changeType} />
        </div>
      </FieldRow>

      <FieldRow label="TITLE">
        <input
          type="text"
          name="title"
          required
          maxLength={200}
          placeholder="Concise title"
          className="w-full rounded-[5px] border border-white/[0.10] bg-black px-3 py-2 font-mono text-[12px] text-text outline-none transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] focus:border-[#6F94B0]"
        />
      </FieldRow>

      <FieldRow label="DESCRIPTION">
        <textarea
          name="description"
          required
          rows={3}
          placeholder="Scope, deliverables, acceptance criteria"
          className="w-full rounded-[5px] border border-white/[0.10] bg-black px-3 py-2 font-mono text-[12px] text-text outline-none transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] focus:border-[#6F94B0]"
        />
      </FieldRow>

      {changeType === "minor_hourly" && (
        <FieldRow label="ESTIMATED HOURS">
          <input
            type="number"
            name="estimated_hours"
            min={0.5}
            max={3.5}
            step={0.5}
            required
            placeholder="0.5 – 3.5"
            className="w-32 rounded-[5px] border border-white/[0.10] bg-black px-3 py-2 font-mono text-[12px] tabular-nums text-text outline-none transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] focus:border-[#6F94B0]"
          />
          <span className="ml-3 font-mono text-[10px] uppercase tracking-[0.16em] text-text-mute">
            <span className="text-text-mute">[</span>
            BUCKETED TO 30 MIN · ≥ 4H REQUIRES FIXED QUOTE
            <span className="text-text-mute">]</span>
          </span>
        </FieldRow>
      )}

      {(changeType === "major_fixed" || changeType === "tier_upgrade") && (
        <FieldRow label="FIXED PRICE">
          <span className="inline-flex items-center gap-2">
            <span className="font-mono text-[12px] text-text-mute">$</span>
            <input
              type="number"
              name="fixed_price_cents"
              min={100}
              step={100}
              required
              placeholder="Cents (e.g. 75000 = $750)"
              className="w-48 rounded-[5px] border border-white/[0.10] bg-black px-3 py-2 font-mono text-[12px] tabular-nums text-text outline-none transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] focus:border-[#6F94B0]"
            />
          </span>
        </FieldRow>
      )}

      <FieldRow label="DELIVERY IMPACT">
        <span className="inline-flex items-center gap-2">
          <input
            type="number"
            name="delivery_impact_days"
            min={0}
            max={60}
            step={1}
            defaultValue={0}
            className="w-24 rounded-[5px] border border-white/[0.10] bg-black px-3 py-2 font-mono text-[12px] tabular-nums text-text outline-none transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] focus:border-[#6F94B0]"
          />
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-mute">DAYS ADDED</span>
        </span>
      </FieldRow>

      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          className="rounded-[5px] border border-ops-accent px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-ops-accent transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-ops-accent hover:text-black"
        >
          PROPOSE CHANGE ORDER
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-3 transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:text-text"
        >
          CANCEL
        </button>
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-mute">
          <span className="text-text-mute">[</span>
          CUSTOMER MUST ACCEPT BEFORE INVOICING
          <span className="text-text-mute">]</span>
        </span>
      </div>
    </form>
  );
}

function RadioPill({
  value,
  current,
  onChange,
  label,
  sub,
}: {
  value: SpecChangeOrderType;
  current: SpecChangeOrderType;
  onChange: (v: SpecChangeOrderType) => void;
  label: string;
  sub: string;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={() => onChange(value)}
      className={`flex min-w-[140px] flex-col items-start gap-0.5 rounded-[5px] border px-3 py-2 text-left transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] ${
        active
          ? "border-white/[0.30] bg-white/[0.06] text-text"
          : "border-white/[0.10] text-text-3 hover:text-text"
      }`}
    >
      <span className="font-mono text-[11px] uppercase tracking-[0.16em]">{label}</span>
      <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-text-mute">{sub}</span>
    </button>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-mute">
        <span className="text-text-mute">[</span>
        {label}
        <span className="text-text-mute">]</span>
      </span>
      {children}
    </label>
  );
}

function EmptyState() {
  return (
    <div className="rounded-[10px] border border-white/[0.08] bg-[rgba(18,18,20,0.40)] p-8 text-center backdrop-blur-[28px]">
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-3">
        — no change orders yet
      </p>
      <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-text-mute">
        propose one above. customer must accept before invoicing.
      </p>
    </div>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: "right" }) {
  return (
    <th
      className={`px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-text-mute ${
        align === "right" ? "text-right" : ""
      }`}
    >
      {children}
    </th>
  );
}

function Td({ children, align }: { children: React.ReactNode; align?: "right" }) {
  return (
    <td className={`px-3 py-3 align-middle ${align === "right" ? "text-right" : ""}`}>
      {children}
    </td>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-mute">{label}</p>
      <p className={`mt-1 font-mono text-[16px] tabular-nums leading-none ${tone ?? "text-text"}`}>
        {value}
      </p>
    </div>
  );
}

function countByStatus(rows: readonly SpecChangeOrderRow[], status: SpecChangeOrderStatus): number {
  return rows.filter((r) => r.status === status).length;
}
