/**
 * Unit tests for MrrTrendChart.
 *
 * Recharts components don't render meaningfully in jsdom (they need layout
 * via ResponsiveContainer's parent measurement), so we mock them out and
 * assert against the test-id surface. Coverage:
 *
 *   1. Renders the loading skeleton before fetch resolves.
 *   2. Renders the chart with correct row count after fetch succeeds.
 *   3. Renders the explicit error state when fetch fails.
 *   4. Includes the $15K target ReferenceLine.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="rc-container">{children}</div>
  ),
  LineChart: ({
    children,
    data,
  }: {
    children: React.ReactNode;
    data?: unknown[];
  }) => (
    <div data-testid="rc-linechart" data-rows={data?.length ?? 0}>
      {children}
    </div>
  ),
  Line: () => <div data-testid="rc-line" />,
  CartesianGrid: () => <div />,
  XAxis: () => <div />,
  YAxis: () => <div />,
  Tooltip: () => <div />,
  ReferenceLine: () => <div data-testid="rc-refline" />,
}));

import { MrrTrendChart } from "@/components/pmf/mrr-trend-chart";

const ROWS = [
  { week: "2026-01", mrr_cents: 0 },
  { week: "2026-02", mrr_cents: 12500 },
  { week: "2026-03", mrr_cents: 47000 },
];

describe("MrrTrendChart", () => {
  beforeEach(() => {
    // Default to a never-resolving fetch so loading tests can observe the
    // skeleton; individual tests override this.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})) as unknown as typeof fetch,
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the loading skeleton initially (before fetch resolves)", () => {
    const { container } = render(<MrrTrendChart />);
    expect(screen.getByText("BASE SAAS · MRR TREND")).toBeInTheDocument();
    // Skeleton uses animate-pulse and has no chart container yet.
    expect(container.querySelector(".animate-pulse")).not.toBeNull();
    expect(screen.queryByTestId("rc-linechart")).toBeNull();
  });

  it("renders chart with correct row count after fetch succeeds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ data: ROWS }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ) as unknown as typeof fetch,
    );

    render(<MrrTrendChart />);
    const chart = await screen.findByTestId("rc-linechart");
    expect(chart.getAttribute("data-rows")).toBe(String(ROWS.length));
    expect(screen.getByTestId("rc-container")).toBeInTheDocument();
    expect(screen.getByTestId("rc-line")).toBeInTheDocument();
  });

  it("renders the error state when the fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "boom" }), {
            status: 500,
            headers: { "content-type": "application/json" },
          }),
      ) as unknown as typeof fetch,
    );

    render(<MrrTrendChart />);
    await waitFor(() => {
      expect(screen.getByText(/ERROR — FAILED TO LOAD/)).toBeInTheDocument();
    });
    expect(screen.getByText(/fetch failed: 500/)).toBeInTheDocument();
    expect(screen.queryByTestId("rc-linechart")).toBeNull();
  });

  it("includes the $15K target ReferenceLine after data loads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ data: ROWS }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ) as unknown as typeof fetch,
    );

    render(<MrrTrendChart />);
    expect(await screen.findByTestId("rc-refline")).toBeInTheDocument();
  });
});
