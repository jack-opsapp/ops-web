/**
 * Convert a 6-char hex string to an `rgba(r, g, b, a)` string with the
 * given alpha. Replaces the legacy `${hex}33` / `${hex}55` / `${hex}80`
 * pattern that quietly relied on appending an 8-char alpha suffix to a
 * 7-char hex.
 *
 * @param hex          6-char hex (`"#RRGGBB"` or `"RRGGBB"`)
 * @param alphaPercent integer in [0, 100]
 *
 * Throws on malformed hex; clamps alpha into [0, 100].
 */
export function withAlpha(hex: string, alphaPercent: number): string {
  const stripped = hex.startsWith("#") ? hex.slice(1) : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(stripped)) {
    throw new Error(`withAlpha: malformed hex "${hex}" — expected 6 hex chars`);
  }
  const clamped = Math.max(0, Math.min(100, alphaPercent));
  const r = parseInt(stripped.slice(0, 2), 16);
  const g = parseInt(stripped.slice(2, 4), 16);
  const b = parseInt(stripped.slice(4, 6), 16);
  const a = clamped / 100;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
