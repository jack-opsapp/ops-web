import { describe, expect, it } from "vitest";

import { createDashboardMapTileLayerConfig } from "@/components/dashboard/map/dashboard-map-tiles";

describe("createDashboardMapTileLayerConfig", () => {
  it("builds authenticated Mapbox dark-style tiles for Leaflet", () => {
    expect(createDashboardMapTileLayerConfig("pk.test/token value")).toEqual({
      url: "https://api.mapbox.com/styles/v1/mapbox/dark-v11/tiles/512/{z}/{x}/{y}@2x?access_token=pk.test%2Ftoken%20value",
      options: {
        attribution:
          '© <a href="https://www.mapbox.com/about/maps/">Mapbox</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
        tileSize: 512,
        zoomOffset: -1,
      },
    });
  });

  it.each([undefined, "", "   "])(
    "does not create an unauthenticated tile request for %p",
    (token) => {
      expect(createDashboardMapTileLayerConfig(token)).toBeNull();
    }
  );
});
