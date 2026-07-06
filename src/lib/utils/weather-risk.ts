/**
 * OPS Web — Weather-risk classification for the schedule.
 *
 * Pure, side-effect-free logic that decides whether a scheduled event should
 * surface an adverse-weather warning. Two independent questions:
 *
 *   1. Is the EVENT weather-dependent? (outdoor field work vs. indoor/logistics)
 *   2. Is the FORECAST for a covered date adverse? (rain / snow / storm / wind)
 *
 * A warning fires only when BOTH are true — "invisible helpfulness": the glyph
 * never appears for a material pickup, and never appears on a clear day. No
 * toggle, no configuration; the signal is present exactly when it earns its
 * place and silent otherwise.
 *
 * Open-Meteo only forecasts 6 days out, so warnings are inherently bounded to
 * the [today, today+6] window. Beyond that there is no data and no warning —
 * which is correct: you cannot warn about weather three weeks away.
 *
 * Kept free of React / Supabase / date-fns so it unit-tests trivially.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type WeatherRiskKind = "rain" | "snow" | "storm" | "wind";

/** The minimal forecast shape the classifier needs (subset of weather_forecasts). */
export interface ForecastLike {
  forecastDate: string; // YYYY-MM-DD
  precipitationProbability: number | null; // %
  precipitationMm: number | null;
  windSpeedKmh: number | null;
  conditions: string | null; // WMO human label, e.g. "Slight rain"
}

/** The resolved risk for one event — enough to render the glyph + tooltip. */
export interface WeatherRisk {
  kind: WeatherRiskKind;
  forecastDate: string; // the covered date the risk is for
  precipitationProbability: number | null;
  windSpeedKmh: number | null;
  conditions: string | null;
}

/** Just the fields of an event the weather-dependency test reads. */
export interface WeatherClassifiableEvent {
  kind: "task" | "personal" | "time_off";
  taskType: string;
  typeLabel: string;
  taskTitle: string;
}

// ─── Thresholds (documented, single source of truth) ─────────────────────────

/** ≥ this precipitation probability (%) is treated as adverse. */
export const PRECIP_PROBABILITY_THRESHOLD = 60;

/**
 * ≥ this sustained wind (km/h) is treated as adverse. Chosen for the trades:
 * crane/lift work, working at height, and handling sheet material (vinyl,
 * glass, railing panels) become unsafe/impractical around 40 km/h.
 */
export const HIGH_WIND_KMH = 40;

/** ≥ this daily precipitation (mm) is a soaker even if the probability field is modest. */
export const HEAVY_PRECIP_MM = 10;

// ─── Weather-dependency (which events can be rained out) ──────────────────────

// Indoor / logistics work — the ONE category that is NOT weather-dependent.
// Everything else a trades crew schedules happens outdoors, so the model is
// "outdoor by default, unless the type clearly reads as indoor/logistics."
// This correctly catches custom outdoor types (Vinyl Install, Rail Install,
// Renovation, Resheet & Rail…) that no allow-list would enumerate, while
// still excluding material runs and office work.
const INDOOR_STEMS = [
  "material",
  "pickup",
  "pick up",
  "pick-up",
  "deliver", // deliver / delivery
  "supplier",
  "supplies",
  "supply",
  "office",
  "admin",
  "paperwork",
  "invoic", // invoice / invoicing
  "billing",
  "showroom",
  "warehouse",
  "drawing", // shop drawings
  "permit",
  "meeting",
  "design",
];

// Short, ambiguous tokens matched on word boundaries so "install" never trips
// "call" and "recall" never trips "call".
const INDOOR_WORD_RE = /\b(call|phone|shop|remote|virtual)\b/;

/**
 * True when an event represents outdoor field work whose execution depends on
 * the weather. Personal events and time-off are never weather-dependent.
 */
export function isWeatherDependentEvent(event: WeatherClassifiableEvent): boolean {
  if (event.kind !== "task") return false;
  const hay = `${event.taskType} ${event.typeLabel} ${event.taskTitle}`.toLowerCase();
  if (INDOOR_WORD_RE.test(hay)) return false;
  if (INDOOR_STEMS.some((stem) => hay.includes(stem))) return false;
  return true;
}

// ─── Adverse-condition label detection (from WMO human labels) ────────────────

// weather_forecasts stores the human WMO label ("Slight rain", "Heavy snow",
// "Thunderstorm"…), not the numeric code, so classify off the label text.
function conditionKind(label: string | null): WeatherRiskKind | null {
  if (!label) return null;
  const l = label.toLowerCase();
  if (l.includes("thunder")) return "storm";
  if (l.includes("snow")) return "snow";
  if (
    l.includes("rain") ||
    l.includes("drizzle") ||
    l.includes("shower") ||
    l.includes("freezing")
  ) {
    return "rain";
  }
  return null;
}

// ─── Forecast → risk ──────────────────────────────────────────────────────────

/**
 * Classify a single forecast row. Returns a WeatherRisk when the day is
 * adverse, or null when it's fine.
 *
 * Adverse when ANY of:
 *   - precipitation probability ≥ PRECIP_PROBABILITY_THRESHOLD
 *   - the WMO label reads as rain / snow / thunderstorm
 *   - daily precipitation ≥ HEAVY_PRECIP_MM
 *   - wind ≥ HIGH_WIND_KMH
 *
 * Kind priority: storm > snow > rain > wind. A day that is both windy and
 * rainy reads as "rain" (the precip is the headline); wind-only days read as
 * "wind".
 */
export function classifyForecast(f: ForecastLike): WeatherRisk | null {
  const labelKind = conditionKind(f.conditions);
  const prob = f.precipitationProbability;
  const mm = f.precipitationMm;
  const wind = f.windSpeedKmh;

  const precipByProb = prob != null && prob >= PRECIP_PROBABILITY_THRESHOLD;
  const precipByMm = mm != null && mm >= HEAVY_PRECIP_MM;
  const windy = wind != null && wind >= HIGH_WIND_KMH;
  const precipByLabel = labelKind !== null;

  const adverse = precipByProb || precipByMm || windy || precipByLabel;
  if (!adverse) return null;

  // Resolve the headline kind.
  let kind: WeatherRiskKind;
  if (labelKind === "storm") {
    kind = "storm";
  } else if (labelKind === "snow") {
    kind = "snow";
  } else if (labelKind === "rain" || precipByProb || precipByMm) {
    kind = "rain";
  } else {
    // Only the wind threshold tripped — clear/overcast but blustery.
    kind = "wind";
  }

  return {
    kind,
    forecastDate: f.forecastDate,
    precipitationProbability: prob,
    windSpeedKmh: wind,
    conditions: f.conditions,
  };
}

// ─── Covered dates within the forecast window ────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;
/** Open-Meteo horizon: today + 5 = 6 calendar days of data. */
export const FORECAST_HORIZON_DAYS = 5;

/** Format a Date to a LOCAL YYYY-MM-DD (never UTC — avoids the day-shift bug). */
export function toLocalISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * The set of YYYY-MM-DD dates an event covers that fall inside the forecast
 * window [today, today+FORECAST_HORIZON_DAYS]. Multi-day events contribute
 * every covered day so a clear start followed by a rainy finish still warns.
 * Past days are dropped — a warning is only about upcoming work.
 */
export function coveredForecastDates(
  start: Date,
  end: Date,
  now: Date = new Date()
): string[] {
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const horizon = new Date(todayMidnight.getTime() + FORECAST_HORIZON_DAYS * DAY_MS);

  // Clamp the event's covered span to the forecast window.
  const startMidnight = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const endMidnight = new Date(end.getFullYear(), end.getMonth(), end.getDate());

  const from = startMidnight < todayMidnight ? todayMidnight : startMidnight;
  const to = endMidnight > horizon ? horizon : endMidnight;
  if (from > to) return [];

  const out: string[] = [];
  for (let t = from.getTime(); t <= to.getTime(); t += DAY_MS) {
    out.push(toLocalISODate(new Date(t)));
  }
  return out;
}

// ─── Event → risk (the orchestrator the hook calls) ──────────────────────────

/**
 * Resolve the single most-imminent adverse-weather risk for an event, or null.
 * Returns the EARLIEST adverse covered date — the soonest risk is the one the
 * operator would act on first (reschedule, call the client, move the crew).
 *
 * `getForecast` is injected so this stays pure and testable — the hook passes
 * a lookup backed by the cached weather_forecasts rows.
 */
export function weatherRiskForEvent(
  event: {
    kind: "task" | "personal" | "time_off";
    taskType: string;
    typeLabel: string;
    taskTitle: string;
    projectId?: string;
    startDate: Date;
    endDate: Date;
  },
  getForecast: (projectId: string, date: string) => ForecastLike | null,
  now: Date = new Date()
): WeatherRisk | null {
  if (!event.projectId) return null;
  if (!isWeatherDependentEvent(event)) return null;

  const dates = coveredForecastDates(event.startDate, event.endDate, now);
  for (const date of dates) {
    const forecast = getForecast(event.projectId, date);
    if (!forecast) continue;
    const risk = classifyForecast(forecast);
    if (risk) return risk; // dates are ascending → first hit is the most imminent
  }
  return null;
}
