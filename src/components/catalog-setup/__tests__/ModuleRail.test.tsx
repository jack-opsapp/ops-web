import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("framer-motion", async () => {
  const actual = await vi.importActual<typeof import("framer-motion")>("framer-motion");
  return { ...actual, useReducedMotion: () => true };
});

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
    dict: {},
  }),
  useLocale: () => ({ locale: "en", setLocale: vi.fn() }),
}));

import { ModuleRail } from "../ModuleRail";
import type { StepContext } from "@/lib/catalog-setup/step-machine";

const TRACKED: StepContext = {
  inventoryTracked: true,
  canSell: true,
  canStock: true,
  canTypes: true,
};
const UNTRACKED: StepContext = { ...TRACKED, inventoryTracked: false };

describe("<ModuleRail>", () => {
  it("renders without crashing and shows all four segments when tracked", () => {
    render(
      <ModuleRail
        currentStep="sell"
        context={TRACKED}
        counts={{ sell: 4, stock: 2, types: 3 }}
      />,
    );
    expect(screen.getByTestId("module-rail")).toBeInTheDocument();
    expect(screen.getByTestId("rail-segment-sell")).toBeInTheDocument();
    expect(screen.getByTestId("rail-segment-stock")).toBeInTheDocument();
    expect(screen.getByTestId("rail-segment-types")).toBeInTheDocument();
    expect(screen.getByTestId("rail-segment-review")).toBeInTheDocument();
  });

  it("OMITS the STOCK segment entirely when inventory is not tracked", () => {
    render(
      <ModuleRail
        currentStep="sell"
        context={UNTRACKED}
        counts={{ sell: 4, types: 3 }}
      />,
    );
    expect(screen.queryByTestId("rail-segment-stock")).toBeNull();
    expect(screen.getByTestId("rail-segment-sell")).toBeInTheDocument();
    expect(screen.getByTestId("rail-segment-types")).toBeInTheDocument();
    expect(screen.getByTestId("rail-segment-review")).toBeInTheDocument();
  });

  it("STOCK carries a TRACKED tag", () => {
    render(
      <ModuleRail currentStep="sell" context={TRACKED} counts={{ stock: 2 }} />,
    );
    expect(screen.getByTestId("rail-tracked-tag")).toHaveTextContent("tracked");
  });

  it("done segment shows an olive check; active is a surface-active pill (no accent)", () => {
    render(
      <ModuleRail
        currentStep="types"
        context={TRACKED}
        counts={{ sell: 4, stock: 2, types: 3 }}
      />,
    );
    // sell + stock are before types → done (olive check)
    expect(screen.getByTestId("rail-check-sell")).toHaveClass("text-olive");
    expect(screen.getByTestId("rail-check-stock")).toBeInTheDocument();
    // types is active → surface-active pill, white label, no accent
    const active = screen.getByTestId("rail-segment-types");
    expect(active).toHaveAttribute("data-seg-state", "active");
    expect(active).toHaveClass("bg-surface-active");
    expect(active.querySelector('[class*="ops-accent"]')).toBeNull();
  });

  it("upcoming segments show a hollow circle with the proposed count in mono", () => {
    render(
      <ModuleRail
        currentStep="sell"
        context={TRACKED}
        counts={{ sell: 4, stock: 2, types: 3 }}
      />,
    );
    const stock = screen.getByTestId("rail-segment-stock");
    expect(stock).toHaveAttribute("data-seg-state", "upcoming");
    // its count "2" renders inside the hollow circle
    expect(stock).toHaveTextContent("2");
  });

  it("renders a 2px fill-neutral progress track + fill", () => {
    render(
      <ModuleRail currentStep="types" context={TRACKED} counts={{}} />,
    );
    const track = screen.getByTestId("rail-progress-track");
    expect(track).toHaveClass("h-[2px]");
    expect(track).toHaveClass("bg-fill-neutral-dim");
    expect(track).toHaveClass("rounded-bar");
    const fill = screen.getByTestId("rail-progress-fill");
    expect(fill).toHaveClass("bg-fill-neutral");
  });

  it("renders thin connectors between segments (count = segments - 1)", () => {
    render(
      <ModuleRail
        currentStep="sell"
        context={TRACKED}
        counts={{ sell: 1, stock: 1, types: 1 }}
      />,
    );
    // 4 segments → 3 connectors
    expect(screen.getAllByTestId("rail-connector")).toHaveLength(3);
  });
});
