/**
 * Translate an i18n-keyed notification string with graceful fallback.
 *
 * Services that emit notifications can pass either a literal human-readable
 * string or a dot-notation i18n key (e.g., "notification.confirmedTaskRescheduled.title").
 * This helper detects the dot-key shape — lowercase start, contains ".", no spaces —
 * and routes it through the provided translator. Literal strings pass through unchanged.
 *
 * Used by: notifications-row. Replaces the duplicated helper in the deprecated
 * notification-card-full.tsx and notification-mini-card.tsx (deleted in Task 14).
 */
export function translateNotifCopy(
  raw: string | null | undefined,
  t: (k: string) => string,
): string | null {
  if (!raw) return null;
  const looksLikeKey = /^[a-z][a-zA-Z0-9._-]*$/.test(raw) && raw.includes(".");
  if (!looksLikeKey) return raw;
  return t(raw);
}
