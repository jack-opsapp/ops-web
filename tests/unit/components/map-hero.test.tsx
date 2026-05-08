import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Mock ProjectMap so MapHero tests stay compositional.
vi.mock("@/components/ops/projects/workspace/map/project-map", () => ({
  ProjectMap: ({
    expanded,
    otherPins,
    pinColor,
    latitude,
    longitude,
  }: {
    expanded: boolean;
    otherPins?: Array<unknown>;
    pinColor: string;
    latitude: number;
    longitude: number;
  }) => (
    <div
      data-testid="mock-project-map"
      data-expanded={String(expanded)}
      data-other-pins={String(otherPins?.length ?? 0)}
      data-pin-color={pinColor}
      data-lat={String(latitude)}
      data-lng={String(longitude)}
    />
  ),
}));

import { MapHero } from "@/components/ops/projects/workspace/map/map-hero";

const baseProps = {
  latitude: 49.7016,
  longitude: -123.1558,
  address: "1234 Industrial Way, Squamish, BC",
  statusColor: "#D99A3E",
  statusLabel: "IN PROGRESS",
  projectId: "PROJ-00247",
  projectName: "Greenway Townhomes — Phase 2",
};

describe("<MapHero>", () => {
  it("compact mode renders address pill, status pill, expand hint — no collapse btn, toolbar, legend, crumb", () => {
    render(<MapHero {...baseProps} expanded={false} onToggleExpand={() => {}} />);
    expect(screen.getByTestId("map-address-pill")).toHaveTextContent(baseProps.address);
    expect(screen.getByTestId("map-status-pill")).toHaveTextContent(baseProps.statusLabel);
    expect(screen.getByTestId("map-expand-hint")).toBeInTheDocument();
    expect(screen.getByTestId("map-expand-hint")).toHaveTextContent("EXPAND MAP");
    expect(screen.queryByTestId("map-collapse-button")).not.toBeInTheDocument();
    expect(screen.queryByTestId("map-toolbar")).not.toBeInTheDocument();
    expect(screen.queryByTestId("map-legend")).not.toBeInTheDocument();
    expect(screen.queryByTestId("map-project-crumb")).not.toBeInTheDocument();
  });

  it("expanded mode renders crumb, collapse btn, toolbar, legend — no expand hint, no standalone status pill", () => {
    render(
      <MapHero
        {...baseProps}
        expanded={true}
        onToggleExpand={() => {}}
        legend={{ accepted: 4, completed: 12, rfq: 7 }}
      />,
    );
    expect(screen.getByTestId("map-project-crumb")).toBeInTheDocument();
    expect(screen.getByTestId("map-collapse-button")).toBeInTheDocument();
    expect(screen.getByTestId("map-collapse-button")).toHaveTextContent("COLLAPSE");
    const toolbar = screen.getByTestId("map-toolbar");
    expect(toolbar).toBeInTheDocument();
    expect(toolbar.querySelector("[data-tool=zoom-in]")).toBeInTheDocument();
    expect(toolbar.querySelector("[data-tool=zoom-out]")).toBeInTheDocument();
    expect(toolbar.querySelector("[data-tool=crew]")).toBeInTheDocument();
    expect(toolbar.querySelector("[data-tool=layers]")).toBeInTheDocument();
    expect(toolbar.querySelector("[data-tool=recenter]")).toBeInTheDocument();
    const legend = screen.getByTestId("map-legend");
    expect(legend).toBeInTheDocument();
    expect(legend).toHaveTextContent("4");
    expect(legend).toHaveTextContent("12");
    expect(legend).toHaveTextContent("7");
    expect(screen.queryByTestId("map-expand-hint")).not.toBeInTheDocument();
    // Standalone status pill is compact-only — the crumb's leading dot
    // carries the status signal in expanded mode.
    expect(screen.queryByTestId("map-status-pill")).not.toBeInTheDocument();
    // Compact-only address pill is also gone — the crumb owns the address.
    expect(screen.queryByTestId("map-address-pill")).not.toBeInTheDocument();
  });

  it("clicking the expand hint fires onToggleExpand", async () => {
    const onToggleExpand = vi.fn();
    render(<MapHero {...baseProps} expanded={false} onToggleExpand={onToggleExpand} />);
    await userEvent.click(screen.getByTestId("map-expand-hint"));
    expect(onToggleExpand).toHaveBeenCalledTimes(1);
  });

  it("clicking the collapse button fires onToggleExpand", async () => {
    const onToggleExpand = vi.fn();
    render(<MapHero {...baseProps} expanded={true} onToggleExpand={onToggleExpand} />);
    await userEvent.click(screen.getByTestId("map-collapse-button"));
    expect(onToggleExpand).toHaveBeenCalledTimes(1);
  });

  it("forwards otherPins through to ProjectMap (expanded only)", () => {
    const otherPins = [
      { id: "a", latitude: 49.71, longitude: -123.15, color: "#9DB582", label: "Greenway" },
      { id: "b", latitude: 49.69, longitude: -123.16, color: "#B58289", label: "Cedar Ridge" },
    ];
    render(
      <MapHero
        {...baseProps}
        expanded={true}
        onToggleExpand={() => {}}
        otherPins={otherPins}
      />,
    );
    const map = screen.getByTestId("mock-project-map");
    expect(map).toHaveAttribute("data-other-pins", "2");
    expect(map).toHaveAttribute("data-expanded", "true");
    expect(map).toHaveAttribute("data-pin-color", baseProps.statusColor);
  });

  it("legend defaults to zeros when no counts are passed", () => {
    render(<MapHero {...baseProps} expanded={true} onToggleExpand={() => {}} />);
    const legend = screen.getByTestId("map-legend");
    // Three count chips — accepted, completed, rfq — all rendering "0".
    const counts = legend.querySelectorAll("[data-count]");
    expect(counts).toHaveLength(3);
    counts.forEach((node) => expect(node).toHaveAttribute("data-count", "0"));
  });

  it("toolbar callbacks fire when buttons are clicked (expanded mode)", async () => {
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    const onShowCrew = vi.fn();
    const onShowLayers = vi.fn();
    const onRecenter = vi.fn();
    render(
      <MapHero
        {...baseProps}
        expanded={true}
        onToggleExpand={() => {}}
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
        onShowCrew={onShowCrew}
        onShowLayers={onShowLayers}
        onRecenter={onRecenter}
      />,
    );
    const toolbar = screen.getByTestId("map-toolbar");
    await userEvent.click(toolbar.querySelector("[data-tool=zoom-in]") as HTMLElement);
    await userEvent.click(toolbar.querySelector("[data-tool=zoom-out]") as HTMLElement);
    await userEvent.click(toolbar.querySelector("[data-tool=crew]") as HTMLElement);
    await userEvent.click(toolbar.querySelector("[data-tool=layers]") as HTMLElement);
    await userEvent.click(toolbar.querySelector("[data-tool=recenter]") as HTMLElement);
    expect(onZoomIn).toHaveBeenCalledTimes(1);
    expect(onZoomOut).toHaveBeenCalledTimes(1);
    expect(onShowCrew).toHaveBeenCalledTimes(1);
    expect(onShowLayers).toHaveBeenCalledTimes(1);
    expect(onRecenter).toHaveBeenCalledTimes(1);
  });

  // ─── Review-required positional + crumb tests ───────────────────────────

  it("project crumb renders projectId and projectName in expanded mode", () => {
    render(<MapHero {...baseProps} expanded={true} onToggleExpand={() => {}} />);
    const crumb = screen.getByTestId("map-project-crumb");
    expect(screen.getByTestId("map-crumb-id")).toHaveTextContent(baseProps.projectId);
    expect(screen.getByTestId("map-crumb-name")).toHaveTextContent(baseProps.projectName);
    expect(screen.getByTestId("map-crumb-address")).toHaveTextContent(baseProps.address);
    // Crumb is anchored to the top-left at OVERLAY_INSET (14px).
    const wrapper = crumb.parentElement as HTMLElement;
    expect(wrapper.style.top).toBe("14px");
    expect(wrapper.style.left).toBe("14px");
  });

  it("legend is anchored to the bottom-right (handoff §MapHero — Expanded)", () => {
    render(<MapHero {...baseProps} expanded={true} onToggleExpand={() => {}} />);
    const legend = screen.getByTestId("map-legend");
    const wrapper = legend.parentElement as HTMLElement;
    expect(wrapper.style.bottom).toBe("14px");
    expect(wrapper.style.right).toBe("14px");
    // Make sure it's NOT in the old top-right slot.
    expect(wrapper.style.top).toBe("");
  });

  it("toolbar is anchored to the left edge below the crumb (top: 70px, left: 14px)", () => {
    render(<MapHero {...baseProps} expanded={true} onToggleExpand={() => {}} />);
    const toolbar = screen.getByTestId("map-toolbar");
    const wrapper = toolbar.parentElement as HTMLElement;
    expect(wrapper.style.left).toBe("14px");
    expect(wrapper.style.top).toBe("70px");
    // Make sure it's NOT in the old right-mid slot.
    expect(wrapper.style.right).toBe("");
  });
});
