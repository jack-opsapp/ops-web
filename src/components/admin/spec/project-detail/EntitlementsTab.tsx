"use client";

import { useState } from "react";
import { toggleEntitlement } from "@/app/admin/spec/[id]/_actions/toggle-entitlement";
import type {
  SpecEntitlementDisabledReason,
  SpecEntitlementRow,
  SpecEntitlementsTab,
} from "@/lib/admin/spec-types";
import { formatCents, formatDate } from "./format";

interface EntitlementsTabProps {
  data: SpecEntitlementsTab;
  projectId: string;
}

const REASON_LABEL: Record<SpecEntitlementDisabledReason, string> = {
  non_payment: "NON-PAYMENT",
  dispute: "DISPUTE",
  refunded: "REFUNDED · TERMINAL",
  subscription_lapse: "SUB LAPSED · TERMINAL",
  customer_request: "CUSTOMER REQUEST",
  ops_decision: "OPS DECISION",
  not_yet_delivered: "NOT YET DELIVERED",
};

const REASON_TONE: Record<SpecEntitlementDisabledReason, string> = {
  non_payment: "text-[#B58289] border-[#93321A]/60",
  dispute: "text-[#B58289] border-[#93321A]/60",
  refunded: "text-[#B58289] border-[#93321A]/60",
  subscription_lapse: "text-[#B58289] border-[#93321A]/60",
  customer_request: "text-[#C4A868] border-[#C4A868]/40",
  ops_decision: "text-[#C4A868] border-[#C4A868]/40",
  not_yet_delivered: "text-[#8A8A8A] border-white/[0.10]",
};

export function EntitlementsTab({ data, projectId }: EntitlementsTabProps) {
  const counts = {
    total: data.rows.length,
    enabled: data.rows.filter((r) => r.enabled).length,
    disabled: data.rows.filter((r) => !r.enabled).length,
  };

  return (
    <div className="space-y-6">
      <section
        aria-label="Entitlements summary"
        className="rounded-[10px] border border-white/[0.10] bg-[rgba(18,18,20,0.58)] p-5 backdrop-blur-[28px]"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="font-cakemono text-[14px] font-light uppercase leading-none text-[#EDEDED]">
            <span aria-hidden="true" className="mr-2 font-mono text-[#6A6A6A]">
              {"//"}
            </span>
            MODULE ENTITLEMENTS
          </h2>
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#C4A868]">
            <span className="text-[#3A3A3A]">[</span>
            HIGH-CONSEQUENCE · CUSTOMER LOSES / REGAINS ACCESS IMMEDIATELY
            <span className="text-[#3A3A3A]">]</span>
          </span>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-x-6 gap-y-3">
          <Kpi label="MODULES" value={counts.total} />
          <Kpi label="ENABLED" value={counts.enabled} tone={counts.enabled > 0 ? "text-[#9DB582]" : "text-[#EDEDED]"} />
          <Kpi
            label="DISABLED"
            value={counts.disabled}
            tone={counts.disabled > 0 ? "text-[#B58289]" : "text-[#EDEDED]"}
          />
        </div>
      </section>

      {data.rows.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-3">
          {data.rows.map((row) => (
            <EntitlementCard key={row.id} row={row} projectId={projectId} />
          ))}
        </div>
      )}

      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#6A6A6A]">
        <span className="text-[#3A3A3A]">[</span>
        TERMINAL REASONS (REFUNDED / SUBSCRIPTION_LAPSE) CANNOT BE OPERATOR-CLEARED · USE REFUND / STRIPE FLOW
        <span className="text-[#3A3A3A]">]</span>
      </p>
    </div>
  );
}

function EntitlementCard({ row, projectId }: { row: SpecEntitlementRow; projectId: string }) {
  const [confirmOpen, setConfirmOpen] = useState<"disable" | "enable" | null>(null);

  return (
    <article
      aria-label={`Entitlement: ${row.moduleKey}`}
      className={`rounded-[10px] border bg-[rgba(18,18,20,0.58)] p-5 backdrop-blur-[28px] ${
        row.enabled ? "border-[#9DB582]/30" : row.disabledReason && ["refunded", "subscription_lapse"].includes(row.disabledReason) ? "border-[#93321A]/40" : "border-white/[0.10]"
      }`}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-mohave text-[16px] text-[#EDEDED]">{formatModuleKey(row.moduleKey)}</h3>
            <Pill className={row.enabled ? "text-[#9DB582] border-[#9DB582]/40" : "text-[#B58289] border-[#B58289]/40"}>
              {row.enabled ? "ENABLED" : "DISABLED"}
            </Pill>
            {row.disabledReason && (
              <Pill className={REASON_TONE[row.disabledReason]}>{REASON_LABEL[row.disabledReason]}</Pill>
            )}
          </div>
          <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[#6A6A6A]">
            <span className="text-[#3A3A3A]">[</span>
            KEY · {row.moduleKey}
            <span className="text-[#3A3A3A]">]</span>
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          {row.enabled ? (
            <button
              type="button"
              onClick={() => setConfirmOpen(confirmOpen === "disable" ? null : "disable")}
              className="rounded-[5px] border border-[#B58289] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-[#B58289] transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-[#B58289] hover:text-black"
            >
              DISABLE
            </button>
          ) : row.canReEnable ? (
            <button
              type="button"
              onClick={() => setConfirmOpen(confirmOpen === "enable" ? null : "enable")}
              className="rounded-[5px] border border-[#9DB582] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-[#9DB582] transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-[#9DB582] hover:text-black"
            >
              RE-ENABLE
            </button>
          ) : (
            <span
              className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#6A6A6A]"
              title={row.disabledReason ? `${REASON_LABEL[row.disabledReason]} — operator cannot clear` : ""}
            >
              LOCKED · TERMINAL
            </span>
          )}
        </div>
      </header>

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 border-t border-white/[0.06] pt-4 sm:grid-cols-4">
        <Field label="MULTIPLIER" value={row.multiplier.toFixed(2)} mono />
        <Field label="SURCHARGE" value={formatCents(row.surchargeCents)} mono />
        <Field label="ENTITLED" value={formatDate(row.entitledAt)} mono />
        <Field
          label={row.enabled ? "ENABLED AT" : "DISABLED AT"}
          value={formatDate(row.enabled ? row.enabledAt : row.disabledAt)}
          mono
        />
        {row.stripeSubscriptionItemId && (
          <Field
            label="STRIPE ITEM"
            value={row.stripeSubscriptionItemId}
            mono
            wide
            title={row.stripeSubscriptionItemId}
          />
        )}
      </dl>

      {confirmOpen === "disable" && (
        <DisableForm projectId={projectId} row={row} onCancel={() => setConfirmOpen(null)} />
      )}
      {confirmOpen === "enable" && (
        <EnableForm projectId={projectId} row={row} onCancel={() => setConfirmOpen(null)} />
      )}
    </article>
  );
}

function DisableForm({
  projectId,
  row,
  onCancel,
}: {
  projectId: string;
  row: SpecEntitlementRow;
  onCancel: () => void;
}) {
  const operatorReasons: SpecEntitlementDisabledReason[] = [
    "non_payment",
    "dispute",
    "customer_request",
    "ops_decision",
    "not_yet_delivered",
  ];
  return (
    <form
      action={toggleEntitlement}
      className="mt-4 space-y-3 rounded-[5px] border border-[#93321A]/50 bg-[#93321A]/[0.06] p-4"
    >
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="entitlement_id" value={row.id} />
      <input type="hidden" name="intended_state" value="disabled" />

      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#B58289]">
        <span className="text-[#3A3A3A]">[</span>
        WARNING · IMMEDIATE EFFECT
        <span className="text-[#3A3A3A]">]</span>
      </p>
      <p className="text-[12px] text-[#EDEDED]">
        This will remove the customer&apos;s access to{" "}
        <strong className="font-mohave text-[#EDEDED]">{formatModuleKey(row.moduleKey)}</strong> inside
        OPS-Web. They will be notified by email and in-app.
      </p>

      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#6A6A6A]">
          <span className="text-[#3A3A3A]">[</span>
          REASON
          <span className="text-[#3A3A3A]">]</span>
        </span>
        <select
          name="disabled_reason"
          required
          defaultValue="customer_request"
          className="w-full rounded-[5px] border border-white/[0.10] bg-black px-3 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[#EDEDED] outline-none transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] focus:border-[#B58289]"
        >
          {operatorReasons.map((r) => (
            <option key={r} value={r}>
              {REASON_LABEL[r]}
            </option>
          ))}
        </select>
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#6A6A6A]">
          <span className="text-[#3A3A3A]">[</span>
          REFUNDED / SUBSCRIPTION_LAPSE ARE FIRED AUTOMATICALLY BY THEIR FLOWS · NOT OPERATOR-SELECTABLE HERE
          <span className="text-[#3A3A3A]">]</span>
        </span>
      </label>

      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          className="rounded-[5px] border border-[#B58289] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[#B58289] transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-[#B58289] hover:text-black"
        >
          CONFIRM DISABLE
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#8A8A8A] hover:text-[#EDEDED]"
        >
          CANCEL
        </button>
      </div>
    </form>
  );
}

function EnableForm({
  projectId,
  row,
  onCancel,
}: {
  projectId: string;
  row: SpecEntitlementRow;
  onCancel: () => void;
}) {
  return (
    <form
      action={toggleEntitlement}
      className="mt-4 space-y-3 rounded-[5px] border border-[#9DB582]/50 bg-[#9DB582]/[0.06] p-4"
    >
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="entitlement_id" value={row.id} />
      <input type="hidden" name="intended_state" value="enabled" />

      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#9DB582]">
        <span className="text-[#3A3A3A]">[</span>
        CONFIRM RE-ENABLE
        <span className="text-[#3A3A3A]">]</span>
      </p>
      <p className="text-[12px] text-[#EDEDED]">
        This will restore the customer&apos;s access to{" "}
        <strong className="font-mohave text-[#EDEDED]">{formatModuleKey(row.moduleKey)}</strong>. The previous disabled reason
        {row.disabledReason ? ` (${REASON_LABEL[row.disabledReason]})` : ""} will be cleared.
      </p>

      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          className="rounded-[5px] border border-[#9DB582] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[#9DB582] transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-[#9DB582] hover:text-black"
        >
          CONFIRM RE-ENABLE
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#8A8A8A] hover:text-[#EDEDED]"
        >
          CANCEL
        </button>
      </div>
    </form>
  );
}

function Pill({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={`rounded-[4px] border px-1.5 py-px font-mono text-[10px] uppercase tracking-[0.16em] ${className ?? ""}`}
    >
      {children}
    </span>
  );
}

function Field({
  label,
  value,
  mono,
  wide,
  title,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  wide?: boolean;
  title?: string;
}) {
  return (
    <div className={wide ? "col-span-2 sm:col-span-4" : ""}>
      <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#6A6A6A]">{label}</dt>
      <dd
        title={title}
        className={`mt-0.5 text-[12px] text-[#EDEDED] ${mono ? "font-mono tabular-nums" : ""} ${wide ? "truncate" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-[10px] border border-white/[0.08] bg-[rgba(18,18,20,0.40)] p-8 text-center backdrop-blur-[28px]">
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#8A8A8A]">
        — no entitlements reserved yet
      </p>
      <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[#6A6A6A]">
        rows are seeded at scope sign-off (disabled / not_yet_delivered) and flipped on at delivery walkthrough.
      </p>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#6A6A6A]">{label}</p>
      <p className={`mt-1 font-mono text-[20px] tabular-nums leading-none ${tone ?? "text-[#EDEDED]"}`}>
        {value}
      </p>
    </div>
  );
}

function formatModuleKey(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
