const GENERIC_FORM_SUMMARY_PATTERNS = [
  /\blinked to an?\b.*\bopportunit.*\b(form|submission|submitted|contact us)\b/i,
  /\b(form|quote|contact us|submission)\b.*\b(new|got|received|submitted)\b/i,
  /\b(new|got|received)\b.*\b(form|quote|contact us|submission)\b/i,
  /\bgot a new submission\b/i,
];

const FORM_CONTENT_PATTERNS = [
  /\b(full name|name|email|phone|message|how can we help|project type|address)\s*:/i,
  /\b(renovate|replace|repair|install|quote|estimate|deck|roof|siding|window|door)\b/i,
  /^[A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+){0,3}:\s+\S/u,
];

function compactText(value: string | null | undefined): string {
  return value?.trim().replace(/\s+/g, " ") ?? "";
}

export function isGenericFormSubmissionSummary(
  value: string | null | undefined,
): boolean {
  const text = compactText(value);
  if (!text) return false;
  return GENERIC_FORM_SUMMARY_PATTERNS.some((pattern) => pattern.test(text));
}

export function hasParsedFormContentPreview(
  value: string | null | undefined,
): boolean {
  const text = compactText(value);
  if (!text || isGenericFormSubmissionSummary(text)) return false;
  return FORM_CONTENT_PATTERNS.some((pattern) => pattern.test(text));
}

export function resolveThreadPreview({
  aiSummary,
  fallback,
}: {
  aiSummary: string | null | undefined;
  fallback: string | null | undefined;
}): string {
  const summary = compactText(aiSummary);
  const fallbackText = compactText(fallback);

  if (
    isGenericFormSubmissionSummary(summary) &&
    hasParsedFormContentPreview(fallbackText)
  ) {
    return fallbackText;
  }

  return summary || fallbackText;
}
