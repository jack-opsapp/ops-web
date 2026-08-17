"use client";

/**
 * BookSiteVisitModal — the single web surface for booking, rescheduling,
 * and cancelling a site-visit appointment on a lead.
 *
 * Writes go through the booking RPCs only (`book_site_visit` /
 * `reschedule_site_visit` / `cancel_site_visit_booking`) — the server owns
 * every side effect (visit row, timeline activity, new_lead → qualifying
 * nudge, Google Calendar sync enqueue, prompt re-arming).
 *
 * Modes:
 *   - book       — no `existingBooking`: date/time/duration/WHO'S GOING/
 *                  HEADS-UP with the booker preselected, CTA BOOK VISIT.
 *   - reschedule — `existingBooking` set (the lead's ONE open booking):
 *                  fields prefilled, CTA RESCHEDULE, plus a two-click
 *                  armed CANCEL VISIT. One entry point, state-aware —
 *                  a second stacked booking is never offered.
 *
 * Heads-up semantics: DEFAULT = the user's stored lead
 * (notification_preferences.site_visit_reminder_lead_minutes, product
 * default 30). Book sends nothing for DEFAULT; reschedule sends -1 only
 * when clearing a stored per-booking override.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Clock } from "lucide-react";
import { format } from "date-fns";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  SegmentControl,
  type SegmentControlOption,
} from "@/components/ui/segment-control";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import {
  useBookSiteVisit,
  useCancelSiteVisitBooking,
  useRescheduleSiteVisit,
} from "@/lib/hooks/use-site-visits";
import { useTeamMembers } from "@/lib/hooks";
import { useAuthStore } from "@/lib/store/auth-store";
import { NotificationPreferencesService } from "@/lib/api/services/notification-preferences-service";
import {
  SiteVisitBookingError,
  type BookSiteVisitInput,
  type RescheduleSiteVisitInput,
} from "@/lib/api/services/site-visit-service";
import type { SiteVisit } from "@/lib/types/pipeline";
import { formatVisitSlot } from "./visit-slot";

// ─── Constants ──────────────────────────────────────────────────────────────

/** Product default heads-up lead when the user has no stored preference. */
const PRODUCT_DEFAULT_LEAD_MINUTES = 30;

const DURATION_PRESETS = [30, 60, 90, 120, 240];
const HEADS_UP_PRESETS = [15, 30, 60, 120];

/** Mirror of the RPC's past-time grace so the client blocks what the server
 *  would reject anyway. */
const PAST_GRACE_MS = 5 * 60 * 1000;

/** 45 → "45 MIN", 60 → "1 HR", 90 → "90 MIN", 120 → "2 HR". */
function formatMinutes(minutes: number): string {
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} HR`;
  }
  return `${minutes} MIN`;
}

function toDateInputValue(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

function toTimeInputValue(date: Date): string {
  return format(date, "HH:mm");
}

/** Next full hour from now — the intelligent default for a same-day booking. */
function nextFullHour(): Date {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
}

/** Compose the local Date from the two field values ("" → null). */
function composeDateTime(dateValue: string, timeValue: string): Date | null {
  if (!dateValue || !timeValue) return null;
  const composed = new Date(`${dateValue}T${timeValue}:00`);
  return Number.isNaN(composed.getTime()) ? null : composed;
}

// ─── Props ──────────────────────────────────────────────────────────────────

export interface BookSiteVisitModalProps {
  opportunityId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The lead's one open booking → reschedule mode. Null/absent → book mode. */
  existingBooking?: SiteVisit | null;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function BookSiteVisitModal({
  opportunityId,
  open,
  onOpenChange,
  existingBooking = null,
}: BookSiteVisitModalProps) {
  const { t } = useDictionary("pipeline");
  const isReschedule = existingBooking !== null;

  const currentUser = useAuthStore((s) => s.currentUser);
  const company = useAuthStore((s) => s.company);
  const bookVisit = useBookSiteVisit();
  const rescheduleVisit = useRescheduleSiteVisit();
  const cancelBooking = useCancelSiteVisitBooking();

  const { data: teamData } = useTeamMembers();
  const members = useMemo(
    () => (teamData?.users ?? []).filter((u) => u.isActive !== false),
    [teamData]
  );

  // The user's default heads-up lead — labels the DEFAULT option.
  const { data: preferences } = useQuery({
    queryKey: ["notification-preferences", currentUser?.id, company?.id],
    queryFn: () =>
      NotificationPreferencesService.getPreferences(
        currentUser!.id,
        company!.id
      ),
    enabled: open && !!currentUser?.id && !!company?.id,
    staleTime: 5 * 60 * 1000,
  });
  const defaultLeadMinutes =
    preferences?.siteVisitReminderLeadMinutes ?? PRODUCT_DEFAULT_LEAD_MINUTES;

  // ── Form state (seeded per open, keyed by mode + booking) ──────────────
  const seed = useMemo(() => {
    if (existingBooking) {
      return {
        date: toDateInputValue(existingBooking.scheduledAt),
        time: toTimeInputValue(existingBooking.scheduledAt),
        duration: existingBooking.durationMinutes,
        crew: existingBooking.assigneeIds,
        headsUp:
          existingBooking.reminderLeadMinutes === null
            ? ("default" as const)
            : String(existingBooking.reminderLeadMinutes),
      };
    }
    const start = nextFullHour();
    return {
      date: toDateInputValue(start),
      time: toTimeInputValue(start),
      duration: 60,
      crew: currentUser?.id ? [currentUser.id] : [],
      headsUp: "default" as const,
    };
    // Reseed whenever the modal reopens or the managed booking changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingBooking, currentUser?.id, open]);

  const [dateValue, setDateValue] = useState(seed.date);
  const [timeValue, setTimeValue] = useState(seed.time);
  const [durationMinutes, setDurationMinutes] = useState<number>(seed.duration);
  const [crewIds, setCrewIds] = useState<string[]>(seed.crew);
  const [headsUpValue, setHeadsUpValue] = useState<string>(seed.headsUp);
  const [cancelArmed, setCancelArmed] = useState(false);

  useEffect(() => {
    setDateValue(seed.date);
    setTimeValue(seed.time);
    setDurationMinutes(seed.duration);
    setCrewIds(seed.crew);
    setHeadsUpValue(seed.headsUp);
    setCancelArmed(false);
  }, [seed]);

  // ── Derived validity ───────────────────────────────────────────────────
  const scheduledAt = composeDateTime(dateValue, timeValue);
  const isPast =
    scheduledAt !== null &&
    scheduledAt.getTime() <= Date.now() - PAST_GRACE_MS;
  const mutating =
    bookVisit.isPending || rescheduleVisit.isPending || cancelBooking.isPending;
  const canSubmit =
    scheduledAt !== null && !isPast && crewIds.length > 0 && !mutating;

  // ── Options ────────────────────────────────────────────────────────────
  const durationOptions = useMemo<SegmentControlOption[]>(() => {
    const values = DURATION_PRESETS.includes(durationMinutes)
      ? DURATION_PRESETS
      : // An off-preset stored duration (e.g. 45 from iOS) keeps its slot,
        // sorted into place, instead of being silently coerced.
        [...DURATION_PRESETS, durationMinutes].sort((a, b) => a - b);
    return values.map((v) => ({ value: String(v), label: formatMinutes(v) }));
  }, [durationMinutes]);

  const headsUpOptions = useMemo<SegmentControlOption[]>(() => {
    const stored =
      existingBooking?.reminderLeadMinutes != null &&
      !HEADS_UP_PRESETS.includes(existingBooking.reminderLeadMinutes)
        ? [existingBooking.reminderLeadMinutes, ...HEADS_UP_PRESETS].sort(
            (a, b) => a - b
          )
        : HEADS_UP_PRESETS;
    return [
      {
        value: "default",
        label: t(
          "booking.headsUpDefault",
          "DEFAULT — {lead}"
        ).replace("{lead}", formatMinutes(defaultLeadMinutes)),
      },
      ...stored.map((v) => ({ value: String(v), label: formatMinutes(v) })),
    ];
  }, [existingBooking?.reminderLeadMinutes, defaultLeadMinutes, t]);

  // ── Handlers ───────────────────────────────────────────────────────────

  const handleError = (error: unknown, fallbackKey: string, fallback: string) => {
    if (error instanceof SiteVisitBookingError) {
      switch (error.code) {
        case "conflict":
          toast.error(
            t(
              "booking.errorConflict",
              "// VISIT ALREADY BOOKED — RESCHEDULE OR CANCEL IT FIRST"
            )
          );
          return;
        case "permission":
          toast.error(
            t("booking.errorPermission", "// NO PERMISSION TO BOOK ON THIS LEAD")
          );
          return;
        case "validation":
          toast.error(
            t("booking.errorValidation", "// CHECK THE TIME AND DETAILS")
          );
          return;
        case "not_found":
          toast.error(t("booking.errorNotFound", "// LEAD OR VISIT NOT FOUND"));
          return;
      }
    }
    toast.error(t(fallbackKey, fallback));
  };

  const handleSubmit = () => {
    if (!scheduledAt || !canSubmit) return;

    if (isReschedule && existingBooking) {
      const input: RescheduleSiteVisitInput = {
        siteVisitId: existingBooking.id,
        scheduledAt,
        durationMinutes,
        assigneeIds: crewIds,
      };
      if (headsUpValue === "default") {
        // DEFAULT selected: clear only if the booking carried an override.
        if (existingBooking.reminderLeadMinutes !== null) {
          input.reminderLeadMinutes = -1;
        }
      } else {
        input.reminderLeadMinutes = Number(headsUpValue);
      }

      rescheduleVisit.mutate(input, {
        onSuccess: () => {
          onOpenChange(false);
          toast.success(
            t("booking.toastMoved", "MOVED — {slot}").replace(
              "{slot}",
              formatVisitSlot(scheduledAt)
            )
          );
        },
        onError: (error) =>
          handleError(
            error,
            "booking.errorUnknown",
            "// BOOKING FAILED — TRY AGAIN"
          ),
      });
      return;
    }

    const input: BookSiteVisitInput = {
      opportunityId,
      scheduledAt,
      durationMinutes,
      assigneeIds: crewIds,
    };
    if (headsUpValue !== "default") {
      input.reminderLeadMinutes = Number(headsUpValue);
    }

    bookVisit.mutate(input, {
      onSuccess: () => {
        onOpenChange(false);
        toast.success(
          t("booking.toastBooked", "BOOKED — {slot}").replace(
            "{slot}",
            formatVisitSlot(scheduledAt)
          )
        );
      },
      onError: (error) =>
        handleError(
          error,
          "booking.errorUnknown",
          "// BOOKING FAILED — TRY AGAIN"
        ),
    });
  };

  const handleCancelVisit = () => {
    if (!existingBooking) return;
    if (!cancelArmed) {
      setCancelArmed(true);
      return;
    }
    cancelBooking.mutate(existingBooking.id, {
      onSuccess: () => {
        onOpenChange(false);
        toast.success(t("booking.toastCancelled", "VISIT CANCELLED"));
      },
      onError: (error) =>
        handleError(
          error,
          "booking.errorCancelFailed",
          "// CANCEL FAILED — TRY AGAIN"
        ),
    });
  };

  const toggleCrew = (memberId: string) => {
    setCrewIds((current) =>
      current.includes(memberId)
        ? current.filter((id) => id !== memberId)
        : [...current, memberId]
    );
  };

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Modal layer (3000) on panel + overlay: booking opens from inside
          the floating deal window (itself z-[3000]) and from the calendar —
          the arbitrary value replaces the base z-50 under tailwind-merge,
          which the named .z-modal class cannot (both classes survive and
          z-50 wins the cascade), and equal z + later portal order paints
          the dialog above the window. */}
      <DialogContent
        className="z-[3000]"
        overlayClassName="z-[3000]"
      >
        <DialogHeader>
          <DialogTitle className="uppercase tracking-wider">
            {isReschedule
              ? t("booking.titleReschedule", "RESCHEDULE VISIT")
              : t("booking.titleBook", "BOOK SITE VISIT")}
          </DialogTitle>
        </DialogHeader>

        <div className="mt-1 flex flex-col gap-2">
          {/* Date + time */}
          <div className="grid grid-cols-2 gap-1.5">
            <Input
              label={t("booking.date", "Date")}
              type="date"
              prefixIcon={<CalendarDays />}
              value={dateValue}
              onChange={(e) => setDateValue(e.target.value)}
              className="font-mono text-[13px] tabular-nums [font-feature-settings:'tnum'_1,'zero'_1] [color-scheme:dark]"
            />
            <Input
              label={t("booking.time", "Time")}
              type="time"
              prefixIcon={<Clock />}
              value={timeValue}
              onChange={(e) => setTimeValue(e.target.value)}
              className="font-mono text-[13px] tabular-nums [font-feature-settings:'tnum'_1,'zero'_1] [color-scheme:dark]"
            />
          </div>
          {isPast && (
            <span className="font-mono text-micro uppercase tracking-[0.14em] text-rose">
              {t("booking.pastTime", "// PICK A FUTURE TIME")}
            </span>
          )}

          {/* Duration */}
          <div className="flex flex-col gap-0.5">
            <span className="font-mohave text-caption-sm uppercase tracking-wide text-text-3">
              {t("booking.duration", "Duration")}
            </span>
            <SegmentControl
              mode="choice"
              ariaLabel={t("booking.duration", "Duration")}
              options={durationOptions}
              value={String(durationMinutes)}
              onChange={(v) => setDurationMinutes(Number(v))}
            />
          </div>

          {/* Who's going */}
          <div className="flex flex-col gap-0.5" data-testid="book-visit-crew">
            <span className="font-mohave text-caption-sm uppercase tracking-wide text-text-3">
              {t("booking.crew", "Who's going")}
            </span>
            <div className="flex flex-wrap gap-1">
              {members.map((member) => {
                const selected = crewIds.includes(member.id);
                const fullName =
                  `${member.firstName ?? ""} ${member.lastName ?? ""}`.trim() ||
                  member.email ||
                  "?";
                return (
                  <button
                    key={member.id}
                    type="button"
                    onClick={() => toggleCrew(member.id)}
                    aria-pressed={selected}
                    className={cn(
                      "flex items-center gap-1.5 rounded border px-1.5 py-1",
                      "font-mohave text-body-sm transition-colors duration-150",
                      "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent",
                      selected
                        ? "border-[rgba(255,255,255,0.18)] bg-surface-active text-text"
                        : "border-border bg-surface-input text-text-3 hover:border-line-hi hover:text-text-2"
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "h-1.5 w-1.5 shrink-0 rounded-full transition-opacity duration-150",
                        selected ? "opacity-100" : "opacity-30"
                      )}
                      style={{
                        backgroundColor: member.userColor ?? "var(--text-3)",
                      }}
                    />
                    {fullName}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Heads-up lead */}
          <div className="flex flex-col gap-0.5">
            <span className="font-mohave text-caption-sm uppercase tracking-wide text-text-3">
              {t("booking.headsUp", "Heads-up")}
            </span>
            <SegmentControl
              mode="choice"
              ariaLabel={t("booking.headsUp", "Heads-up")}
              options={headsUpOptions}
              value={headsUpValue}
              onChange={setHeadsUpValue}
              className="flex-wrap h-auto min-h-[28px]"
            />
          </div>
        </div>

        {/* Actions.
            Wraps rather than clips: in reschedule mode the row carries three
            buttons (CANCEL VISIT + CLOSE + RESCHEDULE) whose combined width
            exceeds the dialog's content box, which pushed the primary CTA
            past the panel edge. `ml-auto` on the right group keeps the
            destructive-left / primary-right grammar on one line when it fits
            and after wrapping when it does not. */}
        <div className="mt-3 flex flex-wrap items-center gap-y-2 border-t border-border pt-2">
          {isReschedule && (
            <Button
              type="button"
              variant={cancelArmed ? "destructive" : "ghost"}
              className={cn(!cancelArmed && "text-rose hover:text-rose")}
              disabled={cancelBooking.isPending}
              onClick={handleCancelVisit}
            >
              {cancelArmed
                ? t("booking.ctaConfirmCancel", "CONFIRM CANCEL")
                : t("booking.ctaCancelVisit", "CANCEL VISIT")}
            </Button>
          )}
          <div className="ml-auto flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              {isReschedule
                ? t("booking.close", "CLOSE")
                : t("booking.cancel", "CANCEL")}
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={!canSubmit}
              loading={bookVisit.isPending || rescheduleVisit.isPending}
              onClick={handleSubmit}
            >
              {isReschedule
                ? t("booking.ctaReschedule", "RESCHEDULE")
                : t("booking.ctaBook", "BOOK VISIT")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
