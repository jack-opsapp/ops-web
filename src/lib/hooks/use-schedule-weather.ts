/**
 * useScheduleWeather — batch adverse-weather forecast for the visible schedule.
 *
 * Called once by the schedule page. It collects the distinct project ids of the
 * weather-dependent events that fall inside the 6-day forecast window, posts
 * them to `/api/schedule/weather`, and returns a lookup keyed by
 * `${projectId}|${forecastDate}`. The batch route owns the 12h cache + the
 * service-role upsert; this hook just hands off and indexes the result.
 *
 * The query is intentionally lazy (fires on schedule load, not blocking first
 * paint) — the calendar renders immediately and the warning glyphs fade in when
 * the forecast resolves. Empty when nothing weather-dependent is scheduled soon.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/api/query-client";
import { useAuthStore } from "@/lib/store/auth-store";
import type { InternalScheduleEvent } from "@/lib/utils/schedule-utils";
import {
  coveredForecastDates,
  isWeatherDependentEvent,
  type ForecastLike,
} from "@/lib/utils/weather-risk";

interface ScheduleWeatherForecast extends ForecastLike {
  projectId: string;
}

interface ScheduleWeatherResponse {
  forecasts: ScheduleWeatherForecast[];
}

export interface ScheduleWeatherLookup {
  /** Look up a project's forecast for a specific YYYY-MM-DD, or null. */
  get: (projectId: string, date: string) => ForecastLike | null;
  isFetching: boolean;
}

const EMPTY_LOOKUP: ScheduleWeatherLookup = {
  get: () => null,
  isFetching: false,
};

function lookupKey(projectId: string, date: string): string {
  return `${projectId}|${date}`;
}

export function useScheduleWeather(
  events: InternalScheduleEvent[]
): ScheduleWeatherLookup {
  const companyId = useAuthStore((s) => s.company?.id ?? "");

  // Distinct project ids that have a weather-dependent task inside the forecast
  // window. Sorted for a stable query key so scrolling the calendar (which
  // doesn't change the in-window set) never refetches.
  const projectIds = useMemo(() => {
    const ids = new Set<string>();
    for (const e of events) {
      if (!e.projectId) continue;
      if (!isWeatherDependentEvent(e)) continue;
      if (coveredForecastDates(e.startDate, e.endDate).length === 0) continue;
      ids.add(e.projectId);
    }
    return Array.from(ids).sort();
  }, [events]);

  const projectKey = projectIds.join(",");

  const { data, isFetching } = useQuery({
    queryKey: queryKeys.calendar.weather(companyId, projectKey),
    queryFn: async (): Promise<ScheduleWeatherResponse> => {
      const res = await fetch("/api/schedule/weather", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectIds }),
      });
      if (!res.ok) {
        throw new Error(`Schedule weather request failed: ${res.status}`);
      }
      return (await res.json()) as ScheduleWeatherResponse;
    },
    enabled: projectIds.length > 0 && !!companyId,
    // Forecasts move slowly and the server holds a 12h cache — a long client
    // stale window keeps the calendar from re-posting on every remount.
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  });

  return useMemo<ScheduleWeatherLookup>(() => {
    if (!data?.forecasts?.length) {
      return { get: () => null, isFetching };
    }
    const map = new Map<string, ForecastLike>();
    for (const f of data.forecasts) {
      map.set(lookupKey(f.projectId, f.forecastDate), {
        forecastDate: f.forecastDate,
        precipitationProbability: f.precipitationProbability,
        precipitationMm: f.precipitationMm,
        windSpeedKmh: f.windSpeedKmh,
        conditions: f.conditions,
      });
    }
    return {
      get: (projectId, date) => map.get(lookupKey(projectId, date)) ?? null,
      isFetching,
    };
  }, [data, isFetching]);
}

export { EMPTY_LOOKUP as EMPTY_SCHEDULE_WEATHER_LOOKUP };
