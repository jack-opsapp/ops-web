import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RailEmptyState } from "../rail-empty-state";

// Passthrough `t` — every assertion targets the fallback string the component
// hands to the dictionary. Matches the convention used across inbox tests
// (see today-bar.test.tsx, inbox-route-navigation.test.tsx).
vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
    dict: {},
  }),
  useLocale: () => ({ locale: "en", setLocale: vi.fn() }),
}));

describe("<RailEmptyState>", () => {
  it("renders the YOUR MOVE celebratory copy on the inbox-zero rail", () => {
    render(<RailEmptyState rail="YOUR_MOVE" />);
    expect(screen.getByText("// CAUGHT UP")).toBeInTheDocument();
    expect(screen.getByText("[—] nothing waiting on you")).toBeInTheDocument();
    expect(screen.getByTestId("rail-empty-state")).toHaveAttribute(
      "data-rail",
      "YOUR_MOVE",
    );
  });

  it("renders the WAITING stillness copy when the operator owes nothing back", () => {
    render(<RailEmptyState rail="WAITING" />);
    expect(screen.getByText("// QUIET")).toBeInTheDocument();
    expect(screen.getByText("[—] no replies owed")).toBeInTheDocument();
    expect(screen.getByTestId("rail-empty-state")).toHaveAttribute(
      "data-rail",
      "WAITING",
    );
  });

  it("renders the ARCHIVED neutral copy on a never-filed inbox", () => {
    render(<RailEmptyState rail="ARCHIVED" />);
    expect(screen.getByText("// EMPTY")).toBeInTheDocument();
    expect(screen.getByText("[—] nothing archived yet")).toBeInTheDocument();
    expect(screen.getByTestId("rail-empty-state")).toHaveAttribute(
      "data-rail",
      "ARCHIVED",
    );
  });

  it("renders the ALL degenerate fallback when an operator has zero threads ever", () => {
    render(<RailEmptyState rail="ALL" />);
    expect(screen.getByText("// NO THREADS")).toBeInTheDocument();
    expect(screen.getByText("[—] inbox is empty")).toBeInTheDocument();
    expect(screen.getByTestId("rail-empty-state")).toHaveAttribute(
      "data-rail",
      "ALL",
    );
  });

  it("degrades a stray SNOOZED filter to ALL — SNOOZED is not a rail tab", () => {
    render(<RailEmptyState rail="SNOOZED" />);
    expect(screen.getByText("// NO THREADS")).toBeInTheDocument();
    expect(screen.getByTestId("rail-empty-state")).toHaveAttribute(
      "data-rail",
      "ALL",
    );
  });
});
