// src/lib/api/services/conversation-state/forward-wrapper.ts
//
// Strips the FORWARDER's own wrapper signature from a forwarded message before
// the text reaches a model prompt.
//
// WHY: contact-form notifications reach OPS as a platform email the operator
// forwarded from their phone. The forwarded body therefore opens with the
// forwarder's device signature ("Thanks, <name> / <phone> / <company> / Sent
// from my iPhone") ABOVE the forward marker, and only then carries the actual
// submission. A model given that raw text adopts the forwarder's name and phone
// number and signs the customer reply as them — the 2026-08-02 impersonation
// incident. The operator's identity belongs to the prompt's OPERATOR IDENTITY
// block and to the appended signature, never to text lifted out of an email.
//
// SCOPE: this removes ONLY the wrapper signature that sits between the start of
// the message and the forward marker. Any real note the forwarder typed above
// that signature ("quote this one high") is intentionally preserved — it is
// operator intent. Everything from the forward marker onward is returned
// byte-for-byte.
//
// The function is PURE and side-effect free: no DB, no network, no I/O.

/** Markers that open the forwarded payload (Apple Mail / Gmail web / Outlook). */
const FORWARD_MARKER_RE =
  /^[ \t]*(?:Begin forwarded message:|-{4,}[ \t]*Forwarded message[ \t]*-{4,})/m;

/** Device / client footer that terminates a forwarder's wrapper signature. */
const DEVICE_FOOTER_RE =
  /^[ \t]*sent from my (?:iphone|ipad|ipod|android|samsung|galaxy|pixel|huawei|mobile device|phone)\b/i;

/** Closing words that, at the head of a line, may open a wrapper signature. */
const CLOSING_WORDS = [
  "thanks so much",
  "thanks again",
  "many thanks",
  "thank you",
  "thanks",
  "best regards",
  "kind regards",
  "warm regards",
  "regards",
  "best wishes",
  "best",
  "cheers",
  "sincerely",
  "talk soon",
];

const CLOSING_LINE_RE = new RegExp(
  `^[ \\t]*(?:${CLOSING_WORDS.map((word) => word.replace(/ /g, "\\s+")).join(
    "|"
  )})[ \\t]*[,.!;:—–-]?[ \\t]*(.*)$`,
  "i"
);

/**
 * A same-line tail after the closing word reads as a signed name only when
 * every token is capitalised ("Thanks,Jared Jerome"). Lower-case tails are
 * prose ("Thanks for chasing this one down") and must never trigger a cut.
 */
const SIGNED_NAME_TAIL_RE =
  /^\p{Lu}[\p{L}.'’-]*(?:[ \t]+\p{Lu}[\p{L}.'’-]*){0,3}$/u;

/** Longest a wrapper-signature line may be before it reads as prose. */
const MAX_WRAPPER_LINE_LENGTH = 60;

function isBlank(line: string): boolean {
  return line.trim().length === 0;
}

/** True when the line is a closing line rather than prose opening with one. */
function isClosingLine(line: string): boolean {
  if (line.trim().length > MAX_WRAPPER_LINE_LENGTH) return false;
  const match = CLOSING_LINE_RE.exec(line);
  if (!match) return false;
  const tail = (match[1] ?? "").trim();
  if (!tail) return true;
  return SIGNED_NAME_TAIL_RE.test(tail);
}

/**
 * Remove the forwarder's wrapper signature from forwarded text.
 *
 * Returns the input unchanged when there is no forward marker, when no device
 * footer precedes the marker, or when no wrapper block can be identified — the
 * function never guesses at a cut it cannot justify.
 */
export function stripForwardWrapper(text: string): string {
  if (!text) return text;

  const markerMatch = FORWARD_MARKER_RE.exec(text);
  if (!markerMatch) return text;

  const markerIndex = markerMatch.index;
  const preMarker = text.slice(0, markerIndex);
  const fromMarker = text.slice(markerIndex);
  if (!preMarker.trim()) return text;

  const lines = preMarker.split(/\r?\n/);

  // The wrapper signature always terminates at the LAST device footer before
  // the marker. Without one there is no block we can safely bound.
  let deviceIndex = -1;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (DEVICE_FOOTER_RE.test(lines[index] ?? "")) {
      deviceIndex = index;
      break;
    }
  }
  if (deviceIndex < 0) return text;

  // Walk backwards from the device footer across the contiguous run of short
  // non-blank lines directly above it, stopping at the first blank separator or
  // prose-length line. A blank line immediately above the footer is a separator
  // inside the signature, not a boundary.
  let cursor = deviceIndex - 1;
  while (cursor >= 0 && isBlank(lines[cursor] ?? "")) cursor -= 1;

  let runStart = deviceIndex;
  let closingIndex = -1;
  while (cursor >= 0) {
    const line = lines[cursor] ?? "";
    if (isBlank(line)) break;
    if (line.trim().length > MAX_WRAPPER_LINE_LENGTH) break;
    runStart = cursor;
    if (isClosingLine(line)) {
      closingIndex = cursor;
      break;
    }
    cursor -= 1;
  }

  const blockStart = closingIndex >= 0 ? closingIndex : runStart;
  const kept = lines.slice(0, blockStart);
  while (kept.length > 0 && isBlank(kept[kept.length - 1] ?? "")) kept.pop();

  const prefix = kept.join("\n");
  return prefix ? `${prefix}\n\n${fromMarker}` : fromMarker;
}
