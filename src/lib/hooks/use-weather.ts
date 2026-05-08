/**
 * useWeather — workspace WEATHER card.
 *
 * Calls the per-project route handler at `/api/projects/:id/weather`. The
 * route handler owns the 12h cache logic and the service-role write into
 * `weather_forecasts` — the hook just hands off and parses.
 *
 * Open-Meteo attribution ("Weather data by Open-Meteo.com") is included in
 * every WeatherSummary so the UI can render the courtesy line next to the
 * card without a second source of truth.
 */

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/api/query-client";
import type { WeatherSummary } from "@/lib/types/weather";

export function useWeather(projectId: string | null) {
  return useQuery({
    queryKey: queryKeys.projectWorkspace.weather(projectId),
    queryFn: async (): Promise<WeatherSummary> => {
      if (!projectId) {
        return {
          current: null,
          forecast: [],
          attribution: "Weather data by Open-Meteo.com",
        };
      }
      const res = await fetch(`/api/projects/${projectId}/weather`);
      if (!res.ok) {
        throw new Error(`Weather request failed: ${res.status}`);
      }
      return (await res.json()) as WeatherSummary;
    },
    enabled: !!projectId,
    // Forecasts move slowly — give the cache a long stale window. The 12h
    // server-side cache governs freshness; the client just avoids spamming
    // the route handler when the workspace re-mounts.
    staleTime: 10 * 60 * 1000,
  });
}
