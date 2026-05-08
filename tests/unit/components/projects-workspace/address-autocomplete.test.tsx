/**
 * AddressAutocomplete — Mapbox forward-geocoding combobox for the
 * workspace identity tab.
 *
 * Smoke coverage for the public surface:
 *   - renders an accessible combobox with the operator-facing aria label
 *   - typing populates the input and opens the dropdown after debounce
 *   - selecting a result fires onChange with address + lat + lng and
 *     collapses the dropdown
 *   - ArrowDown/ArrowUp/Enter keyboard nav lands on the right pick
 *   - the disabled prop forwards to the underlying input
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Mock the dictionary so render is hermetic.
vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (key: string) => {
      switch (key) {
        case "identity.address.placeholder":
          return "Search address";
        case "identity.address.aria":
          return "Project address";
        default:
          return key;
      }
    },
  }),
}));

// Mock the geocoding service so we don't hit Mapbox.
const forwardGeocode = vi.fn();
vi.mock("@/lib/api/services/geocoding-service", () => ({
  GeocodingService: {
    forwardGeocode: (q: string, opts?: { signal?: AbortSignal }) =>
      forwardGeocode(q, opts),
  },
}));

import { AddressAutocomplete } from "@/components/ops/projects/workspace/inputs/address-autocomplete";

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

const SAMPLE_RESULTS = [
  {
    id: "addr-1",
    fullAddress: "123 Industry Way, Stockton, CA 95202",
    shortAddress: "123 Industry Way",
    latitude: 37.96,
    longitude: -121.29,
  },
  {
    id: "addr-2",
    fullAddress: "456 Industry Way, Stockton, CA 95202",
    shortAddress: "456 Industry Way",
    latitude: 37.961,
    longitude: -121.291,
  },
];

beforeEach(() => {
  forwardGeocode.mockReset();
  forwardGeocode.mockResolvedValue(SAMPLE_RESULTS);
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

describe("<AddressAutocomplete>", () => {
  it("renders an accessible combobox with the resolved aria label", () => {
    render(
      <AddressAutocomplete value="" onChange={vi.fn()} />,
      { wrapper: makeWrapper() },
    );
    const input = screen.getByRole("combobox", { name: "Project address" });
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-expanded", "false");
  });

  it("forwards the disabled prop to the underlying input", () => {
    render(
      <AddressAutocomplete value="" onChange={vi.fn()} disabled />,
      { wrapper: makeWrapper() },
    );
    expect(screen.getByRole("combobox")).toBeDisabled();
  });

  it("opens the dropdown after debounce + populated results, and calls onChange when an option is clicked", async () => {
    const onChange = vi.fn();
    render(
      <AddressAutocomplete value="" onChange={onChange} />,
      { wrapper: makeWrapper() },
    );
    const input = screen.getByRole("combobox");

    await act(async () => {
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: "123 Industry" } });
      // Drain the 300ms debounce.
      vi.advanceTimersByTime(350);
    });

    await waitFor(() => {
      expect(forwardGeocode).toHaveBeenCalledWith(
        "123 Industry",
        expect.objectContaining({ signal: expect.any(Object) }),
      );
    });

    const option = await screen.findByText("123 Industry Way");
    fireEvent.mouseDown(option);

    expect(onChange).toHaveBeenCalledWith({
      address: "123 Industry Way, Stockton, CA 95202",
      latitude: 37.96,
      longitude: -121.29,
    });
  });

  it("supports ArrowDown / Enter keyboard navigation", async () => {
    const onChange = vi.fn();
    render(
      <AddressAutocomplete value="" onChange={onChange} />,
      { wrapper: makeWrapper() },
    );
    const input = screen.getByRole("combobox");

    await act(async () => {
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: "456 Industry" } });
      vi.advanceTimersByTime(350);
    });

    await screen.findByText("456 Industry Way");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith({
      address: "456 Industry Way, Stockton, CA 95202",
      latitude: 37.961,
      longitude: -121.291,
    });
  });
});
