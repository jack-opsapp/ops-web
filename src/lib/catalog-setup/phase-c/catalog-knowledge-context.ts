import { createHash } from "crypto";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import type { CatalogFact, GuidedQuestion } from "./types";

export const CATALOG_KNOWLEDGE_CATEGORIES = [
  "service_capability",
  "pricing",
  "final_pricing",
  "process",
  "limitation",
  "material",
  "material_usage",
  "supplier_pricing",
  "supplier_relationship",
  "dimension",
  "lead_time",
  "warranty",
  "correction",
  "seasonal_pattern",
] as const;

const CATEGORY_SET = new Set<string>(CATALOG_KNOWLEDGE_CATEGORIES);
const MAX_QUERY_CHARACTERS = 8_000;
const MAX_CANDIDATES = 300;
const MAX_EVIDENCE = 12;
const MAX_EVIDENCE_CONTENT_CHARACTERS = 600;
const MAX_TOTAL_EVIDENCE_CHARACTERS = 7_200;
const MIN_CONFIDENCE = 0.55;
const MIN_DECAY_SCORE = 0.1;

const CATEGORY_PRIORITY: Record<string, number> = {
  correction: 10,
  service_capability: 9,
  supplier_pricing: 9,
  pricing: 8,
  final_pricing: 8,
  material: 8,
  material_usage: 7,
  limitation: 7,
  process: 6,
  supplier_relationship: 6,
  dimension: 5,
  lead_time: 5,
  warranty: 4,
  seasonal_pattern: 3,
};

const QUERY_STOP_WORDS = new Set([
  "about",
  "answer",
  "catalog",
  "company",
  "current",
  "first",
  "from",
  "have",
  "kind",
  "operator",
  "setup",
  "that",
  "their",
  "this",
  "want",
  "what",
  "when",
  "where",
  "which",
  "with",
  "would",
  "your",
]);

export interface CatalogKnowledgeMemoryRow {
  id: string;
  company_id: string;
  memory_type: string;
  category: string;
  content: string;
  confidence: number;
  source: string;
  entity_id: string | null;
  valid_from: string | null;
  valid_to: string | null;
  decay_score: number;
  created_at: string;
}

export interface CatalogKnowledgeEvidence {
  id: string;
  category: string;
  content: string;
  confidence: number;
  source: string;
  scope: "company" | "entity_specific";
  observedAt: string;
}

export interface CatalogKnowledgeContext {
  queryHash: string;
  evidence: CatalogKnowledgeEvidence[];
}

interface CatalogKnowledgeQueryInput {
  currentQuestion: GuidedQuestion | null;
  answer: unknown;
  facts: CatalogFact[];
}

interface SelectCatalogKnowledgeEvidenceInput {
  companyId: string;
  query: string;
  rows: CatalogKnowledgeMemoryRow[];
}

export interface LoadCatalogKnowledgeContextInput extends CatalogKnowledgeQueryInput {
  companyId: string;
  readRows?: (companyId: string) => Promise<CatalogKnowledgeMemoryRow[]>;
}

function serialize(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function stripControlCharacters(value: string): string {
  return Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127 ? " " : character;
  }).join("");
}

function normalizeText(value: string): string {
  return stripControlCharacters(value)
    .normalize("NFKC")
    .toLocaleLowerCase("en-CA")
    .replace(/[^a-z0-9.$%/-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value: string): string[] {
  return normalizeText(value)
    .split(" ")
    .map((token) =>
      token.length > 4 && token.endsWith("s") ? token.slice(0, -1) : token
    )
    .filter((token) => token.length >= 3 && !QUERY_STOP_WORDS.has(token));
}

function sanitizeEvidenceContent(value: string): string {
  return stripControlCharacters(value)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_EVIDENCE_CONTENT_CHARACTERS);
}

export function buildCatalogKnowledgeQuery({
  currentQuestion,
  answer,
  facts,
}: CatalogKnowledgeQueryInput): string {
  return normalizeText(
    [
      currentQuestion?.prompt ?? "",
      serialize(answer),
      ...facts.map((fact) => `${fact.key} ${serialize(fact.value)}`),
    ].join(" ")
  ).slice(0, MAX_QUERY_CHARACTERS);
}

export function selectCatalogKnowledgeEvidence({
  companyId,
  query,
  rows,
}: SelectCatalogKnowledgeEvidenceInput): CatalogKnowledgeEvidence[] {
  const queryTokens = new Set(tokens(query));
  if (queryTokens.size === 0) return [];
  const now = Date.now();

  const ranked = rows.flatMap((row) => {
    const confidence = Number(row.confidence);
    const decayScore = Number(row.decay_score);
    const validFrom =
      row.valid_from == null ? null : Date.parse(row.valid_from);
    const validTo = row.valid_to == null ? null : Date.parse(row.valid_to);
    if (
      row.company_id !== companyId ||
      !CATEGORY_SET.has(row.category) ||
      (validFrom != null && (!Number.isFinite(validFrom) || validFrom > now)) ||
      (validTo != null && (!Number.isFinite(validTo) || validTo <= now)) ||
      !Number.isFinite(confidence) ||
      confidence < MIN_CONFIDENCE ||
      !Number.isFinite(decayScore) ||
      decayScore <= MIN_DECAY_SCORE
    ) {
      return [];
    }

    const content = sanitizeEvidenceContent(row.content);
    if (!content) return [];
    const normalizedContent = normalizeText(content);
    if (!normalizedContent) return [];

    const contentTokens = new Set(tokens(normalizedContent));
    const overlap = Array.from(queryTokens).filter((token) =>
      contentTokens.has(token)
    ).length;
    if (overlap === 0) return [];

    const entityPenalty = row.entity_id ? 2 : 0;
    const score =
      overlap * 20 +
      (CATEGORY_PRIORITY[row.category] ?? 0) +
      confidence * 2 -
      entityPenalty;

    return [
      {
        score,
        normalizedContent,
        evidence: {
          id: row.id,
          category: row.category,
          content,
          confidence,
          source: row.source,
          scope: row.entity_id
            ? ("entity_specific" as const)
            : ("company" as const),
          observedAt: row.created_at,
        },
      },
    ];
  });

  ranked.sort(
    (left, right) =>
      right.score - left.score ||
      right.evidence.confidence - left.evidence.confidence ||
      right.evidence.observedAt.localeCompare(left.evidence.observedAt) ||
      left.evidence.id.localeCompare(right.evidence.id)
  );

  const selected: CatalogKnowledgeEvidence[] = [];
  const seenContent = new Set<string>();
  let contentCharacters = 0;
  for (const candidate of ranked) {
    if (selected.length >= MAX_EVIDENCE) break;
    if (seenContent.has(candidate.normalizedContent)) continue;
    const remainingCharacters =
      MAX_TOTAL_EVIDENCE_CHARACTERS - contentCharacters;
    if (remainingCharacters <= 0) break;
    const content = candidate.evidence.content.slice(0, remainingCharacters);
    if (!content) break;
    selected.push({ ...candidate.evidence, content });
    seenContent.add(candidate.normalizedContent);
    contentCharacters += content.length;
  }
  return selected;
}

async function readCatalogKnowledgeRows(
  companyId: string
): Promise<CatalogKnowledgeMemoryRow[]> {
  const now = new Date().toISOString();
  const { data, error } = await getServiceRoleClient()
    .from("agent_memories")
    .select(
      "id, company_id, memory_type, category, content, confidence, source, entity_id, valid_from, valid_to, decay_score, created_at"
    )
    .eq("company_id", companyId)
    .in("category", CATALOG_KNOWLEDGE_CATEGORIES)
    .or(`valid_from.is.null,valid_from.lte.${now}`)
    .or(`valid_to.is.null,valid_to.gt.${now}`)
    .gt("decay_score", MIN_DECAY_SCORE)
    .gte("confidence", MIN_CONFIDENCE)
    .order("confidence", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(MAX_CANDIDATES);

  if (error) {
    throw new Error(`Failed to read catalog knowledge: ${error.message}`);
  }
  return (data ?? []) as CatalogKnowledgeMemoryRow[];
}

export async function loadCatalogKnowledgeContext({
  companyId,
  currentQuestion,
  answer,
  facts,
  readRows = readCatalogKnowledgeRows,
}: LoadCatalogKnowledgeContextInput): Promise<CatalogKnowledgeContext> {
  const query = buildCatalogKnowledgeQuery({
    currentQuestion,
    answer,
    facts,
  });
  const rows = await readRows(companyId);
  return {
    queryHash: `sha256:${createHash("sha256").update(query).digest("hex")}`,
    evidence: selectCatalogKnowledgeEvidence({
      companyId,
      query,
      rows,
    }),
  };
}
