/**
 * Formatting utilities for OPS Web
 */

/**
 * Format currency value.
 */
export function formatCurrency(
  amount: number,
  currency: string = "USD"
): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Format a phone number for display.
 * Input can be string or number.
 */
export function formatPhoneNumber(phone: string | number | null | undefined): string {
  if (phone == null) return "";

  // Convert number to string
  const phoneStr =
    typeof phone === "number" ? String(Math.floor(phone)) : phone;

  // Strip non-numeric characters
  const digits = phoneStr.replace(/\D/g, "");

  // Format based on length
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }

  // Return as-is if unknown format
  return phoneStr;
}

/**
 * Format an address for display.
 * Handles address objects and plain strings.
 */
export function formatAddress(
  address:
    | string
    | { address?: string; lat?: number; lng?: number }
    | null
    | undefined
): string {
  if (!address) return "";
  if (typeof address === "string") return address;
  return address.address || "";
}

/**
 * Truncate text with ellipsis.
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).trimEnd() + "...";
}

/**
 * Get initials from a name.
 */
export function getInitials(name: string): string {
  if (!name) return "";
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0]?.toUpperCase() ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0]?.toUpperCase() ?? "" : "";
  return `${first}${last}`;
}

/**
 * Get initials from first + last name.
 */
export function getUserInitials(
  firstName: string | null | undefined,
  lastName: string | null | undefined
): string {
  const first = firstName?.[0]?.toUpperCase() ?? "";
  const last = lastName?.[0]?.toUpperCase() ?? "";
  return `${first}${last}` || "?";
}

/**
 * Parse comma-separated string into array.
 * Used for teamMemberIdsString, projectImagesString, etc.
 */
export function parseCommaSeparated(value: string | null | undefined): string[] {
  if (!value || value.trim() === "") return [];
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * Join array into comma-separated string.
 */
export function joinCommaSeparated(values: string[]): string {
  return values.filter(Boolean).join(",");
}

/**
 * Generate a random hex color.
 */
export function randomColor(): string {
  return `#${Math.floor(Math.random() * 16777215).toString(16).padStart(6, "0")}`;
}

/**
 * Validate and normalize a hex color.
 * Ensures it has a # prefix.
 */
export function normalizeHexColor(
  color: string | null | undefined,
  fallback: string = "#59779F"
): string {
  if (!color) return fallback;
  const trimmed = color.trim();
  if (trimmed.startsWith("#")) return trimmed;
  return `#${trimmed}`;
}

/**
 * Format a number with commas.
 */
export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

/**
 * Format a percentage.
 */
export function formatPercent(
  value: number,
  decimals: number = 0
): string {
  return `${value.toFixed(decimals)}%`;
}

/**
 * Extract street address from a full address string.
 * Used for image filename generation (matching iOS behavior).
 */
export function extractStreetAddress(address: string): string {
  const streetPart = address.split(",")[0] || "";
  const cleaned = streetPart
    .replace(/\s/g, "")
    .replace(/\./g, "")
    .replace(/,/g, "");
  return cleaned || "NoAddress";
}

/**
 * Pluralize a word based on count.
 */
export function pluralize(
  count: number,
  singular: string,
  plural?: string
): string {
  if (count === 1) return singular;
  return plural || `${singular}s`;
}
