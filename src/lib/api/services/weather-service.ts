/**
 * Open-Meteo weather service.
 *
 * Free public API (no key, no rate limit for non-commercial use). OPS is
 * commercial — Open-Meteo asks for a courtesy "Weather data by Open-Meteo.com"
 * attribution. The attribution constant is exported and rendered next to the
 * forecast card in the workspace UI.
 *
 * This module is server-side only (called from the weather route handler) —
 * the upsert into `weather_forecasts` requires the Supabase service role.
 */

import type { WeatherForecast, WeatherSummary } from "@/lib/types/weather";

export const OPEN_METEO_BASE = "https://api.open-meteo.com/v1/forecast";
export const OPEN_METEO_ATTRIBUTION = "Weather data by Open-Meteo.com" as const;

/** WMO 4677 weather code → human-readable conditions label. */
export const WMO_CODES: Record<number, string> = {
  0: "Clear",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  56: "Light freezing drizzle",
  57: "Dense freezing drizzle",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  66: "Light freezing rain",
  67: "Heavy freezing rain",
  71: "Slight snow",
  73: "Moderate snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Rain showers",
  81: "Heavy rain showers",
  82: "Violent rain showers",
  85: "Snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm w/ hail",
  99: "Heavy thunderstorm",
};

export interface OpenMeteoResponse {
  current?: {
    time: string;
    temperature_2m: number | null;
    weather_code: number | null;
    wind_speed_10m: number | null;
    precipitation_probability: number | null;
  };
  daily?: {
    time: string[];
    temperature_2m_max: (number | null)[];
    temperature_2m_min: (number | null)[];
    precipitation_probability_max: (number | null)[];
    precipitation_sum: (number | null)[];
    weather_code: (number | null)[];
    // Optional — Open-Meteo omits a daily field if it isn't requested/available.
    // The mapper reads it defensively, so absence just yields null wind.
    wind_speed_10m_max?: (number | null)[];
  };
}

/** Fetches current + 6-day forecast for the given coords. */
export async function fetchOpenMeteo(
  latitude: number,
  longitude: number,
  fetchImpl: typeof fetch = fetch
): Promise<OpenMeteoResponse> {
  const params = new URLSearchParams({
    latitude: latitude.toString(),
    longitude: longitude.toString(),
    current:
      "temperature_2m,weather_code,wind_speed_10m,precipitation_probability",
    daily:
      "temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,weather_code,wind_speed_10m_max",
    timezone: "auto",
    forecast_days: "6",
  });
  const res = await fetchImpl(`${OPEN_METEO_BASE}?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`Open-Meteo request failed: ${res.status}`);
  }
  return (await res.json()) as OpenMeteoResponse;
}

/**
 * Convert an Open-Meteo response into the WeatherForecast row shape used by
 * the cache table and the hook. The mapper does not insert IDs — those come
 * from the upsert in the route handler.
 */
export function mapOpenMeteoResponse(
  data: OpenMeteoResponse,
  projectId: string,
  companyId: string,
  retrievedAt: string = new Date().toISOString()
): WeatherSummary {
  const dailyTimes = data.daily?.time ?? [];
  const forecast: WeatherForecast[] = dailyTimes.map((date, i) => ({
    id: "", // assigned by DB on upsert
    projectId,
    companyId,
    forecastDate: date,
    tempHighC: data.daily?.temperature_2m_max?.[i] ?? null,
    tempLowC: data.daily?.temperature_2m_min?.[i] ?? null,
    tempCurrentC: null,
    precipitationMm: data.daily?.precipitation_sum?.[i] ?? null,
    precipitationProbability:
      data.daily?.precipitation_probability_max?.[i] ?? null,
    // Per-day max wind — lets adverse-weather warnings fire on future dates,
    // not just today (bug 9dc7c38d). Open-Meteo returns km/h by default.
    windSpeedKmh: data.daily?.wind_speed_10m_max?.[i] ?? null,
    conditions: codeToConditions(data.daily?.weather_code?.[i] ?? null),
    retrievedAt,
    source: "open-meteo",
  }));

  const todayISO = data.current?.time?.slice(0, 10) ?? null;
  const todayForecast = todayISO ? forecast.find((f) => f.forecastDate === todayISO) : null;

  const current: WeatherForecast | null = data.current
    ? {
        id: "",
        projectId,
        companyId,
        forecastDate: todayISO ?? forecast[0]?.forecastDate ?? "",
        tempHighC: todayForecast?.tempHighC ?? null,
        tempLowC: todayForecast?.tempLowC ?? null,
        tempCurrentC: data.current.temperature_2m ?? null,
        precipitationMm: todayForecast?.precipitationMm ?? null,
        precipitationProbability: data.current.precipitation_probability ?? null,
        windSpeedKmh: data.current.wind_speed_10m ?? null,
        conditions: codeToConditions(data.current.weather_code ?? null),
        retrievedAt,
        source: "open-meteo",
      }
    : null;

  return {
    current,
    forecast,
    attribution: OPEN_METEO_ATTRIBUTION,
  };
}

function codeToConditions(code: number | null): string | null {
  if (code == null) return null;
  return WMO_CODES[code] ?? null;
}

/**
 * True when the cache row is older than 12 hours (or null/undefined).
 * Used by the route handler to decide whether to refresh.
 */
export function isCacheStale(retrievedAt: string | null | undefined, now = new Date()): boolean {
  if (!retrievedAt) return true;
  const t = new Date(retrievedAt).getTime();
  if (Number.isNaN(t)) return true;
  return now.getTime() - t > 12 * 60 * 60 * 1000;
}
