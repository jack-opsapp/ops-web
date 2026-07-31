import type { LiveCatalogSnapshot } from "./live-catalog-context";
import type { CatalogAction, CatalogBlueprint } from "./types";

export interface VerifyCatalogReadbackInput {
  blueprint: CatalogBlueprint;
  snapshot: LiveCatalogSnapshot;
  resolvedIds: Readonly<Record<string, string>>;
}

function active(rows: Array<Record<string, unknown>>) {
  return rows.filter((row) => row.deleted_at == null);
}

function normalizedText(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en-CA");
}

function sameNumber(actual: unknown, expected: unknown): boolean {
  return (
    typeof expected !== "number" ||
    (Number.isFinite(Number(actual)) &&
      Math.abs(Number(actual) - expected) < 0.0001)
  );
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  }
  return value;
}

function sameJson(actual: unknown, expected: unknown): boolean {
  return (
    JSON.stringify(stableValue(actual ?? null)) ===
    JSON.stringify(stableValue(expected ?? null))
  );
}

function targetId(
  action: CatalogAction,
  resolvedIds: Readonly<Record<string, string>>,
): string | undefined {
  return (
    action.existingId ??
    (action.clientId ? resolvedIds[action.clientId] : undefined)
  );
}

function resolvedRef(
  value: unknown,
  resolvedIds: Readonly<Record<string, string>>,
): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  return resolvedIds[value] ?? value;
}

const PERSISTED_ID_ACTIONS = new Set<CatalogAction["actionType"]>([
  "upsert_product",
  "upsert_product_option",
  "upsert_product_option_value",
  "upsert_catalog_family",
  "upsert_catalog_option",
  "upsert_catalog_option_value",
  "upsert_catalog_variant",
  "move_catalog_variant",
  "map_product_catalog_option",
  "upsert_product_material",
  "upsert_material_quantity_rule",
  "upsert_supplier_cost_profile",
  "upsert_capability_binding",
  "reuse_task_type",
  "create_task_type",
  "upsert_tax_rate",
  "archive_catalog_variant",
  "archive_catalog_option",
  "create_verification_item",
]);

export function verifyCatalogBlueprintReadback({
  blueprint,
  snapshot,
  resolvedIds,
}: VerifyCatalogReadbackInput): Array<Record<string, unknown>> {
  const issues: Array<Record<string, unknown>> = [];
  const mismatch = (
    code: string,
    action: CatalogAction,
    id?: string,
  ) => {
    issues.push({
      code,
      actionKey: action.actionKey,
      ...(id ? { targetId: id } : {}),
    });
  };

  for (const action of blueprint.actions) {
    const id = targetId(action, resolvedIds);
    if (PERSISTED_ID_ACTIONS.has(action.actionType) && !id) {
      mismatch("readback_id_missing", action);
      continue;
    }

    if (action.actionType === "upsert_product") {
      const row = active(snapshot.products).find((entry) => entry.id === id);
      if (
        !row ||
        normalizedText(row.name) !== normalizedText(action.payload.name) ||
        normalizedText(row.description) !==
          normalizedText(action.payload.description) ||
        !sameNumber(row.base_price, action.payload.basePrice) ||
        !sameNumber(row.default_price, action.payload.defaultPrice) ||
        !sameNumber(row.unit_cost, action.payload.unitCost) ||
        !sameNumber(row.minimum_charge, action.payload.minimumCharge) ||
        normalizedText(row.pricing_unit) !==
          normalizedText(action.payload.pricingUnit) ||
        normalizedText(row.kind) !== normalizedText(action.payload.kind) ||
        normalizedText(row.type) !== normalizedText(action.payload.type) ||
        row.is_taxable !== action.payload.isTaxable ||
        row.show_in_storefront !== action.payload.showInStorefront ||
        row.is_active !== true ||
        row.task_type_ref !==
          resolvedRef(action.payload.taskTypeClientId, resolvedIds) ||
        row.linked_catalog_item_id !==
          resolvedRef(action.payload.linkedFamilyRef, resolvedIds)
      ) {
        mismatch("product_readback_mismatch", action, id);
      }
    } else if (action.actionType === "upsert_product_option") {
      const row = active(snapshot.productOptions).find(
        (entry) => entry.id === id,
      );
      if (
        !row ||
        row.product_id !==
          resolvedRef(action.payload.productRef, resolvedIds) ||
        normalizedText(row.name) !== normalizedText(action.payload.name) ||
        normalizedText(row.kind) !== normalizedText(action.payload.kind) ||
        row.affects_price !== action.payload.affectsPrice ||
        row.affects_recipe !== action.payload.affectsRecipe ||
        row.required !== action.payload.required ||
        !sameNumber(row.sort_order, action.payload.sortOrder)
      ) {
        mismatch("product_option_readback_mismatch", action, id);
      }
    } else if (action.actionType === "upsert_product_option_value") {
      const row = active(snapshot.productOptionValues).find(
        (entry) => entry.id === id,
      );
      if (
        !row ||
        row.option_id !==
          resolvedRef(action.payload.optionRef, resolvedIds) ||
        normalizedText(row.value) !== normalizedText(action.payload.value) ||
        !sameNumber(row.sort_order, action.payload.sortOrder)
      ) {
        mismatch("product_value_readback_mismatch", action, id);
      }
    } else if (action.actionType === "upsert_catalog_family") {
      const row = active(snapshot.families).find((entry) => entry.id === id);
      if (!row || normalizedText(row.name) !== normalizedText(action.payload.name)) {
        mismatch("family_readback_mismatch", action, id);
      }
    } else if (action.actionType === "upsert_catalog_option") {
      const row = active(snapshot.catalogOptions).find(
        (entry) => entry.id === id,
      );
      if (
        !row ||
        row.catalog_item_id !==
          resolvedRef(action.payload.familyRef, resolvedIds) ||
        normalizedText(row.name) !== normalizedText(action.payload.name) ||
        !sameNumber(row.sort_order, action.payload.sortOrder)
      ) {
        mismatch("catalog_option_readback_mismatch", action, id);
      }
    } else if (action.actionType === "upsert_catalog_option_value") {
      const row = active(snapshot.catalogOptionValues).find(
        (entry) => entry.id === id,
      );
      if (
        !row ||
        row.option_id !==
          resolvedRef(action.payload.optionRef, resolvedIds) ||
        normalizedText(row.value) !== normalizedText(action.payload.value) ||
        !sameNumber(row.sort_order, action.payload.sortOrder)
      ) {
        mismatch("catalog_value_readback_mismatch", action, id);
      }
    } else if (
      action.actionType === "upsert_catalog_variant" ||
      action.actionType === "move_catalog_variant"
    ) {
      const row = active(snapshot.variants).find((entry) => entry.id === id);
      if (
        !row ||
        row.catalog_item_id !==
          resolvedRef(
            action.payload.destinationFamilyRef ??
              action.payload.familyRef,
            resolvedIds,
          ) ||
        normalizedText(row.sku) !==
          normalizedText(action.payload.supplierSku) ||
        !sameNumber(row.unit_cost_override, action.payload.unitCost) ||
        row.is_active !== true
      ) {
        mismatch("catalog_variant_readback_mismatch", action, id);
      }
    } else if (action.actionType === "replace_variant_option_values") {
      const variantId = resolvedRef(action.payload.variantRef, resolvedIds);
      const expected = Array.isArray(action.payload.optionValueRefs)
        ? action.payload.optionValueRefs
            .map((value) => resolvedRef(value, resolvedIds))
            .filter((value): value is string => Boolean(value))
            .sort()
        : [];
      const actual = active(snapshot.variantOptionValues)
        .filter((row) => row.variant_id === variantId)
        .map((row) => String(row.option_value_id ?? ""))
        .filter(Boolean)
        .sort();
      if (!variantId || !sameJson(actual, expected)) {
        mismatch("variant_values_readback_mismatch", action, variantId);
      }
    } else if (action.actionType === "map_product_catalog_option") {
      const row = active(snapshot.productOptionMappings).find(
        (entry) => entry.id === id,
      );
      if (
        !row ||
        row.product_id !==
          resolvedRef(action.payload.productRef, resolvedIds) ||
        row.catalog_item_id !==
          resolvedRef(action.payload.catalogItemRef, resolvedIds) ||
        row.catalog_option_id !==
          resolvedRef(action.payload.catalogOptionRef, resolvedIds) ||
        row.product_option_id !==
          resolvedRef(action.payload.productOptionRef, resolvedIds) ||
        row.catalog_option_value_id !==
          resolvedRef(action.payload.catalogOptionValueRef, resolvedIds) ||
        row.product_option_value_id !==
          resolvedRef(action.payload.productOptionValueRef, resolvedIds) ||
        normalizedText(row.mapping_kind) !==
          normalizedText(action.payload.mappingKind)
      ) {
        mismatch("catalog_mapping_readback_mismatch", action, id);
      }
    } else if (action.actionType === "upsert_product_material") {
      const row = active(snapshot.productMaterials).find(
        (entry) => entry.id === id,
      );
      if (
        !row ||
        row.product_id !==
          resolvedRef(action.payload.productRef, resolvedIds) ||
        String(row.catalog_variant_id ?? "") !==
          String(
            resolvedRef(action.payload.catalogVariantRef, resolvedIds) ?? "",
          ) ||
        String(row.catalog_item_id ?? "") !==
          String(
            resolvedRef(action.payload.catalogItemRef, resolvedIds) ?? "",
          ) ||
        !sameJson(row.variant_selector, action.payload.variantSelector) ||
        !sameNumber(row.quantity_per_unit, action.payload.quantityPerUnit) ||
        normalizedText(row.notes) !== normalizedText(action.payload.notes)
      ) {
        mismatch("product_material_readback_mismatch", action, id);
      }
    } else if (action.actionType === "upsert_material_quantity_rule") {
      const row = active(snapshot.materialQuantityRules).find(
        (entry) => entry.id === id,
      );
      if (
        !row ||
        row.product_material_id !==
          resolvedRef(action.payload.productMaterialRef, resolvedIds) ||
        normalizedText(row.calculation_kind) !==
          normalizedText(action.payload.calculationKind) ||
        normalizedText(row.measure_source) !==
          normalizedText(action.payload.measureSource) ||
        !sameJson(row.required_inputs, action.payload.requiredInputs) ||
        !sameNumber(row.coverage_quantity, action.payload.coverageQuantity) ||
        !sameNumber(row.waste_factor, action.payload.wasteFactor) ||
        normalizedText(row.purchase_rounding) !==
          normalizedText(action.payload.purchaseRounding) ||
        !sameNumber(row.rounding_increment, action.payload.roundingIncrement) ||
        !sameNumber(row.package_quantity, action.payload.packageQuantity) ||
        !sameJson(row.fallback_rule, action.payload.fallbackRule) ||
        !sameJson(row.config, action.payload.config)
      ) {
        mismatch("material_rule_readback_mismatch", action, id);
      }
    } else if (action.actionType === "upsert_supplier_cost_profile") {
      const row = active(snapshot.supplierCostProfiles).find(
        (entry) => entry.id === id,
      );
      if (
        !row ||
        row.catalog_variant_id !==
          resolvedRef(action.payload.variantRef, resolvedIds) ||
        normalizedText(row.profile_key) !==
          normalizedText(action.payload.profileKey) ||
        normalizedText(row.label) !== normalizedText(action.payload.label) ||
        !sameNumber(row.unit_cost, action.payload.unitCost) ||
        normalizedText(row.currency_code) !==
          normalizedText(action.payload.currencyCode) ||
        row.is_default !== action.payload.isDefault ||
        !sameJson(row.activation_rule, action.payload.activationRule)
      ) {
        mismatch("supplier_cost_readback_mismatch", action, id);
      }
    } else if (action.actionType === "upsert_capability_binding") {
      const row = active(snapshot.capabilityBindings).find(
        (entry) => entry.id === id,
      );
      if (
        !row ||
        row.product_id !==
          resolvedRef(action.payload.productRef, resolvedIds) ||
        normalizedText(row.capability_key) !==
          normalizedText(action.payload.capabilityKey) ||
        !sameJson(row.required_inputs, action.payload.requiredInputs) ||
        !sameJson(row.fallback_behavior, action.payload.fallbackBehavior) ||
        row.enabled !== action.payload.enabled
      ) {
        mismatch("capability_readback_mismatch", action, id);
      }
    } else if (
      action.actionType === "reuse_task_type" ||
      action.actionType === "create_task_type"
    ) {
      const row = active(snapshot.taskTypes).find((entry) => entry.id === id);
      if (
        !row ||
        normalizedText(row.display) !== normalizedText(action.payload.display)
      ) {
        mismatch("task_type_readback_mismatch", action, id);
      }
    } else if (action.actionType === "upsert_tax_rate") {
      const row = active(snapshot.taxRates).find((entry) => entry.id === id);
      if (
        !row ||
        normalizedText(row.name) !== normalizedText(action.payload.name) ||
        !sameNumber(row.rate, action.payload.rate) ||
        row.is_default !== action.payload.isDefault ||
        row.is_active !== action.payload.isActive
      ) {
        mismatch("tax_readback_mismatch", action, id);
      }
    } else if (action.actionType === "archive_catalog_variant") {
      const row = snapshot.variants.find((entry) => entry.id === id);
      if (!row || row.deleted_at == null || row.is_active !== false) {
        mismatch("variant_archive_readback_mismatch", action, id);
      }
    } else if (action.actionType === "archive_catalog_option") {
      const row = snapshot.catalogOptions.find((entry) => entry.id === id);
      if (!row || row.deleted_at == null) {
        mismatch("option_archive_readback_mismatch", action, id);
      }
    } else if (action.actionType === "create_verification_item") {
      const row = active(snapshot.verificationItems).find(
        (entry) => entry.id === id,
      );
      if (
        !row ||
        row.item_key !== (action.clientId ?? action.actionKey) ||
        normalizedText(row.message) !==
          normalizedText(action.payload.message)
      ) {
        mismatch("verification_item_readback_mismatch", action, id);
      }
    }
  }

  return issues;
}
