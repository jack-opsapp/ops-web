"use client";

import { useState, useTransition } from "react";
import type { CapacityEditRow, SpecTier } from "@/lib/admin/spec-types";
import {
  saveCapacityAction,
  type SaveCapacityFormState,
} from "../_actions/save-capacity";

interface CapacityTierFormProps {
  row: CapacityEditRow;
}

const TIER_HINT: Record<SpecTier, string> = {
  setup: "SHORT ENGAGEMENT · 1–2 WEEK BUILD",
  build: "FULL BUILD · 3–4 WEEK ENGAGEMENT",
  enterprise: "CUSTOM SCOPE · 4–6+ WEEK BUILD",
};

function formatUpdatedAt(iso: string | null): string {
  if (!iso) return "[never]";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.max(0, Math.floor(ms / 1000))}s ago`;
  if (ms < 60 * 60_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 24 * 60 * 60_000) return `${Math.floor(ms / 60 / 60_000)}h ago`;
  return `${Math.floor(ms / 24 / 60 / 60_000)}d ago`;
}

export function CapacityTierForm({ row }: CapacityTierFormProps) {
  const [state, setState] = useState<SaveCapacityFormState>({ status: "idle" });
  const [pending, startTransition] = useTransition();
  const [bookingsEnabled, setBookingsEnabled] = useState(row.isAcceptingBookings);

  async function handleSubmit(formData: FormData) {
    // Inject the toggle value (since we render it via button, not native checkbox).
    formData.set("is_accepting_bookings", bookingsEnabled ? "1" : "0");
    setState({ status: "pending" });
    startTransition(async () => {
      const result = await saveCapacityAction(row.tier, formData);
      setState(result);
    });
  }

  const errors = state.status === "error" ? state.errors ?? {} : {};
  const formError = state.status === "error" ? state.formError : null;
  const success = state.status === "success";

  return (
    <form
      action={handleSubmit}
      className="rounded-[10px] border border-white/[0.10] bg-[rgba(18,18,20,0.58)] backdrop-blur-[28px] backdrop-saturate-[1.3] p-6"
      aria-labelledby={`capacity-${row.tier}-heading`}
    >
      {/* Tier heading */}
      <header className="mb-5 flex items-baseline justify-between">
        <div>
          <h2
            id={`capacity-${row.tier}-heading`}
            className="font-cakemono text-[20px] font-light uppercase tracking-[0.04em] text-[#EDEDED]"
          >
            {row.tier}
          </h2>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[#6A6A6A]">
            <span className="text-[#3A3A3A]">[</span>
            {TIER_HINT[row.tier]}
            <span className="text-[#3A3A3A]">]</span>
          </p>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#6A6A6A]">
          <span className="text-[#3A3A3A]">[</span>
          UPDATED {formatUpdatedAt(row.updatedAt)}
          <span className="text-[#3A3A3A]">]</span>
        </span>
      </header>

      {/* Capacity */}
      <Section label="// CAPACITY">
        <FieldGroup>
          <Field label="SLOT CEILING" hint="0 closes the tier" error={errors.slot_ceiling}>
            <NumberInput
              name="slot_ceiling"
              defaultValue={row.slotCeiling}
              min={0}
              step={1}
            />
          </Field>
          <Toggle
            label="ACCEPTING BOOKINGS"
            enabled={bookingsEnabled}
            onToggle={() => setBookingsEnabled((b) => !b)}
          />
        </FieldGroup>
        <Field
          label="MANUAL NEXT-START OVERRIDE"
          hint="Optional · forces /spec to show this date instead of auto-calc"
          error={errors.manual_next_start_override}
        >
          <DateInput
            name="manual_next_start_override"
            defaultValue={row.manualNextStartOverride ?? ""}
          />
        </Field>
      </Section>

      {/* Duration */}
      <Section label="// DURATION ESTIMATES">
        <FieldGroup>
          <Field label="DISCOVERY MIN (DAYS)" error={errors.discovery_days_min}>
            <NumberInput
              name="discovery_days_min"
              defaultValue={row.discoveryDaysMin}
              min={0}
              step={1}
            />
          </Field>
          <Field label="DISCOVERY MAX (DAYS)" error={errors.discovery_days_max}>
            <NumberInput
              name="discovery_days_max"
              defaultValue={row.discoveryDaysMax}
              min={0}
              step={1}
            />
          </Field>
        </FieldGroup>
        <FieldGroup>
          <Field label="BUILD MIN (DAYS)" error={errors.build_days_min}>
            <NumberInput
              name="build_days_min"
              defaultValue={row.buildDaysMin}
              min={0}
              step={1}
            />
          </Field>
          <Field label="BUILD MAX (DAYS)" error={errors.build_days_max}>
            <NumberInput
              name="build_days_max"
              defaultValue={row.buildDaysMax}
              min={0}
              step={1}
            />
          </Field>
        </FieldGroup>
        <Field label="SUPPORT WINDOW (DAYS)" error={errors.support_window_days}>
          <NumberInput
            name="support_window_days"
            defaultValue={row.supportWindowDays}
            min={0}
            step={1}
          />
        </Field>
      </Section>

      {/* Pricing */}
      <Section label="// PRICING">
        <Field
          label="SUBSCRIPTION MULTIPLIER ESTIMATE"
          hint="e.g. 0.30 for build · published on /spec"
          error={errors.subscription_multiplier_estimate}
        >
          <NumberInput
            name="subscription_multiplier_estimate"
            defaultValue={row.subscriptionMultiplierEstimate.toFixed(2)}
            min={0}
            step={0.01}
          />
        </Field>
        <Field
          label="RETAINER MONTHLY ($)"
          hint="Whole dollars · stored as cents"
          error={errors.retainer_monthly_dollars}
        >
          <DollarInput
            name="retainer_monthly_dollars"
            defaultValue={(row.retainerMonthlyCents / 100).toFixed(0)}
          />
        </Field>
        <Field
          label="POLISH BUDGET (HOURS)"
          hint="0.5 increments"
          error={errors.polish_hours_budget}
        >
          <NumberInput
            name="polish_hours_budget"
            defaultValue={row.polishHoursBudget.toFixed(1)}
            min={0}
            step={0.5}
          />
        </Field>
      </Section>

      {/* Public note */}
      <Section label="// PUBLIC NOTE">
        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[#6A6A6A]">
          <span className="text-[#3A3A3A]">[</span>
          SURFACES ON /SPEC OPS BOARD · CUSTOMER-FACING · TERSE
          <span className="text-[#3A3A3A]">]</span>
        </p>
        <TextArea
          name="public_note"
          defaultValue={row.publicNote ?? ""}
          rows={3}
          maxLength={240}
          placeholder="// e.g. NEXT SLOT OPENS JUN 02 — DEPOSIT TO HOLD"
          error={errors.public_note}
        />
      </Section>

      {/* Admin notes */}
      <Section label="// ADMIN NOTES">
        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[#6A6A6A]">
          <span className="text-[#3A3A3A]">[</span>
          PRIVATE · OPERATOR-ONLY
          <span className="text-[#3A3A3A]">]</span>
        </p>
        <TextArea
          name="admin_notes"
          defaultValue={row.adminNotes ?? ""}
          rows={3}
          maxLength={2000}
          placeholder="// e.g. JACKSON ON VACATION JUN 10–17 — DON'T BOOK"
          error={errors.admin_notes}
        />
      </Section>

      {/* Footer: save + status */}
      <footer className="mt-6 flex items-center justify-between border-t border-white/[0.06] pt-5">
        <div className="font-mono text-[10px] uppercase tracking-[0.14em]">
          {pending && <span className="text-[#6A6A6A]">[SAVING…]</span>}
          {success && (
            <span className="text-[#9DB582]">
              <span className="text-[#3A3A3A]">[</span>
              SAVED · BOARD REFRESHED
              <span className="text-[#3A3A3A]">]</span>
            </span>
          )}
          {formError && (
            <span className="text-[#B58289]">
              <span className="text-[#3A3A3A]">[</span>
              ERR · {formError}
              <span className="text-[#3A3A3A]">]</span>
            </span>
          )}
        </div>
        <button
          type="submit"
          disabled={pending}
          className={`inline-flex items-center gap-2 rounded-[5px] border border-[#6F94B0] bg-transparent px-4 py-[6px] font-mono text-[12px] uppercase tracking-[0.14em] text-[#6F94B0] transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-[#6F94B0] hover:text-black focus-visible:outline focus-visible:outline-[1.5px] focus-visible:outline-[#6F94B0] focus-visible:outline-offset-2 disabled:opacity-50`}
        >
          {pending ? "SAVING…" : "SAVE"}
        </button>
      </footer>
    </form>
  );
}

// ─── Form primitives ─────────────────────────────────────────────────────────

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="mb-6 last:mb-0">
      <h3 className="mb-3 font-cakemono text-[12px] font-light uppercase tracking-[0.06em] text-[#8A8A8A]">
        {label}
      </h3>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function FieldGroup({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-4">{children}</div>;
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block font-mono text-[10px] uppercase tracking-[0.18em] text-[#8A8A8A]">
        {label}
      </span>
      <div className="mt-1.5">{children}</div>
      {hint && !error ? (
        <span className="mt-1 block font-mono text-[10px] uppercase tracking-[0.12em] text-[#6A6A6A]">
          {hint}
        </span>
      ) : null}
      {error ? (
        <span className="mt-1 block font-mono text-[10px] uppercase tracking-[0.12em] text-[#B58289]">
          <span className="text-[#3A3A3A]">[</span>
          {error}
          <span className="text-[#3A3A3A]">]</span>
        </span>
      ) : null}
    </label>
  );
}

const INPUT_BASE =
  "w-full rounded-[5px] border border-white/[0.10] bg-black/40 px-3 py-[7px] font-mono text-[13px] text-[#EDEDED] tabular-nums " +
  "placeholder:text-[#3A3A3A] " +
  "focus:border-[#6F94B0] focus:outline-none " +
  "transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]";

function NumberInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input type="number" inputMode="decimal" className={INPUT_BASE} {...props} />;
}

function DollarInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="relative">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-[12px] text-[#6A6A6A]"
      >
        $
      </span>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        step={1}
        className={`${INPUT_BASE} pl-7`}
        {...props}
      />
    </div>
  );
}

function DateInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input type="date" className={INPUT_BASE} {...props} />;
}

function TextArea({
  error,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { error?: string }) {
  return (
    <div>
      <textarea
        className={`${INPUT_BASE} resize-y leading-snug`}
        {...props}
      />
      {error ? (
        <span className="mt-1 block font-mono text-[10px] uppercase tracking-[0.12em] text-[#B58289]">
          <span className="text-[#3A3A3A]">[</span>
          {error}
          <span className="text-[#3A3A3A]">]</span>
        </span>
      ) : null}
    </div>
  );
}

function Toggle({
  label,
  enabled,
  onToggle,
}: {
  label: string;
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex flex-col">
      <span className="block font-mono text-[10px] uppercase tracking-[0.18em] text-[#8A8A8A]">
        {label}
      </span>
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={enabled}
        className={`mt-1.5 inline-flex h-[34px] items-center justify-between gap-3 rounded-[5px] border px-3 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] ${
          enabled
            ? "border-[#9DB582]/40 bg-[#9DB582]/8 text-[#9DB582]"
            : "border-[#93321A]/40 bg-[#93321A]/8 text-[#B58289]"
        }`}
      >
        <span>{enabled ? "OPEN" : "CLOSED"}</span>
        <span
          aria-hidden="true"
          className={`inline-block h-[8px] w-[8px] rounded-full ${
            enabled ? "bg-[#9DB582]" : "bg-[#B58289]"
          }`}
        />
      </button>
    </div>
  );
}
