export type NewThreadSubjectSource =
  | "operator"
  | "configured"
  | "generated"
  | "learned"
  | "fallback";

export type DraftSubjectInputSource = NewThreadSubjectSource | "thread";

export interface LearnedSubjectContext {
  contact?: string | null;
  company?: string | null;
  address?: string | null;
  project?: string | null;
  email?: string | null;
  number?: string | null;
}

const REPLY_PREFIX = /^\s*re(?:\[\d+\])?\s*:\s*/i;
const FORWARD_PREFIX = /^\s*(?:fwd?|forwarded)\s*:\s*/i;
const MAX_SUBJECT_LENGTH = 200;

function cleanSubject(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripReplyPrefixes(value: string): string {
  let subject = cleanSubject(value);

  while (REPLY_PREFIX.test(subject)) {
    subject = subject.replace(REPLY_PREFIX, "").trim();
  }

  return subject;
}

export function isReplyLikeSubject(subject: string): boolean {
  return REPLY_PREFIX.test(cleanSubject(subject));
}

export function normalizeReplySubject(subject: string): string {
  const base = stripReplyPrefixes(subject);
  return base ? `Re: ${base}` : "Re:";
}

function normalizeNewThreadSubject(subject: string | null | undefined): string {
  return stripReplyPrefixes(cleanSubject(subject));
}

export function normalizeLearnedSubjectExamples(
  subjects: readonly string[]
): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const rawSubject of subjects) {
    const subject = cleanSubject(rawSubject);
    if (
      !subject ||
      subject.length > MAX_SUBJECT_LENGTH ||
      REPLY_PREFIX.test(subject) ||
      FORWARD_PREFIX.test(subject)
    ) {
      continue;
    }

    const key = subject.toLocaleLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    normalized.push(subject);
  }

  return normalized;
}

export function contextualNewThreadSubject(input: {
  opportunityTitle?: string | null;
  userInstruction?: string | null;
}): string | null {
  const candidate = cleanSubject(
    input.opportunityTitle || input.userInstruction || ""
  )
    .replace(/[.!?]+$/, "")
    .slice(0, 120)
    .trim();
  if (!candidate) return null;

  return candidate.charAt(0).toLocaleUpperCase() + candidate.slice(1);
}

/**
 * The tokens an operator may type into their own outreach subject, and the lead
 * field each one answers with. `{name}` is deliberately not `{contact}`: the
 * operator is naming the person, not our column.
 */
const SUBJECT_TEMPLATE_TOKENS: Record<string, keyof LearnedSubjectContext> = {
  name: "contact",
  address: "address",
  project: "project",
  email: "email",
};

export const SUBJECT_TEMPLATE_TOKEN_NAMES = Object.keys(
  SUBJECT_TEMPLATE_TOKENS
) as ReadonlyArray<keyof typeof SUBJECT_TEMPLATE_TOKENS>;

/**
 * `{…}` in any shape — including the empty `{}` — so a malformed token can
 * never survive as literal punctuation in a subject a customer reads.
 */
const SUBJECT_TOKEN = /\{([^{}]*)\}/g;
const SEPARATORS = "-–—·,:|";
const TRAILING_SEPARATOR = new RegExp(`\\s*[${SEPARATORS}]\\s*$`);
const LEADING_SEPARATOR = new RegExp(`^\\s*[${SEPARATORS}]\\s*`);
const EDGE_SEPARATORS = new RegExp(
  `^\\s*[${SEPARATORS}]+\\s*|\\s*[${SEPARATORS}]+\\s*$`,
  "g"
);

/** Tidy the seams a removed token leaves behind, and never emit a brace. */
function tidyFilledSubject(value: string): string {
  return value
    .replace(/[{}]/g, "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(EDGE_SEPARATORS, "")
    .trim();
}

/**
 * Fill an operator-authored subject template against one lead.
 *
 * A lead that cannot answer a token loses the token AND the separator holding
 * it on — "Canpro Deck and Rail Estimate - {address}" reads as "Canpro Deck and
 * Rail Estimate", never "Canpro Deck and Rail Estimate - ". The separator ahead
 * of the token goes first; the one behind it goes only when there is nothing
 * ahead. Everything the operator typed outside a token is preserved.
 *
 * Nothing brace-shaped ever survives. A template with no braces at all is
 * returned byte for byte — filling must not quietly reformat a plain subject.
 */
export function fillSubjectTemplate(
  template: string,
  context: LearnedSubjectContext
): string {
  if (!/[{}]/.test(template)) return template;

  let filled = "";
  let cursor = 0;
  SUBJECT_TOKEN.lastIndex = 0;

  for (
    let match = SUBJECT_TOKEN.exec(template);
    match;
    match = SUBJECT_TOKEN.exec(template)
  ) {
    const literal = template.slice(cursor, match.index);
    const field = SUBJECT_TEMPLATE_TOKENS[match[1].trim().toLocaleLowerCase()];
    const value = field ? cleanSubject(context[field]) : "";

    if (value) {
      filled += literal + value;
    } else {
      const ahead = filled + literal;
      const withoutAhead = ahead.replace(TRAILING_SEPARATOR, "");
      if (withoutAhead !== ahead) {
        filled = withoutAhead;
      } else {
        filled = ahead;
        // Nothing ahead to absorb the gap, so the separator behind it goes.
        const behind = template
          .slice(SUBJECT_TOKEN.lastIndex)
          .match(LEADING_SEPARATOR);
        if (behind) SUBJECT_TOKEN.lastIndex += behind[0].length;
      }
    }

    cursor = SUBJECT_TOKEN.lastIndex;
  }

  return tidyFilledSubject(filled + template.slice(cursor));
}

/**
 * Deliberately does NOT share `fillSubjectTemplate`. A learned pattern is only
 * usable when this lead fills it ENTIRELY — a half-filled pattern learned from
 * someone else's thread is a wrong subject, not a shorter one — and it speaks
 * the learner's own six-token vocabulary rather than the four the operator is
 * offered. Same shape, opposite failure mode.
 */
export function learnedNewThreadSubjectFromPreferences(
  preferences: unknown,
  context: LearnedSubjectContext
): string | null {
  if (!preferences || typeof preferences !== "object") return null;

  const record = preferences as Record<string, unknown>;
  if (!Array.isArray(record.preferred_patterns)) return null;

  const recognizedTokens = new Set<keyof LearnedSubjectContext>([
    "contact",
    "company",
    "address",
    "project",
    "email",
    "number",
  ]);

  // preferred_patterns is already ranked by the learner. Walk in stored order
  // and use the first pattern with enough evidence that can be filled entirely
  // from this lead. The examples field is intentionally ignored: even though
  // the learner stores de-identified templates today, it is never a send input.
  for (const value of record.preferred_patterns) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;

    const preference = value as Record<string, unknown>;
    const pattern = cleanSubject(
      typeof preference.pattern === "string" ? preference.pattern : ""
    );
    const count = preference.count;
    if (
      !pattern ||
      pattern.length > MAX_SUBJECT_LENGTH ||
      typeof count !== "number" ||
      !Number.isFinite(count) ||
      count < 3 ||
      REPLY_PREFIX.test(pattern) ||
      FORWARD_PREFIX.test(pattern)
    ) {
      continue;
    }

    let invalid = false;
    const subject = pattern.replace(/\{([^{}]+)\}/g, (_match, rawToken) => {
      const token = rawToken as keyof LearnedSubjectContext;
      if (!recognizedTokens.has(token)) {
        invalid = true;
        return "";
      }
      const currentValue = cleanSubject(context[token]);
      if (!currentValue) {
        invalid = true;
        return "";
      }
      return currentValue;
    });
    const normalized = cleanSubject(subject);
    if (
      invalid ||
      /[{}]/.test(normalized) ||
      !normalized ||
      normalized.length > MAX_SUBJECT_LENGTH ||
      REPLY_PREFIX.test(normalized) ||
      FORWARD_PREFIX.test(normalized)
    ) {
      continue;
    }

    return normalized;
  }

  return null;
}

export function subjectDraftRequestFields(
  subject: string | null | undefined,
  source: DraftSubjectInputSource
): { subject?: string; configuredSubject?: string } {
  const normalized = cleanSubject(subject);
  if (!normalized) return {};
  if (source === "operator") return { subject: normalized };
  if (source === "configured") return { configuredSubject: normalized };
  return {};
}

export function chooseNewThreadSubject(input: {
  operatorSubject?: string | null;
  configuredSubject?: string | null;
  learnedSubject?: string | null;
  generatedSubject?: string | null;
  fallback?: string | null;
}): { subject: string; source: NewThreadSubjectSource } {
  const candidates: Array<{
    value: string | null | undefined;
    source: NewThreadSubjectSource;
  }> = [
    { value: input.operatorSubject, source: "operator" },
    { value: input.configuredSubject, source: "configured" },
    { value: input.learnedSubject, source: "learned" },
    { value: input.generatedSubject, source: "generated" },
    { value: input.fallback, source: "fallback" },
  ];

  for (const candidate of candidates) {
    const subject = normalizeNewThreadSubject(candidate.value);
    if (subject) return { subject, source: candidate.source };
  }

  return { subject: "Your inquiry", source: "fallback" };
}
