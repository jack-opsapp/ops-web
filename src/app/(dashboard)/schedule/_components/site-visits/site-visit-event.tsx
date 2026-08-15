"use client";

/**
 * Booked site visits on the schedule calendar — the third source.
 *
 * Visits are appointments, not tasks: none of these components register
 * with dnd-kit (no drag-reschedule), expose resize handles, or route into
 * the task side panel / project window. The single interaction is click →
 * compact visit popover (lead link, reschedule, cancel), with reschedule
 * opening the shared BookSiteVisitModal.
 *
 * Treatment: tan — the design system's site-visit hue (DESIGN.md §3) —
 * carried by a MapPin glyph + tinted hairline + SITE VISIT chip, the same
 * "special event" grammar the calendar already uses for personal (Star,
 * white) and time-off (TreePalm, muted tan wash) items.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { MapPin } from "lucide-react";
import { motion } from "framer-motion";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import { useTeamMembers } from "@/lib/hooks";
import { useCancelSiteVisitBooking } from "@/lib/hooks/use-site-visits";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { UserAvatar } from "@/components/ops/user-avatar";
import { BookSiteVisitModal } from "@/components/ops/site-visit/book-site-visit-modal";
import { SiteVisitBookingError } from "@/lib/api/services/site-visit-service";
import {
  frostedBadgeStyleFromBg,
  getEventTopOffset,
  getEventHeight,
  type InternalScheduleEvent,
} from "@/lib/utils/schedule-utils";

// ─── Shared tan surface (mirrors the day-card special-event tokens) ─────────

const VISIT_BG = "rgba(196, 168, 104, 0.06)";
const VISIT_BORDER = "var(--tan-line)";
const VISIT_BORDER_STRONG = "rgba(196, 168, 104, 0.55)";
const VISIT_TEXT = "var(--tan)";

function formatSlotRange(event: InternalScheduleEvent): string {
  return `${format(event.startDate, "HH:mm")} → ${format(event.endDate, "HH:mm")}`;
}

// ─── Popover ────────────────────────────────────────────────────────────────

interface SiteVisitPopoverProps {
  event: InternalScheduleEvent;
  children: React.ReactNode;
}

/**
 * Compact visit popover: lead link, slot, address, crew, and (for operators
 * holding the booking gate) RESCHEDULE + armed CANCEL. Wraps every visit
 * card/bar/block as its click target.
 */
export function SiteVisitPopover({ event, children }: SiteVisitPopoverProps) {
  const { t } = useDictionary("pipeline");
  const [open, setOpen] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [cancelArmed, setCancelArmed] = useState(false);

  const canBook = usePermissionStore((s) => s.can("pipeline.convert"));
  const cancelBooking = useCancelSiteVisitBooking();

  const { data: teamData } = useTeamMembers();
  const crew = useMemo(() => {
    const users = teamData?.users ?? [];
    const byId = new Map(users.map((u) => [u.id, u]));
    return event.crewIds
      .map((id) => byId.get(id))
      .filter((u): u is NonNullable<typeof u> => Boolean(u));
  }, [teamData, event.crewIds]);

  const visit = event.siteVisit;

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) setCancelArmed(false);
  };

  const handleCancel = () => {
    if (!visit) return;
    if (!cancelArmed) {
      setCancelArmed(true);
      return;
    }
    cancelBooking.mutate(visit.id, {
      onSuccess: () => {
        setOpen(false);
        setCancelArmed(false);
        toast.success(t("booking.toastCancelled", "VISIT CANCELLED"));
      },
      onError: (error) => {
        setCancelArmed(false);
        toast.error(
          error instanceof SiteVisitBookingError && error.code === "permission"
            ? t("booking.errorPermission", "// NO PERMISSION TO BOOK ON THIS LEAD")
            : t("booking.errorCancelFailed", "// CANCEL FAILED — TRY AGAIN")
        );
      },
    });
  };

  return (
    <>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>{children}</PopoverTrigger>
        <PopoverContent
          side="right"
          align="start"
          collisionPadding={8}
          className="w-[280px] rounded-modal border border-glass-border p-2"
        >
          {/* Header — kind + slot */}
          <div className="flex items-center justify-between gap-2">
            <span
              className="font-mono text-[10px] uppercase tracking-[0.16em]"
              style={{ color: "var(--text-mute)" }}
            >
              {t("booking.kindLabel", "// SITE VISIT")}
            </span>
            <span
              className="font-mono text-[11px] tabular-nums"
              style={{
                color: VISIT_TEXT,
                fontFeatureSettings: '"tnum" 1, "zero" 1',
              }}
            >
              {formatSlotRange(event)}
            </span>
          </div>

          {/* Lead link — the visit's home */}
          {event.opportunityId ? (
            <Link
              href={`/pipeline?opportunityId=${encodeURIComponent(event.opportunityId)}`}
              className={cn(
                "mt-1 block truncate font-cakemono font-light text-[15px] uppercase leading-tight",
                "text-text transition-colors duration-150 hover:text-text-2",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent"
              )}
            >
              {event.title}
            </Link>
          ) : (
            <span className="mt-1 block truncate font-cakemono font-light text-[15px] uppercase leading-tight text-text">
              {event.title}
            </span>
          )}
          {event.clientName && (
            <span
              className="mt-[2px] block truncate font-mono text-[11px]"
              style={{ color: "var(--text-3)" }}
            >
              {event.clientName}
            </span>
          )}

          {/* Site */}
          {event.address && (
            <div className="mt-1.5 flex items-start gap-1">
              <MapPin
                className="mt-[1px] h-3 w-3 shrink-0"
                style={{ color: VISIT_TEXT }}
                aria-hidden="true"
              />
              <span
                className="min-w-0 font-mono text-[11px] leading-snug"
                style={{ color: "var(--text-3)" }}
              >
                {event.address}
              </span>
            </div>
          )}

          {/* Crew */}
          {crew.length > 0 && (
            <div className="mt-1.5 flex items-center gap-1.5">
              <div className="flex items-center -space-x-[6px]">
                {crew.slice(0, 4).map((u) => (
                  <UserAvatar
                    key={u.id}
                    name={
                      `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() ||
                      u.email ||
                      "?"
                    }
                    imageUrl={u.profileImageURL}
                    size="sm"
                    showTooltip
                  />
                ))}
              </div>
              {crew.length > 4 && (
                <span
                  className="font-mono text-[11px] tabular-nums"
                  style={{
                    color: "var(--text-3)",
                    fontFeatureSettings: '"tnum" 1, "zero" 1',
                  }}
                >
                  {`+${crew.length - 4}`}
                </span>
              )}
            </div>
          )}

          {/* Actions — booking gate only; visits are never editable inline */}
          {canBook && visit && (
            <div className="mt-2 flex items-center justify-between gap-1 border-t border-border-subtle pt-1.5">
              <button
                type="button"
                onClick={handleCancel}
                disabled={cancelBooking.isPending}
                className={cn(
                  "rounded px-1.5 py-1 font-mono text-micro uppercase tracking-[0.14em]",
                  "transition-colors duration-150",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent",
                  cancelArmed
                    ? "border border-rose-line bg-rose-soft text-rose"
                    : "text-rose/80 hover:text-rose"
                )}
              >
                {cancelArmed
                  ? t("booking.ctaConfirmCancel", "CONFIRM CANCEL")
                  : t("booking.ctaCancelVisit", "CANCEL VISIT")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setRescheduling(true);
                }}
                className={cn(
                  "rounded border border-border px-1.5 py-1",
                  "font-mono text-micro uppercase tracking-[0.14em] text-text-2",
                  "transition-colors duration-150 hover:bg-surface-hover hover:text-text",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent"
                )}
              >
                {t("booking.ctaReschedule", "RESCHEDULE")}
              </button>
            </div>
          )}
        </PopoverContent>
      </Popover>

      {canBook && visit && event.opportunityId && (
        <BookSiteVisitModal
          opportunityId={event.opportunityId}
          open={rescheduling}
          onOpenChange={setRescheduling}
          existingBooking={visit}
        />
      )}
    </>
  );
}

// ─── List / week card ───────────────────────────────────────────────────────

interface SiteVisitEventCardProps {
  event: InternalScheduleEvent;
  index: number;
}

/**
 * Week-column / day-list card. Mirrors the DayTaskCard special-event layout
 * (leading glyph + tinted hairline, no type stripe) so the three non-task
 * kinds read as one family — MapPin + tan is the appointment signature.
 */
export function SiteVisitEventCard({ event, index }: SiteVisitEventCardProps) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <SiteVisitPopover event={event}>
      <motion.div
        initial={{ y: 14, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{
          duration: 0.22,
          ease: [0.22, 1, 0.36, 1],
          delay: index * 0.06,
        }}
        className="relative cursor-pointer"
        role="button"
        tabIndex={0}
        style={{
          display: "flex",
          minHeight: 64,
          borderRadius: 4,
          overflow: "hidden",
          background: VISIT_BG,
          border: `1px solid ${isHovered ? VISIT_BORDER_STRONG : VISIT_BORDER}`,
          opacity: isHovered ? 1 : 0.96,
          transition:
            "border-color 0.15s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.15s cubic-bezier(0.22, 1, 0.36, 1)",
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <div
          className="flex min-w-0 flex-1 flex-col justify-center"
          style={{ padding: "12px 14px" }}
        >
          {/* Line 1 — glyph + lead. No type chip: like the other special
              events (Star = personal, TreePalm = time off), the MapPin +
              tan pairing IS the signal, and a chip clips at week-column
              widths. The label lives in the popover header. */}
          <div className="flex min-w-0 items-center gap-[8px]">
            <MapPin
              size={14}
              strokeWidth={1.5}
              style={{ color: VISIT_TEXT, flexShrink: 0 }}
              aria-hidden="true"
            />
            <span
              className="min-w-0 flex-1 truncate font-cakemono font-light text-[15px] uppercase leading-tight"
              style={{ color: VISIT_TEXT }}
            >
              {event.title}
            </span>
          </div>

          {/* Line 2 — client */}
          {event.clientName && (
            <span
              className="mt-[3px] truncate font-mono text-[12px] leading-tight"
              style={{ color: "var(--text-2)" }}
            >
              {event.clientName}
            </span>
          )}

          {/* Bottom row — address left, slot right */}
          <div className="mt-[6px] flex min-w-0 items-center justify-between gap-2">
            <span
              className="min-w-0 truncate font-mono text-[11px] leading-tight"
              style={{ color: "rgba(237, 237, 237, 0.45)" }}
            >
              {event.address ?? "—"}
            </span>
            <span
              className="shrink-0 font-mono text-[11px] leading-tight tabular-nums"
              style={{
                color: "var(--text-3)",
                fontFeatureSettings: '"tnum" 1, "zero" 1',
              }}
            >
              {formatSlotRange(event)}
            </span>
          </div>
        </div>
      </motion.div>
    </SiteVisitPopover>
  );
}

// ─── Hourly block (Day view timed lane) ─────────────────────────────────────

interface SiteVisitTimedBlockProps {
  event: InternalScheduleEvent;
  columnIndex: number;
  totalColumns: number;
}

/**
 * Absolutely positioned hourly block. Shares the TimedBlock geometry
 * helpers but registers no draggable and grows no resize handles — the
 * appointment moves only through the reschedule flow.
 */
export function SiteVisitTimedBlock({
  event,
  columnIndex,
  totalColumns,
}: SiteVisitTimedBlockProps) {
  const top = getEventTopOffset(event.startDate);
  const height = getEventHeight(event.startDate, event.endDate);
  const widthPercent = 100 / Math.max(totalColumns, 1);
  const leftPercent = columnIndex * widthPercent;
  const compact = height < 44;

  return (
    <SiteVisitPopover event={event}>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.15 }}
        data-site-visit-id={event.id}
        role="button"
        tabIndex={0}
        className="absolute cursor-pointer"
        style={{
          left: `${leftPercent}%`,
          width: `calc(${widthPercent}% - 4px)`,
          top,
          height,
          ...frostedBadgeStyleFromBg(event.statusColors.bg),
          border: `1px solid ${event.statusColors.border}`,
          borderRadius: 4,
          zIndex: 5,
        }}
      >
        <div
          className="flex min-w-0 flex-col gap-[2px] overflow-hidden"
          style={{ padding: compact ? "4px 8px" : "6px 8px" }}
        >
          <div className="flex min-w-0 items-center gap-[6px]">
            <MapPin
              size={12}
              strokeWidth={1.5}
              style={{ color: VISIT_TEXT, flexShrink: 0 }}
              aria-hidden="true"
            />
            <span
              className="min-w-0 flex-1 truncate font-cakemono font-light text-[12px] uppercase leading-tight"
              style={{ color: VISIT_TEXT, letterSpacing: "0.02em" }}
            >
              {event.title}
            </span>
          </div>
          {!compact && (
            <span
              className="font-mono text-[11px] tabular-nums"
              style={{
                color: "var(--text-3)",
                fontFeatureSettings: '"tnum" 1, "zero" 1',
                paddingLeft: 18,
              }}
            >
              {formatSlotRange(event)}
            </span>
          )}
        </div>
      </motion.div>
    </SiteVisitPopover>
  );
}
