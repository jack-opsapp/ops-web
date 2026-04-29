import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SuppressionsTab } from "@/app/admin/email/_components/suppressions-tab";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

beforeEach(() => {
  fetchMock.mockReset();
});

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, networkMode: "always" },
    },
  });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

describe("SuppressionsTab", () => {
  it("renders header + action buttons synchronously", () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ rows: [], total: 0 }),
    });
    render(wrap(<SuppressionsTab />));
    expect(screen.getByText(/SUPPRESSIONS/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /BULK ADD/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /IMPORT CSV/ })).toBeInTheDocument();
  });

  it("calls suppressions API on mount", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ rows: [], total: 0 }),
    });
    render(wrap(<SuppressionsTab />));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const arg = fetchMock.mock.calls[0]?.[0];
    const url =
      typeof arg === "string"
        ? arg
        : arg && typeof (arg as Request).url === "string"
          ? (arg as Request).url
          : String(arg);
    expect(url).toMatch(/\/api\/admin\/email\/suppressions/);
    expect(url).toMatch(/limit=50/);
    expect(url).toMatch(/offset=0/);
  });

  it("renders empty state when API returns no rows", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ rows: [], total: 0 }),
    });
    render(wrap(<SuppressionsTab />));
    await waitFor(() =>
      expect(
        screen.getByText(/no suppressions match the filter/i)
      ).toBeInTheDocument()
    );
  });
});
