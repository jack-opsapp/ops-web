"use client";

import Link from "next/link";
import { AlertTriangle, ArrowRight } from "lucide-react";

interface AssignRoleSeatBannerProps {
  firstName: string;
  isSeated: boolean;
  seatsAvailable: number;
  onAssignSeat: () => void;
  onManageSeats: () => void;
  isAssigning?: boolean;
}

/**
 * Three states:
 *   A — seated (isSeated=true): not rendered
 *   B — unseated with seats: inline warning with ASSIGN SEAT NOW action
 *   C — unseated, full: inline warning with MANAGE SEATS + UPGRADE actions
 */
export function AssignRoleModalSeatBanner({
  firstName,
  isSeated,
  seatsAvailable,
  onAssignSeat,
  onManageSeats,
  isAssigning,
}: AssignRoleSeatBannerProps) {
  if (isSeated) return null;

  const isFull = seatsAvailable <= 0;

  return (
    <div className="rounded-sm border border-status-warning/30 bg-status-warning/10 p-3 mb-4">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-[14px] h-[14px] text-status-warning mt-[2px] shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="font-kosugi text-micro uppercase tracking-wider text-status-warning">
            {isFull ? "Unseated — no seats left" : "Unseated"}
          </p>
          <p className="font-mohave text-body-sm text-text-2 leading-relaxed mt-1">
            {isFull
              ? `${firstName} joined your crew but can't access OPS until you shift a seat or upgrade your plan.`
              : `${firstName} is ready to work but hasn't been assigned a seat.`}
          </p>

          {isFull ? (
            <div className="flex items-center gap-3 mt-2">
              <button
                type="button"
                onClick={onManageSeats}
                className="font-kosugi text-micro uppercase tracking-wider text-text-2 hover:text-text transition-colors"
              >
                Manage seats
              </button>
              <Link
                href="/settings?tab=subscription"
                className="font-kosugi text-micro uppercase tracking-wider text-text-2 hover:text-text transition-colors inline-flex items-center gap-1"
              >
                Upgrade plan
                <ArrowRight className="w-[12px] h-[12px]" />
              </Link>
            </div>
          ) : (
            <button
              type="button"
              onClick={onAssignSeat}
              disabled={isAssigning}
              className="mt-2 bg-status-warning/20 hover:bg-status-warning/30 text-status-warning border border-status-warning/40 font-kosugi text-micro uppercase tracking-wider rounded-sm px-3 py-2 transition-colors disabled:opacity-50"
            >
              {isAssigning ? "Assigning…" : "Assign seat now"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
