import {
  type CountryCode,
  isSupportedCountry,
  isValidPhoneNumber,
  parsePhoneNumberFromString,
} from "libphonenumber-js";

export class InvalidPhoneError extends Error {
  public readonly raw: string;

  constructor(raw: string) {
    super(`Invalid phone number: ${raw}`);
    this.name = "InvalidPhoneError";
    this.raw = raw;
  }
}

/**
 * Normalize a phone number to E.164 format (+14155551234).
 * Defaults to US country code if no country code is present.
 *
 * Throws InvalidPhoneError on any input that cannot be parsed as a valid
 * phone number — includes empty strings, gibberish, and numbers too short
 * or too long for the detected country.
 */
export function normalizePhoneE164(
  raw: string,
  defaultCountry: CountryCode = "US"
): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new InvalidPhoneError(raw);

  if (!isSupportedCountry(defaultCountry)) {
    throw new InvalidPhoneError(raw);
  }

  if (!isValidPhoneNumber(trimmed, defaultCountry)) {
    throw new InvalidPhoneError(raw);
  }

  const parsed = parsePhoneNumberFromString(trimmed, defaultCountry);
  if (!parsed || !parsed.isValid()) {
    throw new InvalidPhoneError(raw);
  }

  return parsed.number;
}

/**
 * Format an E.164 number back to national display format, e.g.,
 * "+14155551234" → "(415) 555-1234". Used for chip display in the
 * invite modal where E.164 is ugly but still the authoritative value.
 */
export function formatPhoneNational(
  e164: string,
  defaultCountry: CountryCode = "US"
): string {
  if (!isSupportedCountry(defaultCountry)) return e164;
  const parsed = parsePhoneNumberFromString(e164, defaultCountry);
  if (!parsed || !parsed.isValid()) return e164;
  return parsed.formatNational();
}
