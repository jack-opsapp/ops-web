import { getAccessTokenClient } from "@/lib/supabase/accessToken-client";
import {
  acquireSessionLock,
  createSessionLockStore,
  type SessionLockTable,
} from "@/lib/catalog-setup/session-lock-service";
import {
  buildLiveCatalogSnapshot,
  type LiveCatalogContextRowSets,
} from "./live-catalog-context";
import { normalizeGuidedConversation } from "./conversation-history";
import type { GuidedQuestion } from "./types";

const ACTIVE_SESSION_STATUSES = [
  "interviewing",
  "review",
  "approved",
  "committing",
  "attention",
] as const;

interface StartSessionParams {
  token: string;
  companyId: string;
  operatorId: string;
}

interface AbandonSessionParams {
  token: string;
  companyId: string;
  operatorId: string;
  sessionId: string;
  expectedVersion: number;
}

export class GuidedSetupSessionVersionConflictError extends Error {
  constructor() {
    super("Guided setup session changed before it could be restarted");
    this.name = "GuidedSetupSessionVersionConflictError";
  }
}

interface QueryError {
  message?: string;
}

interface QueryResult {
  data: unknown;
  error: QueryError | null;
}

interface LooseQuery extends PromiseLike<QueryResult> {
  select(columns?: string): LooseQuery;
  eq(column: string, value: string | number): LooseQuery;
  in(column: string, values: readonly string[]): LooseQuery;
  order(column: string, options?: { ascending?: boolean }): LooseQuery;
  limit(count: number): LooseQuery;
  update(values: Record<string, unknown>): LooseQuery;
  maybeSingle(): Promise<QueryResult>;
  single(): Promise<QueryResult>;
}

interface LooseTable extends LooseQuery {
  insert(values: Record<string, unknown>): LooseQuery;
}

export interface GuidedSetupQueryClient {
  from(table: string): LooseTable;
}

export const FIRST_SERVICE_LINE_QUESTION: GuidedQuestion = {
  id: "first-service-line",
  prompt: "What service do you want to set up first?",
  answerKind: "text",
  factKeys: ["customer_products.first_service_line"],
  help: "Describe the service, or upload a CSV or Excel price sheet.",
};

function asRows(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter(
        (row): row is Record<string, unknown> =>
          !!row && typeof row === "object" && !Array.isArray(row),
      )
    : [];
}

async function readCompanyRows(
  client: GuidedSetupQueryClient,
  table: string,
  companyId: string,
): Promise<Array<Record<string, unknown>>> {
  const result = await client.from(table).select("*").eq("company_id", companyId);
  if (result.error) {
    throw new Error(
      `Failed to read ${table}: ${result.error.message ?? "unknown error"}`,
    );
  }
  return asRows(result.data);
}

async function readChildRows(
  client: GuidedSetupQueryClient,
  table: string,
  parentColumn: string,
  parentIds: string[],
): Promise<Array<Record<string, unknown>>> {
  if (parentIds.length === 0) return [];
  const result = await client.from(table).select("*").in(parentColumn, parentIds);
  if (result.error) {
    throw new Error(
      `Failed to read ${table}: ${result.error.message ?? "unknown error"}`,
    );
  }
  return asRows(result.data);
}

function rowIds(rows: Array<Record<string, unknown>>): string[] {
  return rows.flatMap((row) =>
    typeof row.id === "string" ? [row.id] : [],
  );
}

/**
 * Loads roots by verified company first, then scopes every child table through
 * those owned parent IDs. This avoids relying on PostgREST relationship-filter
 * syntax and makes cross-company rows impossible to reach.
 */
export async function loadCompanyCatalogRowSets(
  client: GuidedSetupQueryClient,
  companyId: string,
): Promise<LiveCatalogContextRowSets> {
  const [
    products,
    families,
    variants,
    productOptionMappings,
    stockUnits,
    supplierCostProfiles,
    capabilityBindings,
    units,
    categories,
    taskTypes,
    taxRates,
    verificationItems,
  ] = await Promise.all([
    readCompanyRows(client, "products", companyId),
    readCompanyRows(client, "catalog_items", companyId),
    readCompanyRows(client, "catalog_variants", companyId),
    readCompanyRows(client, "catalog_product_option_mappings", companyId),
    readCompanyRows(client, "catalog_stock_units", companyId),
    readCompanyRows(client, "catalog_supplier_cost_profiles", companyId),
    readCompanyRows(client, "catalog_product_capability_bindings", companyId),
    readCompanyRows(client, "catalog_units", companyId),
    readCompanyRows(client, "catalog_categories", companyId),
    readCompanyRows(client, "task_types", companyId),
    readCompanyRows(client, "tax_rates", companyId),
    readCompanyRows(client, "catalog_setup_verification_items", companyId),
  ]);

  const productIds = rowIds(products);
  const familyIds = rowIds(families);
  const variantIds = rowIds(variants);
  const [productOptions, pricingModifiers, productMaterials, catalogOptions, variantOptionValues] =
    await Promise.all([
      readChildRows(client, "product_options", "product_id", productIds),
      readChildRows(
        client,
        "product_pricing_modifiers",
        "product_id",
        productIds,
      ),
      readChildRows(client, "product_materials", "product_id", productIds),
      readChildRows(client, "catalog_options", "catalog_item_id", familyIds),
      readChildRows(
        client,
        "catalog_variant_option_values",
        "variant_id",
        variantIds,
      ),
    ]);

  const [productOptionValues, catalogOptionValues, materialQuantityRules] =
    await Promise.all([
      readChildRows(
        client,
        "product_option_values",
        "option_id",
        rowIds(productOptions),
      ),
      readChildRows(
        client,
        "catalog_option_values",
        "option_id",
        rowIds(catalogOptions),
      ),
      readChildRows(
        client,
        "product_material_quantity_rules",
        "product_material_id",
        rowIds(productMaterials),
      ),
    ]);

  return {
    products,
    productOptions,
    productOptionValues,
    pricingModifiers,
    productMaterials,
    materialQuantityRules,
    families,
    catalogOptions,
    catalogOptionValues,
    variants,
    variantOptionValues,
    productOptionMappings,
    stockUnits,
    supplierCostProfiles,
    capabilityBindings,
    units,
    categories,
    taskTypes,
    taxRates,
    verificationItems,
  };
}

function mapSessionRow(row: Record<string, unknown>) {
  const unresolvedQuestions = asRows(
    row.unresolved_questions,
  ) as unknown as GuidedQuestion[];
  const version = Number(row.version ?? 0);
  return {
    id: row.id,
    companyId: row.company_id,
    operatorId: row.operator_id,
    mode: row.mode,
    status: row.status,
    version,
    facts: row.facts,
    sources: row.sources,
    conversation: normalizeGuidedConversation(
      row.conversation,
      unresolvedQuestions,
      version,
    ),
    unresolvedQuestions,
    contradictions: row.contradictions,
    liveSnapshot: row.live_snapshot,
    liveSnapshotHash: row.live_snapshot_hash,
    proposedPlan: row.proposed_plan,
    proposedPlanHash: row.proposed_plan_hash,
    validationIssues: row.validation_issues,
    approvalHash: row.approval_hash,
    commitJournal: row.commit_journal,
    readback: row.readback,
  };
}

function needsFileQuestionRepair(row: Record<string, unknown>): boolean {
  return (
    row.status === "interviewing" &&
    asRows(row.unresolved_questions).some(
      (question) => question.answerKind === "file",
    )
  );
}

async function repairFileQuestion(
  client: GuidedSetupQueryClient,
  row: Record<string, unknown>,
  companyId: string,
  operatorId: string,
): Promise<Record<string, unknown>> {
  if (!needsFileQuestionRepair(row)) return row;

  const version = Number(row.version ?? 0);
  const nextVersion = version + 1;
  const sessionOperatorId =
    typeof row.operator_id === "string" ? row.operator_id : operatorId;
  const repairedResult = await client
    .from("catalog_guided_setup_sessions")
    .update({
      version: nextVersion,
      unresolved_questions: [FIRST_SERVICE_LINE_QUESTION],
      conversation: normalizeGuidedConversation(
        row.conversation,
        [FIRST_SERVICE_LINE_QUESTION],
        nextVersion,
      ),
      sources: [
        ...asRows(row.sources),
        {
          kind: "system_repair",
          reason: "unsupported_file_question",
          version: nextVersion,
        },
      ],
      updated_at: new Date().toISOString(),
    })
    .eq("id", String(row.id))
    .eq("company_id", companyId)
    .eq("operator_id", sessionOperatorId)
    .eq("version", version)
    .select("*")
    .maybeSingle();

  if (repairedResult.error) {
    throw new Error(
      `Failed to repair guided setup: ${repairedResult.error.message ?? "unknown error"}`,
    );
  }
  if (
    !repairedResult.data ||
    typeof repairedResult.data !== "object"
  ) {
    const latestResult = await client
      .from("catalog_guided_setup_sessions")
      .select("*")
      .eq("id", String(row.id))
      .eq("company_id", companyId)
      .maybeSingle();
    if (latestResult.error) {
      throw new Error(
        `Failed to reload guided setup after repair: ${latestResult.error.message ?? "unknown error"}`,
      );
    }
    if (
      latestResult.data &&
      typeof latestResult.data === "object" &&
      !needsFileQuestionRepair(
        latestResult.data as Record<string, unknown>,
      )
    ) {
      return latestResult.data as Record<string, unknown>;
    }
    throw new Error(
      "Failed to repair guided setup: the session changed in another window",
    );
  }
  return repairedResult.data as Record<string, unknown>;
}

export async function startOrResumeGuidedSetupSession({
  token,
  companyId,
  operatorId,
}: StartSessionParams) {
  const client = getAccessTokenClient(token) as unknown as GuidedSetupQueryClient;
  const existingResult = await client
    .from("catalog_guided_setup_sessions")
    .select("*")
    .eq("company_id", companyId)
    .in("status", ACTIVE_SESSION_STATUSES)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingResult.error) {
    throw new Error(
      `Failed to resume guided setup: ${existingResult.error.message ?? "unknown error"}`,
    );
  }
  if (existingResult.data && typeof existingResult.data === "object") {
    const repairedRow = await repairFileQuestion(
      client,
      existingResult.data as Record<string, unknown>,
      companyId,
      operatorId,
    );
    const session = mapSessionRow(repairedRow);
    const lock = await acquireSessionLock(
      createSessionLockStore(
        () =>
          client.from(
            "catalog_setup_session_locks",
          ) as unknown as SessionLockTable,
        operatorId,
      ),
      companyId,
      String(session.id),
      Date.now(),
      operatorId,
    );
    return {
      resumed: true,
      heldByOther: lock.heldByOther,
      session,
    };
  }

  const rowSets = await loadCompanyCatalogRowSets(client, companyId);
  const snapshot = buildLiveCatalogSnapshot(companyId, rowSets);
  const createdResult = await client
    .from("catalog_guided_setup_sessions")
    .insert({
      company_id: companyId,
      operator_id: operatorId,
      mode: "guided",
      status: "interviewing",
      version: 0,
      facts: [],
      sources: [],
      conversation: normalizeGuidedConversation(
        [],
        [FIRST_SERVICE_LINE_QUESTION],
        0,
      ),
      unresolved_questions: [FIRST_SERVICE_LINE_QUESTION],
      contradictions: [],
      live_snapshot: snapshot,
      live_snapshot_hash: snapshot.hash,
      validation_issues: [],
      commit_journal: [],
    })
    .select("*")
    .single();

  if (createdResult.error) {
    throw new Error(
      `Failed to start guided setup: ${createdResult.error.message ?? "unknown error"}`,
    );
  }
  if (!createdResult.data || typeof createdResult.data !== "object") {
    throw new Error("Failed to start guided setup: no session returned");
  }

  const session = mapSessionRow(
    createdResult.data as Record<string, unknown>,
  );
  const lock = await acquireSessionLock(
    createSessionLockStore(
      () =>
        client.from("catalog_setup_session_locks") as unknown as SessionLockTable,
      operatorId,
    ),
    companyId,
    String(session.id),
    Date.now(),
    operatorId,
  );

  return {
    resumed: false,
    heldByOther: lock.heldByOther,
    session,
  };
}

export async function abandonGuidedSetupSession({
  token,
  companyId,
  operatorId,
  sessionId,
  expectedVersion,
}: AbandonSessionParams) {
  const client = getAccessTokenClient(token) as unknown as GuidedSetupQueryClient;
  const currentResult = await client
    .from("catalog_guided_setup_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("company_id", companyId)
    .maybeSingle();

  if (currentResult.error) {
    throw new Error(
      `Failed to load guided setup: ${currentResult.error.message ?? "unknown error"}`,
    );
  }
  if (!currentResult.data || typeof currentResult.data !== "object") {
    throw new GuidedSetupSessionVersionConflictError();
  }
  const current = currentResult.data as Record<string, unknown>;
  if (
    Number(current.version) !== expectedVersion ||
    !ACTIVE_SESSION_STATUSES.includes(
      current.status as (typeof ACTIVE_SESSION_STATUSES)[number],
    )
  ) {
    throw new GuidedSetupSessionVersionConflictError();
  }

  const nextVersion = expectedVersion + 1;
  const updatedResult = await client
    .from("catalog_guided_setup_sessions")
    .update({
      status: "abandoned",
      version: nextVersion,
      sources: [
        ...asRows(current.sources),
        {
          kind: "operator",
          action: "abandon_setup",
          operatorId,
          version: nextVersion,
        },
      ],
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId)
    .eq("company_id", companyId)
    .eq("version", expectedVersion)
    .in("status", ACTIVE_SESSION_STATUSES)
    .select("*")
    .maybeSingle();

  if (updatedResult.error) {
    throw new Error(
      `Failed to restart guided setup: ${updatedResult.error.message ?? "unknown error"}`,
    );
  }
  if (!updatedResult.data || typeof updatedResult.data !== "object") {
    throw new GuidedSetupSessionVersionConflictError();
  }
  return mapSessionRow(updatedResult.data as Record<string, unknown>);
}
