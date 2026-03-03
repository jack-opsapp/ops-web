/**
 * OPS Web - Crew Locations Hook
 *
 * Fetches real-time crew positions from the crew_locations Supabase table.
 * Polls every 15 seconds (matching iOS CrewLocationSubscriber behavior).
 */

import { useQuery } from "@tanstack/react-query";
import { CrewLocationService } from "../api/services/crew-location-service";
import type { CrewLocation } from "../api/services/crew-location-service";
import { useAuthStore } from "../store/auth-store";

const POLL_INTERVAL_MS = 15_000; // 15 seconds, matching iOS

export function useCrewLocations() {
  const { company } = useAuthStore();
  const orgId = company?.id ?? "";

  return useQuery<CrewLocation[]>({
    queryKey: ["crew-locations", orgId],
    queryFn: () => CrewLocationService.fetchLocations(orgId),
    enabled: !!orgId,
    refetchInterval: POLL_INTERVAL_MS,
    staleTime: POLL_INTERVAL_MS - 1000, // consider stale just before next poll
  });
}
