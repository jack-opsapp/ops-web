import "server-only";

import {
  assertP2NoForbiddenFields,
  P2CollectionProofSchema,
  P2EntityProofSchema,
  P2EvidenceIdentitySchema,
  P2_MAX_PAGE_ITEMS,
  P2_MAX_SERIALIZED_CHARACTERS,
  type P2CollectionProof,
  type P2EntityProof,
  type P2EvidenceIdentity,
} from "@/lib/agent-control-plane/contracts";
import { serializeUntrustedPromptData } from "@/lib/prompt-safety/untrusted-json";
import { coupleP2CollectionAndChildProofs } from "./proof";

const RESERVED_ENVELOPE_KEYS = new Set([
  "items",
  "item_proofs",
  "evidence",
  "collection_proof",
]);

export interface P2AtomicResultUnit<TItem> {
  readonly item: TItem;
  readonly proof: P2EntityProof;
  readonly evidence: readonly P2EvidenceIdentity[];
}

export type P2BudgetedAtomicResult<TEnvelope, TItem> = Readonly<
  TEnvelope & {
    items: readonly TItem[];
    item_proofs: readonly P2EntityProof[];
    evidence: readonly P2EvidenceIdentity[];
    collection_proof: P2CollectionProof;
  }
>;

export class P2ResultBudgetError extends Error {
  readonly code: "P2_RESULT_INVALID" | "P2_RESULT_BUDGET_EXCEEDED";

  constructor(code: P2ResultBudgetError["code"]) {
    super(code);
    this.name = "P2ResultBudgetError";
    this.code = code;
  }
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

export function measureP2SerializedCharacters(value: unknown): number {
  try {
    return serializeUntrustedPromptData(value).length;
  } catch {
    throw new P2ResultBudgetError("P2_RESULT_INVALID");
  }
}

function normalizeUnits<TItem>(
  units: readonly P2AtomicResultUnit<TItem>[]
): readonly P2AtomicResultUnit<TItem>[] {
  if (!Array.isArray(units) || units.length > P2_MAX_PAGE_ITEMS) {
    throw new P2ResultBudgetError("P2_RESULT_INVALID");
  }
  const proofRefs = new Set<string>();
  const evidenceRefs = new Set<string>();
  return Object.freeze(
    units.map((unit) => {
      if (typeof unit !== "object" || unit === null || Array.isArray(unit)) {
        throw new P2ResultBudgetError("P2_RESULT_INVALID");
      }
      const proof = P2EntityProofSchema.safeParse(unit.proof);
      if (
        !proof.success ||
        proofRefs.has(proof.data.proof_ref) ||
        !Array.isArray(unit.evidence) ||
        unit.evidence.length === 0
      ) {
        throw new P2ResultBudgetError("P2_RESULT_INVALID");
      }
      proofRefs.add(proof.data.proof_ref);
      const evidence = unit.evidence.map((rawEvidence: P2EvidenceIdentity) => {
        const parsed = P2EvidenceIdentitySchema.safeParse(rawEvidence);
        if (
          !parsed.success ||
          parsed.data.occurred_at !== proof.data.read_at ||
          evidenceRefs.has(parsed.data.evidence_ref)
        ) {
          throw new P2ResultBudgetError("P2_RESULT_INVALID");
        }
        evidenceRefs.add(parsed.data.evidence_ref);
        return parsed.data;
      });
      return deepFreeze({
        item: unit.item,
        proof: proof.data,
        evidence,
      });
    })
  );
}

/**
 * Retains a prefix and removes only complete item/proof/evidence units until
 * the exact MCP untrusted serializer fits the fixed 60,000-character budget.
 */
export function reduceP2AtomicResultToBudget<
  TEnvelope extends Readonly<Record<string, unknown>>,
  TItem,
>(input: {
  readonly envelope: TEnvelope;
  readonly units: readonly P2AtomicResultUnit<TItem>[];
  readonly sourceHasMore: boolean;
  readonly makeCollectionProof: (
    returnedCount: number,
    hasMore: boolean
  ) => P2CollectionProof;
}): P2BudgetedAtomicResult<TEnvelope, TItem> {
  if (
    typeof input.envelope !== "object" ||
    input.envelope === null ||
    Array.isArray(input.envelope) ||
    Object.keys(input.envelope).some((key) =>
      RESERVED_ENVELOPE_KEYS.has(key)
    ) ||
    typeof input.sourceHasMore !== "boolean"
  ) {
    throw new P2ResultBudgetError("P2_RESULT_INVALID");
  }

  const units = normalizeUnits(input.units);
  const build = (retainedCount: number) => {
    try {
      const retained = units.slice(0, retainedCount);
      const hasMore = input.sourceHasMore || retainedCount < units.length;
      const parsedCollection = P2CollectionProofSchema.parse(
        input.makeCollectionProof(retainedCount, hasMore)
      );
      if (
        parsedCollection.returned_count !== retainedCount ||
        parsedCollection.has_more !== hasMore
      ) {
        throw new P2ResultBudgetError("P2_RESULT_INVALID");
      }
      coupleP2CollectionAndChildProofs({
        collectionProof: parsedCollection,
        childProofs: retained.map((unit) => unit.proof),
      });
      const result = deepFreeze({
        ...input.envelope,
        items: retained.map((unit) => unit.item),
        item_proofs: retained.map((unit) => unit.proof),
        evidence: retained.flatMap((unit) => unit.evidence),
        collection_proof: parsedCollection,
      }) as P2BudgetedAtomicResult<TEnvelope, TItem>;
      assertP2NoForbiddenFields(result);
      return Object.freeze({
        result,
        serializedCharacters: measureP2SerializedCharacters(result),
      });
    } catch (error) {
      if (error instanceof P2ResultBudgetError) throw error;
      throw new P2ResultBudgetError("P2_RESULT_INVALID");
    }
  };

  // The complete input must be privacy-safe and proof-coupled before output
  // size can authorize dropping any atomic tail unit.
  const full = build(units.length);
  if (full.serializedCharacters <= P2_MAX_SERIALIZED_CHARACTERS) {
    return full.result;
  }
  const minimumRetainedCount = units.length === 0 ? 0 : 1;
  for (
    let retainedCount = units.length - 1;
    retainedCount >= minimumRetainedCount;
    retainedCount -= 1
  ) {
    const candidate = build(retainedCount);
    if (candidate.serializedCharacters <= P2_MAX_SERIALIZED_CHARACTERS) {
      return candidate.result;
    }
  }
  throw new P2ResultBudgetError("P2_RESULT_BUDGET_EXCEEDED");
}
