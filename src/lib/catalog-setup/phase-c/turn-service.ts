import { createHash } from "crypto";
import { getAccessTokenClient } from "@/lib/supabase/accessToken-client";
import {
  generateGuidedCatalogTurn,
  type GenerateGuidedCatalogTurnParams,
} from "@/lib/catalog-setup/agent/setup-agent-service";
import { applyCatalogAgentTurn } from "./conversation-reducer";
import {
  advanceGuidedConversation,
  normalizeGuidedConversation,
} from "./conversation-history";
import {
  CatalogFactSchema,
  CatalogBlueprintSchema,
  GuidedQuestionSchema,
} from "./schemas";
import {
  loadCatalogKnowledgeContext,
  type CatalogKnowledgeContext,
  type LoadCatalogKnowledgeContextInput,
} from "./catalog-knowledge-context";

interface QueryError {
  message?: string;
}

interface QueryResult {
  data: unknown;
  error: QueryError | null;
}

interface TurnQuery extends PromiseLike<QueryResult> {
  select(columns?: string): TurnQuery;
  eq(column: string, value: string | number): TurnQuery;
  update(values: Record<string, unknown>): TurnQuery;
  maybeSingle(): Promise<QueryResult>;
}

type TurnTable = TurnQuery;

export interface GuidedTurnQueryClient {
  from(table: string): TurnTable;
}

export class GuidedSetupVersionConflictError extends Error {
  constructor() {
    super("Guided setup changed in another window");
    this.name = "GuidedSetupVersionConflictError";
  }
}

export class GuidedSetupSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuidedSetupSessionError";
  }
}

interface RunGuidedSetupTurnParams {
  token: string;
  companyId: string;
  operatorId: string;
  sessionId: string;
  answer: unknown;
  expectedVersion: number;
  client?: GuidedTurnQueryClient;
  generateTurn?: (
    params: GenerateGuidedCatalogTurnParams
  ) => ReturnType<typeof generateGuidedCatalogTurn>;
  loadKnowledge?: (
    params: LoadCatalogKnowledgeContextInput
  ) => Promise<CatalogKnowledgeContext>;
}

function rows(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is Record<string, unknown> =>
          !!entry && typeof entry === "object" && !Array.isArray(entry)
      )
    : [];
}

function snapshotSummary(snapshot: Record<string, unknown>) {
  const products = rows(snapshot.products);
  const families = rows(snapshot.families);
  const variants = rows(snapshot.variants);
  const taskTypes = rows(snapshot.taskTypes);
  const taxRates = rows(snapshot.taxRates);
  return {
    hash: typeof snapshot.hash === "string" ? snapshot.hash : null,
    counts: {
      products: products.length,
      families: families.length,
      variants: variants.length,
      taskTypes: taskTypes.length,
      taxRates: taxRates.length,
    },
    products: products.map((row) => ({
      id: row.id,
      name: row.name,
      deletedAt: row.deleted_at ?? null,
      taskTypeRef: row.task_type_ref ?? null,
    })),
    families: families.map((row) => ({
      id: row.id,
      name: row.name,
      deletedAt: row.deleted_at ?? null,
    })),
    taskTypes: taskTypes.map((row) => ({
      id: row.id,
      display: row.display,
      deletedAt: row.deleted_at ?? null,
    })),
    taxRates: taxRates.map((row) => ({
      id: row.id,
      name: row.name,
      rate: row.rate,
      isDefault: row.is_default,
      isActive: row.is_active,
    })),
  };
}

function hashPlan(plan: unknown): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(plan))
    .digest("hex")}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function runGuidedSetupTurn({
  token,
  companyId,
  operatorId,
  sessionId,
  answer,
  expectedVersion,
  client: injectedClient,
  generateTurn = generateGuidedCatalogTurn,
  loadKnowledge = loadCatalogKnowledgeContext,
}: RunGuidedSetupTurnParams) {
  const client =
    injectedClient ??
    (getAccessTokenClient(token) as unknown as GuidedTurnQueryClient);
  const currentResult = await client
    .from("catalog_guided_setup_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("company_id", companyId)
    .maybeSingle();

  if (currentResult.error) {
    throw new GuidedSetupSessionError(
      `Failed to load guided setup: ${currentResult.error.message ?? "unknown error"}`
    );
  }
  if (!currentResult.data || typeof currentResult.data !== "object") {
    throw new GuidedSetupSessionError("Guided setup session not found");
  }
  const current = currentResult.data as Record<string, unknown>;
  const version = Number(current.version ?? 0);
  if (version !== expectedVersion) {
    throw new GuidedSetupVersionConflictError();
  }
  if (!["interviewing", "review"].includes(String(current.status))) {
    throw new GuidedSetupSessionError(
      `Guided setup cannot accept answers while ${String(current.status)}.`
    );
  }

  const facts = CatalogFactSchema.array().parse(current.facts ?? []);
  const unresolvedQuestions = GuidedQuestionSchema.array().parse(
    current.unresolved_questions ?? []
  );
  const contradictions = rows(current.contradictions);
  const conversation = normalizeGuidedConversation(
    current.conversation,
    unresolvedQuestions,
    version
  );
  const proposedPlan =
    current.proposed_plan == null
      ? null
      : CatalogBlueprintSchema.parse(current.proposed_plan);
  const liveSnapshot = asRecord(current.live_snapshot);
  let companyKnowledge: CatalogKnowledgeContext = {
    queryHash: "",
    evidence: [],
  };
  try {
    companyKnowledge = await loadKnowledge({
      companyId,
      currentQuestion: unresolvedQuestions[0] ?? null,
      answer,
      facts,
    });
  } catch (error) {
    console.error("[catalog-setup] Company knowledge unavailable", error);
  }
  const turn = await generateTurn({
    answer,
    facts,
    contradictions,
    currentQuestion: unresolvedQuestions[0] ?? null,
    liveSnapshotSummary: snapshotSummary(liveSnapshot),
    verifiedReference: {},
    companyKnowledge: companyKnowledge.evidence,
  });
  const reduced = applyCatalogAgentTurn(
    {
      facts,
      contradictions,
      unresolvedQuestions,
      proposedPlan,
    },
    turn
  );
  const nextVersion = version + 1;
  const nextPlanHash = reduced.proposedPlan
    ? hashPlan(reduced.proposedPlan)
    : null;
  const answerRecord = asRecord(answer);
  const sourceKind =
    answerRecord.kind === "catalog_source_document" ? "upload" : "operator";
  const knowledgeSource =
    companyKnowledge.evidence.length > 0
      ? [
          {
            kind: "company_knowledge",
            queryHash: companyKnowledge.queryHash,
            memoryIds: companyKnowledge.evidence.map((entry) => entry.id),
            categories: Array.from(
              new Set(companyKnowledge.evidence.map((entry) => entry.category))
            ),
            version: nextVersion,
          },
        ]
      : [];
  const nextSources = [
    ...rows(current.sources),
    ...knowledgeSource,
    {
      kind: sourceKind,
      questionId: unresolvedQuestions[0]?.id ?? null,
      answer,
      ...(sourceKind === "upload"
        ? {
            filename: answerRecord.filename,
            rowCount: answerRecord.rowCount,
            sourceHash: hashPlan(answer),
          }
        : {}),
      version: nextVersion,
    },
  ];
  const nextConversation = advanceGuidedConversation({
    conversation,
    currentQuestion: unresolvedQuestions[0] ?? null,
    answer,
    nextQuestion: reduced.unresolvedQuestions[0] ?? null,
    nextVersion,
  });
  const updateResult = await client
    .from("catalog_guided_setup_sessions")
    .update({
      status: reduced.status,
      version: nextVersion,
      facts: reduced.facts,
      sources: nextSources,
      conversation: nextConversation,
      unresolved_questions: reduced.unresolvedQuestions,
      contradictions: reduced.contradictions,
      proposed_plan: reduced.proposedPlan,
      proposed_plan_hash: nextPlanHash,
      validation_issues: reduced.proposedPlan?.issues ?? [],
      approval_hash: null,
      approved_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId)
    .eq("company_id", companyId)
    .eq("operator_id", operatorId)
    .eq("version", expectedVersion)
    .select("*")
    .maybeSingle();

  if (updateResult.error) {
    throw new GuidedSetupSessionError(
      `Failed to save guided setup: ${updateResult.error.message ?? "unknown error"}`
    );
  }
  if (!updateResult.data || typeof updateResult.data !== "object") {
    throw new GuidedSetupVersionConflictError();
  }

  return {
    session: updateResult.data,
    turn,
  };
}
