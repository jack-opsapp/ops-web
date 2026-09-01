import "server-only";

import {
  P2CollectionProofSchema,
  P2EntityProofSchema,
  type P2DomainRevision,
  type P2CollectionProof,
  type P2EntityProof,
} from "@/lib/agent-control-plane/contracts";
import { canonicalOperationalProjection } from "../../operational-read-projection";

export class P2ProofCouplingError extends Error {
  readonly code = "P2_PROOF_COUPLING_INVALID" as const;

  constructor() {
    super("P2_PROOF_COUPLING_INVALID");
    this.name = "P2ProofCouplingError";
  }
}

function sameRevisions(
  left: readonly P2DomainRevision[],
  right: readonly P2DomainRevision[]
): boolean {
  try {
    return (
      canonicalOperationalProjection(left) ===
      canonicalOperationalProjection(right)
    );
  } catch {
    return false;
  }
}

/** Couples collection and child proofs before any result crosses the boundary. */
export function coupleP2CollectionAndChildProofs(input: {
  readonly collectionProof: unknown;
  readonly childProofs: readonly unknown[];
}): Readonly<{
  collectionProof: P2CollectionProof;
  childProofs: readonly P2EntityProof[];
}> {
  const collection = P2CollectionProofSchema.safeParse(input.collectionProof);
  if (!collection.success || !Array.isArray(input.childProofs)) {
    throw new P2ProofCouplingError();
  }
  const children: P2EntityProof[] = [];
  const refs = new Set<string>([collection.data.proof_ref]);
  for (const rawChild of input.childProofs) {
    const child = P2EntityProofSchema.safeParse(rawChild);
    if (
      !child.success ||
      child.data.read_at !== collection.data.read_at ||
      !sameRevisions(
        collection.data.source_revisions,
        child.data.source_revisions
      ) ||
      refs.has(child.data.proof_ref)
    ) {
      throw new P2ProofCouplingError();
    }
    refs.add(child.data.proof_ref);
    children.push(
      Object.freeze({
        ...child.data,
        source_revisions: Object.freeze(
          child.data.source_revisions.map((revision) =>
            Object.freeze({ ...revision })
          )
        ),
      }) as unknown as P2EntityProof
    );
  }
  if (collection.data.returned_count !== children.length) {
    throw new P2ProofCouplingError();
  }
  const frozenCollection = Object.freeze({
    ...collection.data,
    source_revisions: Object.freeze(
      collection.data.source_revisions.map((revision) =>
        Object.freeze({ ...revision })
      )
    ),
  }) as unknown as P2CollectionProof;
  return Object.freeze({
    collectionProof: frozenCollection,
    childProofs: Object.freeze(children),
  });
}
