import "server-only";

import { types as nodeTypes } from "node:util";

import type { JobConversationContextDomainResult } from "@/lib/agent-control-plane/services/domain-service";
import { JOB_CONVERSATION_PROMPT_SAFETY_DIRECTIVE } from "@/lib/agent-control-plane/services/get-job-conversation-context";
import { escapeUntrustedPromptJson } from "@/lib/prompt-safety/untrusted-json";

export const REPLY_CONTEXT_SHADOW_SCHEMA_REVISION =
  "phase-c-reply-context-shadow:v1" as const;

export interface ObserveReplyContextShadowInput {
  /** Existing whole-history prompt data. Read only for its bounded length. */
  readonly controlContext: string;
  /** The sole effect: load the shared, actor/source-scoped context envelope. */
  readonly loadBoundedContext: () => Promise<JobConversationContextDomainResult>;
  /** Monotonic test seam. Defaults to performance.now(). */
  readonly clock?: () => number;
}

export interface ReplyContextShadowObservation {
  readonly schemaRevision: typeof REPLY_CONTEXT_SHADOW_SCHEMA_REVISION;
  readonly status: "ready" | "unavailable";
  readonly controlContextCharacters: number;
  readonly boundedContextCharacters: number | null;
  readonly characterDelta: number | null;
  readonly latencyMilliseconds: number;
  readonly memoryVersion: number | null;
  readonly evidenceCount: number;
  readonly recentTurnCount: number;
  readonly participantCount: number;
  readonly crossJobSeedIncluded: boolean;
  readonly freshnessGapCount: number;
  readonly warningCount: number;
}

interface ReplyContextShadowInputSnapshot {
  readonly controlContext: string;
  readonly loadBoundedContext: () => Promise<JobConversationContextDomainResult>;
  readonly clock?: () => number;
}

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonObject | JsonArray;
interface JsonObject {
  readonly [key: string]: JsonValue;
}
type JsonArray = readonly JsonValue[];

interface ProjectionContext {
  readonly seen: WeakSet<object>;
  readonly budget: { remaining: number };
}

interface ProjectedMetrics {
  readonly serializedData: string;
  readonly memoryVersion: number | null;
  readonly evidenceCount: number;
  readonly recentTurnCount: number;
  readonly participantCount: number;
  readonly crossJobSeedIncluded: boolean;
  readonly freshnessGapCount: number;
  readonly warningCount: number;
}

const SAFE_OBJECT_FREEZE = Object.freeze;
const SAFE_OBJECT_CREATE = Object.create;
const SAFE_OBJECT_DEFINE_PROPERTY = Object.defineProperty;
const SAFE_OBJECT_GET_PROTOTYPE_OF = Object.getPrototypeOf;
const SAFE_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR = Object.getOwnPropertyDescriptor;
const SAFE_OBJECT_HAS_OWN = Object.hasOwn;
const SAFE_OBJECT_PROTOTYPE = Object.prototype;
const SAFE_OBJECT_SET_PROTOTYPE_OF = Object.setPrototypeOf;
const SAFE_ARRAY_IS_ARRAY = Array.isArray;
const SAFE_REFLECT_OWN_KEYS = Reflect.ownKeys;
const SAFE_REFLECT_APPLY = Reflect.apply;
const SAFE_NUMBER_IS_SAFE_INTEGER = Number.isSafeInteger;
const SAFE_NUMBER_IS_FINITE = Number.isFinite;
const SAFE_MATH_MAX = Math.max;
const SAFE_MATH_ROUND = Math.round;
const SAFE_JSON_STRINGIFY = JSON.stringify;
const SAFE_WEAK_SET = WeakSet;
const SAFE_WEAK_SET_HAS = WeakSet.prototype.has;
const SAFE_WEAK_SET_ADD = WeakSet.prototype.add;
const SAFE_IS_PROXY = nodeTypes.isProxy;
const SAFE_PERFORMANCE_NOW = performance.now.bind(performance);

const MAX_PROJECTION_DEPTH = 64;
const MAX_PROJECTION_NODES = 50_000;
const MAX_ARRAY_ITEMS = 1_000;
const MAX_OBJECT_FIELDS = 256;
const MAX_STRING_CHARACTERS = 60_000;
const MAX_SERIALIZED_SOURCE_CHARACTERS = 60_000;
const MAX_ESCAPED_SERIALIZED_CHARACTERS = 360_000;
const INVALID_PROJECTION = Symbol("reply-context-shadow.invalid-projection");

const REQUIRED_INPUT_KEYS = ["controlContext", "loadBoundedContext"] as const;
const ALLOWED_INPUT_KEYS = new Set<PropertyKey>([
  ...REQUIRED_INPUT_KEYS,
  "clock",
]);
const EXPECTED_DATA_KEYS = new Set([
  "conversation_id",
  "requested_job",
  "prompt_safety_directive",
  "sections",
]);
const EXPECTED_SECTION_ORDER = [
  "memory",
  "recent_turns",
  "source_evidence",
  "participants",
  "cross_job_seed",
  "freshness_and_gaps",
] as const;
const EXPECTED_SECTION_KINDS = new Set(EXPECTED_SECTION_ORDER);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const OBSERVATION_KEYS = SAFE_OBJECT_FREEZE([
  "schemaRevision",
  "status",
  "controlContextCharacters",
  "boundedContextCharacters",
  "characterDelta",
  "latencyMilliseconds",
  "memoryVersion",
  "evidenceCount",
  "recentTurnCount",
  "participantCount",
  "crossJobSeedIncluded",
  "freshnessGapCount",
  "warningCount",
] as const satisfies readonly (keyof ReplyContextShadowObservation)[]);

function weakSetHas(values: WeakSet<object>, value: object): boolean {
  return SAFE_REFLECT_APPLY(SAFE_WEAK_SET_HAS, values, [value]) as boolean;
}

function weakSetAdd(values: WeakSet<object>, value: object): void {
  SAFE_REFLECT_APPLY(SAFE_WEAK_SET_ADD, values, [value]);
}

function defineFrozenDataProperty(
  target: object,
  key: PropertyKey,
  value: unknown
): void {
  SAFE_OBJECT_DEFINE_PROPERTY(target, key, {
    configurable: false,
    enumerable: true,
    value,
    writable: false,
  });
}

function ownEnumerableValue(object: object, key: PropertyKey): unknown {
  const descriptor = SAFE_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(object, key);
  return descriptor &&
    SAFE_OBJECT_HAS_OWN(descriptor, "value") &&
    descriptor.enumerable
    ? descriptor.value
    : INVALID_PROJECTION;
}

function projectArray(
  value: object,
  context: ProjectionContext,
  depth: number
): JsonArray | typeof INVALID_PROJECTION {
  const lengthDescriptor = SAFE_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(
    value,
    "length"
  );
  if (
    !lengthDescriptor ||
    !SAFE_OBJECT_HAS_OWN(lengthDescriptor, "value") ||
    typeof lengthDescriptor.value !== "number" ||
    !SAFE_NUMBER_IS_SAFE_INTEGER(lengthDescriptor.value) ||
    lengthDescriptor.value < 0 ||
    lengthDescriptor.value > MAX_ARRAY_ITEMS
  ) {
    return INVALID_PROJECTION;
  }
  const length = lengthDescriptor.value;
  const keys = SAFE_REFLECT_OWN_KEYS(value);
  if (keys.length !== length + 1) return INVALID_PROJECTION;

  const projected: JsonValue[] = [];
  SAFE_OBJECT_SET_PROTOTYPE_OF(projected, null);
  for (let index = 0; index < length; index += 1) {
    const item = ownEnumerableValue(value, String(index));
    if (item === INVALID_PROJECTION) return INVALID_PROJECTION;
    const projectedItem = projectJsonValue(item, context, depth + 1);
    if (projectedItem === INVALID_PROJECTION) return INVALID_PROJECTION;
    defineFrozenDataProperty(projected, String(index), projectedItem);
  }
  return SAFE_OBJECT_FREEZE(projected);
}

function projectObject(
  value: object,
  context: ProjectionContext,
  depth: number
): JsonObject | typeof INVALID_PROJECTION {
  const prototype = SAFE_OBJECT_GET_PROTOTYPE_OF(value);
  if (prototype !== SAFE_OBJECT_PROTOTYPE && prototype !== null) {
    return INVALID_PROJECTION;
  }
  const keys = SAFE_REFLECT_OWN_KEYS(value);
  if (keys.length > MAX_OBJECT_FIELDS) return INVALID_PROJECTION;
  const projected = SAFE_OBJECT_CREATE(null) as Record<string, JsonValue>;
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    if (typeof key !== "string") return INVALID_PROJECTION;
    const item = ownEnumerableValue(value, key);
    if (item === INVALID_PROJECTION) return INVALID_PROJECTION;
    const projectedItem = projectJsonValue(item, context, depth + 1);
    if (projectedItem === INVALID_PROJECTION) return INVALID_PROJECTION;
    defineFrozenDataProperty(projected, key, projectedItem);
  }
  return SAFE_OBJECT_FREEZE(projected);
}

function projectJsonValue(
  value: unknown,
  context: ProjectionContext,
  depth: number
): JsonValue | typeof INVALID_PROJECTION {
  if (depth > MAX_PROJECTION_DEPTH || context.budget.remaining <= 0) {
    return INVALID_PROJECTION;
  }
  context.budget.remaining -= 1;
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    return value.length <= MAX_STRING_CHARACTERS ? value : INVALID_PROJECTION;
  }
  if (typeof value === "number") {
    return SAFE_NUMBER_IS_FINITE(value) ? value : INVALID_PROJECTION;
  }
  if (
    typeof value !== "object" ||
    SAFE_IS_PROXY(value) ||
    weakSetHas(context.seen, value)
  ) {
    return INVALID_PROJECTION;
  }
  weakSetAdd(context.seen, value);
  return SAFE_ARRAY_IS_ARRAY(value)
    ? projectArray(value, context, depth)
    : projectObject(value, context, depth);
}

function asObject(value: JsonValue | undefined): JsonObject | null {
  const object =
    value !== undefined &&
    typeof value === "object" &&
    value !== null &&
    !SAFE_ARRAY_IS_ARRAY(value)
      ? value
      : null;
  return object as JsonObject | null;
}

function asArray(value: JsonValue | undefined): JsonArray | null {
  return value !== undefined && SAFE_ARRAY_IS_ARRAY(value) ? value : null;
}

function hasExactKeys(
  value: JsonObject,
  expected: ReadonlySet<string>
): boolean {
  const keys = SAFE_REFLECT_OWN_KEYS(value);
  return (
    keys.length === expected.size &&
    keys.every((key) => typeof key === "string" && expected.has(key))
  );
}

function requiredArray(value: JsonObject, key: string): JsonArray | null {
  return asArray(value[key]);
}

function escapedJson(value: JsonObject): string | null {
  const serialized = SAFE_JSON_STRINGIFY(value);
  if (
    typeof serialized !== "string" ||
    serialized.length > MAX_SERIALIZED_SOURCE_CHARACTERS
  ) {
    return null;
  }
  const escaped = escapeUntrustedPromptJson(serialized);
  if (escaped.length > MAX_ESCAPED_SERIALIZED_CHARACTERS) return null;
  return escaped;
}

function sectionMap(
  sections: JsonArray
): ReadonlyMap<string, JsonObject> | null {
  if (sections.length !== EXPECTED_SECTION_KINDS.size) return null;
  const mapped = new Map<string, JsonObject>();
  for (let index = 0; index < sections.length; index += 1) {
    const section = asObject(sections[index]);
    const kind = section?.kind;
    if (
      !section ||
      typeof kind !== "string" ||
      kind !== EXPECTED_SECTION_ORDER[index] ||
      !EXPECTED_SECTION_KINDS.has(kind) ||
      mapped.has(kind)
    ) {
      return null;
    }
    mapped.set(kind, section);
  }
  return mapped;
}

function memoryVersion(section: JsonObject): number | null | undefined {
  const version = section.version;
  if (version === null) return null;
  const versionObject = asObject(version);
  const value = versionObject?.version_number;
  return typeof value === "number" &&
    SAFE_NUMBER_IS_SAFE_INTEGER(value) &&
    value > 0
    ? value
    : undefined;
}

function projectLoaderResult(loaded: unknown): ProjectedMetrics | null {
  if (
    typeof loaded !== "object" ||
    loaded === null ||
    SAFE_IS_PROXY(loaded) ||
    SAFE_ARRAY_IS_ARRAY(loaded)
  ) {
    return null;
  }
  try {
    const dataValue = ownEnumerableValue(loaded, "data");
    const warningsValue = ownEnumerableValue(loaded, "warnings");
    if (
      dataValue === INVALID_PROJECTION ||
      warningsValue === INVALID_PROJECTION
    ) {
      return null;
    }
    const context: ProjectionContext = {
      seen: new SAFE_WEAK_SET<object>(),
      budget: { remaining: MAX_PROJECTION_NODES },
    };
    const dataProjection = projectJsonValue(dataValue, context, 0);
    const warningsProjection = projectJsonValue(warningsValue, context, 0);
    const data =
      dataProjection === INVALID_PROJECTION ? null : asObject(dataProjection);
    const warnings =
      warningsProjection === INVALID_PROJECTION
        ? null
        : asArray(warningsProjection);
    if (!data || !warnings || !hasExactKeys(data, EXPECTED_DATA_KEYS)) {
      return null;
    }
    if (
      typeof data.conversation_id !== "string" ||
      !UUID_PATTERN.test(data.conversation_id) ||
      data.prompt_safety_directive !== JOB_CONVERSATION_PROMPT_SAFETY_DIRECTIVE
    ) {
      return null;
    }
    const requestedJob = asObject(data.requested_job);
    if (
      !requestedJob ||
      requestedJob.kind !== "opportunity" ||
      typeof requestedJob.id !== "string" ||
      !UUID_PATTERN.test(requestedJob.id)
    ) {
      return null;
    }
    const sections = asArray(data.sections);
    const byKind = sections ? sectionMap(sections) : null;
    if (!byKind) return null;

    const memory = byKind.get("memory")!;
    const recentTurns = requiredArray(byKind.get("recent_turns")!, "turns");
    const evidence = requiredArray(byKind.get("source_evidence")!, "evidence");
    const participants = requiredArray(
      byKind.get("participants")!,
      "participants"
    );
    const crossJobSeed = byKind.get("cross_job_seed")!;
    const freshness = byKind.get("freshness_and_gaps")!;
    const gaps = requiredArray(freshness, "gaps");
    const requiredThrough = asObject(freshness.required_through);
    const version = memoryVersion(memory);
    const serializedData = escapedJson(data);
    const requiredTurnId = requiredThrough?.turn_id;
    const expectedEvidenceId =
      typeof requiredTurnId === "string"
        ? `job_conversation_turn:${requiredTurnId}`
        : null;
    let includesRequiredEvidence = false;
    if (expectedEvidenceId !== null && evidence) {
      for (let index = 0; index < evidence.length; index += 1) {
        if (asObject(evidence[index])?.evidence_id === expectedEvidenceId) {
          includesRequiredEvidence = true;
          break;
        }
      }
    }
    if (
      !recentTurns ||
      !evidence ||
      !participants ||
      !asObject(crossJobSeed.seed) ||
      !gaps ||
      !requiredThrough ||
      requiredThrough.state !== "summarized" ||
      typeof requiredTurnId !== "string" ||
      !UUID_PATTERN.test(requiredTurnId) ||
      !includesRequiredEvidence ||
      version === undefined ||
      version === null ||
      serializedData === null
    ) {
      return null;
    }
    return SAFE_OBJECT_FREEZE({
      serializedData,
      memoryVersion: version,
      evidenceCount: evidence.length,
      recentTurnCount: recentTurns.length,
      participantCount: participants.length,
      crossJobSeedIncluded: asObject(crossJobSeed.seed)?.state === "available",
      freshnessGapCount: gaps.length,
      warningCount: warnings.length,
    });
  } catch {
    return null;
  }
}

function snapshotInput(input: unknown): ReplyContextShadowInputSnapshot | null {
  if (
    typeof input !== "object" ||
    input === null ||
    SAFE_IS_PROXY(input) ||
    SAFE_ARRAY_IS_ARRAY(input)
  ) {
    return null;
  }
  try {
    const keys = SAFE_REFLECT_OWN_KEYS(input);
    if (
      keys.some(
        (key) => typeof key !== "string" || !ALLOWED_INPUT_KEYS.has(key)
      ) ||
      REQUIRED_INPUT_KEYS.some((key) => !SAFE_OBJECT_HAS_OWN(input, key))
    ) {
      return null;
    }
    const values = SAFE_OBJECT_CREATE(null) as Record<string, unknown>;
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index]!;
      if (typeof key !== "string") return null;
      const value = ownEnumerableValue(input, key);
      if (value === INVALID_PROJECTION) return null;
      values[key] = value;
    }
    if (
      typeof values.controlContext !== "string" ||
      typeof values.loadBoundedContext !== "function" ||
      (values.clock !== undefined && typeof values.clock !== "function")
    ) {
      return null;
    }
    return SAFE_OBJECT_FREEZE({
      controlContext: values.controlContext,
      loadBoundedContext:
        values.loadBoundedContext as ReplyContextShadowInputSnapshot["loadBoundedContext"],
      ...(values.clock === undefined
        ? {}
        : { clock: values.clock as () => number }),
    });
  } catch {
    return null;
  }
}

function safeClock(clock: () => number): number {
  try {
    const value = clock();
    return SAFE_NUMBER_IS_FINITE(value) ? value : 0;
  } catch {
    return 0;
  }
}

function elapsed(startedAt: number, finishedAt: number): number {
  return SAFE_MATH_MAX(0, SAFE_MATH_ROUND(finishedAt - startedAt));
}

function isObservationPrimitive(value: unknown): boolean {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && SAFE_NUMBER_IS_FINITE(value))
  );
}

function createObservation(
  values: ReplyContextShadowObservation
): ReplyContextShadowObservation {
  if (SAFE_REFLECT_OWN_KEYS(values).length !== OBSERVATION_KEYS.length) {
    throw new TypeError("REPLY_CONTEXT_SHADOW_OBSERVATION_INVALID");
  }
  const observation = SAFE_OBJECT_CREATE(null) as Record<string, unknown>;
  for (let index = 0; index < OBSERVATION_KEYS.length; index += 1) {
    const key = OBSERVATION_KEYS[index]!;
    const value = ownEnumerableValue(values, key);
    if (value === INVALID_PROJECTION || !isObservationPrimitive(value)) {
      throw new TypeError("REPLY_CONTEXT_SHADOW_OBSERVATION_INVALID");
    }
    defineFrozenDataProperty(observation, key, value);
  }
  return SAFE_OBJECT_FREEZE(
    observation
  ) as unknown as ReplyContextShadowObservation;
}

function unavailableObservation(
  controlContextCharacters: number,
  latencyMilliseconds: number
): ReplyContextShadowObservation {
  return createObservation({
    schemaRevision: REPLY_CONTEXT_SHADOW_SCHEMA_REVISION,
    status: "unavailable",
    controlContextCharacters,
    boundedContextCharacters: null,
    characterDelta: null,
    latencyMilliseconds,
    memoryVersion: null,
    evidenceCount: 0,
    recentTurnCount: 0,
    participantCount: 0,
    crossJobSeedIncluded: false,
    freshnessGapCount: 0,
    warningCount: 0,
  });
}

/**
 * Measure the replacement context without generating a second reply, sending,
 * persisting a draft, changing mailbox state, or feeding draft text to memory.
 * The result deliberately contains only counts and timing—never correspondence.
 */
export async function observeReplyContextShadow(
  input: ObserveReplyContextShadowInput
): Promise<ReplyContextShadowObservation> {
  const snapshot = snapshotInput(input);
  const controlContextCharacters = snapshot?.controlContext.length ?? 0;
  const clock = snapshot?.clock ?? SAFE_PERFORMANCE_NOW;
  const startedAt = safeClock(clock);

  try {
    if (!snapshot) {
      throw new TypeError("REPLY_CONTEXT_SHADOW_LOADER_INVALID");
    }
    const projection = projectLoaderResult(await snapshot.loadBoundedContext());
    if (!projection) {
      throw new TypeError("REPLY_CONTEXT_SHADOW_RESULT_INVALID");
    }
    const finishedAt = safeClock(clock);
    return createObservation({
      schemaRevision: REPLY_CONTEXT_SHADOW_SCHEMA_REVISION,
      status: "ready",
      controlContextCharacters,
      boundedContextCharacters: projection.serializedData.length,
      characterDelta:
        projection.serializedData.length - controlContextCharacters,
      latencyMilliseconds: elapsed(startedAt, finishedAt),
      memoryVersion: projection.memoryVersion,
      evidenceCount: projection.evidenceCount,
      recentTurnCount: projection.recentTurnCount,
      participantCount: projection.participantCount,
      crossJobSeedIncluded: projection.crossJobSeedIncluded,
      freshnessGapCount: projection.freshnessGapCount,
      warningCount: projection.warningCount,
    });
  } catch {
    return unavailableObservation(
      controlContextCharacters,
      elapsed(startedAt, safeClock(clock))
    );
  }
}
