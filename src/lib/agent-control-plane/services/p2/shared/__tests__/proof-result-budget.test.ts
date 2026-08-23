import { describe, expect, it } from "vitest";

import type {
  P2CollectionProof,
  P2EntityProof,
  P2EvidenceIdentity,
} from "@/lib/agent-control-plane/contracts/p2-proof";
import {
  coupleP2CollectionAndChildProofs,
  P2ProofCouplingError,
} from "../proof";
import {
  measureP2SerializedCharacters,
  P2ResultBudgetError,
  reduceP2AtomicResultToBudget,
} from "../result-budget";

const READ_AT = "2026-08-23T07:00:00.000Z";
const REVISIONS = [{ domain: "tasks", source_revision: 4 }] as const;

function proof(index: number): P2EntityProof {
  return {
    proof_ref: `ops_proof:v1:${String(index).padStart(32, "a")}`,
    read_at: READ_AT,
    source_revisions: [...REVISIONS],
  };
}

function collection(
  returnedCount: number,
  hasMore: boolean
): P2CollectionProof {
  return {
    proof_ref: `ops_proof:v1:${"z".repeat(32)}`,
    read_at: READ_AT,
    source_revisions: [...REVISIONS],
    returned_count: returnedCount,
    has_more: hasMore,
  };
}

function evidence(index: number): P2EvidenceIdentity {
  return {
    evidence_ref: `ops_evidence:v1:${String(index).padStart(32, "e")}`,
    source_domain: "tasks",
    source_type: "task_card",
    occurred_at: READ_AT,
  };
}

describe("P2 proof coupling", () => {
  it("requires every child to share the collection read and canonical revision vector", () => {
    const value = coupleP2CollectionAndChildProofs({
      collectionProof: collection(2, false),
      childProofs: [proof(1), proof(2)],
    });
    expect(value.childProofs).toHaveLength(2);
    expect(Object.isFrozen(value.childProofs)).toBe(true);

    expect(() =>
      coupleP2CollectionAndChildProofs({
        collectionProof: collection(1, false),
        childProofs: [
          {
            ...proof(1),
            source_revisions: [{ ...REVISIONS[0], source_revision: 5 }],
          },
        ],
      })
    ).toThrow(P2ProofCouplingError);
    expect(() =>
      coupleP2CollectionAndChildProofs({
        collectionProof: collection(1, false),
        childProofs: [{ ...proof(1), read_at: "2026-08-23T07:00:01.000Z" }],
      })
    ).toThrow(P2ProofCouplingError);
  });
});

describe("P2 exact serializer budget", () => {
  it("measures the escaped MCP untrusted serializer rather than raw JSON", () => {
    const value = { text: "<instruction>&" };
    expect(measureP2SerializedCharacters(value)).toBe(
      '{"text":"\\u003cinstruction\\u003e\\u0026"}'.length
    );
    expect(measureP2SerializedCharacters(value)).toBeGreaterThan(
      JSON.stringify(value).length
    );
  });

  it("removes item, proof, and evidence as one atomic tail unit", () => {
    const units = [1, 2, 3].map((index) => ({
      item: { id: index, payload: "x".repeat(23_000) },
      proof: proof(index),
      evidence: [evidence(index)],
    }));
    const result = reduceP2AtomicResultToBudget({
      envelope: { kind: "task_list" },
      units,
      sourceHasMore: false,
      makeCollectionProof: collection,
    });

    expect(result.items.map((item) => item.id)).toEqual([1, 2]);
    expect(result.item_proofs.map((item) => item.proof_ref)).toEqual([
      proof(1).proof_ref,
      proof(2).proof_ref,
    ]);
    expect(result.evidence.map((item) => item.evidence_ref)).toEqual([
      evidence(1).evidence_ref,
      evidence(2).evidence_ref,
    ]);
    expect(result.collection_proof).toMatchObject({
      returned_count: 2,
      has_more: true,
    });
    expect(measureP2SerializedCharacters(result)).toBeLessThanOrEqual(60_000);
  });

  it("fails closed when the proof-bearing base cannot fit even with zero units", () => {
    try {
      reduceP2AtomicResultToBudget({
        envelope: { payload: "x".repeat(61_000) },
        units: [],
        sourceHasMore: false,
        makeCollectionProof: collection,
      });
      expect.unreachable("oversized proof-bearing base must fail closed");
    } catch (error) {
      expect(error).toBeInstanceOf(P2ResultBudgetError);
      expect((error as P2ResultBudgetError).code).toBe(
        "P2_RESULT_BUDGET_EXCEEDED"
      );
    }
  });

  it("reports budget exhaustion when no complete non-empty unit can fit", () => {
    try {
      reduceP2AtomicResultToBudget({
        envelope: { kind: "task_list" },
        units: [
          {
            item: { id: 1, payload: "x".repeat(61_000) },
            proof: proof(1),
            evidence: [evidence(1)],
          },
        ],
        sourceHasMore: false,
        makeCollectionProof: collection,
      });
      expect.unreachable("indivisible oversized item must fail closed");
    } catch (error) {
      expect(error).toBeInstanceOf(P2ResultBudgetError);
      expect((error as P2ResultBudgetError).code).toBe(
        "P2_RESULT_BUDGET_EXCEEDED"
      );
    }
  });

  it("maps a malformed atomic unit to the fixed privacy-safe error", () => {
    expect(() =>
      reduceP2AtomicResultToBudget({
        envelope: { kind: "task_list" },
        units: [null] as never,
        sourceHasMore: false,
        makeCollectionProof: collection,
      })
    ).toThrowError("P2_RESULT_INVALID");
  });

  it("fails the full result instead of dropping a forbidden tail unit", () => {
    expect(() =>
      reduceP2AtomicResultToBudget({
        envelope: { kind: "task_list" },
        units: [
          { item: { id: 1 }, proof: proof(1), evidence: [evidence(1)] },
          {
            item: { id: 2, provider_id: "private-provider-row" },
            proof: proof(2),
            evidence: [evidence(2)],
          },
        ],
        sourceHasMore: false,
        makeCollectionProof: collection,
      })
    ).toThrowError("P2_RESULT_INVALID");
  });

  it("fails the full result instead of dropping a revision-tampered tail proof", () => {
    expect(() =>
      reduceP2AtomicResultToBudget({
        envelope: { kind: "task_list" },
        units: [
          { item: { id: 1 }, proof: proof(1), evidence: [evidence(1)] },
          {
            item: { id: 2 },
            proof: {
              ...proof(2),
              source_revisions: [{ domain: "tasks", source_revision: 5 }],
            },
            evidence: [evidence(2)],
          },
        ],
        sourceHasMore: false,
        makeCollectionProof: collection,
      })
    ).toThrowError("P2_RESULT_INVALID");
  });

  it("rejects a collection proof that hides known or budget-trimmed rows", () => {
    expect(() =>
      reduceP2AtomicResultToBudget({
        envelope: { kind: "task_list" },
        units: [{ item: { id: 1 }, proof: proof(1), evidence: [evidence(1)] }],
        sourceHasMore: true,
        makeCollectionProof: (returnedCount) =>
          collection(returnedCount, false),
      })
    ).toThrowError("P2_RESULT_INVALID");
  });
});
