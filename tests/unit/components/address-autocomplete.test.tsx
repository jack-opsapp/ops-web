import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";

// ─── Geocoding service mock ────────────────────────────────────────────────
// Mock the service rather than fetch so the test exercises the component +
// debounce + query-cache wiring without depending on Mapbox response shape.
const forwardGeocodeMock = vi.fn();
vi.mock("@/lib/api/services/geocoding-service", () => ({
  GeocodingService: {
    forwardGeocode: (...args: unknown[]) => forwardGeocodeMock(...args),
  },
}));

import { AddressAutocomplete } from "@/components/ops/projects/workspace/inputs/address-autocomplete";

const SAMPLE_RESULTS = [
  {
    id: "f1",
    fullAddress: "1234 Industrial Way, Squamish, BC V8B 0A1, Canada",
    shortAddress: "1234 Industrial Way",
    latitude: 49.7016,
    longitude: -123.1558,
  },
  {
    id: "f2",
    fullAddress: "1234 Industrial Park Drive, Vancouver, BC, Canada",
    shortAddress: "1234 Industrial Park Drive",
    latitude: 49.2827,
    longitude: -123.1207,
  },
];

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("<AddressAutocomplete>", () => {
  beforeEach(() => {
    forwardGeocodeMock.mockReset();
    forwardGeocodeMock.mockResolvedValue(SAMPLE_RESULTS);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not query Mapbox before the 300ms debounce expires", async () => {
    vi.useFakeTimers();
    renderWithClient(<AddressAutocomplete value="" onChange={() => {}} />);
    const input = screen.getByRole("combobox", { name: /address/i });
    // fireEvent.change sets the value synchronously without advancing the
    // fake clock, so we control the exact timing of the debounce window.
    await act(async () => {
      fireEvent.change(input, { target: { value: "1234 industrial" } });
    });
    expect(forwardGeocodeMock).not.toHaveBeenCalled();
    // Advance just shy of 300ms — still no call.
    await act(async () => {
      vi.advanceTimersByTime(290);
    });
    expect(forwardGeocodeMock).not.toHaveBeenCalled();
    // Cross the 300ms threshold — query fires.
    await act(async () => {
      vi.advanceTimersByTime(20);
    });
    // Switch back to real timers so React Query's promise resolution flushes.
    vi.useRealTimers();
    await waitFor(() => expect(forwardGeocodeMock).toHaveBeenCalledTimes(1));
    expect(forwardGeocodeMock.mock.calls[0]?.[0]).toBe("1234 industrial");
  });

  it("renders dropdown of geocoding results after debounce", async () => {
    const user = userEvent.setup();
    renderWithClient(<AddressAutocomplete value="" onChange={() => {}} />);
    const input = screen.getByRole("combobox", { name: /address/i });
    await user.type(input, "1234 industrial");
    await waitFor(() => expect(forwardGeocodeMock).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(await screen.findByText(SAMPLE_RESULTS[0].fullAddress)).toBeInTheDocument();
    expect(screen.getByText(SAMPLE_RESULTS[1].fullAddress)).toBeInTheDocument();
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(2);
  });

  it("selecting a result calls onChange with { address, latitude, longitude }", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderWithClient(<AddressAutocomplete value="" onChange={onChange} />);
    const input = screen.getByRole("combobox", { name: /address/i });
    await user.type(input, "1234 industrial");
    await waitFor(() => expect(forwardGeocodeMock).toHaveBeenCalled(), { timeout: 2000 });
    const firstResult = await screen.findByText(SAMPLE_RESULTS[0].fullAddress);
    await user.click(firstResult);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({
      address: SAMPLE_RESULTS[0].fullAddress,
      latitude: SAMPLE_RESULTS[0].latitude,
      longitude: SAMPLE_RESULTS[0].longitude,
    });
    // Dropdown closes after selection.
    await waitFor(() => expect(screen.queryAllByRole("option")).toHaveLength(0));
  });

  it("does not query for blank or short input (< 3 chars)", async () => {
    const user = userEvent.setup();
    renderWithClient(<AddressAutocomplete value="" onChange={() => {}} />);
    const input = screen.getByRole("combobox", { name: /address/i });
    await user.type(input, "ab");
    // Wait long enough that the debounce would fire if it were going to.
    await new Promise((r) => setTimeout(r, 350));
    expect(forwardGeocodeMock).not.toHaveBeenCalled();
  });

  it("hides dropdown when there are no results", async () => {
    forwardGeocodeMock.mockResolvedValueOnce([]);
    const user = userEvent.setup();
    renderWithClient(<AddressAutocomplete value="" onChange={() => {}} />);
    const input = screen.getByRole("combobox", { name: /address/i });
    await user.type(input, "noresults");
    await waitFor(() => expect(forwardGeocodeMock).toHaveBeenCalled(), { timeout: 2000 });
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("re-uses cached results for the same query (TanStack Query staleTime)", async () => {
    const user = userEvent.setup();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 5 * 60_000 } },
    });
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <AddressAutocomplete value="" onChange={() => {}} />
      </QueryClientProvider>,
    );
    const input = screen.getByRole("combobox", { name: /address/i });
    await user.type(input, "cached query");
    await waitFor(() => expect(forwardGeocodeMock).toHaveBeenCalledTimes(1), { timeout: 2000 });
    // Unmount and remount — same query should hit cache, not re-fetch.
    rerender(<QueryClientProvider client={client}><div /></QueryClientProvider>);
    rerender(
      <QueryClientProvider client={client}>
        <AddressAutocomplete value="" onChange={() => {}} />
      </QueryClientProvider>,
    );
    const input2 = screen.getByRole("combobox", { name: /address/i });
    await user.type(input2, "cached query");
    // Still only one network call — cache served the second.
    await new Promise((r) => setTimeout(r, 400));
    expect(forwardGeocodeMock).toHaveBeenCalledTimes(1);
  });
});
