"use client";

/**
 * BookingRequestDecision — the staff answer to a public booking request
 * (PUBLIC API P2-4, design §8, invariant I14).
 *
 * A `request`-mode submission put nothing on any calendar. This dialog is
 * where that changes: ACCEPT calls the confirm RPC, which is what actually
 * books the visit, honouring a time the operator moved it to. DECLINE closes
 * the request, books nothing, and sends the customer nothing — the lead stays
 * in the pipeline to be worked like any other (I16).
 *
 * There is no inbox and no queue. The request is simply this lead's visit
 * state until somebody decides, so it lives on the lead's one visit entry
 * point, and a notification links here.
 */

import { useEffect, useMemo, useState } from "react";
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
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import { formatTimeAgo } from "@/lib/utils/date";
import {
  BookingRequestError,
  useAcceptBookingRequest,
  useDeclineBookingRequest,
  type BookingRequestFailure,
  type PendingBookingRequest,
} from "@/lib/hooks/use-booking-request";
import { formatVisitSlot } from "./visit-slot";

/** Mirror of the RPC's past-time grace so the client blocks what the server
 *  would reject anyway — the same rule the staff booking modal keeps. */
const PAST_GRACE_MS = 5 * 60 * 1000;

const FAILURE_COPY: Record<BookingRequestFailure, string> = {
  conflict: "request.errorConflict",
  permission: "request.errorPermission",
  not_found: "request.errorNotFound",
  unavailable: "request.errorUnknown",
};

/** 45 → "45 MIN", 60 → "1 HR", 240 → "4 HR". */
function formatMinutes(minutes: number): string {
  return minutes % 60 === 0 ? `${minutes / 60} HR` : `${minutes} MIN`;
}

/** The full slot as an operator says it: "THU 08 OCT · 10:00". */
function formatLongSlot(date: Date): string {
  return `${format(date, "EEE dd MMM").toUpperCase()} · ${format(date, "HH:mm")}`;
}

function composeDateTime(dateValue: string, timeValue: string): Date | null {
  if (!dateValue || !timeValue) return null;
  const composed = new Date(`${dateValue}T${timeValue}:00`);
  return Number.isNaN(composed.getTime()) ? null : composed;
}

export interface BookingRequestDecisionProps {
  opportunityId: string;
  request: PendingBookingRequest;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BookingRequestDecision({
  opportunityId,
  request,
  open,
  onOpenChange,
}: BookingRequestDecisionProps) {
  const { t } = useDictionary("pipeline");
  const accept = useAcceptBookingRequest(opportunityId);
  const decline = useDeclineBookingRequest(opportunityId);

  const asked = useMemo(() => new Date(request.slotStartAt), [request.slotStartAt]);

  // Seeded with the time the customer asked for, so accepting as asked is one
  // click and moving it is just editing what is already there.
  const [dateValue, setDateValue] = useState(() => format(asked, "yyyy-MM-dd"));
  const [timeValue, setTimeValue] = useState(() => format(asked, "HH:mm"));
  const [declineArmed, setDeclineArmed] = useState(false);

  useEffect(() => {
    setDateValue(format(asked, "yyyy-MM-dd"));
    setTimeValue(format(asked, "HH:mm"));
    setDeclineArmed(false);
  }, [asked, open]);

  const chosen = composeDateTime(dateValue, timeValue);
  const moved = chosen !== null && chosen.getTime() !== asked.getTime();
  const isPast = chosen !== null && chosen.getTime() <= Date.now() - PAST_GRACE_MS;
  const busy = accept.isPending || decline.isPending;
  const canAccept = chosen !== null && !isPast && !busy;

  const reportFailure = (error: unknown) => {
    const failure = error instanceof BookingRequestError ? error.failure : "unavailable";
    toast.error(t(FAILURE_COPY[failure]));
  };

  const handleAccept = () => {
    if (!chosen || !canAccept) return;
    accept.mutate(
      // The moved time is sent only when it is genuinely a move; accepting as
      // asked keeps the customer's own slot on the server side too.
      moved
        ? { requestId: request.requestId, scheduledAt: chosen.toISOString() }
        : { requestId: request.requestId },
      {
        onSuccess: (scheduledAt) => {
          onOpenChange(false);
          const booked = scheduledAt ? new Date(scheduledAt) : chosen;
          toast.success(
            t("request.toastAccepted", { slot: formatVisitSlot(booked) })
          );
        },
        onError: reportFailure,
      }
    );
  };

  const handleDecline = () => {
    if (busy) return;
    if (!declineArmed) {
      setDeclineArmed(true);
      return;
    }
    decline.mutate(
      { requestId: request.requestId },
      {
        onSuccess: () => {
          onOpenChange(false);
          toast.success(t("request.toastDeclined"));
        },
        onError: reportFailure,
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Modal layer (3000) on panel + overlay: the decision opens from inside
          the floating deal window (itself z-[3000]). */}
      <DialogContent className="z-[3000]" overlayClassName="z-[3000]">
        <DialogHeader>
          <DialogTitle className="uppercase tracking-wider">
            {t("request.title")}
          </DialogTitle>
        </DialogHeader>

        <div className="mt-1 flex flex-col gap-2">
          {/* ── What was asked for ─────────────────────────────────────── */}
          <div
            data-testid="request-slot"
            className="font-mono text-data-lg tabular-nums text-text [font-feature-settings:'tnum'_1,'zero'_1]"
          >
            {formatLongSlot(asked)}
          </div>

          <dl className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <div className="flex items-baseline gap-1">
              <dt className="font-mono text-micro uppercase tracking-[0.14em] text-text-3">
                {t("request.from")}
              </dt>
              <dd className="font-mohave text-body-sm text-text">
                {request.contactName || "—"}
              </dd>
            </div>
            <div className="flex items-baseline gap-1" data-testid="request-asked">
              <dt className="font-mono text-micro uppercase tracking-[0.14em] text-text-3">
                {t("request.asked")}
              </dt>
              <dd className="font-mono text-micro tabular-nums text-text-2 [font-feature-settings:'tnum'_1,'zero'_1]">
                {formatTimeAgo(new Date(request.requestedAt))}
              </dd>
            </div>
          </dl>

          {/* ── What they told the website ─────────────────────────────── */}
          {request.answers.length > 0 ? (
            <div data-testid="request-answers" className="flex flex-col gap-0.5">
              <span className="font-mono text-micro uppercase tracking-[0.16em] text-text-3">
                <span className="text-text-mute">{"// "}</span>
                {t("request.answers")}
              </span>
              <dl className="divide-y divide-glass-border border-t border-glass-border">
                {request.answers.map((answer) => (
                  <div
                    key={`${answer.label}:${answer.value}`}
                    className="flex items-baseline justify-between gap-2 py-1"
                  >
                    <dt className="shrink-0 font-mono text-micro uppercase tracking-[0.12em] text-text-3">
                      {answer.label}
                    </dt>
                    <dd className="min-w-0 text-right font-mohave text-body-sm text-text-2">
                      {answer.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}

          {/* ── The time this will actually book ───────────────────────── */}
          <div className="grid grid-cols-2 gap-1.5">
            <Input
              label={t("request.date")}
              type="date"
              prefixIcon={<CalendarDays />}
              value={dateValue}
              onChange={(event) => setDateValue(event.target.value)}
              className="font-mono text-data-sm tabular-nums [font-feature-settings:'tnum'_1,'zero'_1] [color-scheme:dark]"
            />
            <Input
              label={t("request.time")}
              type="time"
              prefixIcon={<Clock />}
              value={timeValue}
              onChange={(event) => setTimeValue(event.target.value)}
              className="font-mono text-data-sm tabular-nums [font-feature-settings:'tnum'_1,'zero'_1] [color-scheme:dark]"
            />
          </div>
          {isPast ? (
            <span className="font-mono text-micro uppercase tracking-[0.14em] text-rose">
              {t("request.pastTime")}
            </span>
          ) : null}
          {moved && !isPast ? (
            <span
              data-testid="request-moved"
              className="font-mono text-micro uppercase tracking-[0.14em] text-[var(--tan)]"
            >
              {`// ${t("request.moved", { slot: format(asked, "HH:mm") })}`}
            </span>
          ) : null}

          {/* The consequence, stated before the operator commits to it. */}
          {chosen && !isPast ? (
            <span
              data-testid="request-books"
              className="font-mono text-micro uppercase tracking-[0.14em] tabular-nums text-text-2 [font-feature-settings:'tnum'_1,'zero'_1]"
            >
              {t("request.books", {
                slot: formatLongSlot(chosen),
                duration: formatMinutes(request.durationMinutes),
              })}
            </span>
          ) : null}
        </div>

        {/* Destructive-left / primary-right, wrapping rather than clipping —
            the grammar the staff booking modal already keeps. */}
        <div className="mt-3 flex flex-wrap items-center gap-y-2 border-t border-border pt-2">
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant={declineArmed ? "destructive" : "ghost"}
              className={cn(!declineArmed && "text-rose hover:text-rose")}
              disabled={busy}
              onClick={handleDecline}
            >
              {declineArmed ? t("request.ctaConfirmDecline") : t("request.ctaDecline")}
            </Button>
            {declineArmed ? (
              <span className="font-mono text-micro text-text-3">
                {t("request.declineNote")}
              </span>
            ) : null}
          </div>
          <div className="ml-auto flex items-center gap-1">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("request.close")}
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={!canAccept}
              loading={accept.isPending}
              onClick={handleAccept}
            >
              {t("request.ctaAccept")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
