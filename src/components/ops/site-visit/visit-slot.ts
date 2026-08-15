/**
 * Booked-visit slot formatting shared by the pipeline strip, the booking
 * modal toasts, and the calendar visit popover.
 *
 * Near appointments read as a weekday ("THU 10:00" — the way an operator
 * says it on the phone); anything beyond this week reads as a date
 * ("AUG 20 10:00"). Always uppercase, always 24h — numbers stay mono at
 * the render site.
 */

import { differenceInCalendarDays, format } from "date-fns";

export function formatVisitSlot(date: Date, now: Date = new Date()): string {
  const daysAhead = differenceInCalendarDays(date, now);
  const pattern = daysAhead >= 0 && daysAhead < 7 ? "EEE HH:mm" : "MMM d HH:mm";
  return format(date, pattern).toUpperCase();
}
