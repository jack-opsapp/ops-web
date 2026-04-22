/**
 * OPS Web - Inbox Velocity Hook
 *
 * TanStack Query wrapper for /api/inbox/velocity. Used by the
 * empty-status-view's velocity section.
 */

"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/api/query-client";
import type { InboxScope } from "@/lib/types/email-thread";

export interface InboxVelocityData {
  daily: number[];          // length 14, oldest → newest
  weekTotal: number;
  priorWeekTotal: number;
  weekDelta: number;        // e.g. -0.12 for -12%, 0 when prior-week was zero
}

async function authHeaders(): Promise<HeadersInit> {
  const { getIdToken } = await import("@/lib/firebase/auth");
  const token = await getIdToken();
  if (!token) throw new Error("Not authenticated");
  return { Authorization: `Bearer ${token}` };
}

async function fetchVelocity(scope: InboxScope): Promise<InboxVelocityData> {
  const headers = await authHeaders();
  const res = await fetch(`/api/inbox/velocity?scope=${scope}`, { headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`velocity fetch failed: ${res.status} ${body}`);
  }
  return res.json();
}

export function useInboxVelocity(scope: InboxScope) {
  return useQuery({
    queryKey: queryKeys.inbox.velocity(scope),
    queryFn: () => fetchVelocity(scope),
    staleTime: 5 * 60_000, // 5 minutes — trend data doesn't need second-fresh
  });
}
