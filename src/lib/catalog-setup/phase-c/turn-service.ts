import { createHash } from "crypto";
import { getAccessTokenClient } from "@/lib/supabase/accessToken-client";
import {
  generateGuidedCatalogTurn,
  type GenerateGuidedCatalogTurnParams,
} from "@/lib/catalog-setup/agent/setup-agent-service";
import { applyCatalogAgentTurn } from "./conversation-reducer";
import {
  acceptGuidedConversationInputs,
  advanceGuidedConversation,
  normalizeGuidedConversation,
} from "./conversation-history";
import { normalizeGuidedInputLedger } from "./input-ledger";
import { narrowGuidedQuestionToUnresolvedFacts } from "./question-policy";
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
import {
  CATALOG_CAPABILITY_MANIFEST_REVISION,
} from "./catalog-capability-manifest";

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
  answer?: unknown;
  expectedVersion: number;
  expectedInputRevision?: number;
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
  expectedInputRevision,
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
    .eq("operator_id", operatorId)
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
  const inputRevision = Number(current.input_revision ?? 0);
  const processedInputRevision = Number(
    current.processed_input_revision ?? 0,
  );
  const manifestRevision =
    typeof current.capability_manifest_revision === "string"
      ? current.capability_manifest_revision
      : CATALOG_CAPABILITY_MANIFEST_REVISION;
  if (
    expectedInputRevision != null &&
    inputRevision !== expectedInputRevision
  ) {
    throw new GuidedSetupVersionConflictError();
  }
  if (manifestRevision !== CATALOG_CAPABILITY_MANIFEST_REVISION) {
    throw new GuidedSetupSessionError(
      "OPS capabilities changed. Reload Guided Catalog Setup.",
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
  const inputLedger = normalizeGuidedInputLedger(current.input_ledger);
  const queuedInputs =
    expectedInputRevision == null
      ? []
      : inputLedger.filter(
          (entry) =>
            entry.state === "queued" &&
            entry.revision > processedInputRevision &&
            entry.revision <= expectedInputRevision,
        );
  if (expectedInputRevision != null && queuedInputs.length === 0) {
    throw new GuidedSetupSessionError(
      "There are no queued messages for Phase C.",
    );
  }
  const turnAnswer =
    queuedInputs.length === 0
      ? answer
      : queuedInputs.length === 1
        ? queuedInputs[0].answer
        : {
            kind: "operator_input_batch",
            inputs: queuedInputs.map((entry) => ({
              id: entry.id,
              revision: entry.revision,
              questionId: entry.questionId ?? null,
              answer: entry.answer,
            })),
          };
  let companyKnowledge: CatalogKnowledgeContext = {
    queryHash: "",
    evidence: [],
  };
  try {
    companyKnowledge = await loadKnowledge({
      companyId,
      currentQuestion: unresolvedQuestions[0] ?? null,
      answer: turnAnswer,
      facts,
    });
  } catch (error) {
    console.error("[catalog-setup] Company knowledge unavailable", error);
  }
  const turn = await generateTurn({
    answer: turnAnswer,
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
  // A question may only ask for facts still unresolved after this turn's
  // facts merge — otherwise the deterministic template regenerates the
  // already-answered sentence under a fresh model-minted id and the
  // transcript shows the question again after the operator's reply
  // (bug 986009b0, session 3af7b940 ords 7–9).
  const nextQuestion =
    reduced.unresolvedQuestions.length > 0
      ? (narrowGuidedQuestionToUnresolvedFacts(
          reduced.unresolvedQuestions[0],
          reduced.facts,
        ) ?? reduced.unresolvedQuestions[0])
      : null;
  const nextUnresolvedQuestions = nextQuestion ? [nextQuestion] : [];
  const nextVersion = version + 1;
  const nextPlanHash = reduced.proposedPlan
    ? hashPlan(reduced.proposedPlan)
    : null;
  const answerRecord = asRecord(turnAnswer);
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
  const operatorSources =
    queuedInputs.length > 0
      ? queuedInputs.map((entry) => {
          if (entry.displayKind === "source_document") {
            const sourceDocument = asRecord(entry.answer);
            return {
              kind: "upload",
              inputId: entry.id,
              questionId: entry.questionId ?? null,
              filename: entry.filename ?? sourceDocument.filename,
              rowCount: sourceDocument.rowCount,
              sourceHash: hashPlan(entry.answer),
              revision: entry.revision,
              version: nextVersion,
            };
          }
          return {
            kind: "operator",
            inputId: entry.id,
            questionId: entry.questionId ?? null,
            answer: entry.answer,
            revision: entry.revision,
            version: nextVersion,
          };
        })
      : [
          {
            kind: sourceKind,
            questionId: unresolvedQuestions[0]?.id ?? null,
            answer: turnAnswer,
            ...(sourceKind === "upload"
              ? {
                  filename: answerRecord.filename,
                  rowCount: answerRecord.rowCount,
                  sourceHash: hashPlan(turnAnswer),
                }
              : {}),
            version: nextVersion,
          },
        ];
  const nextSources = [
    ...rows(current.sources),
    ...knowledgeSource,
    ...operatorSources,
  ];
  const acceptedInputIds = queuedInputs.map((entry) => entry.id);
  const nextConversation =
    queuedInputs.length > 0
      ? acceptGuidedConversationInputs({
          conversation,
          acceptedInputIds,
          nextQuestion: nextQuestion,
          nextVersion,
        })
      : advanceGuidedConversation({
          conversation,
          currentQuestion: unresolvedQuestions[0] ?? null,
          answer: turnAnswer,
          nextQuestion: nextQuestion,
          nextVersion,
        });
  const nextInputLedger =
    queuedInputs.length > 0
      ? inputLedger.map((entry) =>
          acceptedInputIds.includes(entry.id)
            ? {
                ...entry,
                state: "accepted" as const,
                updatedAt: new Date().toISOString(),
              }
            : entry,
        )
      : inputLedger;
  const updateResult = await client
    .from("catalog_guided_setup_sessions")
    .update({
      status: reduced.status,
      version: nextVersion,
      ...(queuedInputs.length > 0
        ? {
            processed_input_revision: expectedInputRevision,
            input_ledger: nextInputLedger,
          }
        : {}),
      facts: reduced.facts,
      sources: nextSources,
      conversation: nextConversation,
      unresolved_questions: nextUnresolvedQuestions,
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
    .eq("input_revision", inputRevision)
    .eq(
      "capability_manifest_revision",
      CATALOG_CAPABILITY_MANIFEST_REVISION,
    )
    .select("*")
    .maybeSingle();

  if (updateResult.error) {
    throw new GuidedSetupSessionError(
      `Failed to save guided setup: ${updateResult.error.message ?? "unknown error"}`
    );
  }
  if (!updateResult.data || typeof updateResult.data !== "object") {
    if (expectedInputRevision != null) {
      const latestResult = await client
        .from("catalog_guided_setup_sessions")
        .select("*")
        .eq("id", sessionId)
        .eq("company_id", companyId)
        .eq("operator_id", operatorId)
        .maybeSingle();
      if (
        !latestResult.error &&
        latestResult.data &&
        typeof latestResult.data === "object"
      ) {
        return {
          session: latestResult.data,
          turn: null,
          superseded: true,
        };
      }
    }
    throw new GuidedSetupVersionConflictError();
  }

  return {
    session: updateResult.data,
    turn,
    superseded: false,
  };
}
