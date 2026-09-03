const MAPBOX_DARK_STYLE_TILE_URL =
  "https://api.mapbox.com/styles/v1/mapbox/dark-v11/tiles/512/{z}/{x}/{y}@2x";

const MAPBOX_ATTRIBUTION =
  '© <a href="https://www.mapbox.com/about/maps/">Mapbox</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

export interface DashboardMapTileLayerConfig {
  url: string;
  options: {
    attribution: string;
    maxZoom: number;
    tileSize: number;
    zoomOffset: number;
  };
}

export function createDashboardMapTileLayerConfig(
  token: string | undefined
): DashboardMapTileLayerConfig | null {
  const accessToken = token?.trim();
  if (!accessToken) return null;

  return {
    url: `${MAPBOX_DARK_STYLE_TILE_URL}?access_token=${encodeURIComponent(accessToken)}`,
    options: {
      attribution: MAPBOX_ATTRIBUTION,
      maxZoom: 19,
      tileSize: 512,
      zoomOffset: -1,
    },
  };
}
