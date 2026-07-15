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
