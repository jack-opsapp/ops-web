import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Reduced motion ON → useCountUp snaps to the target instantly (deterministic).
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

import { RunningTotals } from "../RunningTotals";

describe("<RunningTotals>", () => {
  it("renders without crashing", () => {
    render(<RunningTotals totals={{ proposed: 6, added: 4, rejected: 0 }} />);
    expect(screen.getByTestId("running-totals")).toBeInTheDocument();
  });

  it("shows 'N proposed · M added' with the counts", () => {
    render(<RunningTotals totals={{ proposed: 6, added: 4, rejected: 0 }} />);
    expect(screen.getByTestId("running-totals-proposed")).toHaveTextContent("6");
    expect(screen.getByText("PROPOSED")).toBeInTheDocument();
    expect(screen.getByTestId("running-totals-added")).toHaveTextContent("4");
    expect(screen.getByText("ADDED")).toBeInTheDocument();
  });

  it("paints olive ONLY on the added count", () => {
    render(<RunningTotals totals={{ proposed: 6, added: 4, rejected: 0 }} />);
    expect(screen.getByTestId("running-totals-added")).toHaveClass("text-olive");
    expect(screen.getByTestId("running-totals-proposed")).not.toHaveClass("text-olive");
  });

  it("uses tabular-lining mono numerals", () => {
    render(<RunningTotals totals={{ proposed: 6, added: 4, rejected: 0 }} />);
    const el = screen.getByTestId("running-totals");
    expect(el).toHaveClass("font-mono");
    expect(el).toHaveStyle({ fontFeatureSettings: '"tnum" 1, "zero" 1' });
  });

  it("renders zeroes for an empty canvas", () => {
    render(<RunningTotals totals={{ proposed: 0, added: 0, rejected: 0 }} />);
    expect(screen.getByTestId("running-totals-proposed")).toHaveTextContent("0");
    expect(screen.getByTestId("running-totals-added")).toHaveTextContent("0");
  });
});
