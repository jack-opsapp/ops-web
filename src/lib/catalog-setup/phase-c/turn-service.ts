import { createHash } from "crypto";
import { getAccessTokenClient } from "@/lib/supabase/accessToken-client";
import {
  generateGuidedCatalogTurn,
  SetupAgentOutputError,
  type GenerateGuidedCatalogTurnParams,
} from "@/lib/catalog-setup/agent/setup-agent-service";
import { applyCatalogAgentTurn } from "./conversation-reducer";
import {
  CatalogFactSchema,
  CatalogBlueprintSchema,
  GuidedQuestionSchema,
} from "./schemas";
import {
  DEKSMART_MEMBRANES,
  DEKSMART_SYSTEM_MATERIALS,
} from "./reference/deksmart";
import { buildDeksmartVinylDesiredStructure } from "./reference/deksmart-desired";
import { reconcileCatalogStructure } from "./reconcile";
import type { LiveCatalogSnapshot } from "./live-catalog-context";
import type {
  CatalogAgentTurn,
  CatalogAction,
  CatalogFact,
} from "./types";

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
    params: GenerateGuidedCatalogTurnParams,
  ) => ReturnType<typeof generateGuidedCatalogTurn>;
}

function rows(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is Record<string, unknown> =>
          !!entry && typeof entry === "object" && !Array.isArray(entry),
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
    hash:
      typeof snapshot.hash === "string" ? snapshot.hash : null,
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

function numeric(
  action: CatalogAction | undefined,
  key: string,
): number | null {
  const value = action?.payload[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : null;
}

function text(
  action: CatalogAction | undefined,
  key: string,
): string | null {
  const value = action?.payload[key];
  return typeof value === "string" && value.trim()
    ? value.trim()
    : null;
}

/**
 * The model interviews and classifies. Verified supplier adapters own the
 * structural plan. This prevents a plausible-looking model response from
 * inventing or omitting DekSmart colors, SKUs, recipe compatibility, costs, or
 * merge/archive behavior.
 */
export function canonicalizeVerifiedSupplierTurn(
  turn: CatalogAgentTurn,
  liveSnapshot: Record<string, unknown>,
  supplierAdapter?: "deksmart",
): CatalogAgentTurn {
  if (turn.kind !== "review" || supplierAdapter !== "deksmart") {
    return turn;
  }

  const productActions = turn.blueprint.actions.filter(
    (action) => action.actionType === "upsert_product",
  );
  const smoothback = productActions.find((action) =>
    JSON.stringify(action.payload).toLocaleLowerCase("en-CA").includes("60mil"),
  );
  const standard = productActions.find((action) => action !== smoothback);
  const tax = turn.blueprint.actions.find(
    (action) =>
      action.actionType === "upsert_tax_rate" &&
      String(action.payload.name ?? "").toLocaleLowerCase("en-CA") === "gst",
  );
  const task = turn.blueprint.actions.find((action) =>
    ["reuse_task_type", "create_task_type"].includes(action.actionType),
  );

  const config = {
    standardPricePerSqft: numeric(standard, "basePrice"),
    smoothbackPricePerSqft: numeric(smoothback, "basePrice"),
    standardLaborCostPerSqft: numeric(standard, "unitCost"),
    smoothbackLaborCostPerSqft: numeric(smoothback, "unitCost"),
    minimumCharge: numeric(standard, "minimumCharge"),
    taxRate: numeric(tax, "rate"),
    taskTypeDisplay: text(task, "display"),
  };
  const missing = Object.entries(config).flatMap(([key, value]) =>
    value == null ? [key] : [],
  );
  if (missing.length > 0) {
    throw new SetupAgentOutputError(
      `Invalid guided setup response: DekSmart review is missing ${missing.join(", ")}`,
    );
  }

  const desired = buildDeksmartVinylDesiredStructure({
    standardPricePerSqft: config.standardPricePerSqft as number,
    smoothbackPricePerSqft: config.smoothbackPricePerSqft as number,
    standardLaborCostPerSqft:
      config.standardLaborCostPerSqft as number,
    smoothbackLaborCostPerSqft:
      config.smoothbackLaborCostPerSqft as number,
    minimumCharge: config.minimumCharge as number,
    taxRate: config.taxRate as number,
    taskTypeDisplay: config.taskTypeDisplay as string,
  });
  return {
    kind: "review",
    facts: turn.facts,
    blueprint: reconcileCatalogStructure(
      liveSnapshot as unknown as LiveCatalogSnapshot,
      desired,
    ),
  };
}

function normalizedSupplierSignal(value: unknown): string {
  return JSON.stringify(value)
    .normalize("NFKC")
    .toLocaleLowerCase("en-CA")
    .replace(/[^a-z0-9]+/g, "");
}

function explicitSupplierAdapterForAnswer(
  answer: unknown,
): "deksmart" | null {
  const answerRecord = asRecord(answer);
  if (answerRecord.kind === "catalog_source_document") {
    return null;
  }
  return normalizedSupplierSignal(answer).includes("deksmart")
    ? "deksmart"
    : null;
}

export function supplierAdapterForTurn(
  answer: unknown,
  facts: CatalogFact[],
): "deksmart" | null {
  const explicitAnswer = explicitSupplierAdapterForAnswer(answer);
  if (explicitAnswer) return explicitAnswer;

  const confirmedFacts = facts.filter(
    (fact) => fact.status === "confirmed",
  );
  return normalizedSupplierSignal(confirmedFacts).includes("deksmart")
    ? "deksmart"
    : null;
}

export function confirmExplicitSupplierFact(
  turn: CatalogAgentTurn,
  answer: unknown,
  supplierAdapter: "deksmart" | null,
): CatalogAgentTurn {
  if (
    supplierAdapter !== "deksmart" ||
    explicitSupplierAdapterForAnswer(answer) !== "deksmart"
  ) {
    return turn;
  }

  const supplierFact: CatalogFact = {
    id: "fact:supplier:vinyl_membrane:deksmart",
    classification: "material_compatibility",
    key: "suppliers.vinyl_membrane.manufacturer",
    value: "DekSmart",
    source: {
      kind: "operator",
      reference: "explicit supplier selection",
    },
    confidence: 1,
    status: "confirmed",
    contradicts: [],
  };

  return {
    ...turn,
    facts: [
      ...turn.facts.filter((fact) => fact.id !== supplierFact.id),
      supplierFact,
    ],
  };
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
      `Failed to load guided setup: ${currentResult.error.message ?? "unknown error"}`,
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
      `Guided setup cannot accept answers while ${String(current.status)}.`,
    );
  }

  const facts = CatalogFactSchema.array().parse(current.facts ?? []);
  const unresolvedQuestions = GuidedQuestionSchema.array().parse(
    current.unresolved_questions ?? [],
  );
  const contradictions = rows(current.contradictions);
  const proposedPlan =
    current.proposed_plan == null
      ? null
      : CatalogBlueprintSchema.parse(current.proposed_plan);
  const liveSnapshot = asRecord(current.live_snapshot);
  const supplierAdapter = supplierAdapterForTurn(answer, facts);
  const generatedTurn = await generateTurn({
    answer,
    facts,
    contradictions,
    currentQuestion: unresolvedQuestions[0] ?? null,
    liveSnapshotSummary: snapshotSummary(liveSnapshot),
    verifiedReference:
      supplierAdapter === "deksmart"
        ? {
            deksmartMembranes: DEKSMART_MEMBRANES,
            deksmartSystemMaterials: DEKSMART_SYSTEM_MATERIALS,
          }
        : {},
  });
  const supplierConfirmedTurn = confirmExplicitSupplierFact(
    generatedTurn,
    answer,
    supplierAdapter,
  );
  const turn = canonicalizeVerifiedSupplierTurn(
    supplierConfirmedTurn,
    liveSnapshot,
    supplierAdapter ?? undefined,
  );
  const reduced = applyCatalogAgentTurn(
    {
      facts,
      contradictions,
      unresolvedQuestions,
      proposedPlan,
    },
    turn,
  );
  const nextVersion = version + 1;
  const nextPlanHash = reduced.proposedPlan
    ? hashPlan(reduced.proposedPlan)
    : null;
  const answerRecord = asRecord(answer);
  const sourceKind =
    answerRecord.kind === "catalog_source_document"
      ? "upload"
      : "operator";
  const nextSources = [
    ...rows(current.sources),
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
  const updateResult = await client
    .from("catalog_guided_setup_sessions")
    .update({
      status: reduced.status,
      version: nextVersion,
      facts: reduced.facts,
      sources: nextSources,
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
      `Failed to save guided setup: ${updateResult.error.message ?? "unknown error"}`,
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
