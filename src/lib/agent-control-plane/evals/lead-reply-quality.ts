export type LeadReplyDisposition =
  "reply" | "no_reply_required" | "operator_input_required";

export interface LeadReplyEvalTurn {
  readonly id: string;
  readonly deliveredAt: string;
  readonly side: "user" | "assistant";
  readonly participantId: string;
  readonly subject: string;
  readonly body: string;
  readonly attachmentIds: readonly string[];
}

export interface LeadReplyEvalParticipant {
  readonly id: string;
  readonly side: "user" | "assistant";
  readonly identityStatus: "resolved" | "unresolved";
  /** Runtime directory fact. The candidate must derive the reply target from turns. */
  readonly email: string | null;
}

export interface LeadReplyEvalConversation {
  readonly participants: readonly LeadReplyEvalParticipant[];
  readonly turns: readonly LeadReplyEvalTurn[];
}

export interface LeadReplyEvalContext {
  readonly kind: "whole_history_control" | "shared_job_memory";
  readonly rendered: string;
  readonly evidenceIds: readonly string[];
}

/** Server-owned schedule authority. It is never parsed from correspondence. */
export interface LeadReplyVerifiedSchedule {
  readonly statement: string;
  readonly evidenceId: string;
}

export type LeadReplyResponseMode =
  | "first_reply"
  | "direct_answer"
  | "schedule"
  | "attachment"
  | "no_reply"
  | "operator_input";

export interface LeadReplyExpectedClaim {
  readonly id: string;
  readonly dimension: "fact" | "schedule" | "commitment";
  readonly acceptedPhrases: readonly string[];
  readonly rejectedPhrases: readonly string[];
  readonly evidenceIds: readonly string[];
}

export interface LeadReplyForbiddenClaim {
  readonly id: string;
  readonly phrases: readonly string[];
}

export interface LeadReplyAllowedClause {
  readonly id: string;
  /**
   * Evidence-backed clauses carry a fixture-owned source receipt. The other
   * two kinds are deliberately narrow conversational affordances.
   */
  readonly kind:
    "evidence_backed" | "neutral_question" | "first_reply_greeting";
  /** Complete clauses, not substrings. Unknown wording fails closed. */
  readonly phrases: readonly string[];
  readonly evidenceIds: readonly string[];
}

export interface LeadReplyEvalFixture {
  readonly id: string;
  readonly tags: readonly string[];
  readonly conversation: LeadReplyEvalConversation;
  readonly controlContext: LeadReplyEvalContext;
  readonly sharedContext: LeadReplyEvalContext;
  readonly verifiedSchedule?: LeadReplyVerifiedSchedule | null;
  readonly expectedResponseMode: LeadReplyResponseMode;
  readonly expectedClaims: readonly LeadReplyExpectedClaim[];
  readonly forbiddenClaims: readonly LeadReplyForbiddenClaim[];
  readonly allowedClauses: readonly LeadReplyAllowedClause[];
  readonly requiredDecisionEvidenceIds: readonly string[];
  readonly expectedDisposition: LeadReplyDisposition;
  readonly expectedRecipientEmail: string | null;
  readonly isFirstOperatorReply: boolean;
  readonly maxWords: number;
  readonly maxContextCharacters: number;
  /**
   * Variation is meaningful within one evolving conversation, not across
   * unrelated leads. A repeated opening is permitted only with a written,
   * fixture-owned factual justification that is never shown to a candidate.
   */
  readonly variationSequence: {
    readonly id: string;
    readonly position: number;
    readonly repeatedOpeningJustification?: string;
  };
}

export interface LeadReplyCandidate {
  readonly disposition: LeadReplyDisposition;
  readonly responseMode: LeadReplyResponseMode;
  readonly draft: string;
  readonly recipientEmail: string | null;
  readonly latencyMilliseconds: number;
}

export interface LeadReplyQualityResult {
  readonly fixtureId: string;
  readonly releaseCritical: {
    readonly dispositionSafe: boolean;
    readonly responseModeSafe: boolean;
    readonly factualCorrectness: boolean;
    readonly recipientIdentity: boolean;
    readonly scheduleAccuracy: boolean;
    readonly commitmentContinuity: boolean;
    readonly evidenceCoverage: boolean;
    readonly hallucinationFree: boolean;
  };
  readonly style: {
    readonly concise: boolean;
    readonly noCannedAcknowledgement: boolean;
    readonly noForcedGreetingOrClosing: boolean;
  };
  readonly efficiency: {
    readonly contextBounded: boolean;
  };
  readonly telemetry: {
    readonly contextCharacters: number;
    readonly latencyMilliseconds: number;
  };
  readonly passed: boolean;
}

export interface LeadReplyComparison {
  readonly control: LeadReplyQualityResult;
  readonly shared: LeadReplyQualityResult;
  readonly sharedHasNoCriticalRegression: boolean;
  readonly contextCharacterReduction: number;
  readonly latencyDeltaMilliseconds: number;
  readonly candidateChecksPassed: boolean;
}

export interface LeadReplySuiteVariation {
  readonly replyCount: number;
  readonly repeatedOpeningCount: number;
  readonly unjustifiedRepeatedOpeningCount: number;
  readonly crossModeRepeatedOpeningCount: number;
  readonly cannedOpeningCount: number;
  readonly hasProperVariation: boolean;
}

export interface LeadReplyVariationSample {
  readonly candidate: LeadReplyCandidate;
  readonly responseMode: LeadReplyResponseMode;
  readonly sequenceId?: string;
  readonly sequencePosition?: number;
  readonly repeatedOpeningJustification?: string;
}

const SAFE_APPLY = Reflect.apply;
const SAFE_OBJECT_FREEZE = Object.freeze;
const SAFE_OBJECT_DEFINE_PROPERTY = Object.defineProperty;
const SAFE_STRING_NORMALIZE = String.prototype.normalize;
const SAFE_STRING_TO_LOWER_CASE = String.prototype.toLowerCase;
const SAFE_STRING_TRIM = String.prototype.trim;
const SAFE_STRING_INDEX_OF = String.prototype.indexOf;
const SAFE_STRING_SLICE = String.prototype.slice;
const SAFE_REGEXP_EXEC = RegExp.prototype.exec;

function appendOwnArrayValue<T>(values: T[], value: T): void {
  SAFE_OBJECT_DEFINE_PROPERTY(values, `${values.length}`, {
    configurable: true,
    enumerable: true,
    writable: true,
    value,
  });
}

function callString(
  method: (this: string, ...args: never[]) => unknown,
  value: string,
  args: readonly unknown[] = []
): unknown {
  return SAFE_APPLY(method, value, args);
}

function safeStringNormalize(value: string): string {
  return callString(
    SAFE_STRING_NORMALIZE as (this: string, ...args: never[]) => unknown,
    value,
    ["NFKC"]
  ) as string;
}

function safeLower(value: string): string {
  return callString(
    SAFE_STRING_TO_LOWER_CASE as (this: string, ...args: never[]) => unknown,
    value
  ) as string;
}

function safeTrim(value: string): string {
  return callString(
    SAFE_STRING_TRIM as (this: string, ...args: never[]) => unknown,
    value
  ) as string;
}

function safeIndexOf(value: string, sought: string, from = 0): number {
  return callString(
    SAFE_STRING_INDEX_OF as (this: string, ...args: never[]) => unknown,
    value,
    [sought, from]
  ) as number;
}

function safeSlice(value: string, start?: number, end?: number): string {
  return callString(
    SAFE_STRING_SLICE as (this: string, ...args: never[]) => unknown,
    value,
    [start, end]
  ) as string;
}

function safeRegexTest(pattern: RegExp, value: string): boolean {
  pattern.lastIndex = 0;
  return SAFE_APPLY(SAFE_REGEXP_EXEC, pattern, [value]) !== null;
}

const CANNED_ACKNOWLEDGEMENT_PATTERNS = [
  /^got it\b/i,
  /^understood\b/i,
  /^sounds good\b/i,
  /^absolutely\b/i,
  /^certainly\b/i,
  /^of course\b/i,
  /^no problem\b/i,
  /^noted\b/i,
  /^(?:perfect|great|excellent|wonderful|awesome|fantastic|amazing|brilliant|lovely|nice|cool|super|solid|splendid|acknowledged|terrific|fabulous|outstanding)(?:[,.!;:]|$)/i,
  /^(?:makes sense|good to know|fair enough|sure thing|(?:ok|okay))(?:[,.!;:]|$)/i,
  /^(?:good|very good|sounds great|all right|alright|roger)(?:[,.!;:]|$)/i,
  /^(?:thanks|thank you|that's (?:great|perfect|excellent|good)|appreciate it|received|copy that)(?:[,.!;:]|$)/i,
  /\bthanks for the update\b/i,
  /\bthank you for the update\b/i,
  /\bthanks for letting (?:me|us) know\b/i,
  /\bjust wanted to acknowledge\b/i,
  /\bi appreciate the update\b/i,
];
const NEGATION_PATTERN =
  /\b(?:not|never|no longer|cannot|can't|won't|will not|isn't|is not|unable to|neither|nor)\b/i;
const REFUTATION_PATTERN =
  /\b(?:false|wrong|incorrect|inaccurate|untrue|unverified|bogus|nonsense|misleading|reject(?:ed|s)?|dispute(?:d|s)?|refut(?:e|ed|es)|den(?:y|ied|ies)|doubt(?:ed|ful|s)?|questionable|contrary to|not confirmed|cannot confirm|can't confirm)\b/i;
const META_CLAIM_PATTERN =
  /\b(?:assertion|claim|claimed|claims|phrase|words?|statement|saying|report|reported|asked|question|whether)\b/i;
const UNCERTAINTY_PATTERN =
  /\b(?:maybe|might|may|could|possibly|perhaps|hopefully|supposedly|allegedly|unclear|unknown|uncertain|doubtful|questionable)\b/i;
const GREETING_PATTERN =
  /^(?:hi|hello|hey|dear|greetings|good (?:morning|afternoon|evening))\b/i;
const CLOSING_PATTERN =
  /(?:^|\n)(?:thanks|thank you|thanks again|thank you again|cheers|best|regards|sincerely|kind|warm|kind regards|warm regards|best regards|all the best|take care|yours|yours truly|yours sincerely)[,!]?[ \t]*(?:\n[\p{L}][\p{L} .'-]{0,60})?[ \t]*$/iu;
const WORD_CHARACTER_PATTERN = /[\p{L}\p{N}_]/u;

function isWhitespace(character: string): boolean {
  return character.length > 0 && safeTrim(character).length === 0;
}

function canonicalText(value: string, preserveNewlines = false): string {
  const input = safeLower(safeStringNormalize(value));
  let output = "";
  let pendingSpace = false;
  for (let index = 0; index < input.length; index += 1) {
    let character = input[index]!;
    if ((character === "a" || character === "p") && input[index + 1] === ".") {
      let cursor = index + 2;
      while (
        cursor < input.length &&
        input[cursor] !== "\n" &&
        input[cursor] !== "\r" &&
        isWhitespace(input[cursor]!)
      ) {
        cursor += 1;
      }
      if (input[cursor] === "m" && input[cursor + 1] === ".") {
        if (pendingSpace && output.length > 0) output += " ";
        output += `${character}m`;
        pendingSpace = false;
        index = cursor + 1;
        continue;
      }
    }
    if (character === "’" || character === "‘") character = "'";
    if (
      character === "“" ||
      character === "”" ||
      character === "„" ||
      character === "‟" ||
      character === "«" ||
      character === "»" ||
      character === "‹" ||
      character === "›"
    ) {
      character = '"';
    }
    if (character === "\n" || character === "\r") {
      if (
        preserveNewlines &&
        output.length > 0 &&
        output[output.length - 1] !== "\n"
      ) {
        output += "\n";
      } else if (!preserveNewlines) {
        pendingSpace = output.length > 0;
      }
      continue;
    }
    if (isWhitespace(character)) {
      pendingSpace = output.length > 0;
      continue;
    }
    if (
      pendingSpace &&
      output.length > 0 &&
      output[output.length - 1] !== "\n"
    ) {
      output += " ";
    }
    output += character;
    pendingSpace = false;
  }
  return safeTrim(output);
}

function normalized(value: string): string {
  return canonicalText(value, false);
}

function completeClauses(value: string): readonly string[] {
  const canonical = canonicalText(value, true);
  const clauses: string[] = [];
  let start = 0;
  for (let index = 0; index < canonical.length; index += 1) {
    const character = canonical[index];
    if (
      character !== "." &&
      character !== "!" &&
      character !== "?" &&
      character !== ";" &&
      character !== "\n"
    ) {
      continue;
    }

    let runEnd = index + 1;
    let isQuestion = character === "?";
    while (runEnd < canonical.length) {
      const runCharacter = canonical[runEnd];
      if (
        runCharacter !== "." &&
        runCharacter !== "!" &&
        runCharacter !== "?" &&
        runCharacter !== ";" &&
        runCharacter !== "\n"
      ) {
        break;
      }
      if (runCharacter === "?") isQuestion = true;
      runEnd += 1;
    }

    const clause = normalized(safeSlice(canonical, start, index));
    if (clause) {
      appendOwnArrayValue(clauses, isQuestion ? `${clause}?` : clause);
    } else if (
      isQuestion &&
      clauses.length > 0 &&
      clauses[clauses.length - 1]![clauses[clauses.length - 1]!.length - 1] !==
        "?"
    ) {
      clauses[clauses.length - 1] += "?";
    }
    start = runEnd;
    index = runEnd - 1;
  }
  const tail = normalized(safeSlice(canonical, start));
  if (tail) appendOwnArrayValue(clauses, tail);
  return SAFE_OBJECT_FREEZE(clauses);
}

function hasOpenQuote(prefix: string): boolean {
  let doubleQuoteOpen = false;
  let singleQuoteOpen = false;
  for (let index = 0; index < prefix.length; index += 1) {
    const character = prefix[index];
    if (character === '"') {
      doubleQuoteOpen = !doubleQuoteOpen;
      continue;
    }
    if (character !== "'") continue;
    const previous = prefix[index - 1] ?? " ";
    const next = prefix[index + 1] ?? " ";
    // Apostrophes inside contractions/names are not quotation delimiters.
    if (
      safeRegexTest(WORD_CHARACTER_PATTERN, previous) &&
      safeRegexTest(WORD_CHARACTER_PATTERN, next)
    ) {
      continue;
    }
    singleQuoteOpen = !singleQuoteOpen;
  }
  return doubleQuoteOpen || singleQuoteOpen;
}

function hasPhraseBoundaries(
  value: string,
  index: number,
  sought: string
): boolean {
  const isWord = (character: string | undefined): boolean =>
    Boolean(character && safeRegexTest(WORD_CHARACTER_PATTERN, character));
  const lastSoughtCharacter =
    sought.length > 0 ? sought[sought.length - 1] : "";
  return !(
    (isWord(sought[0]) && isWord(value[index - 1])) ||
    (isWord(lastSoughtCharacter) && isWord(value[index + sought.length]))
  );
}

function hasAffirmativeOccurrence(haystack: string, needle: string): boolean {
  const value = normalized(haystack);
  const sought = normalized(needle);
  if (!sought) return false;
  let offset = 0;
  while (offset <= value.length - sought.length) {
    const index = safeIndexOf(value, sought, offset);
    if (index < 0) return false;
    if (!hasPhraseBoundaries(value, index, sought)) {
      offset = index + (sought.length > 1 ? sought.length : 1);
      continue;
    }
    let clause = value;
    let occurrenceOffset = index;
    const clauses = completeClauses(value);
    for (let clauseIndex = 0; clauseIndex < clauses.length; clauseIndex += 1) {
      const candidateClause = clauses[clauseIndex]!;
      const localIndex = safeIndexOf(candidateClause, sought);
      if (
        localIndex >= 0 &&
        hasPhraseBoundaries(candidateClause, localIndex, sought)
      ) {
        clause = candidateClause;
        occurrenceOffset = localIndex;
        break;
      }
    }
    const prefix = safeSlice(
      clause,
      0,
      occurrenceOffset > 0 ? occurrenceOffset : 0
    );
    const quoted = hasOpenQuote(prefix);
    if (
      !safeRegexTest(NEGATION_PATTERN, clause) &&
      !safeRegexTest(REFUTATION_PATTERN, clause) &&
      !safeRegexTest(UNCERTAINTY_PATTERN, clause) &&
      !safeRegexTest(META_CLAIM_PATTERN, prefix) &&
      !quoted
    ) {
      return true;
    }
    offset = index + (sought.length > 1 ? sought.length : 1);
  }
  return false;
}

function containsAllAffirmatively(
  haystack: string,
  needles: readonly string[]
): boolean {
  for (let index = 0; index < needles.length; index += 1) {
    if (!hasAffirmativeOccurrence(haystack, needles[index]!)) return false;
  }
  return true;
}

function containsNone(haystack: string, needles: readonly string[]): boolean {
  const value = normalized(haystack);
  for (let index = 0; index < needles.length; index += 1) {
    if (safeIndexOf(value, normalized(needles[index]!)) >= 0) return false;
  }
  return true;
}

interface CompiledLeadReplyClaim extends LeadReplyExpectedClaim {
  readonly acceptedPhrases: readonly string[];
  readonly rejectedPhrases: readonly string[];
  readonly evidenceIds: readonly string[];
}

interface CompiledAllowedClause extends LeadReplyAllowedClause {
  readonly phrases: readonly string[];
  readonly evidenceIds: readonly string[];
}

export interface CompiledLeadReplyFixtureMechanics {
  readonly fixtureId: string;
  readonly expectedDisposition: LeadReplyDisposition;
  readonly expectedResponseMode: LeadReplyResponseMode;
  readonly expectedRecipientEmail: string | null;
  readonly isFirstOperatorReply: boolean;
  readonly maxWords: number;
  readonly maxContextCharacters: number;
  readonly expectedClaims: readonly CompiledLeadReplyClaim[];
  readonly forbiddenPhrases: readonly (readonly string[])[];
  readonly requiredDecisionEvidenceIds: readonly string[];
  readonly allowedClauses: readonly CompiledAllowedClause[];
  readonly sourceEvidenceIds: readonly string[];
  readonly controlContextCharacters: number;
  readonly sharedContextCharacters: number;
}

function frozenStrings(
  values: readonly string[],
  normalize = false
): readonly string[] {
  const result: string[] = [];
  for (let index = 0; index < values.length; index += 1) {
    appendOwnArrayValue(
      result,
      normalize ? normalized(values[index]!) : values[index]!
    );
  }
  return SAFE_OBJECT_FREEZE(result);
}

export function compileLeadReplyFixtureMechanics(
  fixture: LeadReplyEvalFixture
): CompiledLeadReplyFixtureMechanics {
  const expectedClaims: CompiledLeadReplyClaim[] = [];
  for (let index = 0; index < fixture.expectedClaims.length; index += 1) {
    const claim = fixture.expectedClaims[index]!;
    appendOwnArrayValue(
      expectedClaims,
      SAFE_OBJECT_FREEZE({
        id: claim.id,
        dimension: claim.dimension,
        acceptedPhrases: frozenStrings(claim.acceptedPhrases),
        rejectedPhrases: frozenStrings(claim.rejectedPhrases),
        evidenceIds: frozenStrings(claim.evidenceIds),
      })
    );
  }
  const forbiddenPhrases: (readonly string[])[] = [];
  for (let index = 0; index < fixture.forbiddenClaims.length; index += 1) {
    appendOwnArrayValue(
      forbiddenPhrases,
      frozenStrings(fixture.forbiddenClaims[index]!.phrases)
    );
  }
  const allowedClauses: CompiledAllowedClause[] = [];
  for (let index = 0; index < fixture.allowedClauses.length; index += 1) {
    const permission = fixture.allowedClauses[index]!;
    const phrases: string[] = [];
    for (
      let phraseIndex = 0;
      phraseIndex < permission.phrases.length;
      phraseIndex += 1
    ) {
      const clauses = completeClauses(permission.phrases[phraseIndex]!);
      if (clauses.length !== 1) {
        throw new TypeError("LEAD_REPLY_EVAL_ALLOWED_CLAUSE_INVALID");
      }
      appendOwnArrayValue(phrases, clauses[0]!);
    }
    appendOwnArrayValue(
      allowedClauses,
      SAFE_OBJECT_FREEZE({
        id: permission.id,
        kind: permission.kind,
        phrases: SAFE_OBJECT_FREEZE(phrases),
        evidenceIds: frozenStrings(permission.evidenceIds),
      })
    );
  }
  const sourceEvidenceIds: string[] = [];
  for (
    let turnIndex = 0;
    turnIndex < fixture.conversation.turns.length;
    turnIndex += 1
  ) {
    const turn = fixture.conversation.turns[turnIndex]!;
    appendOwnArrayValue(sourceEvidenceIds, turn.id);
    for (
      let attachmentIndex = 0;
      attachmentIndex < turn.attachmentIds.length;
      attachmentIndex += 1
    ) {
      appendOwnArrayValue(
        sourceEvidenceIds,
        turn.attachmentIds[attachmentIndex]!
      );
    }
  }
  if (fixture.verifiedSchedule) {
    appendOwnArrayValue(sourceEvidenceIds, fixture.verifiedSchedule.evidenceId);
  }
  return SAFE_OBJECT_FREEZE({
    fixtureId: fixture.id,
    expectedDisposition: fixture.expectedDisposition,
    expectedResponseMode: fixture.expectedResponseMode,
    expectedRecipientEmail:
      fixture.expectedRecipientEmail === null
        ? null
        : normalized(fixture.expectedRecipientEmail),
    isFirstOperatorReply: fixture.isFirstOperatorReply,
    maxWords: fixture.maxWords,
    maxContextCharacters: fixture.maxContextCharacters,
    expectedClaims: SAFE_OBJECT_FREEZE(expectedClaims),
    forbiddenPhrases: SAFE_OBJECT_FREEZE(forbiddenPhrases),
    requiredDecisionEvidenceIds: frozenStrings(
      fixture.requiredDecisionEvidenceIds
    ),
    allowedClauses: SAFE_OBJECT_FREEZE(allowedClauses),
    sourceEvidenceIds: SAFE_OBJECT_FREEZE(sourceEvidenceIds),
    controlContextCharacters: fixture.controlContext.rendered.length,
    sharedContextCharacters: fixture.sharedContext.rendered.length,
  });
}

function claimSatisfied(draft: string, claim: CompiledLeadReplyClaim): boolean {
  return (
    containsAllAffirmatively(draft, claim.acceptedPhrases) &&
    containsNone(draft, claim.rejectedPhrases)
  );
}

function claimsSatisfied(
  compiled: CompiledLeadReplyFixtureMechanics,
  draft: string,
  dimension: LeadReplyExpectedClaim["dimension"]
): boolean {
  for (let index = 0; index < compiled.expectedClaims.length; index += 1) {
    const claim = compiled.expectedClaims[index]!;
    if (claim.dimension === dimension && !claimSatisfied(draft, claim)) {
      return false;
    }
  }
  return true;
}

function stringListHas(values: readonly string[], sought: string): boolean {
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === sought) return true;
  }
  return false;
}

function evidenceCovered(
  evidenceIds: readonly string[],
  context: LeadReplyEvalContext,
  sourceEvidenceIds: readonly string[]
): boolean {
  for (let index = 0; index < evidenceIds.length; index += 1) {
    const evidenceId = evidenceIds[index]!;
    if (
      !stringListHas(context.evidenceIds, evidenceId) ||
      !stringListHas(sourceEvidenceIds, evidenceId)
    ) {
      return false;
    }
  }
  return true;
}

function provenanceCovered(
  compiled: CompiledLeadReplyFixtureMechanics,
  context: LeadReplyEvalContext
): boolean {
  if (
    !evidenceCovered(
      compiled.requiredDecisionEvidenceIds,
      context,
      compiled.sourceEvidenceIds
    )
  ) {
    return false;
  }
  for (let index = 0; index < compiled.expectedClaims.length; index += 1) {
    if (
      !evidenceCovered(
        compiled.expectedClaims[index]!.evidenceIds,
        context,
        compiled.sourceEvidenceIds
      )
    ) {
      return false;
    }
  }
  return true;
}

function completeClausePermissionsSatisfied(
  compiled: CompiledLeadReplyFixtureMechanics,
  draft: string,
  context: LeadReplyEvalContext
): boolean {
  const clauses = completeClauses(draft);
  if (clauses.length === 0) return false;
  const used: string[] = [];
  for (let clauseIndex = 0; clauseIndex < clauses.length; clauseIndex += 1) {
    const clause = clauses[clauseIndex]!;
    if (stringListHas(used, clause)) return false;
    let permitted = false;
    for (
      let permissionIndex = 0;
      permissionIndex < compiled.allowedClauses.length;
      permissionIndex += 1
    ) {
      const permission = compiled.allowedClauses[permissionIndex]!;
      if (!stringListHas(permission.phrases, clause)) continue;
      if (
        permission.kind === "first_reply_greeting" &&
        !compiled.isFirstOperatorReply
      ) {
        continue;
      }
      if (
        permission.kind === "evidence_backed" &&
        !evidenceCovered(
          permission.evidenceIds,
          context,
          compiled.sourceEvidenceIds
        )
      ) {
        continue;
      }
      permitted = true;
      break;
    }
    if (!permitted) return false;
    appendOwnArrayValue(used, clause);
  }
  return true;
}

function validMetric(value: number): boolean {
  return (
    typeof value === "number" &&
    value === value &&
    value >= 0 &&
    value !== Infinity
  );
}

function wordCount(value: string): number {
  const canonical = normalized(value);
  if (!canonical) return 0;
  let count = 0;
  let insideWord = false;
  for (let index = 0; index < canonical.length; index += 1) {
    if (isWhitespace(canonical[index]!)) {
      insideWord = false;
    } else if (!insideWord) {
      count += 1;
      insideWord = true;
    }
  }
  return count;
}

function dispositionSafe(
  compiled: CompiledLeadReplyFixtureMechanics,
  candidate: LeadReplyCandidate
): boolean {
  if (candidate.disposition !== compiled.expectedDisposition) return false;
  return compiled.expectedDisposition === "reply"
    ? safeTrim(candidate.draft).length > 0
    : safeTrim(candidate.draft).length === 0;
}

export function evaluateLeadReplyCandidate(
  fixture: LeadReplyEvalFixture,
  candidate: LeadReplyCandidate,
  context: LeadReplyEvalContext = fixture.sharedContext,
  precompiled?: CompiledLeadReplyFixtureMechanics
): LeadReplyQualityResult {
  const compiled = precompiled ?? compileLeadReplyFixtureMechanics(fixture);
  const shouldWrite = compiled.expectedDisposition === "reply";
  const clausePermissionsSatisfied =
    !shouldWrite ||
    completeClausePermissionsSatisfied(compiled, candidate.draft, context);
  const releaseCritical = SAFE_OBJECT_FREEZE({
    dispositionSafe: dispositionSafe(compiled, candidate),
    responseModeSafe: candidate.responseMode === compiled.expectedResponseMode,
    factualCorrectness:
      !shouldWrite ||
      (clausePermissionsSatisfied &&
        claimsSatisfied(compiled, candidate.draft, "fact")),
    recipientIdentity:
      compiled.expectedRecipientEmail === null
        ? candidate.recipientEmail === null
        : normalized(candidate.recipientEmail ?? "") ===
          compiled.expectedRecipientEmail,
    scheduleAccuracy:
      !shouldWrite ||
      (clausePermissionsSatisfied &&
        claimsSatisfied(compiled, candidate.draft, "schedule")),
    commitmentContinuity:
      !shouldWrite ||
      (clausePermissionsSatisfied &&
        claimsSatisfied(compiled, candidate.draft, "commitment")),
    evidenceCoverage: provenanceCovered(compiled, context),
    hallucinationFree:
      !shouldWrite ||
      (clausePermissionsSatisfied &&
        (() => {
          for (
            let index = 0;
            index < compiled.forbiddenPhrases.length;
            index += 1
          ) {
            if (
              !containsNone(candidate.draft, compiled.forbiddenPhrases[index]!)
            ) {
              return false;
            }
          }
          return true;
        })()),
  });
  let hasCannedAcknowledgement = false;
  for (
    let index = 0;
    index < CANNED_ACKNOWLEDGEMENT_PATTERNS.length;
    index += 1
  ) {
    if (
      safeRegexTest(CANNED_ACKNOWLEDGEMENT_PATTERNS[index]!, candidate.draft)
    ) {
      hasCannedAcknowledgement = true;
      break;
    }
  }
  const trimmedDraft = safeTrim(candidate.draft);
  const hasForcedGreetingOrClosing =
    !compiled.isFirstOperatorReply &&
    (safeRegexTest(GREETING_PATTERN, trimmedDraft) ||
      safeRegexTest(CLOSING_PATTERN, trimmedDraft));
  const style = SAFE_OBJECT_FREEZE({
    concise: !shouldWrite || wordCount(candidate.draft) <= compiled.maxWords,
    noCannedAcknowledgement: !hasCannedAcknowledgement,
    noForcedGreetingOrClosing: !hasForcedGreetingOrClosing,
  });
  const efficiency = SAFE_OBJECT_FREEZE({
    contextBounded: context.rendered.length <= compiled.maxContextCharacters,
  });
  const telemetry = SAFE_OBJECT_FREEZE({
    contextCharacters: context.rendered.length,
    latencyMilliseconds: candidate.latencyMilliseconds,
  });
  const passed =
    releaseCritical.dispositionSafe &&
    releaseCritical.responseModeSafe &&
    releaseCritical.factualCorrectness &&
    releaseCritical.recipientIdentity &&
    releaseCritical.scheduleAccuracy &&
    releaseCritical.commitmentContinuity &&
    releaseCritical.evidenceCoverage &&
    releaseCritical.hallucinationFree &&
    style.concise &&
    style.noCannedAcknowledgement &&
    style.noForcedGreetingOrClosing &&
    efficiency.contextBounded &&
    validMetric(candidate.latencyMilliseconds);
  return SAFE_OBJECT_FREEZE({
    fixtureId: compiled.fixtureId,
    releaseCritical,
    style,
    efficiency,
    telemetry,
    passed,
  });
}

export function compareLeadReplyCandidates(
  fixture: LeadReplyEvalFixture,
  controlCandidate: LeadReplyCandidate,
  sharedCandidate: LeadReplyCandidate,
  precompiled?: CompiledLeadReplyFixtureMechanics
): LeadReplyComparison {
  const compiled = precompiled ?? compileLeadReplyFixtureMechanics(fixture);
  const control = evaluateLeadReplyCandidate(
    fixture,
    controlCandidate,
    fixture.controlContext,
    compiled
  );
  const shared = evaluateLeadReplyCandidate(
    fixture,
    sharedCandidate,
    fixture.sharedContext,
    compiled
  );
  const sharedHasNoCriticalRegression =
    (!control.releaseCritical.dispositionSafe ||
      shared.releaseCritical.dispositionSafe) &&
    (!control.releaseCritical.responseModeSafe ||
      shared.releaseCritical.responseModeSafe) &&
    (!control.releaseCritical.factualCorrectness ||
      shared.releaseCritical.factualCorrectness) &&
    (!control.releaseCritical.recipientIdentity ||
      shared.releaseCritical.recipientIdentity) &&
    (!control.releaseCritical.scheduleAccuracy ||
      shared.releaseCritical.scheduleAccuracy) &&
    (!control.releaseCritical.commitmentContinuity ||
      shared.releaseCritical.commitmentContinuity) &&
    (!control.releaseCritical.evidenceCoverage ||
      shared.releaseCritical.evidenceCoverage) &&
    (!control.releaseCritical.hallucinationFree ||
      shared.releaseCritical.hallucinationFree);
  const contextCharacterReduction =
    compiled.controlContextCharacters - compiled.sharedContextCharacters;
  return SAFE_OBJECT_FREEZE({
    control,
    shared,
    sharedHasNoCriticalRegression,
    contextCharacterReduction,
    latencyDeltaMilliseconds:
      sharedCandidate.latencyMilliseconds -
      controlCandidate.latencyMilliseconds,
    candidateChecksPassed: shared.passed && sharedHasNoCriticalRegression,
  });
}

function openingKey(draft: string): string {
  const value = normalized(draft);
  const words: string[] = [];
  let current = "";
  for (let index = 0; index <= value.length && words.length < 4; index += 1) {
    const character = value[index] ?? " ";
    const isOpeningCharacter =
      (character >= "a" && character <= "z") ||
      (character >= "0" && character <= "9") ||
      character === "'";
    if (isOpeningCharacter) {
      current += character;
    } else if (current) {
      appendOwnArrayValue(words, current);
      current = "";
    }
  }
  let key = "";
  for (let index = 0; index < words.length; index += 1) {
    key += `${index === 0 ? "" : " "}${words[index]!}`;
  }
  return key;
}

export function evaluateLeadReplySuiteVariation(
  values: readonly (LeadReplyCandidate | LeadReplyVariationSample)[]
): LeadReplySuiteVariation {
  interface Sample {
    readonly candidate: LeadReplyCandidate;
    readonly responseMode: LeadReplyResponseMode;
    readonly sequenceId: string;
    readonly sequencePosition: number;
    readonly repeatedOpeningJustification?: string;
  }
  const replies: Sample[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]!;
    const sample: Sample =
      "candidate" in value
        ? {
            candidate: value.candidate,
            responseMode: value.responseMode,
            sequenceId: value.sequenceId ?? "default-sequence",
            sequencePosition: value.sequencePosition ?? index,
            ...(value.repeatedOpeningJustification === undefined
              ? {}
              : {
                  repeatedOpeningJustification:
                    value.repeatedOpeningJustification,
                }),
          }
        : {
            candidate: value,
            responseMode: value.responseMode,
            sequenceId: "default-sequence",
            sequencePosition: index,
          };
    if (
      sample.candidate.disposition === "reply" &&
      safeTrim(sample.candidate.draft)
    ) {
      appendOwnArrayValue(replies, sample);
    }
  }
  for (let index = 1; index < replies.length; index += 1) {
    const current = replies[index]!;
    let cursor = index - 1;
    while (
      cursor >= 0 &&
      (replies[cursor]!.sequenceId > current.sequenceId ||
        (replies[cursor]!.sequenceId === current.sequenceId &&
          replies[cursor]!.sequencePosition > current.sequencePosition))
    ) {
      replies[cursor + 1] = replies[cursor]!;
      cursor -= 1;
    }
    replies[cursor + 1] = current;
  }
  const openingStats: Array<{
    key: string;
    count: number;
    modes: LeadReplyResponseMode[];
  }> = [];
  const sequenceStats: Array<{ key: string; count: number }> = [];
  let unjustifiedRepeatedOpeningCount = 0;
  for (let index = 0; index < replies.length; index += 1) {
    const {
      candidate,
      responseMode,
      sequenceId,
      repeatedOpeningJustification,
    } = replies[index]!;
    const key = openingKey(candidate.draft);
    if (key) {
      let openingStat: (typeof openingStats)[number] | undefined;
      for (let statIndex = 0; statIndex < openingStats.length; statIndex += 1) {
        if (openingStats[statIndex]!.key === key) {
          openingStat = openingStats[statIndex]!;
          break;
        }
      }
      if (!openingStat) {
        openingStat = { key, count: 0, modes: [] };
        appendOwnArrayValue(openingStats, openingStat);
      }
      openingStat.count += 1;
      if (!stringListHas(openingStat.modes, responseMode)) {
        appendOwnArrayValue(openingStat.modes, responseMode);
      }
      const sequenceOpeningKey = `${sequenceId}\u0000${key}`;
      let sequenceStat: { key: string; count: number } | undefined;
      for (
        let statIndex = 0;
        statIndex < sequenceStats.length;
        statIndex += 1
      ) {
        if (sequenceStats[statIndex]!.key === sequenceOpeningKey) {
          sequenceStat = sequenceStats[statIndex]!;
          break;
        }
      }
      if (!sequenceStat) {
        sequenceStat = { key: sequenceOpeningKey, count: 0 };
        appendOwnArrayValue(sequenceStats, sequenceStat);
      }
      const priorSequenceCount = sequenceStat.count;
      if (
        priorSequenceCount > 0 &&
        (typeof repeatedOpeningJustification !== "string" ||
          safeTrim(repeatedOpeningJustification).length < 12)
      ) {
        unjustifiedRepeatedOpeningCount += 1;
      }
      sequenceStat.count = priorSequenceCount + 1;
    }
  }
  let repeatedOpeningCount = 0;
  for (let index = 0; index < sequenceStats.length; index += 1) {
    if (sequenceStats[index]!.count > 1) {
      repeatedOpeningCount += sequenceStats[index]!.count - 1;
    }
  }
  let cannedOpeningCount = 0;
  for (let replyIndex = 0; replyIndex < replies.length; replyIndex += 1) {
    const draft = safeTrim(replies[replyIndex]!.candidate.draft);
    for (
      let patternIndex = 0;
      patternIndex < CANNED_ACKNOWLEDGEMENT_PATTERNS.length;
      patternIndex += 1
    ) {
      if (
        safeRegexTest(CANNED_ACKNOWLEDGEMENT_PATTERNS[patternIndex]!, draft)
      ) {
        cannedOpeningCount += 1;
        break;
      }
    }
  }
  let crossModeRepeatedOpeningCount = 0;
  for (let index = 0; index < openingStats.length; index += 1) {
    const stat = openingStats[index]!;
    if (stat.modes.length > 1 && stat.count > 1) {
      crossModeRepeatedOpeningCount += stat.count - 1;
    }
  }
  return SAFE_OBJECT_FREEZE({
    replyCount: replies.length,
    repeatedOpeningCount,
    unjustifiedRepeatedOpeningCount,
    crossModeRepeatedOpeningCount,
    cannedOpeningCount,
    hasProperVariation:
      unjustifiedRepeatedOpeningCount === 0 && cannedOpeningCount === 0,
  });
}
