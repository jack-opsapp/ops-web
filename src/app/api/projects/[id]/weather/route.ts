/**
 * GET /api/projects/[id]/weather
 *
 * Returns the workspace WEATHER card payload (current + 5-day forecast).
 *
 * Cache discipline lives in `ensureProjectWeather` (shared with the batch
 * schedule route): reads weather_forecasts for the project; if the newest
 * row is < 12h old it's served as-is, otherwise Open-Meteo is called and the
 * rows are upserted keyed by (project_id, forecast_date).
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
import { OPEN_METEO_ATTRIBUTION } from "@/lib/api/services/weather-service";
import {
  ensureProjectWeather,
  type WeatherRow,
} from "@/lib/api/services/weather-refresh";
import type { WeatherForecast, WeatherSummary } from "@/lib/types/weather";

export const maxDuration = 30;

interface ProjectRow {
  id: string;
  company_id: string;
  latitude: number | null;
  longitude: number | null;
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

function summaryFromRows(rows: WeatherRow[]): WeatherSummary {
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

  // Project belongs to user's company? Fetch lat/lng + company_id.
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

  // Shared cache-aware refresh (no coords → empty rows → empty summary).
  let rows: WeatherRow[];
  try {
    rows = await ensureProjectWeather(db, project);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Weather unavailable";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  return NextResponse.json(summaryFromRows(rows));
}
