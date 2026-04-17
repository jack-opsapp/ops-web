/**
 * Email parsing utilities — shared between AI classification and UI rendering.
 *
 * - htmlToPlainText: strips HTML (including <style>/<script> blocks with contents)
 * - stripQuotedContent: removes quoted reply chains (>, >>, "On ... wrote:")
 * - extractEmailAddress: pulls raw email from RFC822 "Name <email>" format
 * - isCommonEmailDomain: identifies shared providers where domain matching is meaningless
 */

// ─── HTML → plain text ─────────────────────────────────────────────────────
// Email bodies often arrive as marketing-grade HTML: inline <style> blocks,
// Outlook conditional comments, zero-width entities. A naive tag strip leaves
// the CSS content behind because `<[^>]+>` only matches the `<style>` and
// `</style>` tags themselves, not the rule block between them.

/**
 * Convert an HTML email body to plain text.
 *
 * Strips `<script>`, `<style>`, `<head>`, `<noscript>` blocks *with their
 * contents*, HTML comments (including Outlook conditionals), and all remaining
 * tags. Preserves paragraph structure by converting block-level closing tags
 * and `<br>` to newlines, and `<li>` to `- ` bullets.
 *
 * Idempotent on plain text: returns the input unchanged if no `<` is present.
 */
export function htmlToPlainText(raw: string): string {
  if (!raw || !raw.includes("<")) return raw;
  return raw
    // Block-level content containers — must strip with their contents,
    // otherwise CSS/JS/metadata leaks through the general tag regex below.
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    // Structural tags become newlines so paragraphs don't merge into a blob
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    // Strip any other remaining tag (including Outlook `<![if]>` / `<![endif]>`)
    .replace(/<[^>]+>/g, "")
    // Decode common HTML entities
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    // Zero-width joiners used to obscure text in promotional emails
    .replace(/&#x200[cdef];/gi, "")
    .replace(/&zwnj;/gi, "")
    .replace(/&zwj;/gi, "")
    // Collapse whitespace
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[^\S\n]+/g, " ")
    .trim();
}

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
