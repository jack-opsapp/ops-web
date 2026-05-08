/**
 * <MapHero> — compact / expanded Mapbox surface above the workspace
 * dossier. Expand toggles between a 220px compact strip and a full-
 * height pane with toolbar + legend + crumb.
 *
 * Smoke coverage:
 *   - compact (expanded=false): status pill, address pill, EXPAND hint
 *     button visible; crumb / collapse / toolbar / legend hidden
 *   - expanded (expanded=true): crumb, collapse button, toolbar, legend
 *     visible; status pill + address pill + EXPAND hint hidden
 *   - clicking the EXPAND hint button calls onToggleExpand
 *   - clicking the COLLAPSE button calls onToggleExpand
 *   - toolbar buttons forward their dedicated callbacks
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (key: string) => {
      switch (key) {
        case "map.expandHint":
          return "Expand";
        case "map.collapseAria":
          return "Collapse map";
        case "map.collapse":
          return "Collapse";
        case "map.toolbar.zoomIn":
          return "Zoom in";
        case "map.toolbar.zoomOut":
          return "Zoom out";
        case "map.toolbar.crew":
          return "Crew";
        case "map.toolbar.layers":
          return "Layers";
        case "map.toolbar.recenter":
          return "Recenter";
        case "map.legend.thisProject":
          return "This project";
        case "map.legend.accepted":
          return "Accepted";
        case "map.legend.completed":
          return "Completed";
        case "map.legend.rfq":
          return "RFQ";
        default:
          return key;
      }
    },
  }),
}));

vi.mock("framer-motion", async () => {
  const actual = await vi.importActual<typeof import("framer-motion")>(
    "framer-motion",
  );
  return { ...actual, useReducedMotion: () => true };
});

// ProjectMap is the heavy child; stub it at the boundary so we focus on
// the hero overlay logic.
vi.mock(
  "@/components/ops/projects/workspace/map/project-map",
  () => ({
    ProjectMap: () => <div data-testid="project-map-stub" />,
  }),
);

import { MapHero } from "@/components/ops/projects/workspace/map/map-hero";

const BASE_PROPS = {
  latitude: 37.96,
  longitude: -121.29,
  address: "123 Industry Way",
  statusColor: "#9DB582",
  statusLabel: "IN PROGRESS",
  projectId: "PROJ-00247",
  projectName: "Greenway Townhomes — Phase 2",
} as const;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("<MapHero> compact", () => {
  it("renders status pill + address pill + EXPAND hint when expanded=false", () => {
    render(
      <MapHero
        {...BASE_PROPS}
        expanded={false}
        onToggleExpand={vi.fn()}
      />,
    );
    expect(screen.getByTestId("map-status-pill")).toBeInTheDocument();
    expect(screen.getByTestId("map-address-pill")).toBeInTheDocument();
    expect(screen.getByTestId("map-expand-hint")).toBeInTheDocument();
    // Expanded-only chrome must not be present.
    expect(screen.queryByTestId("map-project-crumb")).not.toBeInTheDocument();
    expect(screen.queryByTestId("map-collapse-button")).not.toBeInTheDocument();
    expect(screen.queryByTestId("map-toolbar")).not.toBeInTheDocument();
    expect(screen.queryByTestId("map-legend")).not.toBeInTheDocument();
  });

  it("calls onToggleExpand when the EXPAND hint is clicked", () => {
    const onToggle = vi.fn();
    render(
      <MapHero
        {...BASE_PROPS}
        expanded={false}
        onToggleExpand={onToggle}
      />,
    );
    fireEvent.click(screen.getByTestId("map-expand-hint"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});

describe("<MapHero> expanded", () => {
  it("renders crumb, collapse, toolbar, legend; hides compact-only chrome", () => {
    render(
      <MapHero
        {...BASE_PROPS}
        expanded={true}
        onToggleExpand={vi.fn()}
        legend={{ accepted: 5, completed: 7, rfq: 3 }}
      />,
    );
    expect(screen.getByTestId("map-project-crumb")).toBeInTheDocument();
    expect(screen.getByTestId("map-collapse-button")).toBeInTheDocument();
    expect(screen.getByTestId("map-toolbar")).toBeInTheDocument();
    expect(screen.getByTestId("map-legend")).toBeInTheDocument();
    // Compact-only chrome must not be present.
    expect(screen.queryByTestId("map-status-pill")).not.toBeInTheDocument();
    expect(screen.queryByTestId("map-address-pill")).not.toBeInTheDocument();
    expect(screen.queryByTestId("map-expand-hint")).not.toBeInTheDocument();
  });

  it("calls onToggleExpand when the COLLAPSE button is clicked", () => {
    const onToggle = vi.fn();
    render(
      <MapHero {...BASE_PROPS} expanded={true} onToggleExpand={onToggle} />,
    );
    fireEvent.click(screen.getByTestId("map-collapse-button"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("forwards toolbar button clicks to the matching callback", () => {
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    const onShowCrew = vi.fn();
    const onShowLayers = vi.fn();
    const onRecenter = vi.fn();

    const { container } = render(
      <MapHero
        {...BASE_PROPS}
        expanded={true}
        onToggleExpand={vi.fn()}
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
        onShowCrew={onShowCrew}
        onShowLayers={onShowLayers}
        onRecenter={onRecenter}
      />,
    );

    fireEvent.click(container.querySelector('[data-tool="zoom-in"]')!);
    fireEvent.click(container.querySelector('[data-tool="zoom-out"]')!);
    fireEvent.click(container.querySelector('[data-tool="crew"]')!);
    fireEvent.click(container.querySelector('[data-tool="layers"]')!);
    fireEvent.click(container.querySelector('[data-tool="recenter"]')!);

    expect(onZoomIn).toHaveBeenCalledTimes(1);
    expect(onZoomOut).toHaveBeenCalledTimes(1);
    expect(onShowCrew).toHaveBeenCalledTimes(1);
    expect(onShowLayers).toHaveBeenCalledTimes(1);
    expect(onRecenter).toHaveBeenCalledTimes(1);
  });

  it("renders the legend counts as tabular numbers", () => {
    render(
      <MapHero
        {...BASE_PROPS}
        expanded={true}
        onToggleExpand={vi.fn()}
        legend={{ accepted: 5, completed: 7, rfq: 3 }}
      />,
    );
    const legend = screen.getByTestId("map-legend");
    expect(legend.querySelector('[data-count="5"]')).toBeInTheDocument();
    expect(legend.querySelector('[data-count="7"]')).toBeInTheDocument();
    expect(legend.querySelector('[data-count="3"]')).toBeInTheDocument();
  });
});
