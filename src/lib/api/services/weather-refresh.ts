/**
 * OPS Web — shared weather cache refresh (server-only).
 *
 * The single place that reads the `weather_forecasts` cache, decides whether
 * it's stale, and — when it is — calls Open-Meteo and upserts fresh rows. Both
 * the per-project workspace card route (`/api/projects/[id]/weather`) and the
 * batch schedule route (`/api/schedule/weather`) go through here so they can
 * never write the cache in conflicting shapes (e.g. one storing per-day wind,
 * the other nulling it).
 *
 * RLS: `weather_forecasts` INSERT/UPDATE is service-role only, so callers pass
 * a service-role client. Every read is still scoped by project_id (and the
 * caller validates company ownership before calling).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchOpenMeteo,
  isCacheStale,
  mapOpenMeteoResponse,
} from "@/lib/api/services/weather-service";

/** DB row shape for `weather_forecasts` (snake_case, as stored). */
export interface WeatherRow {
  id: string;
  project_id: string;
  company_id: string;
  forecast_date: string;
  temp_high_c: number | null;
  temp_low_c: number | null;
  temp_current_c: number | null;
  precipitation_mm: number | null;
  precipitation_probability: number | null;
  wind_speed_kmh: number | null;
  conditions: string | null;
  retrieved_at: string;
  source: string;
}

/** The project fields the refresh needs — id, company, and coordinates. */
export interface WeatherRefreshProject {
  id: string;
  company_id: string;
  latitude: number | null;
  longitude: number | null;
}

function utcTodayISO(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Return the cached-or-fresh `weather_forecasts` rows for a project, from today
 * onward. Fetches Open-Meteo + upserts only when the cache is missing or older
 * than 12h. Returns [] when the project has no coordinates (nothing to fetch).
 *
 * Never throws on an Open-Meteo failure — falls back to whatever is cached so a
 * transient upstream outage never breaks the schedule or the workspace card.
 */
export async function ensureProjectWeather(
  db: SupabaseClient,
  project: WeatherRefreshProject,
  now: Date = new Date()
): Promise<WeatherRow[]> {
  if (project.latitude == null || project.longitude == null) return [];

  const todayISO = utcTodayISO(now);

  const cacheRes = await db
    .from("weather_forecasts")
    .select("*")
    .eq("project_id", project.id)
    .gte("forecast_date", todayISO)
    .order("forecast_date", { ascending: true });

  if (cacheRes.error) throw new Error(cacheRes.error.message);
  const cachedRows = (cacheRes.data ?? []) as WeatherRow[];

  const newest = cachedRows
    .map((r) => r.retrieved_at)
    .sort()
    .at(-1);

  if (cachedRows.length > 0 && !isCacheStale(newest, now)) {
    return cachedRows;
  }

  // Cache miss / stale → fetch fresh. On any failure, keep serving cache.
  let upsertRows: Omit<WeatherRow, "id">[];
  try {
    const open = await fetchOpenMeteo(project.latitude, project.longitude);
    const summary = mapOpenMeteoResponse(open, project.id, project.company_id);
    const retrievedAt = summary.current?.retrievedAt ?? new Date(now).toISOString();

    upsertRows = summary.forecast.map((f) => ({
      project_id: project.id,
      company_id: project.company_id,
      forecast_date: f.forecastDate,
      temp_high_c: f.tempHighC,
      temp_low_c: f.tempLowC,
      // Today's row keeps the live "current" temp; future days have none.
      temp_current_c:
        f.forecastDate === todayISO ? summary.current?.tempCurrentC ?? null : null,
      precipitation_mm: f.precipitationMm,
      precipitation_probability: f.precipitationProbability,
      // Per-day max wind for every day (today prefers the live current reading).
      wind_speed_kmh:
        f.forecastDate === todayISO
          ? summary.current?.windSpeedKmh ?? f.windSpeedKmh
          : f.windSpeedKmh,
      conditions: f.conditions,
      retrieved_at: retrievedAt,
      source: "open-meteo",
    }));
  } catch {
    return cachedRows;
  }

  const upsertRes = await db
    .from("weather_forecasts")
    .upsert(upsertRows, { onConflict: "project_id,forecast_date" });

  if (upsertRes.error) {
    console.error(
      "[weather-refresh] upsert failed:",
      upsertRes.error.message
    );
    // Return the freshly-mapped rows anyway so the caller can render live data.
  }

  // Return the fresh rows (id is unused downstream — the DTO/summary builders
  // read forecast_date and the metric columns, not the primary key).
  return upsertRows.map((r) => ({ id: "", ...r }));
}
