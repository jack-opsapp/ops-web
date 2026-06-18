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

import { CanvasPane } from "../CanvasPane";
import {
  PREVIEW_STAGING_CARDS,
  PREVIEW_EXISTING_ROWS,
} from "@/lib/catalog-setup/__mocks__/preview-cards";
import { selectByModule, selectRunningTotals } from "@/lib/catalog-setup/selectors";

// Drive the pane from the real selectors so the test exercises the built logic.
const byModule = selectByModule({ cards: PREVIEW_STAGING_CARDS });
const totals = selectRunningTotals({ cards: PREVIEW_STAGING_CARDS });

describe("<CanvasPane>", () => {
  it("renders without crashing and shows the running totals header", () => {
    render(
      <CanvasPane
        byModule={byModule}
        totals={totals}
        inventoryTracked
        existingRows={PREVIEW_EXISTING_ROWS}
      />,
    );
    expect(screen.getByTestId("canvas-pane")).toBeInTheDocument();
    expect(screen.getByTestId("running-totals")).toBeInTheDocument();
  });

  it("renders the three section headers in the // slash voice", () => {
    render(<CanvasPane byModule={byModule} totals={totals} inventoryTracked />);
    expect(screen.getByTestId("canvas-section-sell")).toBeInTheDocument();
    expect(screen.getByTestId("canvas-section-stock")).toBeInTheDocument();
    expect(screen.getByTestId("canvas-section-types")).toBeInTheDocument();
    expect(screen.getByText("SELL")).toBeInTheDocument();
    expect(screen.getByText("STOCK")).toBeInTheDocument();
    expect(screen.getByText("TYPES")).toBeInTheDocument();
  });

  it("renders the staged cards (rejected dropped by the selector)", () => {
    render(<CanvasPane byModule={byModule} totals={totals} inventoryTracked />);
    // 10 preview cards, none rejected → 10 cards render.
    expect(screen.getAllByTestId("staging-card")).toHaveLength(
      PREVIEW_STAGING_CARDS.length,
    );
    expect(screen.getByText("Full vehicle wrap — cast vinyl")).toBeInTheDocument();
  });

  it("OMITS the STOCK section entirely when inventory is not tracked", () => {
    render(
      <CanvasPane byModule={byModule} totals={totals} inventoryTracked={false} />,
    );
    expect(screen.queryByTestId("canvas-section-stock")).toBeNull();
    expect(screen.getByTestId("canvas-section-sell")).toBeInTheDocument();
    expect(screen.getByTestId("canvas-section-types")).toBeInTheDocument();
  });

  it("computes the duplicate diff from the matched existing row", () => {
    render(
      <CanvasPane
        byModule={byModule}
        totals={totals}
        inventoryTracked
        existingRows={PREVIEW_EXISTING_ROWS}
      />,
    );
    // windowPerfDuplicate: on-file price $12 → incoming $14 (struck → olive).
    const news = screen.getAllByTestId("diff-new");
    expect(news.some((n) => n.textContent === "$14")).toBe(true);
    const olds = screen.getAllByTestId("diff-old");
    expect(olds.some((o) => o.textContent === "$12")).toBe(true);
  });

  it("shows the per-section empty treatment when a section has no cards", () => {
    render(
      <CanvasPane
        byModule={{ sell: [], stock: [], types: [] }}
        totals={{ proposed: 0, added: 0, rejected: 0 }}
        inventoryTracked
      />,
    );
    expect(screen.getByTestId("section-empty-sell")).toBeInTheDocument();
    expect(screen.getByTestId("section-empty-stock")).toBeInTheDocument();
    expect(screen.getByTestId("section-empty-types")).toBeInTheDocument();
  });
});
