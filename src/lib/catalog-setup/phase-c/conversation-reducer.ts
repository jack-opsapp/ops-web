import type {
  CatalogAgentTurn,
  CatalogBlueprint,
  CatalogFact,
  GuidedQuestion,
} from "./types";

export interface CatalogConversationState {
  facts: CatalogFact[];
  contradictions: Array<Record<string, unknown>>;
  unresolvedQuestions: GuidedQuestion[];
  proposedPlan: CatalogBlueprint | null;
}

export interface ReducedCatalogConversationState
  extends CatalogConversationState {
  status: "interviewing" | "review";
}

function stableValue(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableValue).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableValue(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function mergeFacts(
  currentFacts: CatalogFact[],
  incomingFacts: CatalogFact[],
): {
  facts: CatalogFact[];
  contradictions: Array<Record<string, unknown>>;
} {
  const facts = [...currentFacts];
  const contradictions: Array<Record<string, unknown>> = [];

  for (const incoming of incomingFacts) {
    const sameKeyIndexes = facts.flatMap((fact, index) =>
      fact.key === incoming.key ? [index] : [],
    );
    const sameValueIndex = sameKeyIndexes.find(
      (index) => stableValue(facts[index].value) === stableValue(incoming.value),
    );

    if (sameValueIndex !== undefined) {
      facts[sameValueIndex] = incoming;
      continue;
    }

    if (sameKeyIndexes.length === 0) {
      facts.push(incoming);
      continue;
    }

    const conflictingIds = sameKeyIndexes.map((index) => facts[index].id);
    for (const index of sameKeyIndexes) {
      facts[index] = {
        ...facts[index],
        status: "contradicted",
        contradicts: Array.from(
          new Set([...facts[index].contradicts, incoming.id]),
        ),
      };
    }
    facts.push({
      ...incoming,
      status: "contradicted",
      contradicts: Array.from(
        new Set([...incoming.contradicts, ...conflictingIds]),
      ),
    });
    contradictions.push({
      factKey: incoming.key,
      factIds: [...conflictingIds, incoming.id],
    });
  }

  return { facts, contradictions };
}

export function applyCatalogAgentTurn(
  current: CatalogConversationState,
  turn: CatalogAgentTurn,
): ReducedCatalogConversationState {
  const merged = mergeFacts(current.facts, turn.facts);
  const contradictions = [
    ...current.contradictions,
    ...merged.contradictions,
  ];

  if (turn.kind === "question") {
    return {
      facts: merged.facts,
      contradictions,
      unresolvedQuestions: [turn.question],
      proposedPlan: null,
      status: "interviewing",
    };
  }

  return {
    facts: merged.facts,
    contradictions,
    unresolvedQuestions: [],
    proposedPlan: turn.blueprint,
    status: turn.blueprint.ready ? "review" : "interviewing",
  };
}
