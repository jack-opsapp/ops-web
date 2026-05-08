/**
 * Open-Meteo service: response mapping, cache freshness, request shape.
 */

import { describe, it, expect, vi } from "vitest";
import {
  fetchOpenMeteo,
  mapOpenMeteoResponse,
  isCacheStale,
  WMO_CODES,
  OPEN_METEO_ATTRIBUTION,
  type OpenMeteoResponse,
} from "@/lib/api/services/weather-service";

describe("WMO_CODES", () => {
  it("covers the canonical conditions used by the workspace", () => {
    expect(WMO_CODES[0]).toBe("Clear");
    expect(WMO_CODES[2]).toBe("Partly cloudy");
    expect(WMO_CODES[63]).toBe("Moderate rain");
    expect(WMO_CODES[95]).toBe("Thunderstorm");
  });
});

describe("fetchOpenMeteo", () => {
  it("hits the Open-Meteo forecast endpoint with the right query string", async () => {
    const emptyResponse: OpenMeteoResponse = {
      daily: {
        time: [],
        temperature_2m_max: [],
        temperature_2m_min: [],
        precipitation_probability_max: [],
        precipitation_sum: [],
        weather_code: [],
      },
    };
    const calls: Array<string> = [];
    const fetchSpy = vi.fn(async (url: string | URL) => {
      calls.push(typeof url === "string" ? url : url.toString());
      return new Response(JSON.stringify(emptyResponse), { status: 200 });
    });

    await fetchOpenMeteo(49.7016, -123.1558, fetchSpy as unknown as typeof fetch);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const url = calls[0];
    expect(url).toContain("latitude=49.7016");
    expect(url).toContain("longitude=-123.1558");
    expect(url).toContain("forecast_days=6");
    expect(url).toContain("timezone=auto");
    expect(url).toContain("current=temperature_2m");
    expect(url).toContain("daily=temperature_2m_max");
  });

  it("throws when the response is not OK", async () => {
    const fetchSpy = vi.fn(async () => new Response("no", { status: 503 }));
    await expect(
      fetchOpenMeteo(0, 0, fetchSpy as unknown as typeof fetch)
    ).rejects.toThrow("Open-Meteo");
  });
});

describe("mapOpenMeteoResponse", () => {
  it("maps current + daily into WeatherSummary with correct conditions", () => {
    const data: OpenMeteoResponse = {
      current: {
        time: "2026-05-07T12:00",
        temperature_2m: 14.2,
        weather_code: 2,
        wind_speed_10m: 12.3,
        precipitation_probability: 22,
      },
      daily: {
        time: ["2026-05-07", "2026-05-08", "2026-05-09"],
        temperature_2m_max: [18, 20, 16],
        temperature_2m_min: [9, 10, 7],
        precipitation_probability_max: [22, 5, 80],
        precipitation_sum: [0.4, 0, 8.5],
        weather_code: [2, 0, 63],
      },
    };

    const summary = mapOpenMeteoResponse(data, "proj-1", "co-1", "2026-05-07T12:00:00Z");

    expect(summary.attribution).toBe(OPEN_METEO_ATTRIBUTION);
    expect(summary.current).not.toBeNull();
    expect(summary.current!.tempCurrentC).toBe(14.2);
    expect(summary.current!.conditions).toBe("Partly cloudy");
    expect(summary.current!.windSpeedKmh).toBe(12.3);
    expect(summary.current!.precipitationProbability).toBe(22);
    // Today's forecast supplies high/low for the current cell
    expect(summary.current!.tempHighC).toBe(18);
    expect(summary.current!.tempLowC).toBe(9);

    expect(summary.forecast).toHaveLength(3);
    expect(summary.forecast[2].conditions).toBe("Moderate rain");
    expect(summary.forecast[2].precipitationProbability).toBe(80);
    expect(summary.forecast[2].precipitationMm).toBe(8.5);
  });

  it("returns current=null when the response has no current block", () => {
    const data: OpenMeteoResponse = {
      daily: {
        time: ["2026-05-07"],
        temperature_2m_max: [18],
        temperature_2m_min: [9],
        precipitation_probability_max: [10],
        precipitation_sum: [0],
        weather_code: [0],
      },
    };
    const summary = mapOpenMeteoResponse(data, "proj-1", "co-1");
    expect(summary.current).toBeNull();
    expect(summary.forecast).toHaveLength(1);
  });

  it("falls back to null when WMO code is unknown", () => {
    const data: OpenMeteoResponse = {
      daily: {
        time: ["2026-05-07"],
        temperature_2m_max: [18],
        temperature_2m_min: [9],
        precipitation_probability_max: [10],
        precipitation_sum: [0],
        weather_code: [9999], // not a real WMO code
      },
    };
    const summary = mapOpenMeteoResponse(data, "proj-1", "co-1");
    expect(summary.forecast[0].conditions).toBeNull();
  });
});

describe("isCacheStale", () => {
  const NOW = new Date("2026-05-07T12:00:00Z");

  it("treats null/undefined as stale", () => {
    expect(isCacheStale(null, NOW)).toBe(true);
    expect(isCacheStale(undefined, NOW)).toBe(true);
  });

  it("treats invalid dates as stale", () => {
    expect(isCacheStale("not-a-date", NOW)).toBe(true);
  });

  it("returns false within the 12h window", () => {
    expect(isCacheStale("2026-05-07T08:00:00Z", NOW)).toBe(false); // 4h ago
    expect(isCacheStale("2026-05-07T00:30:00Z", NOW)).toBe(false); // 11.5h ago
  });

  it("returns true past the 12h window", () => {
    expect(isCacheStale("2026-05-06T23:00:00Z", NOW)).toBe(true); // 13h ago
  });
});
