"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useAuthStore } from "@/lib/store/auth-store";
import { authedFetch } from "@/lib/utils/authed-fetch";
import type { RecentEvent } from "@/lib/types/calibration";

const LIMIT = 5;

/**
 * Last N recent events for the deck RECENT rail.
 *
 * Two sources of truth:
 *   1. Initial + fallback: /api/calibration/recent (polled every 30s).
 *   2. Realtime: Supabase postgres_changes on agent_memories + gmail_scan_jobs
 *      filtered to the current company. New rows merge into the front of the
 *      list, keeping at most LIMIT.
 *
 * If Supabase realtime fails to connect, the 30s poll is the safety net.
 */
export function useCalibrationRecent(): RecentEvent[] {
  const company = useAuthStore((s) => s.company);
  const companyId = company?.id ?? "";

  const { data } = useQuery({
    queryKey: ["calibration", "recent", companyId],
    queryFn: async () => {
      const res = await authedFetch(`/api/calibration/recent?limit=${LIMIT}`);
      if (!res.ok) throw new Error("Failed to fetch recent events");
      const json = (await res.json()) as { events: RecentEvent[] };
      return json.events;
    },
    enabled: !!companyId,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const [events, setEvents] = useState<RecentEvent[]>(data ?? []);

  useEffect(() => {
    if (data) setEvents(data);
  }, [data]);

  useEffect(() => {
    if (!companyId) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;

    const channel = supabase
      .channel(`calibration-recent-${companyId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "agent_memories",
          filter: `company_id=eq.${companyId}`,
        },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          const source = row.source as string | null;
          const isLearning = source === "learning";
          const newEvent: RecentEvent = {
            id: String(row.id),
            type: isLearning ? "learning" : "extraction",
            title: isLearning ? "LEARNING" : "EXTRACTION",
            detail: null,
            createdAt: String(row.created_at),
            sourceTable: "agent_memories",
            sourceId: String(row.id),
          };
          setEvents((prev) =>
            [newEvent, ...prev.filter((e) => e.id !== newEvent.id)].slice(
              0,
              LIMIT
            )
          );
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "gmail_scan_jobs",
          filter: `company_id=eq.${companyId}`,
        },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          const status = row.status as string | null;
          if (
            status !== "complete" &&
            status !== "error" &&
            status !== "running"
          ) {
            return;
          }
          const newEvent: RecentEvent = {
            id: String(row.id),
            type: status === "complete" ? "scan_complete" : "scan",
            title: status === "complete" ? "SCAN COMPLETE" : "SCAN",
            detail: null,
            createdAt: String(row.updated_at ?? row.created_at),
            sourceTable: "gmail_scan_jobs",
            sourceId: String(row.id),
          };
          setEvents((prev) =>
            [newEvent, ...prev.filter((e) => e.id !== newEvent.id)].slice(
              0,
              LIMIT
            )
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [companyId]);

  return events;
}
