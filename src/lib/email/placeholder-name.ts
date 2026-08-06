/**
 * OPS Web — Placeholder contact-name predicate.
 *
 * A single definition of "this name is not a real customer name", shared by
 * every surface that has to decide whether a stored name may be replaced:
 * the sender-name backfill, the live thread-sync self-repair, and the client
 * name backfill.
 *
 * A name is a placeholder when it is:
 *   - null / empty / whitespace
 *   - a bare email address (contains '@')
 *   - the sender's email local part ("canprojack" for canprojack@gmail.com)
 *   - a generic mailbox label ("info", "Sales Team", "… - no reply")
 *
 * Legit-looking names are preserved. "Cecilia Reyes" and "Bob's Roofing"
 * contain no generic tokens and do not echo their local part, so they are
 * never treated as replaceable.
 */

export const GENERIC_MAILBOX_TOKENS: ReadonlySet<string> = new Set([
  "team",
  "info",
  "accounts",
  "accounting",
  "sales",
  "support",
  "billing",
  "help",
  "hello",
  "contact",
  "noreply",
  "no-reply",
  "admin",
  "office",
  "mailbox",
  "inbox",
  "notifications",
  "updates",
  "news",
  "marketing",
  "service",
  "services",
  "enquiries",
  "inquiries",
]);

/**
 * True when `name` is a machine-minted placeholder rather than a real
 * customer name. `senderEmail` is optional — without it the local-part test
 * is skipped and only the shape tests apply.
 */
export function isPlaceholderClientName(
  name: string | null | undefined,
  senderEmail: string | null | undefined
): boolean {
  if (!name) return true;
  const trimmed = name.trim();
  if (!trimmed) return true;
  if (trimmed.includes("@")) return true;
  if (senderEmail) {
    const localPart = senderEmail.split("@")[0];
    if (localPart && trimmed.toLowerCase() === localPart.toLowerCase()) {
      return true;
    }
  }
  const tokens = trimmed
    .toLowerCase()
    .split(/[\s_\-/.]+/)
    .filter(Boolean);
  if (tokens.length === 0) return true;
  // Treat as a placeholder when ANY token is a generic mailbox label.
  // "Info Mailbox" and "Sales Team" both fail; "Cecilia Reyes" has no generic
  // tokens so it passes cleanly.
  //
  // NOTE: the tokenizer splits on '-', so the "no-reply" set entry is only
  // reachable as the unhyphenated "noreply". Lifted verbatim from the inbox
  // name-backfill route to keep that route's behavior identical.
  return tokens.some((t) => GENERIC_MAILBOX_TOKENS.has(t));
}
