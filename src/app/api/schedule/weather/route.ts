/**
 * POST /api/schedule/weather
 *
 * Batch weather for the schedule's adverse-weather warnings (bug 9dc7c38d).
 * The client posts the distinct project ids of the events currently visible
 * within the 6-day forecast window; this returns the compact per-day forecast
 * for each so the calendar can flag weather-dependent jobs at risk.
 *
 * Population happens HERE, on schedule load — no cron. Coverage is therefore
 * complete for exactly the projects the operator is looking at, and the 12h
 * cache (shared with the workspace card via `ensureProjectWeather`) means
 * repeated loads don't spam Open-Meteo. Beyond 6 days there is no data and no
 * warning, which is correct.
 *
 * RLS: weather_forecasts INSERT/UPDATE is service-role only — hence a route
 * handler with a service-role client. Ownership is enforced by scoping the
 * project lookup to the caller's company_id; ids that aren't the caller's are
 * silently dropped.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import {
  ensureProjectWeather,
  type WeatherRefreshProject,
} from "@/lib/api/services/weather-refresh";

export const maxDuration = 30;

// Bound the work per request. The schedule only sends projects with a task in
// the 6-day window, so this is generous headroom, not a real limit.
const MAX_PROJECTS = 200;
// Open-Meteo is fast + free, but cap concurrent upstream calls so a cold cache
// on a big company doesn't open 100 sockets at once.
const FETCH_CONCURRENCY = 8;

/** Compact per-day forecast the calendar classifier consumes. */
interface ScheduleWeatherForecast {
  projectId: string;
  forecastDate: string;
  precipitationProbability: number | null;
  precipitationMm: number | null;
  windSpeedKmh: number | null;
  conditions: string | null;
}

/** Run `worker` over `items` with a fixed concurrency ceiling. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await worker(items[i]);
    }
  });
  await Promise.all(runners);
  return results;
}

export async function POST(req: NextRequest) {
  const authUser = await verifyAdminAuth(req);
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await findUserByAuth(authUser.uid, authUser.email, "id, company_id");
  if (!user?.company_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const companyId = user.company_id as string;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const rawIds =
    body && typeof body === "object" && Array.isArray((body as { projectIds?: unknown }).projectIds)
      ? ((body as { projectIds: unknown[] }).projectIds as unknown[])
      : null;
  if (!rawIds) {
    return NextResponse.json({ error: "projectIds must be an array" }, { status: 400 });
  }

  const projectIds = Array.from(
    new Set(rawIds.filter((v): v is string => typeof v === "string" && v.length > 0))
  ).slice(0, MAX_PROJECTS);

  if (projectIds.length === 0) {
    return NextResponse.json({ forecasts: [] });
  }

  const db = getServiceRoleClient();

  // Ownership + coordinates in one query. Anything not in the caller's company
  // simply doesn't come back.
  const projectsRes = await db
    .from("projects")
    .select("id, company_id, latitude, longitude")
    .eq("company_id", companyId)
    .in("id", projectIds);

  if (projectsRes.error) {
    return NextResponse.json({ error: projectsRes.error.message }, { status: 500 });
  }

  const projects = (projectsRes.data ?? []).filter(
    (p): p is WeatherRefreshProject =>
      p != null && p.latitude != null && p.longitude != null
  );

  if (projects.length === 0) {
    return NextResponse.json({ forecasts: [] });
  }

  const rowsPerProject = await mapWithConcurrency(
    projects,
    FETCH_CONCURRENCY,
    async (project) => {
      try {
        return await ensureProjectWeather(db, project);
      } catch (err) {
        console.error(
          `[api/schedule/weather] refresh failed for ${project.id}:`,
          err instanceof Error ? err.message : err
        );
        return [];
      }
    }
  );

  const forecasts: ScheduleWeatherForecast[] = rowsPerProject.flat().map((r) => ({
    projectId: r.project_id,
    forecastDate: r.forecast_date,
    precipitationProbability: r.precipitation_probability,
    precipitationMm: r.precipitation_mm,
    windSpeedKmh: r.wind_speed_kmh,
    conditions: r.conditions,
  }));

  return NextResponse.json({ forecasts });
}
