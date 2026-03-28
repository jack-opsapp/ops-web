/**
 * OPS Web - Crew Location Service
 *
 * Fetches real-time crew positions from the crew_locations Supabase table.
 * Each row is one crew member's latest known position (upserted by mobile app).
 */

import { requireSupabase, parseDate } from "@/lib/supabase/helpers";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CrewLocation {
  userId: string;
  orgId: string;
  firstName: string;
  lastName: string | null;
  lat: number;
  lng: number;
  heading: number | null;
  speed: number | null;
  accuracy: number | null;
  batteryLevel: number | null;
  isBackground: boolean;
  currentTaskName: string | null;
  currentProjectName: string | null;
  currentProjectId: string | null;
  currentProjectAddress: string | null;
  phoneNumber: string | null;
  updatedAt: Date;
}

export type CrewStatus = "on-site" | "en-route" | "idle";

// ─── Database ↔ TypeScript Mapping ───────────────────────────────────────────

function mapFromDb(row: Record<string, unknown>): CrewLocation {
  return {
    userId: row.user_id as string,
    orgId: row.org_id as string,
    firstName: (row.first_name as string) ?? "",
    lastName: (row.last_name as string) ?? null,
    lat: row.lat as number,
    lng: row.lng as number,
    heading: (row.heading as number) ?? null,
    speed: (row.speed as number) ?? null,
    accuracy: (row.accuracy as number) ?? null,
    batteryLevel: (row.battery_level as number) ?? null,
    isBackground: (row.is_background as boolean) ?? false,
    currentTaskName: (row.current_task_name as string) ?? null,
    currentProjectName: (row.current_project_name as string) ?? null,
    currentProjectId: (row.current_project_id as string) ?? null,
    currentProjectAddress: (row.current_project_address as string) ?? null,
    phoneNumber: (row.phone_number as string) ?? null,
    updatedAt: parseDate(row.updated_at) ?? new Date(),
  };
}

// ─── Status Resolution (matches iOS CrewAnnotationRenderer) ──────────────────

/**
 * Resolve crew member status based on their location relative to job sites.
 * - on-site: within 100m of any project coordinate
 * - en-route: speed > 2 m/s
 * - idle: no update for > 5 minutes, or stationary
 */
export function resolveCrewStatus(
  location: CrewLocation,
  projectCoordinates: { lat: number; lng: number }[]
): CrewStatus {
  // Check if within 100m of any job site (haversine approximation)
  for (const coord of projectCoordinates) {
    const distance = haversineMeters(
      location.lat,
      location.lng,
      coord.lat,
      coord.lng
    );
    if (distance <= 100) return "on-site";
  }

  // Check if moving
  if (location.speed != null && location.speed > 2) return "en-route";

  // Check staleness (> 5 minutes)
  const ageMs = Date.now() - location.updatedAt.getTime();
  if (ageMs > 5 * 60 * 1000) return "idle";

  return "idle";
}

/** Simple haversine distance in meters between two lat/lng pairs. */
function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Service ─────────────────────────────────────────────────────────────────

export const CrewLocationService = {
  /**
   * Fetch all crew locations for an organization.
   * Returns one row per crew member (the table is upserted by the mobile app).
   */
  async fetchLocations(orgId: string): Promise<CrewLocation[]> {
    const supabase = requireSupabase();

    const { data, error } = await supabase
      .from("crew_locations")
      .select("*")
      .eq("org_id", orgId);

    if (error)
      throw new Error(`Failed to fetch crew locations: ${error.message}`);
    return (data ?? []).map(mapFromDb);
  },
};
