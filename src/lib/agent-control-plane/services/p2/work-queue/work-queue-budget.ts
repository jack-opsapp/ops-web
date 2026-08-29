import "server-only";

import {
  P2EntityProofSchema,
  P2EvidenceIdentitySchema,
  P2_MAX_SERIALIZED_CHARACTERS,
} from "@/lib/agent-control-plane/contracts";
import {
  WorkQueueCardSchema,
  WorkQueueCollectionProofSchema,
  type WorkQueueCard,
} from "@/lib/agent-control-plane/contracts/work-queue";
import { measureP2SerializedCharacters } from "../shared/result-budget";

const SOURCE_DOMAINS: Readonly<
  Record<WorkQueueCard["source"], readonly string[]>
> = Object.freeze({
  task: ["legacy_operational", "tasks"],
  lead: ["legacy_operational", "work_queue"],
  correspondence: ["legacy_job_history", "legacy_operational", "work_queue"],
  commitment: ["work_queue"],
  match_review: ["work_queue"],
  schedule: ["legacy_operational"],
  financial_document: ["legacy_operational", "sales_documents"],
  payment: ["legacy_operational", "payments", "sales_documents"],
  expense: ["expenses"],
});

export class WorkQueueBudgetError extends Error {
  readonly code: "INVALID" | "BUDGET_EXCEEDED";
  constructor(code: WorkQueueBudgetError["code"]) {
    super(`WORK_QUEUE_RESULT_${code}`);
    this.name = "WorkQueueBudgetError";
    this.code = code;
  }
}

export function deepFreezeWorkQueue<T>(
  value: T,
  seen = new WeakSet<object>()
): T {
  if (typeof value !== "object" || value === null || seen.has(value))
    return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreezeWorkQueue(child, seen);
  return Object.freeze(value);
}

function same(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Retains only a complete item/proof/evidence prefix under the exact wire budget. */
export function reduceWorkQueueAtomicPrefix(input: {
  readonly warnings: readonly unknown[];
  readonly units: readonly {
    readonly item: unknown;
    readonly proof: unknown;
    readonly evidence: readonly unknown[];
  }[];
  readonly sourceHasMore: boolean;
  readonly collectionSourceRevisions: readonly {
    domain: string;
    source_revision: number;
  }[];
  readonly makeCollectionProof: (
    returnedCount: number,
    hasMore: boolean
  ) => unknown;
}) {
  try {
    if (!Array.isArray(input.units) || input.units.length > 25)
      throw new Error();
    const queueRefs = new Set<string>();
    const proofRefs = new Set<string>();
    const evidenceRefs = new Set<string>();
    const revisionByDomain = new Map(
      input.collectionSourceRevisions.map((revision) => [
        revision.domain,
        revision,
      ])
    );
    const units = input.units.map((unit) => {
      const item = WorkQueueCardSchema.parse(unit.item);
      const proof = P2EntityProofSchema.parse(unit.proof);
      if (!Array.isArray(unit.evidence) || unit.evidence.length !== 1)
        throw new Error();
      const evidence = P2EvidenceIdentitySchema.parse(unit.evidence[0]);
      const queueIdentity = `${item.queue_ref.kind}:${item.queue_ref.id}`;
      const expectedRevisions = SOURCE_DOMAINS[item.source].map((domain) =>
        revisionByDomain.get(domain)
      );
      if (
        queueRefs.has(queueIdentity) ||
        proofRefs.has(proof.proof_ref) ||
        evidenceRefs.has(evidence.evidence_ref) ||
        expectedRevisions.some((revision) => revision === undefined) ||
        !same(proof.source_revisions, expectedRevisions) ||
        evidence.occurred_at !== proof.read_at ||
        evidence.source_domain !== "work_queue" ||
        evidence.source_type !== item.source
      )
        throw new Error();
      queueRefs.add(queueIdentity);
      proofRefs.add(proof.proof_ref);
      evidenceRefs.add(evidence.evidence_ref);
      return deepFreezeWorkQueue({ item, proof, evidence });
    });
    const build = (retainedCount: number) => {
      const retained = units.slice(0, retainedCount);
      const hasMore = input.sourceHasMore || retainedCount < units.length;
      const collectionProof = WorkQueueCollectionProofSchema.parse(
        input.makeCollectionProof(retainedCount, hasMore)
      );
      if (
        collectionProof.returned_count !== retainedCount ||
        collectionProof.has_more !== hasMore ||
        !same(
          collectionProof.source_revisions,
          input.collectionSourceRevisions
        ) ||
        retained.some((unit) => unit.proof.read_at !== collectionProof.read_at)
      )
        throw new Error();
      const result = deepFreezeWorkQueue({
        warnings: input.warnings,
        next_cursor: null,
        items: retained.map(({ item }) => item),
        item_proofs: retained.map(({ proof }) => proof),
        evidence: retained.map(({ evidence }) => evidence),
        collection_proof: collectionProof,
      });
      return { result, size: measureP2SerializedCharacters(result) };
    };
    const full = build(units.length);
    if (full.size <= P2_MAX_SERIALIZED_CHARACTERS) return full.result;
    for (
      let count = units.length - 1;
      count >= (units.length ? 1 : 0);
      count -= 1
    ) {
      const candidate = build(count);
      if (candidate.size <= P2_MAX_SERIALIZED_CHARACTERS)
        return candidate.result;
    }
    throw new WorkQueueBudgetError("BUDGET_EXCEEDED");
  } catch (error) {
    if (error instanceof WorkQueueBudgetError) throw error;
    throw new WorkQueueBudgetError("INVALID");
  }
}
