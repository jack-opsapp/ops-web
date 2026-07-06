/**
 * Unit tests for weather-risk — the pure classifier behind the schedule's
 * adverse-weather warnings (bug 9dc7c38d).
 *
 * Covers the two independent questions (is the event weather-dependent? is the
 * forecast adverse?), the covered-date window math, and the end-to-end
 * orchestrator that the schedule hook calls.
 */

import { describe, it, expect } from "vitest";
import {
  isWeatherDependentEvent,
  classifyForecast,
  coveredForecastDates,
  weatherRiskForEvent,
  toLocalISODate,
  PRECIP_PROBABILITY_THRESHOLD,
  HIGH_WIND_KMH,
  HEAVY_PRECIP_MM,
  type ForecastLike,
  type WeatherClassifiableEvent,
} from "@/lib/utils/weather-risk";

function evt(overrides: Partial<WeatherClassifiableEvent> = {}): WeatherClassifiableEvent {
  return {
    kind: "task",
    taskType: "installation",
    typeLabel: "Vinyl Install",
    taskTitle: "Vinyl Install",
    ...overrides,
  };
}

function fc(overrides: Partial<ForecastLike> = {}): ForecastLike {
  return {
    forecastDate: "2026-07-06",
    precipitationProbability: 0,
    precipitationMm: 0,
    windSpeedKmh: 5,
    conditions: "Clear",
    ...overrides,
  };
}

describe("isWeatherDependentEvent", () => {
  it("treats outdoor task types as weather-dependent (default outdoor)", () => {
    expect(isWeatherDependentEvent(evt({ typeLabel: "Vinyl Install" }))).toBe(true);
    expect(isWeatherDependentEvent(evt({ typeLabel: "Rail Install" }))).toBe(true);
    expect(isWeatherDependentEvent(evt({ typeLabel: "Renovation", taskType: "task" }))).toBe(true);
    expect(isWeatherDependentEvent(evt({ typeLabel: "Resheet & Rail", taskType: "task" }))).toBe(true);
    expect(isWeatherDependentEvent(evt({ typeLabel: "Inspection", taskType: "inspection" }))).toBe(true);
    expect(isWeatherDependentEvent(evt({ typeLabel: "On-site Estimate", taskType: "estimate" }))).toBe(true);
  });

  it("excludes indoor / logistics types", () => {
    expect(isWeatherDependentEvent(evt({ typeLabel: "Material Pickup", taskType: "material" }))).toBe(false);
    expect(isWeatherDependentEvent(evt({ typeLabel: "Delivery", taskType: "material" }))).toBe(false);
    expect(isWeatherDependentEvent(evt({ typeLabel: "Office Admin", taskType: "task" }))).toBe(false);
    expect(isWeatherDependentEvent(evt({ typeLabel: "Phone Call", taskType: "task" }))).toBe(false);
    expect(isWeatherDependentEvent(evt({ typeLabel: "Shop Drawings", taskType: "task" }))).toBe(false);
  });

  it("does not let 'install' trip the 'call' exclusion", () => {
    expect(isWeatherDependentEvent(evt({ typeLabel: "Install", taskType: "installation", taskTitle: "Install" }))).toBe(true);
  });

  it("excludes non-task kinds", () => {
    expect(isWeatherDependentEvent(evt({ kind: "personal" }))).toBe(false);
    expect(isWeatherDependentEvent(evt({ kind: "time_off" }))).toBe(false);
  });
});

describe("classifyForecast", () => {
  it("returns null on a clear, calm day", () => {
    expect(classifyForecast(fc())).toBeNull();
  });

  it("flags rain by probability threshold", () => {
    const r = classifyForecast(fc({ precipitationProbability: PRECIP_PROBABILITY_THRESHOLD, conditions: "Overcast" }));
    expect(r?.kind).toBe("rain");
  });

  it("does not flag just below the probability threshold", () => {
    expect(classifyForecast(fc({ precipitationProbability: PRECIP_PROBABILITY_THRESHOLD - 1, conditions: "Overcast" }))).toBeNull();
  });

  it("flags rain by heavy precipitation mm even with a low probability field", () => {
    const r = classifyForecast(fc({ precipitationProbability: 10, precipitationMm: HEAVY_PRECIP_MM, conditions: "Overcast" }));
    expect(r?.kind).toBe("rain");
  });

  it("flags snow off the WMO label", () => {
    const r = classifyForecast(fc({ conditions: "Heavy snow", precipitationProbability: 40 }));
    expect(r?.kind).toBe("snow");
  });

  it("flags thunderstorm off the WMO label (storm beats rain)", () => {
    const r = classifyForecast(fc({ conditions: "Thunderstorm", precipitationProbability: 80 }));
    expect(r?.kind).toBe("storm");
  });

  it("flags wind-only days as wind", () => {
    const r = classifyForecast(fc({ conditions: "Partly cloudy", windSpeedKmh: HIGH_WIND_KMH, precipitationProbability: 5 }));
    expect(r?.kind).toBe("wind");
  });

  it("prefers rain over wind when both trip", () => {
    const r = classifyForecast(fc({ conditions: "Slight rain", windSpeedKmh: 50, precipitationProbability: 80 }));
    expect(r?.kind).toBe("rain");
  });

  it("treats freezing rain / drizzle / showers as rain", () => {
    expect(classifyForecast(fc({ conditions: "Light freezing rain", precipitationProbability: 20 }))?.kind).toBe("rain");
    expect(classifyForecast(fc({ conditions: "Dense drizzle", precipitationProbability: 20 }))?.kind).toBe("rain");
    expect(classifyForecast(fc({ conditions: "Rain showers", precipitationProbability: 20 }))?.kind).toBe("rain");
  });

  it("tolerates null fields", () => {
    expect(
      classifyForecast({
        forecastDate: "2026-07-06",
        precipitationProbability: null,
        precipitationMm: null,
        windSpeedKmh: null,
        conditions: null,
      })
    ).toBeNull();
  });
});

describe("coveredForecastDates", () => {
  const now = new Date(2026, 6, 6, 9, 0, 0); // Mon Jul 6 2026, 09:00 local

  it("returns the single day for a same-day event in-window", () => {
    const d = new Date(2026, 6, 8, 8, 0, 0);
    expect(coveredForecastDates(d, d, now)).toEqual(["2026-07-08"]);
  });

  it("clamps a multi-day event to the forecast horizon", () => {
    const start = new Date(2026, 6, 6);
    const end = new Date(2026, 6, 20); // far past the 6-day horizon
    const dates = coveredForecastDates(start, end, now);
    expect(dates[0]).toBe("2026-07-06");
    expect(dates.at(-1)).toBe("2026-07-11"); // today + 5
    expect(dates).toHaveLength(6);
  });

  it("drops past days, keeping only today onward", () => {
    const start = new Date(2026, 6, 3); // 3 days ago
    const end = new Date(2026, 6, 7); // tomorrow
    expect(coveredForecastDates(start, end, now)).toEqual(["2026-07-06", "2026-07-07"]);
  });

  it("returns empty for a fully-past event", () => {
    const start = new Date(2026, 6, 1);
    const end = new Date(2026, 6, 3);
    expect(coveredForecastDates(start, end, now)).toEqual([]);
  });

  it("returns empty for an event entirely beyond the horizon", () => {
    const start = new Date(2026, 6, 20);
    const end = new Date(2026, 6, 25);
    expect(coveredForecastDates(start, end, now)).toEqual([]);
  });
});

describe("toLocalISODate", () => {
  it("formats a local date without UTC drift", () => {
    expect(toLocalISODate(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(toLocalISODate(new Date(2026, 11, 31))).toBe("2026-12-31");
  });
});

describe("weatherRiskForEvent", () => {
  const now = new Date(2026, 6, 6, 9, 0, 0);

  const baseEvent = {
    kind: "task" as const,
    taskType: "installation",
    typeLabel: "Vinyl Install",
    taskTitle: "Vinyl Install",
    projectId: "proj-1",
    startDate: new Date(2026, 6, 8, 8, 0, 0),
    endDate: new Date(2026, 6, 8, 17, 0, 0),
  };

  it("returns null when the event has no project", () => {
    const risk = weatherRiskForEvent({ ...baseEvent, projectId: undefined }, () => fc({ conditions: "Heavy rain", precipitationProbability: 90 }), now);
    expect(risk).toBeNull();
  });

  it("returns null for a weather-independent event even in a storm", () => {
    const risk = weatherRiskForEvent(
      { ...baseEvent, taskType: "material", typeLabel: "Material Pickup", taskTitle: "Material Pickup" },
      () => fc({ conditions: "Thunderstorm", precipitationProbability: 90 }),
      now
    );
    expect(risk).toBeNull();
  });

  it("returns null when the forecast for the covered day is fine", () => {
    const risk = weatherRiskForEvent(baseEvent, () => fc(), now);
    expect(risk).toBeNull();
  });

  it("surfaces the risk when the covered day is adverse", () => {
    const risk = weatherRiskForEvent(
      baseEvent,
      (_pid, date) => (date === "2026-07-08" ? fc({ forecastDate: date, conditions: "Slight rain", precipitationProbability: 75 }) : null),
      now
    );
    expect(risk?.kind).toBe("rain");
    expect(risk?.forecastDate).toBe("2026-07-08");
    expect(risk?.precipitationProbability).toBe(75);
  });

  it("returns the EARLIEST adverse day for a multi-day event", () => {
    const multiDay = {
      ...baseEvent,
      startDate: new Date(2026, 6, 6),
      endDate: new Date(2026, 6, 9),
    };
    const risk = weatherRiskForEvent(
      multiDay,
      (_pid, date) => {
        // Jul 7 = snow, Jul 8 = storm. Earliest adverse (Jul 7) should win.
        if (date === "2026-07-07") return fc({ forecastDate: date, conditions: "Moderate snow", precipitationProbability: 70 });
        if (date === "2026-07-08") return fc({ forecastDate: date, conditions: "Thunderstorm", precipitationProbability: 90 });
        return fc({ forecastDate: date });
      },
      now
    );
    expect(risk?.forecastDate).toBe("2026-07-07");
    expect(risk?.kind).toBe("snow");
  });
});
