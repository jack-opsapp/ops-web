/**
 * Email parsing utilities — shared between AI classification and UI rendering.
 *
 * - stripQuotedContent: removes quoted reply chains (>, >>, "On ... wrote:")
 * - extractEmailAddress: pulls raw email from RFC822 "Name <email>" format
 * - isCommonEmailDomain: identifies shared providers where domain matching is meaningless
 */

// ─── Common email domains ──────────────────────────────────────────────────
// Domain matching for outbound detection is meaningless on shared providers —
// everyone has @gmail.com. Only match domains for custom/business addresses.

const COMMON_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com",
  "outlook.com", "hotmail.com", "live.com", "msn.com",
  "yahoo.com", "yahoo.ca", "yahoo.co.uk", "yahoo.com.au",
  "icloud.com", "me.com", "mac.com",
  "aol.com", "protonmail.com", "proton.me",
  "mail.com", "zoho.com", "ymail.com",
  "shaw.ca", "telus.net", "rogers.com", "bell.net",
]);

export function isCommonEmailDomain(domain: string): boolean {
  return COMMON_EMAIL_DOMAINS.has(domain.toLowerCase());
}

// ─── Quote markers ─────────────────────────────────────────────────────────
// All patterns run against \n-normalized text (no \r).

const QUOTE_MARKERS = [
  // Gmail: "On Mon, Jan 15, 2026 at 3:45 PM John Smith <john@example.com> wrote:"
  /^On .{10,80} wrote:\s*$/m,
  // Gmail line-wrapped: "On ... <email>\nwrote:" (wrote: on next line)
  /^On .{10,120}>[ \t]*\nwrote:/m,
  // Outlook: "-----Original Message-----"
  /^-{3,}\s*Original Message\s*-{3,}/mi,
  // Outlook: "From: ... Sent: ... To: ..."
  /^From:\s.+\nSent:\s.+\nTo:\s/m,
  // Apple Mail: "On Jan 15, 2026, at 3:45 PM, John Smith wrote:"
  /^On .{10,60}, at .{5,20}, .{2,60} wrote:/m,
  // Forwarded message
  /^-{5,}\s*Forwarded message\s*-{5,}/mi,
  // Begin forwarded message
  /^Begin forwarded message:/mi,
  // Generic ">" quote blocks (3+ consecutive lines starting with >)
  /(?:^>.*\n){3,}/m,
  // Outlook web: "________________________________\nFrom:"
  /^_{10,}\s*\nFrom:/m,
  // "Get Outlook for iOS/Android" footer
  /^Get Outlook for (?:iOS|Android)/m,
];

/**
 * Strip quoted reply content from an email body.
 * Returns only the NEW content from this specific message.
 */
export function stripQuotedContent(body: string): string {
  if (!body) return body;

  // Normalize line endings — Gmail/M365 APIs may return \r\n
  const normalized = body.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  let earliest = normalized.length;

  for (const marker of QUOTE_MARKERS) {
    const match = normalized.match(marker);
    if (match?.index !== undefined && match.index < earliest) {
      earliest = match.index;
    }
  }

  // If we found a quote marker, trim to just the content before it
  if (earliest < normalized.length) {
    const stripped = normalized.slice(0, earliest).trimEnd();
    // Don't return empty — if the entire message IS a quote, keep a small preview
    return stripped.length > 20 ? stripped : normalized.slice(0, 500);
  }

  return normalized;
}

// ─── Email address extraction ──────────────────────────────────────────────

/**
 * Extract the raw email address from an RFC822 "Display Name <email>" string.
 * If the string is already a plain email, returns it as-is.
 *
 * Examples:
 *   "Jackson Sweet <jack@ops.com>"  →  "jack@ops.com"
 *   "jack@ops.com"                  →  "jack@ops.com"
 *   "<jack@ops.com>"                →  "jack@ops.com"
 */
export function extractEmailAddress(from: string | null | undefined): string {
  if (!from) return "";
  const match = from.match(/<([^>]+)>/);
  return match ? match[1] : from.trim();
}
