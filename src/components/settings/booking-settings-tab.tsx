"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import { useTeamMembers } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import {
  SegmentControl,
  type SegmentControlOption,
} from "@/components/ui/segment-control";
import { toast } from "@/components/ui/toast";
import {
  BOOKING_MODES,
  validateBookingPolicy,
  type BookingMode,
  type BookingPolicy,
  type BookingWindow,
} from "@/lib/booking/policy";
import {
  useBookingSettings,
  useSaveBookingPolicy,
} from "@/lib/hooks/use-booking-settings";
import { BookingWeekGrid } from "./booking-week-grid";

/**
 * Settings › Comms › Booking (PUBLIC API P2-4, design §8, decision D9).
 *
 * Whether customers may book at all is the business's choice, and so is how
 * firmly. That is ONE control with three states — off, request, instant — not
 * two toggles, and every state says what it means before it is chosen, because
 * this decision is made once and lived with.
 *
 * Everything below the control is meaningless while the mode is `off`, so
 * none of it is rendered: no hours, no limits, no assignment. Choosing a mode
 * reveals the terms. The whole section is absent for a company whose website
 * is not connected to OPS — the shell's gate, not this component's problem.
 *
 * The clock the hours are kept on is shown, not edited: one place owns the
 * company's timezone (Company › Details), and a second editor for it here
 * would be a second truth.
 */

/** Same ladder the staff booking modal offers — one product, one grammar. */
const DURATION_PRESETS = [30, 60, 90, 120, 240];

/** 45 → "45 MIN", 60 → "1 HR", 240 → "4 HR". */
function formatMinutes(minutes: number): string {
  return minutes % 60 === 0 ? `${minutes / 60} HR` : `${minutes} MIN`;
}

/** `""` is a real state for the per-day cap: no cap at all. */
function parseOptionalCount(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseCount(raw: string, fallback: number): number {
  const parsed = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function samePolicy(a: BookingPolicy, b: BookingPolicy): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function BookingSettingsTab() {
  const { t } = useDictionary("settings");
  const settings = useBookingSettings(true);
  const save = useSaveBookingPolicy();
  const { data: teamData } = useTeamMembers();

  const stored = settings.data?.available ? settings.data.policy : null;
  const [draft, setDraft] = useState<BookingPolicy | null>(null);

  // The stored row is the seed; a later write re-seeds from what actually
  // landed, never from the local guess about what the write did.
  useEffect(() => {
    if (stored) setDraft(stored);
  }, [stored]);

  const members = useMemo(
    () => (teamData?.users ?? []).filter((user) => user.isActive !== false),
    [teamData]
  );

  const durationOptions = useMemo<SegmentControlOption[]>(() => {
    const current = draft?.visitDurationMinutes ?? 60;
    const values = DURATION_PRESETS.includes(current)
      ? DURATION_PRESETS
      : // A stored off-preset duration keeps its slot, sorted into place,
        // instead of being silently coerced to something the owner never chose.
        [...DURATION_PRESETS, current].sort((a, b) => a - b);
    return values.map((value) => ({ value: String(value), label: formatMinutes(value) }));
  }, [draft?.visitDurationMinutes]);

  if (settings.isPending) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-icon-20 w-icon-20 animate-spin text-text-3" strokeWidth={1.5} />
      </div>
    );
  }

  // The store could not answer. Saying nothing beats telling a company its
  // booking is switched off when no policy was ever read.
  if (!stored || !draft) return null;

  const update = (partial: Partial<BookingPolicy>) =>
    setDraft((current) => (current ? { ...current, ...partial } : current));

  const problems = validateBookingPolicy(draft);
  const dirty = !samePolicy(draft, stored);
  const live = draft.mode !== "off";

  const handleSave = () => {
    if (problems.length > 0) return;
    save.mutate(draft, {
      onSuccess: () => toast.success(t("booking.toast.saved")),
      onError: () => toast.error(t("booking.toast.saveFailed")),
    });
  };

  return (
    <div className="max-w-[720px] space-y-5">
      {/* ── Header + commit ────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className="font-mono text-micro uppercase tracking-[0.16em] text-text-3">
            <span className="text-text-mute">{"// "}</span>
            {t("booking.title")}
          </span>
          <p className="mt-0.5 font-mono text-micro text-text-3">
            [{t("booking.subtitle")}]
          </p>
        </div>
        {dirty ? (
          <div className="flex flex-wrap items-center justify-end gap-1">
            {problems.length > 0 ? (
              <span className="font-mono text-micro uppercase tracking-[0.14em] text-rose">
                {`// ${t(`booking.problem.${problems[0]}`)}`}
              </span>
            ) : null}
            <Button variant="ghost" size="default" onClick={() => setDraft(stored)}>
              {t("booking.discard")}
            </Button>
            <Button
              variant="primary"
              size="default"
              onClick={handleSave}
              loading={save.isPending}
            >
              {t("booking.save")}
            </Button>
          </div>
        ) : null}
      </div>

      {/* ── The one control (D9) ───────────────────────────────────────── */}
      <div
        role="radiogroup"
        aria-label={t("booking.mode.aria")}
        className="glass-surface divide-y divide-glass-border rounded-panel"
      >
        {BOOKING_MODES.map((mode) => (
          <ModeRow
            key={mode}
            mode={mode}
            selected={draft.mode === mode}
            label={t(`booking.mode.${mode}`)}
            body={t(`booking.mode.${mode}Body`)}
            onSelect={() => update({ mode })}
          />
        ))}
      </div>

      {/* ── The terms, only once there are terms to have ───────────────── */}
      {live ? (
        <>
          <BookingWeekGrid
            windows={draft.windows}
            timezone={draft.timezone}
            onChange={(windows: BookingWindow[]) => update({ windows })}
          />

          <section
            data-testid="booking-limits"
            className="glass-surface space-y-3 rounded-panel p-4"
          >
            <BlockHeader label={t("booking.limits")} />
            <div className="grid gap-3 md:grid-cols-2">
              <CountField
                label={t("booking.notice")}
                help={t("booking.noticeHelp")}
                unit={t("booking.noticeUnit")}
                value={String(draft.minNoticeHours)}
                onChange={(raw) =>
                  update({ minNoticeHours: parseCount(raw, draft.minNoticeHours) })
                }
              />
              <CountField
                label={t("booking.horizon")}
                help={t("booking.horizonHelp")}
                unit={t("booking.horizonUnit")}
                value={String(draft.horizonDays)}
                onChange={(raw) => update({ horizonDays: parseCount(raw, draft.horizonDays) })}
              />
              <label className="block rounded border border-border p-3">
                <span className="block font-mohave text-body-sm uppercase text-text">
                  {t("booking.duration")}
                </span>
                <span className="mt-1 block font-mono text-micro leading-relaxed text-text-3">
                  [{t("booking.durationHelp")}]
                </span>
                <SegmentControl
                  mode="choice"
                  ariaLabel={t("booking.duration")}
                  options={durationOptions}
                  value={String(draft.visitDurationMinutes)}
                  onChange={(value) => update({ visitDurationMinutes: Number(value) })}
                  className="mt-1 h-auto min-h-[28px] flex-wrap"
                />
              </label>
              <CountField
                label={t("booking.cap")}
                help={t("booking.capHelp")}
                unit={t("booking.capUnit")}
                value={draft.maxBookingsPerDay === null ? "" : String(draft.maxBookingsPerDay)}
                onChange={(raw) => update({ maxBookingsPerDay: parseOptionalCount(raw) })}
              />
            </div>
          </section>

          <section
            data-testid="booking-assignment"
            className="glass-surface space-y-3 rounded-panel p-4"
          >
            <BlockHeader label={t("booking.assignment")} />
            <label className="block rounded border border-border p-3">
              <span className="block font-mohave text-body-sm uppercase text-text">
                {t("booking.owner")}
              </span>
              <span className="mt-1 block font-mono text-micro leading-relaxed text-text-3">
                [{t("booking.ownerHelp")}]
              </span>
              {/* A native select: one choice from a short, known list, and the
                  only control on this screen a keyboard reaches faster than a
                  popover would. */}
              <select
                value={draft.defaultOwnerId ?? ""}
                onChange={(event) =>
                  update({ defaultOwnerId: event.target.value || null })
                }
                className={cn(
                  "mt-1 h-control-32 w-full rounded border border-border bg-surface-input px-1",
                  "font-mohave text-body-sm text-text",
                  "transition-colors duration-150 ease-smooth",
                  "focus:border-line-hi focus:outline-none"
                )}
              >
                <option value="">{t("booking.ownerUnassigned")}</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {`${member.firstName ?? ""} ${member.lastName ?? ""}`.trim() ||
                      member.email ||
                      "?"}
                  </option>
                ))}
              </select>
            </label>
          </section>
        </>
      ) : null}
    </div>
  );
}

/** One state of the one control: the name, and what choosing it means. */
function ModeRow({
  mode,
  selected,
  label,
  body,
  onSelect,
}: {
  mode: BookingMode;
  selected: boolean;
  label: string;
  body: string;
  onSelect: () => void;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-2 p-3 first:rounded-t-panel last:rounded-b-panel",
        "transition-colors duration-150 ease-smooth",
        selected ? "bg-surface-active" : "hover:bg-surface-hover",
        "has-[:focus-visible]:outline has-[:focus-visible]:outline-1 has-[:focus-visible]:outline-ops-accent"
      )}
    >
      <input
        type="radio"
        name="booking-mode"
        className="peer sr-only"
        value={mode}
        checked={selected}
        onChange={onSelect}
      />
      <span
        aria-hidden
        className={cn(
          "mt-1 h-1 w-1 shrink-0 rounded-bar border transition-colors duration-150 ease-smooth",
          selected ? "border-text bg-text" : "border-line-hi bg-transparent"
        )}
      />
      <span className="min-w-0">
        <span
          className={cn(
            "block font-cakemono text-cake-badge uppercase tracking-[0.12em]",
            selected ? "text-text" : "text-text-2"
          )}
        >
          {label}
        </span>
        <span
          className={cn(
            "mt-0.5 block font-mohave text-body-sm",
            selected ? "text-text-2" : "text-text-3"
          )}
        >
          {body}
        </span>
      </span>
    </label>
  );
}

function BlockHeader({ label }: { label: string }) {
  return (
    <span className="block font-mono text-micro uppercase tracking-[0.16em] text-text-3">
      <span className="text-text-mute">{"// "}</span>
      {label}
    </span>
  );
}

/** A whole number with its unit — always mono, tabular, slashed zero. */
function CountField({
  label,
  help,
  unit,
  value,
  onChange,
}: {
  label: string;
  help: string;
  unit: string;
  value: string;
  onChange: (raw: string) => void;
}) {
  return (
    <label className="block rounded border border-border p-3">
      <span className="block font-mohave text-body-sm uppercase text-text">{label}</span>
      <span className="mt-1 block font-mono text-micro leading-relaxed text-text-3">
        [{help}]
      </span>
      <span className="mt-1 flex items-center gap-1">
        <input
          type="number"
          inputMode="numeric"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={cn(
            "h-control-32 w-[88px] rounded border border-border bg-surface-input px-1",
            "font-mono text-data-sm tabular-nums text-text",
            "[font-feature-settings:'tnum'_1,'zero'_1]",
            "transition-colors duration-150 ease-smooth",
            "focus:border-line-hi focus:outline-none"
          )}
        />
        <span className="font-mono text-micro uppercase tracking-[0.14em] text-text-3">
          {unit}
        </span>
      </span>
    </label>
  );
}
