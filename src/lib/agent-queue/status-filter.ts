/**
 * Agent Queue — status filter vocabulary.
 *
 * The queue has two views: NEEDS YOU (status = pending) and HISTORY (every
 * other status). `parseStatusesParam` validates the `?statuses=a,b` query
 * param on the API side so an unknown status becomes a 400, never a silent
 * empty list.
 */

import type { AgentActionStatus } from "@/lib/types/approval-queue";

export const ALL_STATUSES: readonly AgentActionStatus[] = [
  "pending",
  "approved",
  "rejected",
  "executed",
  "failed",
  "expired",
  "cancelled",
];

/** Every terminal or in-flight status — what the HISTORY view shows. */
export const HISTORY_STATUSES: readonly AgentActionStatus[] = ALL_STATUSES.filter(
  (s) => s !== "pending"
);

/** Parse `?statuses=a,b` into a validated list. Throws on an unknown status. */
export function parseStatusesParam(
  raw: string | null
): AgentActionStatus[] | undefined {
  if (!raw) return undefined;
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return undefined;
  for (const p of parts) {
    if (!ALL_STATUSES.includes(p as AgentActionStatus)) {
      throw new Error(`Unknown status: ${p}`);
    }
  }
  return parts as AgentActionStatus[];
}
