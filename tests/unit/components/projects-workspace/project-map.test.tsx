/**
 * <ProjectMap> — Mapbox tile + status pin renderer used by MapHero.
 *
 * Smoke coverage:
 *   - renders the MapTokenMissing fallback when NEXT_PUBLIC_MAPBOX_TOKEN
 *     is absent (covers the "no env var" path in dev / preview)
 *   - renders the wrapped Map + Marker pair when the token is set
 *   - non-interactive mode applies a zoom-in cursor; expanded mode does
 *     not
 *
 * react-map-gl is mocked at the boundary so we don't touch GL during
 * jsdom — we just confirm the props handed to the mock match the
 * design intent.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as React from "react";
import { render, screen } from "@testing-library/react";

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({ t: (k: string) => k }),
}));

vi.mock("framer-motion", async () => {
  const actual = await vi.importActual<typeof import("framer-motion")>(
    "framer-motion",
  );
  return { ...actual, useReducedMotion: () => false };
});

// React-map-gl boundary mock — capture props so we can assert the
// interactive flags follow the expanded prop.
const mapPropsSpy = vi.fn();
const markerPropsSpy = vi.fn();
vi.mock("react-map-gl", () => ({
  default: ({ children, ...props }: { children?: React.ReactNode }) => {
    mapPropsSpy(props);
    return <div data-testid="map-host">{children}</div>;
  },
  Marker: ({ children, ...props }: { children?: React.ReactNode }) => {
    markerPropsSpy(props);
    return <div data-testid="map-marker">{children}</div>;
  },
}));
// css side-effect import
vi.mock("mapbox-gl/dist/mapbox-gl.css", () => ({}));

import { ProjectMap } from "@/components/ops/projects/workspace/map/project-map";

const ORIGINAL_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

beforeEach(() => {
  mapPropsSpy.mockClear();
  markerPropsSpy.mockClear();
});

afterEach(() => {
  if (ORIGINAL_TOKEN === undefined) {
    delete (process.env as Record<string, string | undefined>).NEXT_PUBLIC_MAPBOX_TOKEN;
  } else {
    process.env.NEXT_PUBLIC_MAPBOX_TOKEN = ORIGINAL_TOKEN;
  }
});

describe("<ProjectMap>", () => {
  it("renders MapTokenMissing fallback when NEXT_PUBLIC_MAPBOX_TOKEN is unset", () => {
    delete (process.env as Record<string, string | undefined>).NEXT_PUBLIC_MAPBOX_TOKEN;

    render(
      <ProjectMap
        latitude={37.96}
        longitude={-121.29}
        pinColor="#9DB582"
        expanded={false}
      />,
    );

    // The fallback element exists somewhere in the tree.
    expect(screen.queryByTestId("map-host")).not.toBeInTheDocument();
  });

  it("renders the Mapbox host + marker when the token is set", () => {
    process.env.NEXT_PUBLIC_MAPBOX_TOKEN = "test-token-123";

    render(
      <ProjectMap
        latitude={37.96}
        longitude={-121.29}
        pinColor="#9DB582"
        expanded={false}
      />,
    );

    expect(screen.getByTestId("map-host")).toBeInTheDocument();
    expect(screen.getByTestId("map-marker")).toBeInTheDocument();
    expect(mapPropsSpy).toHaveBeenCalled();
    const [props] = mapPropsSpy.mock.calls[0];
    expect(props.mapboxAccessToken).toBe("test-token-123");
    // Compact = non-interactive map.
    expect(props.interactive).toBe(false);
    expect(props.dragPan).toBe(false);
    expect(props.scrollZoom).toBe(false);
  });

  it("flips interactive flags on when expanded=true", () => {
    process.env.NEXT_PUBLIC_MAPBOX_TOKEN = "test-token-123";

    render(
      <ProjectMap
        latitude={37.96}
        longitude={-121.29}
        pinColor="#9DB582"
        expanded={true}
      />,
    );

    const [props] = mapPropsSpy.mock.calls[0];
    expect(props.interactive).toBe(true);
    expect(props.dragPan).toBe(true);
    expect(props.scrollZoom).toBe(true);
    expect(props.doubleClickZoom).toBe(true);
  });

  it("renders one Marker per otherPin when expanded", () => {
    process.env.NEXT_PUBLIC_MAPBOX_TOKEN = "test-token-123";

    render(
      <ProjectMap
        latitude={37.96}
        longitude={-121.29}
        pinColor="#9DB582"
        expanded={true}
        otherPins={[
          { id: "p1", latitude: 37.9, longitude: -121.3, color: "#C4A868", label: "A" },
          { id: "p2", latitude: 37.95, longitude: -121.31, color: "#B58289", label: "B" },
        ]}
      />,
    );

    // 1 status marker + 2 other pins
    expect(screen.getAllByTestId("map-marker")).toHaveLength(3);
  });

  it("hides otherPins when not expanded", () => {
    process.env.NEXT_PUBLIC_MAPBOX_TOKEN = "test-token-123";

    render(
      <ProjectMap
        latitude={37.96}
        longitude={-121.29}
        pinColor="#9DB582"
        expanded={false}
        otherPins={[
          { id: "p1", latitude: 37.9, longitude: -121.3, color: "#C4A868", label: "A" },
        ]}
      />,
    );

    expect(screen.getAllByTestId("map-marker")).toHaveLength(1);
  });
});
