import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ─── react-map-gl mock ──────────────────────────────────────────────────────
//
// jsdom can't run mapbox-gl's WebGL renderer, so we replace `react-map-gl`
// with deterministic stand-ins that capture the props the SUT passes through.
// This tests the *integration contract* (props wired correctly to Map /
// Marker / NavigationControl) without booting a real GL context.
type MapProps = {
  initialViewState?: { latitude: number; longitude: number; zoom: number };
  mapStyle?: string;
  mapboxAccessToken?: string;
  interactive?: boolean;
  dragPan?: boolean;
  scrollZoom?: boolean;
  doubleClickZoom?: boolean;
  attributionControl?: boolean;
  children?: React.ReactNode;
};

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({ t: (k: string) => k }),
}));

vi.mock("react-map-gl", () => {
  return {
    default: ({ children, mapStyle, initialViewState, interactive, dragPan, mapboxAccessToken }: MapProps) => (
      <div
        data-testid="mock-map"
        data-style={mapStyle}
        data-token={mapboxAccessToken}
        data-interactive={String(!!interactive)}
        data-drag-pan={String(!!dragPan)}
        data-zoom={String(initialViewState?.zoom)}
        data-lat={String(initialViewState?.latitude)}
        data-lng={String(initialViewState?.longitude)}
      >
        {children}
      </div>
    ),
    Marker: ({ children, latitude, longitude }: { children?: React.ReactNode; latitude: number; longitude: number }) => (
      <div data-testid="mock-marker" data-lat={String(latitude)} data-lng={String(longitude)}>
        {children}
      </div>
    ),
    // NavigationControl was removed from ProjectMap (the custom MapToolbar
    // owns zoom/recenter/etc.). The mock still exposes it so any accidental
    // re-introduction would surface — the assertions below verify it never
    // renders.
    NavigationControl: () => <div data-testid="mock-nav-control" />,
  };
});

// mapbox-gl ships its CSS import; vitest needs an empty module rather than
// trying to parse it as JS.
vi.mock("mapbox-gl/dist/mapbox-gl.css", () => ({}));

import { ProjectMap } from "@/components/ops/projects/workspace/map/project-map";

const ORIGINAL_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

describe("<ProjectMap>", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_MAPBOX_TOKEN = "pk.test_token_for_unit_tests";
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_MAPBOX_TOKEN = ORIGINAL_TOKEN;
  });

  it("renders the mapbox container with center, zoom, and pin", () => {
    render(
      <ProjectMap
        latitude={49.7016}
        longitude={-123.1558}
        pinColor="#D99A3E"
        expanded={false}
      />,
    );
    const map = screen.getByTestId("mock-map");
    expect(map).toBeInTheDocument();
    expect(map).toHaveAttribute("data-style", "mapbox://styles/mapbox/dark-v11");
    expect(map).toHaveAttribute("data-lat", "49.7016");
    expect(map).toHaveAttribute("data-lng", "-123.1558");
    // Compact zoom is 14 per the plan's design tokens.
    expect(map).toHaveAttribute("data-zoom", "14");
    expect(screen.getByTestId("project-pin")).toBeInTheDocument();
  });

  it("disables interactivity in compact mode and adds cursor-zoom-in", () => {
    const onClick = vi.fn();
    const { container } = render(
      <ProjectMap
        latitude={49.7016}
        longitude={-123.1558}
        pinColor="#D99A3E"
        expanded={false}
        onClick={onClick}
      />,
    );
    const map = screen.getByTestId("mock-map");
    expect(map).toHaveAttribute("data-interactive", "false");
    expect(map).toHaveAttribute("data-drag-pan", "false");
    // Compact wrapper signals "click to expand" via cursor + click handler.
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain("cursor-zoom-in");
    expect(screen.queryByTestId("mock-nav-control")).not.toBeInTheDocument();
  });

  it("enables interactivity and other-pin markers in expanded mode (no NavigationControl)", () => {
    render(
      <ProjectMap
        latitude={49.7016}
        longitude={-123.1558}
        pinColor="#D99A3E"
        expanded={true}
        otherPins={[
          { id: "p1", latitude: 49.71, longitude: -123.15, color: "#9DB582", label: "Greenway" },
          { id: "p2", latitude: 49.69, longitude: -123.16, color: "#B58289", label: "Cedar Ridge" },
        ]}
      />,
    );
    const map = screen.getByTestId("mock-map");
    expect(map).toHaveAttribute("data-interactive", "true");
    expect(map).toHaveAttribute("data-drag-pan", "true");
    // Expanded zoom is 13 per the plan's design tokens.
    expect(map).toHaveAttribute("data-zoom", "13");
    // The custom MapToolbar owns zoom/recenter — Mapbox's NavigationControl
    // would be a duplicate, so it must never render.
    expect(screen.queryByTestId("mock-nav-control")).not.toBeInTheDocument();
    // 1 primary pin + 2 other pins = 3 markers.
    expect(screen.getAllByTestId("mock-marker")).toHaveLength(3);
  });

  it("does not invoke onClick in expanded mode (compact-only zoom-in affordance)", async () => {
    const onClick = vi.fn();
    const { container } = render(
      <ProjectMap
        latitude={49.7016}
        longitude={-123.1558}
        pinColor="#D99A3E"
        expanded={true}
        onClick={onClick}
      />,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    await userEvent.click(wrapper);
    expect(onClick).not.toHaveBeenCalled();
    expect(wrapper.className).not.toContain("cursor-zoom-in");
  });

  it("calls onClick once when compact wrapper is clicked", async () => {
    const onClick = vi.fn();
    const { container } = render(
      <ProjectMap
        latitude={49.7016}
        longitude={-123.1558}
        pinColor="#D99A3E"
        expanded={false}
        onClick={onClick}
      />,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    await userEvent.click(wrapper);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders <MapTokenMissing> fallback when NEXT_PUBLIC_MAPBOX_TOKEN is absent", () => {
    delete process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    render(
      <ProjectMap
        latitude={49.7016}
        longitude={-123.1558}
        pinColor="#D99A3E"
        expanded={false}
      />,
    );
    expect(screen.queryByTestId("mock-map")).not.toBeInTheDocument();
    // Token-missing copy resolves via t("map.tokenMissing") — the
    // mocked dictionary returns the key string directly.
    expect(screen.getByText("map.tokenMissing")).toBeInTheDocument();
  });

  it("forwards the access token to <Map>", () => {
    render(
      <ProjectMap
        latitude={49.7016}
        longitude={-123.1558}
        pinColor="#9DB582"
        expanded={false}
      />,
    );
    expect(screen.getByTestId("mock-map")).toHaveAttribute("data-token", "pk.test_token_for_unit_tests");
  });
});
