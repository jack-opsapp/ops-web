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
  it("renders the CLIENTS copy on the client-facing rail", () => {
    render(<RailEmptyState rail="CLIENTS" />);
    expect(screen.getByText("// NO CLIENT THREADS")).toBeInTheDocument();
    expect(
      screen.getByText("[—] no client mail in this view"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("rail-empty-state")).toHaveAttribute(
      "data-rail",
      "CLIENTS",
    );
  });

  it("renders the EVERYTHING ELSE copy on the operational rail", () => {
    render(<RailEmptyState rail="EVERYTHING_ELSE" />);
    expect(screen.getByText("// NO OPS MAIL")).toBeInTheDocument();
    expect(
      screen.getByText("[—] no operational mail in this view"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("rail-empty-state")).toHaveAttribute(
      "data-rail",
      "EVERYTHING_ELSE",
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

  // ─── Search-miss variant ──────────────────────────────────────────────────
  // When the operator has typed into the inbox header search input and the
  // current rail returns zero matches, the empty state must NOT show the
  // rail's empty-audience copy. It must show // NO MATCHES with the query
  // echoed.

  it("renders the NO MATCHES variant on CLIENTS when searchActive and the query echoed", () => {
    render(
      <RailEmptyState rail="CLIENTS" searchActive searchQuery="acme" />,
    );
    expect(screen.getByText("// NO MATCHES")).toBeInTheDocument();
    expect(screen.getByText('[—] nothing matches "acme"')).toBeInTheDocument();
    expect(screen.queryByText("// NO CLIENT THREADS")).not.toBeInTheDocument();
    const node = screen.getByTestId("rail-empty-state");
    expect(node).toHaveAttribute("data-rail", "CLIENTS");
    expect(node).toHaveAttribute("data-search-active", "true");
  });

  it("renders the NO MATCHES variant on EVERYTHING ELSE when searchActive", () => {
    render(
      <RailEmptyState
        rail="EVERYTHING_ELSE"
        searchActive
        searchQuery="invoice"
      />,
    );
    expect(screen.getByText("// NO MATCHES")).toBeInTheDocument();
    expect(
      screen.getByText('[—] nothing matches "invoice"'),
    ).toBeInTheDocument();
    expect(screen.queryByText("// NO OPS MAIL")).not.toBeInTheDocument();
  });

  it("renders the NO MATCHES variant on ARCHIVED when searchActive", () => {
    render(<RailEmptyState rail="ARCHIVED" searchActive searchQuery="acme" />);
    expect(screen.getByText("// NO MATCHES")).toBeInTheDocument();
    expect(screen.queryByText("// EMPTY")).not.toBeInTheDocument();
  });

  it("renders the NO MATCHES variant on ALL when searchActive", () => {
    render(<RailEmptyState rail="ALL" searchActive searchQuery="quote" />);
    expect(screen.getByText("// NO MATCHES")).toBeInTheDocument();
    expect(screen.getByText('[—] nothing matches "quote"')).toBeInTheDocument();
    expect(screen.queryByText("// NO THREADS")).not.toBeInTheDocument();
  });

  it("falls back to the rail's caught-up copy when searchActive is false even if a query was passed", () => {
    render(
      <RailEmptyState
        rail="CLIENTS"
        searchActive={false}
        searchQuery="acme"
      />,
    );
    expect(screen.getByText("// NO CLIENT THREADS")).toBeInTheDocument();
    expect(screen.queryByText("// NO MATCHES")).not.toBeInTheDocument();
  });
});
