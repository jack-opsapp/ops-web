/**
 * useWeather — workspace WEATHER card.
 *
 * Calls the project's weather route handler (which owns the 12h cache logic
 * and the service-role write into weather_forecasts) and returns the parsed
 * WeatherSummary. The hook itself contains no Open-Meteo or cache logic.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

let lastFetchUrl: string | null = null;
let fetchResponse: { ok: boolean; status?: number; body: unknown } | null = null;

const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  if (typeof input === "string") {
    lastFetchUrl = input;
  } else if (input instanceof URL) {
    lastFetchUrl = input.toString();
  } else if (input instanceof Request) {
    lastFetchUrl = input.url;
  }
  if (!fetchResponse) {
    return new Response("{}", { status: 200 });
  }
  return new Response(JSON.stringify(fetchResponse.body), {
    status: fetchResponse.status ?? (fetchResponse.ok ? 200 : 500),
  });
});

vi.stubGlobal("fetch", fetchMock);

import { useWeather } from "@/lib/hooks/use-weather";

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => {
  lastFetchUrl = null;
  fetchResponse = null;
  fetchMock.mockClear();
});

describe("useWeather", () => {
  it("calls /api/projects/:id/weather and returns the parsed summary", async () => {
    fetchResponse = {
      ok: true,
      body: {
        current: {
          id: "wf-1",
          projectId: "proj-1",
          companyId: "co-1",
          forecastDate: "2026-05-07",
          tempHighC: 18,
          tempLowC: 9,
          tempCurrentC: 14.2,
          precipitationMm: 0.4,
          precipitationProbability: 22,
          windSpeedKmh: 12.3,
          conditions: "Partly cloudy",
          retrievedAt: "2026-05-07T08:00:00Z",
          source: "open-meteo",
        },
        forecast: [
          {
            id: "wf-1",
            projectId: "proj-1",
            companyId: "co-1",
            forecastDate: "2026-05-07",
            tempHighC: 18,
            tempLowC: 9,
            tempCurrentC: null,
            precipitationMm: 0.4,
            precipitationProbability: 22,
            windSpeedKmh: null,
            conditions: "Partly cloudy",
            retrievedAt: "2026-05-07T08:00:00Z",
            source: "open-meteo",
          },
        ],
        attribution: "Weather data by Open-Meteo.com",
      },
    };

    const { result } = renderHook(() => useWeather("proj-1"), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(lastFetchUrl).toMatch(/\/api\/projects\/proj-1\/weather$/);
    expect(result.current.data!.current!.tempCurrentC).toBe(14.2);
    expect(result.current.data!.forecast).toHaveLength(1);
    expect(result.current.data!.attribution).toBe("Weather data by Open-Meteo.com");
  });

  it("propagates non-OK responses as errors", async () => {
    fetchResponse = { ok: false, status: 502, body: { error: "Open-Meteo timeout" } };

    const { result } = renderHook(() => useWeather("proj-1"), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("does not fetch when projectId is null", async () => {
    const { result } = renderHook(() => useWeather(null), {
      wrapper: makeWrapper(),
    });
    expect(result.current.isFetching).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
