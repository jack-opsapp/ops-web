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

interface QueryError {
  message?: string;
}

interface QueryResult {
  data: unknown;
  error: QueryError | null;
}

interface LooseQuery extends PromiseLike<QueryResult> {
  select(columns?: string): LooseQuery;
  eq(column: string, value: string): LooseQuery;
  in(column: string, values: readonly string[]): LooseQuery;
  order(column: string, options?: { ascending?: boolean }): LooseQuery;
  limit(count: number): LooseQuery;
  maybeSingle(): Promise<QueryResult>;
  single(): Promise<QueryResult>;
}

interface LooseTable extends LooseQuery {
  insert(values: Record<string, unknown>): LooseQuery;
}

export interface GuidedSetupQueryClient {
  from(table: string): LooseTable;
}

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
    verificationItems,
  };
}

function mapSessionRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    companyId: row.company_id,
    operatorId: row.operator_id,
    mode: row.mode,
    status: row.status,
    version: row.version,
    facts: row.facts,
    sources: row.sources,
    unresolvedQuestions: row.unresolved_questions,
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
    const session = mapSessionRow(
      existingResult.data as Record<string, unknown>,
    );
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
      unresolved_questions: [],
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
