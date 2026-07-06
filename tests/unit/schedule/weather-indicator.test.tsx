/**
 * Component-render proof for the schedule weather warning (bug 9dc7c38d).
 *
 * Renders the REAL month event bar through the REAL provider + context + hook +
 * indicator, and asserts the tan warning glyph appears exactly when it should:
 * only for a weather-dependent event whose covered day has an adverse forecast.
 * Clear days, material runs, and personal events show nothing.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { toLocalISODate, type ForecastLike } from "@/lib/utils/weather-risk";
import {
  colorTripleFromHex,
  getStatusColors,
  type InternalScheduleEvent,
} from "@/lib/utils/schedule-utils";
import type { ScheduleWeatherLookup } from "@/lib/hooks/use-schedule-weather";

// Deterministic, readable weather copy so aria-label assertions are meaningful.
vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "weather.ariaPrefix": "Weather risk",
        "weather.label.rain": "Rain likely",
        "weather.label.snow": "Snow likely",
        "weather.label.storm": "Thunderstorms likely",
        "weather.label.wind": "High winds",
      };
      return map[key] ?? key;
    },
    dict: {},
  }),
}));

const { MonthEventBar } = await import(
  "@/app/(dashboard)/schedule/_components/month/month-event-bar"
);
const { ScheduleWeatherProvider } = await import(
  "@/app/(dashboard)/schedule/_components/weather/schedule-weather-context"
);

// A date two days out is always inside the 6-day forecast window.
const inTwoDays = new Date();
inTwoDays.setDate(inTwoDays.getDate() + 2);
const inTwoDaysISO = toLocalISODate(inTwoDays);

function makeEvent(overrides: Partial<InternalScheduleEvent> = {}): InternalScheduleEvent {
  return {
    id: "evt-1",
    title: "Vinyl Install",
    startDate: inTwoDays,
    endDate: inTwoDays,
    color: "#B58289",
    taskType: "installation",
    status: "active",
    teamMemberIds: [],
    projectId: "proj-1",
    projectTitle: "Deck Rebuild",
    taskTitle: "Vinyl Install",
    typeLabel: "Vinyl Install",
    typeColors: colorTripleFromHex("#B58289"),
    statusColors: getStatusColors("scheduled"),
    statusKey: "scheduled",
    crewIds: [],
    address: null,
    clientName: null,
    startTime: null,
    endTime: null,
    allDay: true,
    kind: "task",
    ...overrides,
  };
}

const SINGLE_DAY_SPAN = {
  startDayIndex: 0,
  endDayIndex: 0,
  isFirstSegment: true,
  isLastSegment: true,
  isSingleDay: true,
};

function lookupWith(forecast: ForecastLike | null): ScheduleWeatherLookup {
  return {
    get: (projectId, date) =>
      projectId === "proj-1" && date === inTwoDaysISO ? forecast : null,
    isFetching: false,
  };
}

const RAIN: ForecastLike = {
  forecastDate: inTwoDaysISO,
  precipitationProbability: 75,
  precipitationMm: 6,
  windSpeedKmh: 12,
  conditions: "Slight rain",
};

const CLEAR: ForecastLike = {
  forecastDate: inTwoDaysISO,
  precipitationProbability: 5,
  precipitationMm: 0,
  windSpeedKmh: 8,
  conditions: "Clear",
};

function renderBar(event: InternalScheduleEvent, lookup: ScheduleWeatherLookup) {
  return render(
    <ScheduleWeatherProvider value={lookup}>
      <MonthEventBar event={event} displayLevel="standard" span={SINGLE_DAY_SPAN} />
    </ScheduleWeatherProvider>
  );
}

describe("<MonthEventBar> weather warning", () => {
  it("shows the tan glyph for a weather-dependent event on an adverse day", () => {
    renderBar(makeEvent(), lookupWith(RAIN));
    const glyph = screen.getByRole("img");
    expect(glyph.getAttribute("aria-label")).toContain("Rain likely");
    expect(glyph.getAttribute("aria-label")).toContain("75%");
  });

  it("shows nothing on a clear day", () => {
    renderBar(makeEvent(), lookupWith(CLEAR));
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("shows nothing when no forecast is available for the day", () => {
    renderBar(makeEvent(), lookupWith(null));
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("shows nothing for a material run even on an adverse day", () => {
    renderBar(
      makeEvent({ taskType: "material", typeLabel: "Material Pickup", taskTitle: "Material Pickup" }),
      lookupWith(RAIN)
    );
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("shows nothing for a personal event even on an adverse day", () => {
    renderBar(makeEvent({ kind: "personal", projectId: undefined }), lookupWith(RAIN));
    expect(screen.queryByRole("img")).toBeNull();
  });
});
