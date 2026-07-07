"use client";

/**
 * Schedule weather context — distributes the batch forecast lookup to the
 * deeply-nested event bars without prop-drilling through every view container.
 *
 * The schedule page fires `useScheduleWeather(events)` once and drops the
 * resulting lookup here; each event bar (month / week / day / crew) calls
 * `useEventWeatherRisk(event)` to resolve its own risk. When the forecast
 * resolves the provider value changes and only the at-risk bars re-render.
 */

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { InternalScheduleEvent } from "@/lib/utils/schedule-utils";
import {
  weatherRiskForEvent,
  type WeatherRisk,
} from "@/lib/utils/weather-risk";
import {
  EMPTY_SCHEDULE_WEATHER_LOOKUP,
  type ScheduleWeatherLookup,
} from "@/lib/hooks/use-schedule-weather";

const ScheduleWeatherContext = createContext<ScheduleWeatherLookup>(
  EMPTY_SCHEDULE_WEATHER_LOOKUP
);

export function ScheduleWeatherProvider({
  value,
  children,
}: {
  value: ScheduleWeatherLookup;
  children: ReactNode;
}) {
  return (
    <ScheduleWeatherContext.Provider value={value}>
      {children}
    </ScheduleWeatherContext.Provider>
  );
}

/**
 * Resolve the most-imminent adverse-weather risk for an event, or null. Null
 * for non-task / weather-independent events, events with no project, and every
 * clear-forecast day — the glyph renders only on a genuine `WeatherRisk`.
 */
export function useEventWeatherRisk(
  event: InternalScheduleEvent
): WeatherRisk | null {
  const lookup = useContext(ScheduleWeatherContext);
  return useMemo(
    () => weatherRiskForEvent(event, lookup.get),
    // event identity + span + the lookup fn are the only inputs.
    [event, lookup]
  );
}
