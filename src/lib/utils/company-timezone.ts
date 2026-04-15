/**
 * OPS Web - Company Timezone Detection
 *
 * Maps a company's lat/lng to an IANA timezone. No external dependency —
 * uses rough longitude bands accurate enough for user-facing date display.
 * Falls back to Pacific Time when no location is available.
 */

export type IanaTimezone =
  | "Pacific/Honolulu"
  | "America/Anchorage"
  | "America/Los_Angeles"
  | "America/Denver"
  | "America/Chicago"
  | "America/New_York"
  | "America/Halifax";

const DEFAULT_TZ: IanaTimezone = "America/Los_Angeles";

/**
 * Detect an IANA timezone string from a company's lat/lng.
 * Covers North America with reasonable accuracy. Outside NA falls back to PT.
 */
export function detectCompanyTimezone(
  latitude: number | null | undefined,
  longitude: number | null | undefined
): IanaTimezone {
  if (
    latitude == null ||
    longitude == null ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude)
  ) {
    return DEFAULT_TZ;
  }

  // Hawaii: roughly -161 to -154 longitude
  if (longitude < -140 && latitude < 25) return "Pacific/Honolulu";

  // Alaska: -168 to -130 longitude, north of 54
  if (longitude < -130 && latitude > 54) return "America/Anchorage";

  // Pacific Time (west coast)
  if (longitude < -115) return "America/Los_Angeles";

  // Mountain Time
  if (longitude < -100) return "America/Denver";

  // Central Time
  if (longitude < -85) return "America/Chicago";

  // Eastern Time
  if (longitude < -67) return "America/New_York";

  // Atlantic Time (Maritimes)
  if (longitude < -52) return "America/Halifax";

  // Outside North America — default to PT so the email still renders
  return DEFAULT_TZ;
}

/** Short abbreviation for a detected IANA zone. */
export function timezoneAbbreviation(tz: IanaTimezone): string {
  switch (tz) {
    case "Pacific/Honolulu":
      return "HST";
    case "America/Anchorage":
      return "AKT";
    case "America/Los_Angeles":
      return "PT";
    case "America/Denver":
      return "MT";
    case "America/Chicago":
      return "CT";
    case "America/New_York":
      return "ET";
    case "America/Halifax":
      return "AT";
  }
}

/**
 * Format a trial end date as "EOD Tuesday, April 22" in the given timezone.
 * User preference is to show end-of-day rather than a specific clock time.
 */
export function formatTrialEndDisplay(date: Date, tz: IanaTimezone): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: tz,
  });
  return `EOD ${formatter.format(date)} (${timezoneAbbreviation(tz)})`;
}
