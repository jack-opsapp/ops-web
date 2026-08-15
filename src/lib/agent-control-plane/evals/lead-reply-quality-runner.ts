import { types as nodeTypes } from "node:util";

import {
  compileLeadReplyFixtureMechanics,
  compareLeadReplyCandidates,
  evaluateLeadReplySuiteVariation,
  type CompiledLeadReplyFixtureMechanics,
  type LeadReplyAllowedClause,
  type LeadReplyCandidate,
  type LeadReplyComparison,
  type LeadReplyDisposition,
  type LeadReplyEvalContext,
  type LeadReplyEvalConversation,
  type LeadReplyEvalFixture,
  type LeadReplyEvalParticipant,
  type LeadReplyEvalTurn,
  type LeadReplyVerifiedSchedule,
  type LeadReplyExpectedClaim,
  type LeadReplyForbiddenClaim,
  type LeadReplyResponseMode,
  type LeadReplySuiteVariation,
} from "./lead-reply-quality";

export interface LeadReplyCandidatePathInput {
  readonly conversation: LeadReplyEvalConversation;
  readonly context: LeadReplyEvalContext;
  readonly verifiedSchedule: LeadReplyVerifiedSchedule | null;
}

export interface LeadReplyCandidatePathOutput {
  readonly disposition: LeadReplyDisposition;
  readonly responseMode: LeadReplyResponseMode;
  readonly draft: string;
  readonly recipientEmail: string | null;
}

export interface LeadReplyCandidatePath {
  run(
    input: LeadReplyCandidatePathInput
  ): Promise<LeadReplyCandidatePathOutput>;
}

export interface LeadReplyFixtureRunResult {
  readonly fixtureId: string;
  readonly controlCandidate: LeadReplyCandidate;
  readonly sharedCandidate: LeadReplyCandidate;
  readonly comparison: LeadReplyComparison;
}

export interface LeadReplyQualitySuiteResult {
  readonly fixtureResults: readonly LeadReplyFixtureRunResult[];
  readonly sharedVariation: LeadReplySuiteVariation;
  readonly totalContextCharacterReduction: number;
  /** Mechanics evidence only. This is never production model-quality proof. */
  readonly qualityChecksPassed: boolean;
  /** No trusted measured-model adapter exists at this offline boundary. */
  readonly releaseGatePassed: false;
}

export interface RunLeadReplyQualitySuiteInput {
  readonly fixtures: readonly LeadReplyEvalFixture[];
  readonly controlPath: LeadReplyCandidatePath;
  readonly sharedPath: LeadReplyCandidatePath;
  readonly clock?: () => number;
}

interface SuiteInputSnapshot {
  readonly fixtures: readonly LeadReplyEvalFixture[];
  readonly compiledFixtures: readonly CompiledLeadReplyFixtureMechanics[];
  readonly controlRun: LeadReplyCandidatePath["run"];
  readonly sharedRun: LeadReplyCandidatePath["run"];
  readonly clock: () => number;
}

const SAFE_OBJECT_FREEZE = Object.freeze;
const SAFE_OBJECT_CREATE = Object.create;
const SAFE_OBJECT_DEFINE_PROPERTY = Object.defineProperty;
const SAFE_OBJECT_IS = Object.is;
const SAFE_OBJECT_PROTOTYPE = Object.prototype;
const SAFE_ARRAY_PROTOTYPE = Array.prototype;
const SAFE_OBJECT_GET_PROTOTYPE_OF = Object.getPrototypeOf;
const SAFE_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR = Object.getOwnPropertyDescriptor;
const SAFE_OBJECT_GET_OWN_PROPERTY_DESCRIPTORS =
  Object.getOwnPropertyDescriptors;
const SAFE_OBJECT_HAS_OWN = Object.hasOwn;
const SAFE_REFLECT_OWN_KEYS = Reflect.ownKeys;
const SAFE_ARRAY_IS_ARRAY = Array.isArray;
const SAFE_ARRAY_EVERY = Array.prototype.every;
const SAFE_ARRAY_PUSH = Array.prototype.push;
const SAFE_NUMBER_IS_SAFE_INTEGER = Number.isSafeInteger;
const SAFE_NUMBER_IS_FINITE = Number.isFinite;
const SAFE_MATH_MAX = Math.max;
const SAFE_MATH_ROUND = Math.round;
const SAFE_REFLECT_APPLY = Reflect.apply;
const SAFE_SET_HAS = Set.prototype.has;
const SAFE_REGEXP_TEST = RegExp.prototype.test;
const SAFE_REGEXP_EXEC = RegExp.prototype.exec;
const SAFE_STRING = String;
const SAFE_STRING_TRIM = String.prototype.trim;
const SAFE_STRING_NORMALIZE = String.prototype.normalize;
const SAFE_IS_PROXY = nodeTypes.isProxy;

interface IntrinsicDescriptorSnapshot {
  readonly owner: object;
  readonly descriptors: PropertyDescriptorMap;
  readonly keys: readonly PropertyKey[];
}

function sameDescriptor(
  current: PropertyDescriptor | undefined,
  captured: PropertyDescriptor | undefined
): boolean {
  if (current === undefined || captured === undefined) {
    return current === captured;
  }
  return (
    current.configurable === captured.configurable &&
    current.enumerable === captured.enumerable &&
    current.get === captured.get &&
    current.set === captured.set &&
    SAFE_OBJECT_IS(current.value, captured.value) &&
    current.writable === captured.writable
  );
}

function captureIntrinsicDescriptors(
  owner: object
): IntrinsicDescriptorSnapshot {
  const descriptors = SAFE_OBJECT_GET_OWN_PROPERTY_DESCRIPTORS(owner);
  return SAFE_OBJECT_FREEZE({
    owner,
    descriptors: SAFE_OBJECT_FREEZE(descriptors),
    keys: SAFE_OBJECT_FREEZE(SAFE_REFLECT_OWN_KEYS(descriptors)),
  });
}

const INTRINSIC_DESCRIPTOR_OWNERS = SAFE_OBJECT_FREEZE([
  Object,
  Object.prototype,
  Array,
  Array.prototype,
  Number,
  Math,
  Reflect,
  Set,
  Set.prototype,
  RegExp,
  RegExp.prototype,
  String,
  String.prototype,
]);

function captureIntrinsicDescriptorSnapshots(): readonly IntrinsicDescriptorSnapshot[] {
  const snapshots: IntrinsicDescriptorSnapshot[] = [];
  for (let index = 0; index < INTRINSIC_DESCRIPTOR_OWNERS.length; index += 1) {
    appendOwnArrayValue(
      snapshots,
      captureIntrinsicDescriptors(INTRINSIC_DESCRIPTOR_OWNERS[index]!)
    );
  }
  return SAFE_OBJECT_FREEZE(snapshots);
}

function isCanonicalArrayIndexKey(key: PropertyKey): boolean {
  if (typeof key !== "string" || key === "") return false;
  let numericValue = 0;
  for (let index = 0; index < key.length; index += 1) {
    const character = key[index]!;
    if (character < "0" || character > "9") return false;
    if (index === 0 && character === "0" && key.length > 1) return false;
    numericValue =
      numericValue * 10 +
      (character === "0"
        ? 0
        : character === "1"
          ? 1
          : character === "2"
            ? 2
            : character === "3"
              ? 3
              : character === "4"
                ? 4
                : character === "5"
                  ? 5
                  : character === "6"
                    ? 6
                    : character === "7"
                      ? 7
                      : character === "8"
                        ? 8
                        : 9);
    if (numericValue > 4_294_967_294) return false;
  }
  return true;
}

function arrayPrototypeHasNumericOwnKey(): boolean {
  const keys = SAFE_REFLECT_OWN_KEYS(
    SAFE_OBJECT_GET_OWN_PROPERTY_DESCRIPTORS(SAFE_ARRAY_PROTOTYPE)
  );
  for (let index = 0; index < keys.length; index += 1) {
    if (isCanonicalArrayIndexKey(keys[index]!)) return true;
  }
  return false;
}

function intrinsicDescriptorsUnchanged(
  snapshot: IntrinsicDescriptorSnapshot
): boolean {
  const current = SAFE_OBJECT_GET_OWN_PROPERTY_DESCRIPTORS(snapshot.owner);
  const currentKeys = SAFE_REFLECT_OWN_KEYS(current);
  if (currentKeys.length !== snapshot.keys.length) return false;
  for (let index = 0; index < snapshot.keys.length; index += 1) {
    const key = snapshot.keys[index]!;
    if (
      !SAFE_OBJECT_HAS_OWN(current, key) ||
      !sameDescriptor(
        current[key as keyof typeof current],
        snapshot.descriptors[key]
      )
    ) {
      return false;
    }
  }
  return true;
}

function assertEvalIntrinsicsUnchanged(
  descriptorSnapshots?: readonly IntrinsicDescriptorSnapshot[]
): void {
  if (
    Object.freeze !== SAFE_OBJECT_FREEZE ||
    Object.create !== SAFE_OBJECT_CREATE ||
    Object.defineProperty !== SAFE_OBJECT_DEFINE_PROPERTY ||
    Object.is !== SAFE_OBJECT_IS ||
    Object.getPrototypeOf !== SAFE_OBJECT_GET_PROTOTYPE_OF ||
    Object.getOwnPropertyDescriptor !==
      SAFE_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR ||
    Object.getOwnPropertyDescriptors !==
      SAFE_OBJECT_GET_OWN_PROPERTY_DESCRIPTORS ||
    Object.hasOwn !== SAFE_OBJECT_HAS_OWN ||
    Reflect.ownKeys !== SAFE_REFLECT_OWN_KEYS ||
    Reflect.apply !== SAFE_REFLECT_APPLY ||
    Array.isArray !== SAFE_ARRAY_IS_ARRAY ||
    Array.prototype.every !== SAFE_ARRAY_EVERY ||
    Array.prototype.push !== SAFE_ARRAY_PUSH ||
    Number.isSafeInteger !== SAFE_NUMBER_IS_SAFE_INTEGER ||
    Number.isFinite !== SAFE_NUMBER_IS_FINITE ||
    Math.max !== SAFE_MATH_MAX ||
    Math.round !== SAFE_MATH_ROUND ||
    Set.prototype.has !== SAFE_SET_HAS ||
    RegExp.prototype.test !== SAFE_REGEXP_TEST ||
    RegExp.prototype.exec !== SAFE_REGEXP_EXEC ||
    String !== SAFE_STRING ||
    String.prototype.trim !== SAFE_STRING_TRIM ||
    String.prototype.normalize !== SAFE_STRING_NORMALIZE ||
    arrayPrototypeHasNumericOwnKey()
  ) {
    throw new TypeError("LEAD_REPLY_EVAL_INTRINSICS_MUTATED");
  }
  if (!descriptorSnapshots) return;
  for (let index = 0; index < descriptorSnapshots.length; index += 1) {
    if (!intrinsicDescriptorsUnchanged(descriptorSnapshots[index]!)) {
      throw new TypeError("LEAD_REPLY_EVAL_INTRINSICS_MUTATED");
    }
  }
}

function appendOwnArrayValue<T>(values: T[], value: T): void {
  SAFE_OBJECT_DEFINE_PROPERTY(values, SAFE_STRING(values.length), {
    configurable: true,
    enumerable: true,
    writable: true,
    value,
  });
}

function safeSetHas<T>(values: ReadonlySet<T>, value: T): boolean {
  return SAFE_REFLECT_APPLY(SAFE_SET_HAS, values, [value]) as boolean;
}

const DISPOSITIONS = new Set<LeadReplyDisposition>([
  "reply",
  "no_reply_required",
  "operator_input_required",
]);
const RESPONSE_MODES = new Set<LeadReplyResponseMode>([
  "first_reply",
  "direct_answer",
  "schedule",
  "attachment",
  "no_reply",
  "operator_input",
]);
const CLAIM_DIMENSIONS = new Set<LeadReplyExpectedClaim["dimension"]>([
  "fact",
  "schedule",
  "commitment",
]);
const ALLOWED_CLAUSE_KINDS = new Set<LeadReplyAllowedClause["kind"]>([
  "evidence_backed",
  "neutral_question",
  "first_reply_greeting",
]);
const CONTEXT_KINDS = new Set<LeadReplyEvalContext["kind"]>([
  "whole_history_control",
  "shared_job_memory",
]);
const PARTICIPANT_SIDES = new Set<LeadReplyEvalParticipant["side"]>([
  "user",
  "assistant",
]);
const IDENTITY_STATUSES = new Set<LeadReplyEvalParticipant["identityStatus"]>([
  "resolved",
  "unresolved",
]);
const MAX_EVAL_ARRAY_ITEMS = 10_000;

type ExactValues = Readonly<Record<string, unknown>>;

function exactObjectValues(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = []
): ExactValues | null {
  if (typeof value !== "object" || value === null || SAFE_IS_PROXY(value)) {
    return null;
  }
  try {
    if (SAFE_ARRAY_IS_ARRAY(value)) return null;
    const prototype = SAFE_OBJECT_GET_PROTOTYPE_OF(value);
    if (prototype !== SAFE_OBJECT_PROTOTYPE && prototype !== null) return null;
    const descriptors = SAFE_OBJECT_GET_OWN_PROPERTY_DESCRIPTORS(value);
    const keys = SAFE_REFLECT_OWN_KEYS(descriptors);
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      if (typeof key !== "string") return null;
      let allowed = false;
      for (
        let requiredIndex = 0;
        requiredIndex < requiredKeys.length;
        requiredIndex += 1
      ) {
        if (requiredKeys[requiredIndex] === key) {
          allowed = true;
          break;
        }
      }
      for (
        let optionalIndex = 0;
        !allowed && optionalIndex < optionalKeys.length;
        optionalIndex += 1
      ) {
        if (optionalKeys[optionalIndex] === key) allowed = true;
      }
      if (!allowed) return null;
    }
    for (let index = 0; index < requiredKeys.length; index += 1) {
      if (!SAFE_OBJECT_HAS_OWN(descriptors, requiredKeys[index]!)) return null;
    }
    const values = SAFE_OBJECT_CREATE(null) as Record<string, unknown>;
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index]!;
      if (typeof key !== "string") return null;
      const descriptor = descriptors[key];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        return null;
      }
      values[key] = descriptor.value;
    }
    return SAFE_OBJECT_FREEZE(values);
  } catch {
    return null;
  }
}

function exactArrayValues(value: unknown): readonly unknown[] | null {
  if (SAFE_IS_PROXY(value) || !SAFE_ARRAY_IS_ARRAY(value)) return null;
  try {
    if (SAFE_OBJECT_GET_PROTOTYPE_OF(value) !== SAFE_ARRAY_PROTOTYPE)
      return null;
    const descriptors = SAFE_OBJECT_GET_OWN_PROPERTY_DESCRIPTORS(value);
    const descriptorRecord = descriptors as unknown as Record<
      PropertyKey,
      PropertyDescriptor | undefined
    >;
    const lengthDescriptor = descriptorRecord.length;
    if (
      !lengthDescriptor ||
      !("value" in lengthDescriptor) ||
      lengthDescriptor.enumerable ||
      !SAFE_NUMBER_IS_SAFE_INTEGER(lengthDescriptor.value) ||
      (lengthDescriptor.value as number) < 0 ||
      (lengthDescriptor.value as number) > MAX_EVAL_ARRAY_ITEMS
    ) {
      return null;
    }
    const length = lengthDescriptor.value as number;
    const allowedKeys = new Set<string>([
      "length",
      ...Array.from({ length }, (_, index) => String(index)),
    ]);
    const keys = SAFE_REFLECT_OWN_KEYS(descriptors);
    if (
      keys.length !== length + 1 ||
      keys.some((key) => typeof key !== "string" || !allowedKeys.has(key))
    ) {
      return null;
    }
    const result: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptorRecord[String(index)];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        return null;
      }
      result.push(descriptor.value);
    }
    return SAFE_OBJECT_FREEZE(result);
  } catch {
    return null;
  }
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function snapshotStringArray(value: unknown): readonly string[] | null {
  const items = exactArrayValues(value);
  if (!items || items.some((item) => typeof item !== "string")) return null;
  return SAFE_OBJECT_FREEZE([...items] as string[]);
}

function snapshotParticipant(value: unknown): LeadReplyEvalParticipant | null {
  const values = exactObjectValues(value, [
    "id",
    "side",
    "identityStatus",
    "email",
  ]);
  if (
    !values ||
    !nonEmptyString(values.id) ||
    !safeSetHas(
      PARTICIPANT_SIDES,
      values.side as LeadReplyEvalParticipant["side"]
    ) ||
    !safeSetHas(
      IDENTITY_STATUSES,
      values.identityStatus as LeadReplyEvalParticipant["identityStatus"]
    ) ||
    (values.email !== null && !nonEmptyString(values.email)) ||
    (values.identityStatus === "resolved" && values.email === null) ||
    (values.identityStatus === "unresolved" && values.email !== null)
  ) {
    return null;
  }
  return Object.freeze({
    id: values.id,
    side: values.side as LeadReplyEvalParticipant["side"],
    identityStatus:
      values.identityStatus as LeadReplyEvalParticipant["identityStatus"],
    email: values.email as string | null,
  });
}

function snapshotTurn(value: unknown): LeadReplyEvalTurn | null {
  const values = exactObjectValues(value, [
    "id",
    "deliveredAt",
    "side",
    "participantId",
    "subject",
    "body",
    "attachmentIds",
  ]);
  const attachmentIds = snapshotStringArray(values?.attachmentIds);
  if (
    !values ||
    !nonEmptyString(values.id) ||
    !nonEmptyString(values.deliveredAt) ||
    !safeSetHas(PARTICIPANT_SIDES, values.side as LeadReplyEvalTurn["side"]) ||
    !nonEmptyString(values.participantId) ||
    typeof values.subject !== "string" ||
    typeof values.body !== "string" ||
    !attachmentIds
  ) {
    return null;
  }
  return Object.freeze({
    id: values.id,
    deliveredAt: values.deliveredAt,
    side: values.side as LeadReplyEvalTurn["side"],
    participantId: values.participantId,
    subject: values.subject,
    body: values.body,
    attachmentIds,
  });
}

function snapshotConversation(
  value: unknown
): LeadReplyEvalConversation | null {
  const values = exactObjectValues(value, ["participants", "turns"]);
  const rawParticipants = exactArrayValues(values?.participants);
  const rawTurns = exactArrayValues(values?.turns);
  if (!values || !rawParticipants || !rawTurns || rawTurns.length === 0) {
    return null;
  }
  const participants = rawParticipants.map(snapshotParticipant);
  const turns = rawTurns.map(snapshotTurn);
  if (
    participants.some((participant) => participant === null) ||
    turns.some((turn) => turn === null)
  ) {
    return null;
  }
  const frozenParticipants = participants as LeadReplyEvalParticipant[];
  const frozenTurns = turns as LeadReplyEvalTurn[];
  const participantById = new Map(
    frozenParticipants.map((participant) => [participant.id, participant])
  );
  const turnIds = new Set(frozenTurns.map((turn) => turn.id));
  if (
    participantById.size !== frozenParticipants.length ||
    turnIds.size !== frozenTurns.length ||
    frozenTurns.some(
      (turn) => participantById.get(turn.participantId)?.side !== turn.side
    ) ||
    frozenTurns.some((turn, index) => {
      const deliveredAt = Date.parse(turn.deliveredAt);
      if (!Number.isFinite(deliveredAt)) return true;
      if (index === 0) return false;
      const prior = frozenTurns[index - 1]!;
      const priorDeliveredAt = Date.parse(prior.deliveredAt);
      return (
        deliveredAt < priorDeliveredAt ||
        (deliveredAt === priorDeliveredAt && turn.id <= prior.id)
      );
    })
  ) {
    return null;
  }
  return Object.freeze({
    participants: Object.freeze(frozenParticipants),
    turns: Object.freeze(frozenTurns),
  });
}

function snapshotContext(value: unknown): LeadReplyEvalContext | null {
  const values = exactObjectValues(value, ["kind", "rendered", "evidenceIds"]);
  const evidenceIds = snapshotStringArray(values?.evidenceIds);
  if (
    !values ||
    !safeSetHas(CONTEXT_KINDS, values.kind as LeadReplyEvalContext["kind"]) ||
    typeof values.rendered !== "string" ||
    !evidenceIds
  ) {
    return null;
  }
  return Object.freeze({
    kind: values.kind as LeadReplyEvalContext["kind"],
    rendered: values.rendered,
    evidenceIds,
  });
}

function snapshotExpectedClaim(value: unknown): LeadReplyExpectedClaim | null {
  const values = exactObjectValues(value, [
    "id",
    "dimension",
    "acceptedPhrases",
    "rejectedPhrases",
    "evidenceIds",
  ]);
  const acceptedPhrases = snapshotStringArray(values?.acceptedPhrases);
  const rejectedPhrases = snapshotStringArray(values?.rejectedPhrases);
  const evidenceIds = snapshotStringArray(values?.evidenceIds);
  if (
    !values ||
    !nonEmptyString(values.id) ||
    !safeSetHas(
      CLAIM_DIMENSIONS,
      values.dimension as LeadReplyExpectedClaim["dimension"]
    ) ||
    !acceptedPhrases ||
    acceptedPhrases.length === 0 ||
    !rejectedPhrases ||
    !evidenceIds ||
    evidenceIds.length === 0
  ) {
    return null;
  }
  return Object.freeze({
    id: values.id,
    dimension: values.dimension as LeadReplyExpectedClaim["dimension"],
    acceptedPhrases,
    rejectedPhrases,
    evidenceIds,
  });
}

function snapshotForbiddenClaim(
  value: unknown
): LeadReplyForbiddenClaim | null {
  const values = exactObjectValues(value, ["id", "phrases"]);
  const phrases = snapshotStringArray(values?.phrases);
  if (!values || !nonEmptyString(values.id) || !phrases) return null;
  return Object.freeze({ id: values.id, phrases });
}

function snapshotAllowedClause(value: unknown): LeadReplyAllowedClause | null {
  const values = exactObjectValues(value, [
    "id",
    "kind",
    "phrases",
    "evidenceIds",
  ]);
  const phrases = snapshotStringArray(values?.phrases);
  const evidenceIds = snapshotStringArray(values?.evidenceIds);
  if (
    !values ||
    !nonEmptyString(values.id) ||
    !safeSetHas(
      ALLOWED_CLAUSE_KINDS,
      values.kind as LeadReplyAllowedClause["kind"]
    ) ||
    !phrases ||
    phrases.length === 0 ||
    phrases.some((phrase) => !nonEmptyString(phrase)) ||
    !evidenceIds ||
    (values.kind === "evidence_backed" && evidenceIds.length === 0) ||
    (values.kind !== "evidence_backed" && evidenceIds.length !== 0)
  ) {
    return null;
  }
  return SAFE_OBJECT_FREEZE({
    id: values.id,
    kind: values.kind as LeadReplyAllowedClause["kind"],
    phrases,
    evidenceIds,
  });
}

function snapshotVariationSequence(
  value: unknown
): LeadReplyEvalFixture["variationSequence"] | null {
  const values = exactObjectValues(
    value,
    ["id", "position"],
    ["repeatedOpeningJustification"]
  );
  if (
    !values ||
    !nonEmptyString(values.id) ||
    !Number.isSafeInteger(values.position) ||
    (values.position as number) < 0 ||
    (values.repeatedOpeningJustification !== undefined &&
      !nonEmptyString(values.repeatedOpeningJustification))
  ) {
    return null;
  }
  return Object.freeze({
    id: values.id,
    position: values.position as number,
    ...(values.repeatedOpeningJustification === undefined
      ? {}
      : {
          repeatedOpeningJustification:
            values.repeatedOpeningJustification as string,
        }),
  });
}

function snapshotVerifiedSchedule(
  value: unknown
): LeadReplyVerifiedSchedule | null {
  if (value === null || value === undefined) return null;
  const values = exactObjectValues(value, ["statement", "evidenceId"]);
  if (
    !values ||
    !nonEmptyString(values.statement) ||
    !nonEmptyString(values.evidenceId)
  ) {
    return null;
  }
  return SAFE_OBJECT_FREEZE({
    statement: values.statement,
    evidenceId: values.evidenceId,
  });
}

function snapshotFixture(value: unknown): LeadReplyEvalFixture | null {
  const values = exactObjectValues(
    value,
    [
      "id",
      "tags",
      "conversation",
      "controlContext",
      "sharedContext",
      "expectedResponseMode",
      "expectedClaims",
      "forbiddenClaims",
      "allowedClauses",
      "requiredDecisionEvidenceIds",
      "expectedDisposition",
      "expectedRecipientEmail",
      "isFirstOperatorReply",
      "maxWords",
      "maxContextCharacters",
      "variationSequence",
    ],
    ["verifiedSchedule"]
  );
  if (!values) return null;
  const tags = snapshotStringArray(values.tags);
  const conversation = snapshotConversation(values.conversation);
  const controlContext = snapshotContext(values.controlContext);
  const sharedContext = snapshotContext(values.sharedContext);
  const rawExpectedClaims = exactArrayValues(values.expectedClaims);
  const rawForbiddenClaims = exactArrayValues(values.forbiddenClaims);
  const rawAllowedClauses = exactArrayValues(values.allowedClauses);
  const requiredDecisionEvidenceIds = snapshotStringArray(
    values.requiredDecisionEvidenceIds
  );
  const variationSequence = snapshotVariationSequence(values.variationSequence);
  const verifiedSchedule = snapshotVerifiedSchedule(values.verifiedSchedule);
  if (
    !nonEmptyString(values.id) ||
    !tags ||
    !conversation ||
    !controlContext ||
    controlContext.kind !== "whole_history_control" ||
    !sharedContext ||
    sharedContext.kind !== "shared_job_memory" ||
    !rawExpectedClaims ||
    !rawForbiddenClaims ||
    !rawAllowedClauses ||
    !requiredDecisionEvidenceIds ||
    requiredDecisionEvidenceIds.length === 0 ||
    !safeSetHas(
      RESPONSE_MODES,
      values.expectedResponseMode as LeadReplyResponseMode
    ) ||
    !safeSetHas(
      DISPOSITIONS,
      values.expectedDisposition as LeadReplyDisposition
    ) ||
    (values.expectedRecipientEmail !== null &&
      !nonEmptyString(values.expectedRecipientEmail)) ||
    typeof values.isFirstOperatorReply !== "boolean" ||
    !Number.isSafeInteger(values.maxWords) ||
    (values.maxWords as number) < 0 ||
    !Number.isSafeInteger(values.maxContextCharacters) ||
    (values.maxContextCharacters as number) < 0 ||
    (values.verifiedSchedule !== undefined &&
      values.verifiedSchedule !== null &&
      verifiedSchedule === null) ||
    !variationSequence
  ) {
    return null;
  }
  const expectedClaims = rawExpectedClaims.map(snapshotExpectedClaim);
  const forbiddenClaims = rawForbiddenClaims.map(snapshotForbiddenClaim);
  const allowedClauses = rawAllowedClauses.map(snapshotAllowedClause);
  const expectedRecipientEmail = values.expectedRecipientEmail as string | null;
  const resolvedUserEmails = new Set(
    conversation.participants
      .filter(
        (participant) =>
          participant.side === "user" &&
          participant.identityStatus === "resolved" &&
          participant.email !== null
      )
      .map((participant) => participant.email!.trim().toLowerCase())
  );
  if (
    expectedClaims.some((claim) => claim === null) ||
    forbiddenClaims.some((claim) => claim === null) ||
    allowedClauses.some((clause) => clause === null) ||
    (values.expectedDisposition === "reply" && expectedClaims.length === 0) ||
    (values.expectedDisposition === "reply" && allowedClauses.length === 0) ||
    (allowedClauses.some((clause) => clause?.kind === "first_reply_greeting") &&
      values.isFirstOperatorReply !== true) ||
    (values.expectedDisposition === "reply" &&
      (expectedRecipientEmail === null ||
        !resolvedUserEmails.has(
          expectedRecipientEmail.trim().toLowerCase()
        ))) ||
    (values.expectedDisposition !== "reply" && expectedRecipientEmail !== null)
  ) {
    return null;
  }
  return Object.freeze({
    id: values.id,
    tags,
    conversation,
    controlContext,
    sharedContext,
    verifiedSchedule,
    expectedResponseMode: values.expectedResponseMode as LeadReplyResponseMode,
    expectedClaims: Object.freeze(expectedClaims as LeadReplyExpectedClaim[]),
    forbiddenClaims: Object.freeze(
      forbiddenClaims as LeadReplyForbiddenClaim[]
    ),
    allowedClauses: SAFE_OBJECT_FREEZE(
      allowedClauses as LeadReplyAllowedClause[]
    ),
    requiredDecisionEvidenceIds,
    expectedDisposition: values.expectedDisposition as LeadReplyDisposition,
    expectedRecipientEmail,
    isFirstOperatorReply: values.isFirstOperatorReply,
    maxWords: values.maxWords as number,
    maxContextCharacters: values.maxContextCharacters as number,
    variationSequence,
  });
}

function snapshotPath(value: unknown): LeadReplyCandidatePath["run"] | null {
  const values = exactObjectValues(value, ["run"]);
  return values &&
    typeof values.run === "function" &&
    !SAFE_IS_PROXY(values.run)
    ? (values.run as LeadReplyCandidatePath["run"])
    : null;
}

function snapshotSuiteInput(input: unknown): SuiteInputSnapshot {
  const values = exactObjectValues(
    input,
    ["fixtures", "controlPath", "sharedPath"],
    ["clock"]
  );
  if (!values) {
    throw new TypeError("LEAD_REPLY_EVAL_SUITE_INPUT_INVALID");
  }
  const rawFixtures = exactArrayValues(values.fixtures);
  if (!rawFixtures || rawFixtures.length === 0) {
    throw new TypeError("LEAD_REPLY_EVAL_SUITE_INPUT_INVALID");
  }
  const fixtures = rawFixtures.map(snapshotFixture);
  if (
    fixtures.some((fixture) => fixture === null) ||
    new Set(fixtures.map((fixture) => fixture?.id)).size !== fixtures.length
  ) {
    throw new TypeError("LEAD_REPLY_EVAL_FIXTURE_INVALID");
  }
  const controlRun = snapshotPath(values.controlPath);
  const sharedRun = snapshotPath(values.sharedPath);
  if (!controlRun || !sharedRun) {
    throw new TypeError("LEAD_REPLY_EVAL_PATH_INVALID");
  }
  if (values.controlPath === values.sharedPath || controlRun === sharedRun) {
    throw new TypeError("LEAD_REPLY_EVAL_PATHS_NOT_INDEPENDENT");
  }
  const clock = values.clock ?? performance.now.bind(performance);
  if (typeof clock !== "function" || SAFE_IS_PROXY(clock)) {
    throw new TypeError("LEAD_REPLY_EVAL_SUITE_INPUT_INVALID");
  }
  const frozenFixtures = SAFE_OBJECT_FREEZE(fixtures as LeadReplyEvalFixture[]);
  const compiledFixtures: CompiledLeadReplyFixtureMechanics[] = [];
  for (let index = 0; index < frozenFixtures.length; index += 1) {
    compiledFixtures[compiledFixtures.length] =
      compileLeadReplyFixtureMechanics(frozenFixtures[index]!);
  }
  return SAFE_OBJECT_FREEZE({
    fixtures: frozenFixtures,
    compiledFixtures: SAFE_OBJECT_FREEZE(compiledFixtures),
    controlRun,
    sharedRun,
    clock: clock as () => number,
  });
}

function safeClock(clock: () => number): number {
  try {
    const value = clock();
    return SAFE_NUMBER_IS_FINITE(value) ? value : 0;
  } catch {
    return 0;
  }
}

function snapshotPathOutput(
  output: unknown
): LeadReplyCandidatePathOutput | null {
  const values = exactObjectValues(output, [
    "disposition",
    "responseMode",
    "draft",
    "recipientEmail",
  ]);
  if (
    !values ||
    !safeSetHas(DISPOSITIONS, values.disposition as LeadReplyDisposition) ||
    !safeSetHas(RESPONSE_MODES, values.responseMode as LeadReplyResponseMode) ||
    typeof values.draft !== "string" ||
    (values.recipientEmail !== null &&
      typeof values.recipientEmail !== "string")
  ) {
    return null;
  }
  return SAFE_OBJECT_FREEZE({
    disposition: values.disposition as LeadReplyDisposition,
    responseMode: values.responseMode as LeadReplyResponseMode,
    draft: values.draft,
    recipientEmail: values.recipientEmail as string | null,
  });
}

async function runPath(
  run: LeadReplyCandidatePath["run"],
  conversation: LeadReplyEvalConversation,
  context: LeadReplyEvalContext,
  verifiedSchedule: LeadReplyVerifiedSchedule | null,
  clock: () => number,
  intrinsicDescriptors: readonly IntrinsicDescriptorSnapshot[]
): Promise<LeadReplyCandidate> {
  const startedAt = safeClock(clock);
  const output = await run(
    SAFE_OBJECT_FREEZE({ conversation, context, verifiedSchedule })
  );
  assertEvalIntrinsicsUnchanged(intrinsicDescriptors);
  const snapshot = snapshotPathOutput(output);
  if (!snapshot) {
    throw new TypeError("LEAD_REPLY_EVAL_PATH_OUTPUT_INVALID");
  }
  return SAFE_OBJECT_FREEZE({
    ...snapshot,
    latencyMilliseconds: SAFE_MATH_MAX(
      0,
      SAFE_MATH_ROUND(safeClock(clock) - startedAt)
    ),
  });
}

export async function runLeadReplyQualitySuite(
  input: RunLeadReplyQualitySuiteInput
): Promise<LeadReplyQualitySuiteResult> {
  assertEvalIntrinsicsUnchanged();
  const intrinsicDescriptors = captureIntrinsicDescriptorSnapshots();
  const snapshot = snapshotSuiteInput(input);
  const fixtureResults: LeadReplyFixtureRunResult[] = [];
  for (
    let fixtureIndex = 0;
    fixtureIndex < snapshot.fixtures.length;
    fixtureIndex += 1
  ) {
    const fixture = snapshot.fixtures[fixtureIndex]!;
    const controlCandidate = await runPath(
      snapshot.controlRun,
      fixture.conversation,
      fixture.controlContext,
      fixture.verifiedSchedule ?? null,
      snapshot.clock,
      intrinsicDescriptors
    );
    const sharedCandidate = await runPath(
      snapshot.sharedRun,
      fixture.conversation,
      fixture.sharedContext,
      fixture.verifiedSchedule ?? null,
      snapshot.clock,
      intrinsicDescriptors
    );
    appendOwnArrayValue(
      fixtureResults,
      SAFE_OBJECT_FREEZE({
        fixtureId: fixture.id,
        controlCandidate,
        sharedCandidate,
        comparison: compareLeadReplyCandidates(
          fixture,
          controlCandidate,
          sharedCandidate,
          snapshot.compiledFixtures[fixtureIndex]!
        ),
      })
    );
  }

  const variationSamples: Array<{
    candidate: LeadReplyCandidate;
    responseMode: LeadReplyResponseMode;
    sequenceId: string;
    sequencePosition: number;
    repeatedOpeningJustification?: string;
  }> = [];
  for (let index = 0; index < fixtureResults.length; index += 1) {
    const variation = snapshot.fixtures[index]!.variationSequence;
    appendOwnArrayValue(variationSamples, {
      candidate: fixtureResults[index]!.sharedCandidate,
      responseMode: fixtureResults[index]!.sharedCandidate.responseMode,
      sequenceId: variation.id,
      sequencePosition: variation.position,
      ...(variation.repeatedOpeningJustification === undefined
        ? {}
        : {
            repeatedOpeningJustification:
              variation.repeatedOpeningJustification,
          }),
    });
  }
  const sharedVariation = evaluateLeadReplySuiteVariation(variationSamples);
  let totalContextCharacterReduction = 0;
  let everyCandidatePassed = true;
  for (let index = 0; index < fixtureResults.length; index += 1) {
    totalContextCharacterReduction +=
      fixtureResults[index]!.comparison.contextCharacterReduction;
    if (!fixtureResults[index]!.comparison.candidateChecksPassed) {
      everyCandidatePassed = false;
    }
  }
  const qualityChecksPassed =
    everyCandidatePassed &&
    sharedVariation.hasProperVariation &&
    totalContextCharacterReduction > 0;
  return SAFE_OBJECT_FREEZE({
    fixtureResults: SAFE_OBJECT_FREEZE(fixtureResults),
    sharedVariation,
    totalContextCharacterReduction,
    qualityChecksPassed,
    releaseGatePassed: false,
  });
}
