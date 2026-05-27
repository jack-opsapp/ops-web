/**
 * Mapbox forward geocoding.
 *
 * Wraps the Mapbox Geocoding API v6 forward endpoint
 * (https://api.mapbox.com/search/geocode/v6/forward) so the rest of the
 * app talks to a single, normalized result shape regardless of what
 * Mapbox returns. Browser-only — the `NEXT_PUBLIC_MAPBOX_TOKEN` is
 * exposed to the client by design (URL-restricted at the Mapbox
 * dashboard).
 */

export interface GeocodingResult {
  /** Mapbox feature id, stable across requests for the same place. */
  id: string;
  /** Long-form address suitable for display (street, city, region, country). */
  fullAddress: string;
  /** Short label — first comma-separated segment of the full address. */
  shortAddress: string;
  latitude: number;
  longitude: number;
}

export interface GeocodingProximity {
  latitude: number;
  longitude: number;
}

interface MapboxV6Feature {
  id?: string;
  type?: string;
  properties?: {
    name?: string;
    full_address?: string;
    place_formatted?: string;
    coordinates?: { latitude?: number; longitude?: number };
  };
  geometry?: {
    type?: string;
    coordinates?: [number, number];
  };
}

interface MapboxV6Response {
  type?: string;
  features?: MapboxV6Feature[];
}

const ENDPOINT = "https://api.mapbox.com/search/geocode/v6/forward";

export const GeocodingService = {
  /**
   * Forward-geocode a free-text query into ranked address suggestions.
   * Returns at most `limit` results (default 5). Throws when the Mapbox
   * token is missing or the API responds with a non-2xx status — the
   * caller is responsible for surfacing the error to the user.
   */
  async forwardGeocode(
    query: string,
    options: {
      signal?: AbortSignal;
      limit?: number;
      proximity?: GeocodingProximity;
    } = {},
  ): Promise<GeocodingResult[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token) {
      throw new Error("NEXT_PUBLIC_MAPBOX_TOKEN is not configured");
    }

    const url = new URL(ENDPOINT);
    url.searchParams.set("q", trimmed);
    url.searchParams.set("access_token", token);
    url.searchParams.set("limit", String(options.limit ?? 5));
    url.searchParams.set("language", "en");
    if (options.proximity) {
      url.searchParams.set(
        "proximity",
        `${options.proximity.longitude},${options.proximity.latitude}`,
      );
    }

    const res = await fetch(url.toString(), { signal: options.signal });
    if (!res.ok) {
      throw new Error(`Mapbox geocoding failed: ${res.status} ${res.statusText}`);
    }
    const data: MapboxV6Response = await res.json();
    return (data.features ?? [])
      .map((feature) => normalizeFeature(feature))
      .filter((feature): feature is GeocodingResult => feature !== null);
  },
};

function normalizeFeature(feature: MapboxV6Feature): GeocodingResult | null {
  const id = feature.id;
  const fullAddress =
    feature.properties?.full_address ??
    feature.properties?.place_formatted ??
    feature.properties?.name;
  // v6 prefers properties.coordinates; fall back to geometry.coordinates.
  const lat =
    feature.properties?.coordinates?.latitude ??
    feature.geometry?.coordinates?.[1];
  const lng =
    feature.properties?.coordinates?.longitude ??
    feature.geometry?.coordinates?.[0];

  if (!id || !fullAddress || lat == null || lng == null) {
    return null;
  }

  return {
    id,
    fullAddress,
    shortAddress: fullAddress.split(",")[0]?.trim() ?? fullAddress,
    latitude: lat,
    longitude: lng,
  };
}
