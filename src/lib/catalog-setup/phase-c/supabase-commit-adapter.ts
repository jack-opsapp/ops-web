import type { SupabaseClient } from "@supabase/supabase-js";
import { getAccessTokenClient } from "@/lib/supabase/accessToken-client";
import type { CatalogSetupPayload } from "@/lib/catalog-setup/commit/payload-builder.types";
import {
  DEFAULT_TASK_TYPE_COLOR,
} from "@/lib/catalog-setup/commit/task-types-commit";
import { buildLiveCatalogSnapshot } from "./live-catalog-context";
import { loadCompanyCatalogRowSets } from "./session-service";
import { CatalogBlueprintSchema } from "./schemas";
import { verifyCatalogBlueprintReadback } from "./readback-verifier";
import type { CatalogAction, CatalogBlueprint } from "./types";
import type {
  CatalogArchiveResult,
  CatalogCommitStart,
  CatalogGuidedCommitAdapter,
  CatalogSaveResult,
} from "./commit-service";

interface CreateSupabaseCommitAdapterParams {
  token: string;
  companyId: string;
  operatorId: string;
  client?: SupabaseClient;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function rows(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is Record<string, unknown> =>
          !!entry && typeof entry === "object" && !Array.isArray(entry),
      )
    : [];
}

function idFrom(value: unknown, context: string): string {
  const id = asRecord(value).id;
  if (typeof id !== "string" || !id) {
    throw new Error(`${context} did not return an id`);
  }
  return id;
}

function requiredRef(
  action: CatalogAction,
  key: string,
  idMap: Readonly<Record<string, string>>,
): string {
  const logical = action.payload[key];
  if (typeof logical !== "string" || !idMap[logical]) {
    throw new Error(
      `${action.actionKey} has unresolved ${key}: ${String(logical ?? "")}`,
    );
  }
  return idMap[logical];
}

function mapIdMap(value: unknown): Record<string, string> {
  return Object.fromEntries(
    Object.entries(asRecord(value)).flatMap(([key, id]) =>
      typeof id === "string" ? [[key, id]] : [],
    ),
  );
}

export function createSupabaseCatalogGuidedCommitAdapter({
  token,
  companyId,
  operatorId,
  client: injectedClient,
}: CreateSupabaseCommitAdapterParams): CatalogGuidedCommitAdapter {
  const client = injectedClient ?? getAccessTokenClient(token);
  let activeSessionId: string | null = null;
  let activeBlueprint: CatalogBlueprint | null = null;
  const resolvedIds: Record<string, string> = {};

  async function begin(
    sessionId: string,
    approvalHash: string,
  ): Promise<CatalogCommitStart> {
    const { data, error } = await client.rpc(
      "catalog_guided_setup_begin_commit",
      {
        p_session_id: sessionId,
        p_approval_hash: approvalHash,
      },
    );
    if (error) throw new Error(`Could not start catalog commit: ${error.message}`);
    const result = asRecord(data);
    const operationId = result.operationId;
    if (typeof operationId !== "string") {
      throw new Error("Catalog commit did not return an operation id");
    }
    activeSessionId = sessionId;
    return {
      operationId,
      replayed: result.replayed === true,
      status: typeof result.status === "string" ? result.status : "committing",
      readback: asRecord(result.readback),
    };
  }

  async function loadBlueprint(sessionId: string): Promise<CatalogBlueprint> {
    const { data, error } = await client
      .from("catalog_guided_setup_sessions")
      .select("proposed_plan")
      .eq("id", sessionId)
      .eq("company_id", companyId)
      .eq("operator_id", operatorId)
      .maybeSingle();
    if (error) throw new Error(`Could not load catalog plan: ${error.message}`);
    const plan = CatalogBlueprintSchema.parse(
      asRecord(data).proposed_plan,
    );
    activeBlueprint = plan;
    for (const action of plan.actions) {
      if (action.clientId && action.existingId) {
        resolvedIds[action.clientId] = action.existingId;
      }
    }
    return plan;
  }

  async function markActions(
    sessionId: string,
    actionKeys: string[],
    status: "running" | "committed" | "verified" | "failed",
    detail: Record<string, unknown> = {},
  ): Promise<void> {
    if (actionKeys.length === 0) return;
    const now = new Date().toISOString();
    const values: Record<string, unknown> = {
      status,
      updated_at: now,
      ...(status === "running" ? { started_at: now } : {}),
      ...(status === "committed" || status === "verified"
        ? { committed_at: now, response: detail }
        : {}),
      ...(status === "verified" ? { verified_at: now } : {}),
      ...(status === "failed" ? { error: detail } : {}),
    };
    const { error } = await client
      .from("catalog_guided_setup_actions")
      .update(values)
      .eq("session_id", sessionId)
      .eq("company_id", companyId)
      .in("action_key", actionKeys);
    if (error) throw new Error(`Could not journal catalog actions: ${error.message}`);
  }

  async function resolveTaskType(action: CatalogAction): Promise<string> {
    if (action.existingId) {
      if (action.clientId) resolvedIds[action.clientId] = action.existingId;
      return action.existingId;
    }
    const display = String(action.payload.display ?? "").trim();
    if (!display) throw new Error(`${action.actionKey} has no task type name`);

    const existing = await client
      .from("task_types")
      .select("id")
      .eq("company_id", companyId)
      .ilike("display", display)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();
    if (existing.error) {
      throw new Error(`Could not check task type: ${existing.error.message}`);
    }
    if (existing.data) {
      const existingId = idFrom(existing.data, "Task type");
      if (action.clientId) resolvedIds[action.clientId] = existingId;
      return existingId;
    }

    const last = await client
      .from("task_types")
      .select("display_order")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .order("display_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (last.error) {
      throw new Error(`Could not order task type: ${last.error.message}`);
    }
    const displayOrder =
      Number(asRecord(last.data).display_order ?? -1) + 1;
    const inserted = await client
      .from("task_types")
      .insert({
        company_id: companyId,
        display,
        color: DEFAULT_TASK_TYPE_COLOR,
        is_default: false,
        display_order: displayOrder,
      })
      .select("id")
      .single();
    if (inserted.error) {
      throw new Error(`Could not create task type: ${inserted.error.message}`);
    }
    const taskTypeId = idFrom(inserted.data, "Task type");
    if (action.clientId) resolvedIds[action.clientId] = taskTypeId;
    return taskTypeId;
  }

  async function upsertTaxRate(action: CatalogAction): Promise<string> {
    const values = {
      company_id: companyId,
      name: String(action.payload.name ?? ""),
      rate: Number(action.payload.rate),
      is_default: action.payload.isDefault === true,
      is_active: action.payload.isActive !== false,
    };
    let existingId = action.existingId;
    if (!existingId) {
      const existing = await client
        .from("tax_rates")
        .select("id")
        .eq("company_id", companyId)
        .ilike("name", values.name)
        .limit(1)
        .maybeSingle();
      if (existing.error) {
        throw new Error(`Could not check tax rate: ${existing.error.message}`);
      }
      if (existing.data) {
        existingId = idFrom(existing.data, "Tax rate");
      }
    }
    const query = existingId
      ? client
          .from("tax_rates")
          .update(values)
          .eq("id", existingId)
          .eq("company_id", companyId)
          .select("id")
          .single()
      : client
          .from("tax_rates")
          .insert(values)
          .select("id")
          .single();
    const result = await query;
    if (result.error) {
      throw new Error(`Could not save tax rate: ${result.error.message}`);
    }
    const id = idFrom(result.data, "Tax rate");
    if (action.clientId) resolvedIds[action.clientId] = id;
    if (values.is_default) {
      const { error } = await client
        .from("tax_rates")
        .update({ is_default: false })
        .eq("company_id", companyId)
        .neq("id", id);
      if (error) {
        throw new Error(`Could not set default tax rate: ${error.message}`);
      }
    }
    return id;
  }

  async function saveCatalog(
    idempotencyKey: string,
    payload: CatalogSetupPayload,
  ): Promise<CatalogSaveResult> {
    const { data, error } = await client.rpc("catalog_setup_save", {
      p_company_id: companyId,
      p_idempotency_key: idempotencyKey,
      p_payload: payload,
    });
    if (error) {
      return {
        ok: false,
        idMap: {},
        blockers: [{ code: "catalog_setup_save", message: error.message }],
      };
    }
    const result = asRecord(data);
    const blockers = rows(result.blockers);
    const idMap = mapIdMap(result.id_map);
    Object.assign(resolvedIds, idMap);

    // The live RPC predates Phase C task linkage and currently ignores
    // task_type_ref. Patch only the rows just returned by the scope-guarded RPC.
    for (const product of payload.products ?? []) {
      const productId = product.id ?? idMap[product.client_id];
      if (!productId) {
        blockers.push({
          code: "product_id_missing",
          clientId: product.client_id,
        });
        continue;
      }
      const { error: patchError } = await client
        .from("products")
        .update({
          ...(product.task_type_ref
            ? { task_type_ref: product.task_type_ref }
            : {}),
          ...(product.linked_catalog_item_id
            ? { linked_catalog_item_id: product.linked_catalog_item_id }
            : {}),
        })
        .eq("id", productId)
        .eq("company_id", companyId);
      if (patchError) {
        blockers.push({
          code: "product_linkage_failed",
          clientId: product.client_id,
          message: patchError.message,
        });
      }
    }

    // The current catalog RPC also predates variant-level supplier cost writes.
    // Keep the normal RPC as the row owner, then patch only its returned,
    // company-scoped variant ids so reruns remain merge-safe.
    for (const variant of payload.variants ?? []) {
      if (typeof variant.unit_cost_override !== "number") continue;
      const variantId = variant.id ?? idMap[variant.client_id];
      if (!variantId) {
        blockers.push({
          code: "variant_id_missing",
          clientId: variant.client_id,
        });
        continue;
      }
      const { error: patchError } = await client
        .from("catalog_variants")
        .update({ unit_cost_override: variant.unit_cost_override })
        .eq("id", variantId)
        .eq("company_id", companyId);
      if (patchError) {
        blockers.push({
          code: "variant_cost_failed",
          clientId: variant.client_id,
          message: patchError.message,
        });
      }
    }

    return {
      ok: result.ok !== false && blockers.length === 0,
      idMap,
      blockers,
    };
  }

  async function upsertSupplierCost(
    action: CatalogAction,
    idMap: Record<string, string>,
  ): Promise<string> {
    const variantId = requiredRef(action, "variantRef", idMap);
    if (action.payload.isDefault === true) {
      let clearDefault = client
        .from("catalog_supplier_cost_profiles")
        .update({ is_default: false })
        .eq("company_id", companyId)
        .eq("catalog_variant_id", variantId)
        .eq("is_default", true);
      if (action.existingId) {
        clearDefault = clearDefault.neq("id", action.existingId);
      }
      const { error: clearError } = await clearDefault;
      if (clearError) {
        throw new Error(
          `Could not set default supplier cost: ${clearError.message}`,
        );
      }
    }
    const row = {
      ...(action.existingId ? { id: action.existingId } : {}),
      company_id: companyId,
      catalog_variant_id: variantId,
      profile_key: String(action.payload.profileKey ?? ""),
      label: String(action.payload.label ?? ""),
      unit_cost: Number(action.payload.unitCost),
      currency_code: String(action.payload.currencyCode ?? "CAD"),
      is_default: action.payload.isDefault === true,
      activation_rule: asRecord(action.payload.activationRule),
      source: { kind: "verified_supplier" },
      deleted_at: null,
    };
    const { data, error } = await client
      .from("catalog_supplier_cost_profiles")
      .upsert(row, {
        onConflict: "company_id,catalog_variant_id,profile_key",
      })
      .select("id")
      .single();
    if (error) throw new Error(`Could not save supplier cost: ${error.message}`);
    const id = idFrom(data, "Supplier cost");
    if (action.clientId) resolvedIds[action.clientId] = id;
    return id;
  }

  async function upsertMaterialRule(
    action: CatalogAction,
    idMap: Record<string, string>,
  ): Promise<string> {
    const row = {
      ...(action.existingId ? { id: action.existingId } : {}),
      company_id: companyId,
      product_material_id: requiredRef(
        action,
        "productMaterialRef",
        idMap,
      ),
      calculation_kind: String(action.payload.calculationKind ?? ""),
      measure_source: String(action.payload.measureSource ?? ""),
      required_inputs: Array.isArray(action.payload.requiredInputs)
        ? action.payload.requiredInputs
        : [],
      coverage_quantity:
        typeof action.payload.coverageQuantity === "number"
          ? action.payload.coverageQuantity
          : null,
      waste_factor: Number(action.payload.wasteFactor ?? 1),
      purchase_rounding: String(action.payload.purchaseRounding ?? "none"),
      rounding_increment:
        typeof action.payload.roundingIncrement === "number"
          ? action.payload.roundingIncrement
          : null,
      package_quantity:
        typeof action.payload.packageQuantity === "number"
          ? action.payload.packageQuantity
          : null,
      fallback_rule: asRecord(action.payload.fallbackRule),
      config: asRecord(action.payload.config),
      deleted_at: null,
    };
    const { data, error } = await client
      .from("product_material_quantity_rules")
      .upsert(row, {
        onConflict: "company_id,product_material_id",
      })
      .select("id")
      .single();
    if (error) throw new Error(`Could not save material rule: ${error.message}`);
    const id = idFrom(data, "Material rule");
    if (action.clientId) resolvedIds[action.clientId] = id;
    return id;
  }

  async function upsertCapability(
    action: CatalogAction,
    idMap: Record<string, string>,
  ): Promise<string> {
    const row = {
      ...(action.existingId ? { id: action.existingId } : {}),
      company_id: companyId,
      product_id: requiredRef(action, "productRef", idMap),
      capability_key: String(action.payload.capabilityKey ?? ""),
      required_inputs: Array.isArray(action.payload.requiredInputs)
        ? action.payload.requiredInputs
        : [],
      fallback_behavior: asRecord(action.payload.fallbackBehavior),
      enabled: action.payload.enabled !== false,
      deleted_at: null,
    };
    const { data, error } = await client
      .from("catalog_product_capability_bindings")
      .upsert(row, {
        onConflict: "company_id,product_id,capability_key",
      })
      .select("id")
      .single();
    if (error) throw new Error(`Could not save capability: ${error.message}`);
    const id = idFrom(data, "Capability");
    if (action.clientId) resolvedIds[action.clientId] = id;
    return id;
  }

  async function upsertVerification(action: CatalogAction): Promise<string> {
    if (!activeSessionId) throw new Error("Catalog session is not active");
    const row = {
      company_id: companyId,
      session_id: activeSessionId,
      item_key: action.clientId ?? action.actionKey,
      subject_kind: String(action.payload.subjectKind ?? action.targetKind),
      subject_id:
        typeof action.payload.subjectId === "string"
          ? action.payload.subjectId
          : action.existingId ?? null,
      status: "pending",
      severity: "verification",
      message: String(action.payload.message ?? "Verification required"),
      source: {
        check: action.payload.check ?? null,
        sourceFingerprint: action.sourceFingerprint ?? null,
      },
      evidence: {},
    };
    const { data, error } = await client
      .from("catalog_setup_verification_items")
      .upsert(row, { onConflict: "company_id,item_key" })
      .select("id")
      .single();
    if (error) {
      throw new Error(`Could not save verification item: ${error.message}`);
    }
    const id = idFrom(data, "Verification item");
    if (action.clientId) resolvedIds[action.clientId] = id;
    return id;
  }

  async function archiveVariant(
    sessionId: string,
    action: CatalogAction,
  ): Promise<CatalogArchiveResult> {
    const { data, error } = await client.rpc(
      "catalog_guided_setup_archive_variant",
      {
        p_session_id: sessionId,
        p_action_key: action.actionKey,
      },
    );
    if (error) {
      throw new Error(`Could not preflight catalog variant: ${error.message}`);
    }
    const result = asRecord(data);
    return {
      ok: result.ok === true,
      references: Object.fromEntries(
        Object.entries(asRecord(result.references)).flatMap(([table, count]) =>
          Number.isFinite(Number(count)) ? [[table, Number(count)]] : [],
        ),
      ),
    };
  }

  async function archiveOption(action: CatalogAction): Promise<boolean> {
    if (!action.existingId) return false;
    const { error } = await client
      .from("catalog_options")
      .update({
        deleted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", action.existingId)
      .eq("company_id", companyId);
    if (error) throw new Error(`Could not archive catalog option: ${error.message}`);
    return true;
  }

  async function readback(): Promise<Record<string, unknown>> {
    const rowSets = await loadCompanyCatalogRowSets(
      client as unknown as Parameters<
        typeof loadCompanyCatalogRowSets
      >[0],
      companyId,
    );
    const snapshot = buildLiveCatalogSnapshot(companyId, rowSets);
    const active = (value: Array<Record<string, unknown>>) =>
      value.filter((row) => row.deleted_at == null);
    const actions = activeBlueprint?.actions ?? [];
    const logicalId = (action: CatalogAction) =>
      action.existingId ??
      (action.clientId ? resolvedIds[action.clientId] : undefined);
    const verificationIssues = activeBlueprint
      ? verifyCatalogBlueprintReadback({
          blueprint: activeBlueprint,
          snapshot,
          resolvedIds,
        })
      : [{ code: "readback_blueprint_missing" }];
    const productIds = new Set(
      actions.flatMap((action) =>
        action.actionType === "upsert_product" && logicalId(action)
          ? [logicalId(action) as string]
          : [],
      ),
    );
    const familyIds = new Set(
      actions.flatMap((action) =>
        action.actionType === "upsert_catalog_family" && logicalId(action)
          ? [logicalId(action) as string]
          : [],
      ),
    );
    const verifiedProducts = active(snapshot.products).filter((row) =>
      productIds.has(String(row.id ?? "")),
    );
    const verifiedFamilies = active(snapshot.families).filter((row) =>
      familyIds.has(String(row.id ?? "")),
    );
    return {
      status:
        verificationIssues.length === 0 ? "verified" : "attention",
      snapshotHash: snapshot.hash,
      products: verifiedProducts.length,
      families: verifiedFamilies.length,
      variants: active(snapshot.variants).filter((row) =>
        familyIds.has(String(row.catalog_item_id ?? "")),
      ).length,
      supplierCostProfiles: active(snapshot.supplierCostProfiles).length,
      materialRules: active(snapshot.materialQuantityRules).length,
      capabilities: active(snapshot.capabilityBindings).length,
      verificationIssues,
    };
  }

  async function finish(
    sessionId: string,
    operationId: string,
    success: boolean,
    readback: Record<string, unknown>,
    journal: Array<Record<string, unknown>>,
  ): Promise<unknown> {
    const { data, error } = await client.rpc(
      "catalog_guided_setup_finish_commit",
      {
        p_session_id: sessionId,
        p_operation_id: operationId,
        p_success: success,
        p_readback: readback,
        p_commit_journal: journal,
      },
    );
    if (error) throw new Error(`Could not finish catalog commit: ${error.message}`);
    return data;
  }

  return {
    begin,
    loadBlueprint,
    markActions,
    resolveTaskType,
    upsertTaxRate,
    saveCatalog,
    upsertSupplierCost,
    upsertMaterialRule,
    upsertCapability,
    upsertVerification,
    archiveVariant,
    archiveOption,
    readback,
    finish,
  };
}
