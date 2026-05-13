/**
 * Display helpers for opportunity cards in the inbox right rail.
 *
 * Email-imported opportunities are sometimes created with an empty title
 * (the source email had no usable subject). The pipeline list still needs
 * to render something tactile in the title slot rather than collapsing to
 * a bare row, so callers route the raw fields through here.
 */

const MAX_FALLBACK_LENGTH = 80;

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Resolve the display title for a pipeline opportunity card.
 *
 * Order of precedence:
 *   1. `title` (trimmed, non-empty)
 *   2. `description` (trimmed, non-empty — truncated to keep the row tidy)
 *   3. `untitledFallback` — pre-localized "[UNTITLED OPPORTUNITY]" string
 *      that the caller pulls from the dictionary.
 */
export function pipelineOppDisplayTitle(
  opp: { title?: string | null; description?: string | null },
  untitledFallback: string,
): string {
  const title = opp.title?.trim();
  if (title) return title;

  const description = opp.description?.trim();
  if (description) return truncate(description, MAX_FALLBACK_LENGTH);

  return untitledFallback;
}
