/**
 * Notification actions are app navigation, never arbitrary browser links.
 * Keep this predicate in lockstep with
 * `notification_action_url_internal` in the database migration.
 */
export function isSafeInternalNotificationActionUrl(
  value: string | null | undefined
): boolean {
  if (value == null) return true;
  if (!value || value !== value.trim()) return false;
  if (!value.startsWith("/") || value.startsWith("//")) return false;
  if (value.includes("\\")) return false;
  return !/[\u0000-\u001f\u007f]/u.test(value);
}
