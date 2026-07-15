"use client";

import { useState, useEffect } from "react";
import { X, Calendar, Save, AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "@/components/ui/toast";
import type { DataSetupQueueRow } from "@/lib/admin/data-setup-queries";
import { patchAndMerge } from "../actions";
import { StatusPill } from "./status-pill";

interface Props {
  row: DataSetupQueueRow;
  onClose: () => void;
  onUpdated: (next: DataSetupQueueRow) => void;
}

function toLocalDateTimeInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // datetime-local expects "YYYY-MM-DDTHH:mm" without TZ. Convert from UTC
  // to the operator's local TZ for editing convenience.
  const offset = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - offset).toISOString().slice(0, 16);
}

function fromLocalDateTimeInputValue(s: string): string | null {
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function formatAmount(cents: number | null): string {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

export function RequestDetailDrawer({
  row,
  onClose,
  onUpdated,
}: Props) {
  // Editable local copy
  const [scheduled, setScheduled] = useState(
    toLocalDateTimeInputValue(row.scheduledAt)
  );
  const [notes, setNotes] = useState(row.notes ?? "");
  const [sourceSoftware, setSourceSoftware] = useState(row.sourceSoftware ?? "");
  const [contactEmail, setContactEmail] = useState(row.contactEmail ?? "");
  const [contactPhone, setContactPhone] = useState(row.contactPhone ?? "");
  const [saving, setSaving] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  // When the row changes (e.g. after a quick action), refresh the local form.
  useEffect(() => {
    setScheduled(toLocalDateTimeInputValue(row.scheduledAt));
    setNotes(row.notes ?? "");
    setSourceSoftware(row.sourceSoftware ?? "");
    setContactEmail(row.contactEmail ?? "");
    setContactPhone(row.contactPhone ?? "");
  }, [row.id, row.scheduledAt, row.notes, row.sourceSoftware, row.contactEmail, row.contactPhone]);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const dirty =
    toLocalDateTimeInputValue(row.scheduledAt) !== scheduled ||
    (row.notes ?? "") !== notes ||
    (row.sourceSoftware ?? "") !== sourceSoftware ||
    (row.contactEmail ?? "") !== contactEmail ||
    (row.contactPhone ?? "") !== contactPhone;

  async function handleSave() {
    setSaving(true);
    try {
      const next = await patchAndMerge(row, {
        scheduledAt: fromLocalDateTimeInputValue(scheduled),
        notes: notes || null,
        sourceSoftware: sourceSoftware || null,
        contactEmail: contactEmail || null,
        contactPhone: contactPhone || null,
      });
      onUpdated(next);
      toast.success("Saved");
    } catch (err) {
      toast.error("Couldn't save", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleSchedule() {
    const iso = fromLocalDateTimeInputValue(scheduled);
    if (!iso) {
      toast.error("Pick a date and time first");
      return;
    }
    setSaving(true);
    try {
      const next = await patchAndMerge(row, {
        status: "scheduled",
        scheduledAt: iso,
        notes: notes || null,
        sourceSoftware: sourceSoftware || null,
        contactEmail: contactEmail || null,
        contactPhone: contactPhone || null,
      });
      onUpdated(next);
      toast.success(`${row.companyName} scheduled`);
    } catch (err) {
      toast.error("Couldn't schedule", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(
    next: "in_progress" | "completed" | "pending"
  ) {
    setSaving(true);
    try {
      const updated = await patchAndMerge(row, { status: next });
      onUpdated(updated);
      toast.success(`Status → ${next.replace("_", " ")}`);
    } catch (err) {
      toast.error("Couldn't change status", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleCancel(clearEntitlement: boolean) {
    setSaving(true);
    try {
      const next = await patchAndMerge(row, {
        status: "cancelled",
        clearEntitlement,
      });
      onUpdated(next);
      toast.success(
        clearEntitlement
          ? "Cancelled + entitlement cleared"
          : "Cancelled (entitlement preserved)"
      );
      setConfirmCancel(false);
    } catch (err) {
      toast.error("Couldn't cancel", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-modal flex justify-end"
      onClick={onClose}
    >
      {/* Scrim */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Drawer */}
      <aside
        className="relative h-full w-full max-w-[480px] glass-dense border-l border-glass-border flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="flex items-start justify-between gap-3 px-5 py-4 border-b border-line">
          <div className="min-w-0">
            <p className="font-mono text-micro text-text-mute uppercase tracking-wider">
              {"// Data Setup"}
            </p>
            <h2 className="font-cakemono font-light uppercase text-[18px] text-text mt-1 truncate">
              {row.companyName}
            </h2>
            <div className="flex items-center gap-2 mt-1.5">
              <StatusPill status={row.status} />
              <span className="font-mono text-micro text-text-mute">
                Purchased{" "}
                {new Date(row.createdAt).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-text-3 hover:text-text hover:bg-white/[0.06] transition-colors"
            aria-label="Close"
          >
            <X className="w-[18px] h-[18px]" />
          </button>
        </header>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Payment block */}
          <Section label="// Payment">
            <FieldRow label="Amount">
              <span
                className="font-mono text-data-sm text-text tabular-nums"
                style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
              >
                {formatAmount(row.amountPaidCents)}
              </span>
            </FieldRow>
            <FieldRow label="Stripe payment ID">
              <span className="font-mono text-micro text-text-2 break-all">
                {row.stripePaymentIntentId ?? "—"}
              </span>
            </FieldRow>
          </Section>

          {/* Requester block */}
          <Section label="// Requester">
            <FieldRow label="Name">
              <span className="font-mohave text-body-sm text-text">
                {row.requesterName ?? "—"}
              </span>
            </FieldRow>
            <FieldRow label="Email">
              <span className="font-mono text-micro text-text-2">
                {row.requesterEmail ?? "—"}
              </span>
            </FieldRow>
          </Section>

          {/* Editable contact + scheduling */}
          <Section label="// Contact + schedule">
            <Field label="Contact email">
              <input
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder={row.companyEmail ?? "owner@example.com"}
                className={inputClass}
              />
            </Field>
            <Field label="Contact phone">
              <input
                type="tel"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                placeholder={row.companyPhone ?? "+1 555 0100"}
                className={inputClass}
              />
            </Field>
            <Field label="Source software">
              <input
                type="text"
                value={sourceSoftware}
                onChange={(e) => setSourceSoftware(e.target.value)}
                placeholder="Jobber, ServiceTitan, Housecall Pro..."
                className={inputClass}
              />
            </Field>
            <Field label="Migration date + time">
              <input
                type="datetime-local"
                value={scheduled}
                onChange={(e) => setScheduled(e.target.value)}
                className={inputClass}
              />
            </Field>
          </Section>

          {/* Notes */}
          <Section label="// Notes">
            <Field label="Internal notes">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={4}
                placeholder="Anything ops needs to remember…"
                className={inputClass + " resize-y"}
              />
            </Field>
          </Section>

          {/* Status transitions */}
          <Section label="// Transition">
            <div className="grid grid-cols-2 gap-2">
              {row.status === "pending" && (
                <PrimaryAction
                  busy={saving}
                  onClick={handleSchedule}
                  icon={<Calendar className="w-[14px] h-[14px]" />}
                >
                  Schedule
                </PrimaryAction>
              )}
              {(row.status === "pending" || row.status === "scheduled") && (
                <SecondaryAction
                  busy={saving}
                  onClick={() => handleStatusChange("in_progress")}
                >
                  Mark in progress
                </SecondaryAction>
              )}
              {row.status === "in_progress" && (
                <PrimaryAction
                  busy={saving}
                  onClick={() => handleStatusChange("completed")}
                >
                  Mark complete
                </PrimaryAction>
              )}
              {row.status !== "pending" && row.status !== "completed" && (
                <SecondaryAction
                  busy={saving}
                  onClick={() => handleStatusChange("pending")}
                >
                  Reset to pending
                </SecondaryAction>
              )}
            </div>
          </Section>

          {/* Cancel / refund — destructive zone */}
          {row.status !== "cancelled" && row.status !== "completed" && (
            <Section label="// Cancel">
              {confirmCancel ? (
                <div className="space-y-2 border border-rose-line bg-rose-soft/30 rounded-panel p-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-[14px] h-[14px] text-rose mt-0.5 shrink-0" />
                    <div>
                      <p className="font-mohave text-body-sm text-text">
                        Cancel this request?
                      </p>
                      <p className="font-mono text-micro text-text-mute mt-1">
                        Choose whether the company keeps the entitlement (refund processed separately in Stripe) or loses access entirely.
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <SecondaryAction
                      busy={saving}
                      onClick={() => handleCancel(false)}
                    >
                      Cancel only
                    </SecondaryAction>
                    <DestructiveAction
                      busy={saving}
                      onClick={() => handleCancel(true)}
                    >
                      Cancel + refund
                    </DestructiveAction>
                  </div>
                  <button
                    type="button"
                    onClick={() => setConfirmCancel(false)}
                    className="font-mono text-micro text-text-mute uppercase tracking-wider hover:text-text-2 mt-1"
                  >
                    Keep open
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmCancel(true)}
                  className={
                    "w-full font-cakemono font-light uppercase text-[12px] tracking-wider " +
                    "px-2 py-2 rounded border border-rose-line text-rose " +
                    "hover:bg-rose-soft/20 transition-colors"
                  }
                >
                  Cancel request
                </button>
              )}
            </Section>
          )}
        </div>

        {/* Footer save bar */}
        <footer className="border-t border-line px-5 py-3 flex items-center justify-between gap-3">
          <span className="font-mono text-micro text-text-mute">
            {dirty ? "Unsaved changes" : "Up to date"}
          </span>
          <PrimaryAction
            busy={saving}
            disabled={!dirty}
            onClick={handleSave}
            icon={<Save className="w-[14px] h-[14px]" />}
          >
            Save
          </PrimaryAction>
        </footer>
      </aside>
    </div>
  );
}

const inputClass =
  "w-full font-mohave text-body-sm bg-surface-input border border-line rounded px-2 py-1.5 text-text placeholder:text-text-3 focus:outline-none focus:border-[rgba(255,255,255,0.20)]";

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h3 className="font-mono text-micro uppercase tracking-wider text-text-mute">
        {label}
      </h3>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="font-mono text-micro uppercase tracking-wider text-text-3">
        {label}
      </span>
      {children}
    </label>
  );
}

function FieldRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="font-mono text-micro uppercase tracking-wider text-text-3 shrink-0">
        {label}
      </span>
      <div className="text-right min-w-0">{children}</div>
    </div>
  );
}

function PrimaryAction({
  busy,
  disabled,
  onClick,
  icon,
  children,
}: {
  busy: boolean;
  disabled?: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || disabled}
      className={
        "inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded " +
        "font-cakemono font-light uppercase text-[13px] tracking-wider " +
        "border border-ops-accent text-ops-accent bg-transparent " +
        "hover:bg-ops-accent hover:text-black " +
        "disabled:opacity-50 transition-colors"
      }
    >
      {busy ? <Loader2 className="w-[14px] h-[14px] animate-spin" /> : icon}
      {children}
    </button>
  );
}

function SecondaryAction({
  busy,
  onClick,
  children,
}: {
  busy: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={
        "inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded " +
        "font-cakemono font-light uppercase text-[12px] tracking-wider " +
        "border border-line text-text-2 " +
        "hover:text-text hover:border-[rgba(255,255,255,0.18)] hover:bg-white/[0.04] " +
        "disabled:opacity-50 transition-colors"
      }
    >
      {busy ? <Loader2 className="w-[14px] h-[14px] animate-spin" /> : null}
      {children}
    </button>
  );
}

function DestructiveAction({
  busy,
  onClick,
  children,
}: {
  busy: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={
        "inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded " +
        "font-cakemono font-light uppercase text-[12px] tracking-wider " +
        "border border-rose-line text-rose bg-rose-soft/20 " +
        "hover:bg-rose-soft/40 " +
        "disabled:opacity-50 transition-colors"
      }
    >
      {busy ? <Loader2 className="w-[14px] h-[14px] animate-spin" /> : null}
      {children}
    </button>
  );
}
