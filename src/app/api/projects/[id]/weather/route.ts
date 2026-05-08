/**
 * GET /api/projects/[id]/weather
 *
 * Returns the workspace WEATHER card payload (current + 5-day forecast).
 *
 * Cache discipline:
 *   - Reads weather_forecasts for the project; if the most recent row's
 *     retrieved_at is < 12h old, returns the cached set as-is.
 *   - Otherwise calls Open-Meteo, upserts each forecast row keyed by
 *     (project_id, forecast_date), and returns the fresh payload.
 *
 * RLS: weather_forecasts INSERT/UPDATE is service-role only — that's why this
 * lives in a route handler. The service-role client bypasses RLS for the
 * write but we still scope every query by the caller's company_id.
 *
 * Attribution: every WeatherSummary embeds "Weather data by Open-Meteo.com"
 * for the courtesy line on the card.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import {
  fetchOpenMeteo,
  isCacheStale,
  mapOpenMeteoResponse,
  OPEN_METEO_ATTRIBUTION,
} from "@/lib/api/services/weather-service";
import type { WeatherForecast, WeatherSummary } from "@/lib/types/weather";

export const maxDuration = 30;

interface ProjectRow {
  id: string;
  company_id: string;
  latitude: number | null;
  longitude: number | null;
}

interface WeatherRow {
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

function rowToForecast(row: WeatherRow): WeatherForecast {
  return {
    id: row.id,
    projectId: row.project_id,
    companyId: row.company_id,
    forecastDate: row.forecast_date,
    tempHighC: row.temp_high_c,
    tempLowC: row.temp_low_c,
    tempCurrentC: row.temp_current_c,
    precipitationMm: row.precipitation_mm,
    precipitationProbability: row.precipitation_probability,
    windSpeedKmh: row.wind_speed_kmh,
    conditions: row.conditions,
    retrievedAt: row.retrieved_at,
    source: "open-meteo",
  };
}

function summaryFromCache(rows: WeatherRow[]): WeatherSummary {
  const sorted = [...rows].sort((a, b) =>
    a.forecast_date < b.forecast_date ? -1 : a.forecast_date > b.forecast_date ? 1 : 0
  );
  const today = new Date().toISOString().slice(0, 10);
  const todayRow = sorted.find((r) => r.forecast_date === today) ?? null;
  return {
    current: todayRow ? rowToForecast(todayRow) : sorted[0] ? rowToForecast(sorted[0]) : null,
    forecast: sorted.map(rowToForecast),
    attribution: OPEN_METEO_ATTRIBUTION,
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authUser = await verifyAdminAuth(req);
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: projectId } = await params;
  if (!projectId) {
    return NextResponse.json({ error: "Missing project id" }, { status: 400 });
  }

  const user = await findUserByAuth(authUser.uid, authUser.email, "id, company_id");
  if (!user?.company_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const companyId = user.company_id as string;

  const db = getServiceRoleClient();

  // 1. Project belongs to user's company? Fetch lat/lng + company_id.
  const projectRes = await db
    .from("projects")
    .select("id, company_id, latitude, longitude")
    .eq("id", projectId)
    .maybeSingle();

  if (projectRes.error) {
    return NextResponse.json({ error: projectRes.error.message }, { status: 500 });
  }
  const project = projectRes.data as ProjectRow | null;
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  if (project.company_id !== companyId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // No coordinates → empty summary (UI renders the "no location" state).
  if (project.latitude == null || project.longitude == null) {
    return NextResponse.json({
      current: null,
      forecast: [],
      attribution: OPEN_METEO_ATTRIBUTION,
    } satisfies WeatherSummary);
  }

  // 2. Pull cached rows (today onward).
  const todayISO = new Date().toISOString().slice(0, 10);
  const cacheRes = await db
    .from("weather_forecasts")
    .select("*")
    .eq("project_id", projectId)
    .gte("forecast_date", todayISO)
    .order("forecast_date", { ascending: true });

  if (cacheRes.error) {
    return NextResponse.json({ error: cacheRes.error.message }, { status: 500 });
  }
  const cachedRows = (cacheRes.data ?? []) as WeatherRow[];
  const newest = cachedRows
    .map((r) => r.retrieved_at)
    .sort()
    .at(-1);

  if (cachedRows.length > 0 && !isCacheStale(newest)) {
    return NextResponse.json(summaryFromCache(cachedRows));
  }

  // 3. Cache miss / stale → fetch + upsert.
  let summary: WeatherSummary;
  try {
    const open = await fetchOpenMeteo(project.latitude, project.longitude);
    summary = mapOpenMeteoResponse(open, projectId, companyId);
  } catch (err) {
    // If Open-Meteo errors, fall back to whatever cached rows we have rather
    // than failing the workspace card.
    if (cachedRows.length > 0) return NextResponse.json(summaryFromCache(cachedRows));
    const message = err instanceof Error ? err.message : "Open-Meteo unavailable";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  // Upsert the daily forecast (keyed by project_id, forecast_date).
  const upsertRows = summary.forecast.map((f) => ({
    project_id: projectId,
    company_id: companyId,
    forecast_date: f.forecastDate,
    temp_high_c: f.tempHighC,
    temp_low_c: f.tempLowC,
    temp_current_c: f.forecastDate === todayISO ? summary.current?.tempCurrentC ?? null : null,
    precipitation_mm: f.precipitationMm,
    precipitation_probability: f.precipitationProbability,
    wind_speed_kmh: f.forecastDate === todayISO ? summary.current?.windSpeedKmh ?? null : null,
    conditions: f.conditions,
    retrieved_at: f.retrievedAt,
    source: "open-meteo",
  }));

  const upsertRes = await db
    .from("weather_forecasts")
    .upsert(upsertRows, { onConflict: "project_id,forecast_date" });

  if (upsertRes.error) {
    // Surface the failure but still return the live summary so the UI renders.
    console.error("[api/projects/.../weather] upsert failed:", upsertRes.error.message);
  }

  return NextResponse.json(summary);
}
