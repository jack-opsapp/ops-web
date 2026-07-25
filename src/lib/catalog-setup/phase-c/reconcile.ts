import { createHash } from "crypto";
import { CatalogBlueprintSchema } from "./schemas";
import type { LiveCatalogSnapshot } from "./live-catalog-context";
import type {
  CatalogAction,
  CatalogBlueprint,
  CatalogSetupIssue,
} from "./types";

export interface DesiredCatalogStructure {
  taxRates?: Array<{
    clientId: string;
    name: string;
    rate: number;
    isDefault: boolean;
    isActive: boolean;
  }>;
  taskTypes: Array<{
    clientId: string;
    display: string;
  }>;
  families: Array<{
    clientId: string;
    name: string;
    aliases?: string[];
    optionName: string;
    variants: Array<{
      clientId: string;
      label: string;
      supplierSku: string | null;
      unitCost?: number | null;
      costProfiles?: Array<{
        profileKey: string;
        label: string;
        unitCost: number;
        isDefault: boolean;
        activationRule: Record<string, unknown>;
      }>;
      legacyMatch?: {
        familyName: string;
        optionValues: Record<string, string>;
      };
    }>;
  }>;
  products?: Array<{
    clientId: string;
    name: string;
    description: string;
    basePrice: number;
    unitCost: number | null;
    pricingUnit: string;
    minimumCharge: number | null;
    isTaxable: boolean;
    showInStorefront: boolean;
    taskTypeClientId: string;
    linkedFamilyRef: string;
    options: Array<{
      clientId: string;
      name: string;
      required: boolean;
      affectsRecipe: boolean;
      values: Array<{
        clientId: string;
        label: string;
        catalogValueRef: string;
      }>;
      catalogOptionRef: string;
    }>;
    materials: Array<{
      clientId: string;
      catalogItemRef?: string;
      catalogVariantRef?: string;
      variantSelector?: Record<string, unknown>;
      quantityPerUnit: number;
      notes?: string;
      quantityRule: {
        calculationKind:
          | "product_quantity"
          | "coverage"
          | "edge_length"
          | "cut_plan";
        measureSource: string;
        requiredInputs: string[];
        coverageQuantity?: number;
        wasteFactor: number;
        purchaseRounding:
          | "none"
          | "increment"
          | "whole_package"
          | "whole_length";
        roundingIncrement?: number;
        packageQuantity?: number;
        fallbackRule: Record<string, unknown>;
        config: Record<string, unknown>;
      };
    }>;
    capability?: {
      capabilityKey: string;
      requiredInputs: string[];
      fallbackBehavior: Record<string, unknown>;
    };
  }>;
}

function normalizeIdentity(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en-CA");
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  }
  return value;
}

function fingerprint(value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex")}`;
}

function actionToken(value: string): string {
  return normalizeIdentity(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function stringId(row: Record<string, unknown> | undefined): string | undefined {
  return typeof row?.id === "string" ? row.id : undefined;
}

function activeRows(rows: Array<Record<string, unknown>>) {
  return rows.filter((row) => row.deleted_at == null);
}

function indexRows(
  rows: Array<Record<string, unknown>>,
): Map<string, Record<string, unknown>> {
  return new Map(
    rows.flatMap((row) =>
      typeof row.id === "string" ? [[row.id, row] as const] : [],
    ),
  );
}

function sameSignature(
  current: Record<string, string>,
  desired: Record<string, string>,
): boolean {
  const currentEntries = Object.entries(current).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const desiredEntries = Object.entries(desired).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return (
    currentEntries.length === desiredEntries.length &&
    currentEntries.every(
      ([key, value], index) =>
        normalizeIdentity(key) === normalizeIdentity(desiredEntries[index][0]) &&
        normalizeIdentity(value) ===
          normalizeIdentity(desiredEntries[index][1]),
    )
  );
}

export function reconcileCatalogStructure(
  snapshot: LiveCatalogSnapshot,
  desired: DesiredCatalogStructure,
): CatalogBlueprint {
  const actions: CatalogAction[] = [];
  const issues: CatalogSetupIssue[] = [];
  const activeFamilies = activeRows(snapshot.families);
  const activeOptions = activeRows(snapshot.catalogOptions);
  const activeOptionValues = activeRows(snapshot.catalogOptionValues);
  const activeVariants = activeRows(snapshot.variants);
  const activeVariantJoins = activeRows(snapshot.variantOptionValues);
  const optionsById = indexRows(activeOptions);
  const valuesById = indexRows(activeOptionValues);
  const familiesById = indexRows(activeFamilies);
  const matchedVariantIds = new Set<string>();
  const reusedFamilyIds = new Set<string>();
  const taskActionKeys = new Map<string, string>();
  const familyActionKeys = new Map<string, string>();
  const catalogOptionActionKeys = new Map<string, string>();
  const catalogValueActionKeys = new Map<string, string>();
  const variantActionKeys = new Map<string, string>();
  const familyExistingIds = new Map<string, string>();
  const catalogOptionExistingIds = new Map<string, string>();
  const catalogValueExistingIds = new Map<string, string>();
  const variantExistingIds = new Map<string, string>();

  const variantSignatures = new Map<
    string,
    { familyName: string; values: Record<string, string> }
  >();

  for (const taxRate of desired.taxRates ?? []) {
    const matches = activeRows(snapshot.taxRates).filter(
      (row) => normalizeIdentity(row.name) === normalizeIdentity(taxRate.name),
    );
    if (matches.length > 1) {
      issues.push({
        code: "ambiguous_match",
        severity: "blocker",
        message: `Multiple tax rates match ${taxRate.name}.`,
      });
      continue;
    }
    const existing = matches[0];
    actions.push({
      actionKey: `${existing ? "update" : "create"}:tax-rate:${taxRate.clientId}`,
      group: existing ? "UPDATE" : "CREATE",
      actionType: "upsert_tax_rate",
      targetKind: "tax_rate",
      clientId: taxRate.clientId,
      ...(existing
        ? {
            existingId: stringId(existing),
            sourceFingerprint: fingerprint(existing),
          }
        : { clientId: taxRate.clientId }),
      dependsOn: [],
      payload: {
        name: taxRate.name,
        rate: taxRate.rate,
        isDefault: taxRate.isDefault,
        isActive: taxRate.isActive,
      },
    });
  }
  for (const variant of activeVariants) {
    const variantId = stringId(variant);
    const family = familiesById.get(String(variant.catalog_item_id ?? ""));
    if (!variantId || !family) continue;
    const values: Record<string, string> = {};
    for (const join of activeVariantJoins) {
      if (join.variant_id !== variantId) continue;
      const value = valuesById.get(String(join.option_value_id ?? ""));
      const option = optionsById.get(String(value?.option_id ?? ""));
      if (
        typeof option?.name === "string" &&
        typeof value?.value === "string"
      ) {
        values[option.name] = value.value;
      }
    }
    variantSignatures.set(variantId, {
      familyName: String(family.name ?? ""),
      values,
    });
  }

  for (const taskType of desired.taskTypes) {
    const matches = activeRows(snapshot.taskTypes).filter(
      (row) => normalizeIdentity(row.display) === normalizeIdentity(taskType.display),
    );
    if (matches.length === 1) {
      const actionKey = `reuse:task-type:${taskType.clientId}`;
      taskActionKeys.set(taskType.clientId, actionKey);
      actions.push({
        actionKey,
        group: "REUSE",
        actionType: "reuse_task_type",
        targetKind: "task_type",
        clientId: taskType.clientId,
        existingId: stringId(matches[0]),
        sourceFingerprint: fingerprint(matches[0]),
        dependsOn: [],
        payload: {
          clientId: taskType.clientId,
          display: taskType.display,
        },
      });
    } else if (matches.length === 0) {
      const actionKey = `create:task-type:${taskType.clientId}`;
      taskActionKeys.set(taskType.clientId, actionKey);
      actions.push({
        actionKey,
        group: "CREATE",
        actionType: "create_task_type",
        targetKind: "task_type",
        clientId: taskType.clientId,
        dependsOn: [],
        payload: { display: taskType.display },
      });
    } else {
      issues.push({
        code: "ambiguous_match",
        severity: "blocker",
        message: `Multiple task types match ${taskType.display}.`,
      });
    }
  }

  for (const family of desired.families) {
    const familyNames = [family.name, ...(family.aliases ?? [])].map(
      normalizeIdentity,
    );
    const familyMatches = activeFamilies.filter(
      (row) =>
        familyNames.includes(normalizeIdentity(row.name)) &&
        !reusedFamilyIds.has(String(row.id)),
    );
    if (familyMatches.length > 1) {
      issues.push({
        code: "ambiguous_match",
        severity: "blocker",
        message: `Multiple catalog families match ${family.name}.`,
      });
      continue;
    }

    const existingFamily = familyMatches[0];
    const existingFamilyId = stringId(existingFamily);
    if (existingFamilyId) {
      familyExistingIds.set(family.clientId, existingFamilyId);
    }
    if (existingFamilyId) reusedFamilyIds.add(existingFamilyId);
    const familyActionKey = `${existingFamilyId ? "update" : "create"}:catalog-family:${family.clientId}`;
    familyActionKeys.set(family.clientId, familyActionKey);
    actions.push({
      actionKey: familyActionKey,
      group: existingFamilyId ? "UPDATE" : "CREATE",
      actionType: "upsert_catalog_family",
      targetKind: "catalog_item",
      clientId: family.clientId,
      ...(existingFamilyId
        ? {
            existingId: existingFamilyId,
            sourceFingerprint: fingerprint(existingFamily),
          }
        : { clientId: family.clientId }),
      dependsOn: [],
      payload: { name: family.name },
    });

    const existingColorOption = existingFamilyId
      ? activeOptions.find(
          (row) =>
            row.catalog_item_id === existingFamilyId &&
            normalizeIdentity(row.name) === normalizeIdentity(family.optionName),
        )
      : undefined;
    const colorOptionRef = `${family.clientId}:${actionToken(family.optionName)}`;
    const colorOptionActionKey = `${
      existingColorOption ? "reuse" : "create"
    }:catalog-option:${colorOptionRef}`;
    catalogOptionActionKeys.set(colorOptionRef, colorOptionActionKey);
    const existingColorOptionId = stringId(existingColorOption);
    if (existingColorOptionId) {
      catalogOptionExistingIds.set(colorOptionRef, existingColorOptionId);
    }
    actions.push({
      actionKey: colorOptionActionKey,
      group: existingColorOption ? "REUSE" : "CREATE",
      actionType: "upsert_catalog_option",
      targetKind: "catalog_option",
      clientId: colorOptionRef,
      ...(existingColorOption
        ? {
            existingId: stringId(existingColorOption),
            sourceFingerprint: fingerprint(existingColorOption),
          }
        : { clientId: colorOptionRef }),
      dependsOn: [familyActionKey],
      payload: {
        familyRef: family.clientId,
        name: family.optionName,
        sortOrder: 0,
      },
    });

    const existingColorValues = new Map(
      activeOptionValues
        .filter((row) => row.option_id === existingColorOption?.id)
        .map((row) => [normalizeIdentity(row.value), row]),
    );

    for (const [sortOrder, variant] of family.variants.entries()) {
      const existingColorValue = existingColorValues.get(
        normalizeIdentity(variant.label),
      );
      const colorValueRef = `${family.clientId}:color:${actionToken(
        variant.label,
      )}`;
      const colorValueActionKey = `${
        existingColorValue ? "reuse" : "create"
      }:catalog-option-value:${colorValueRef}`;
      catalogValueActionKeys.set(colorValueRef, colorValueActionKey);
      const existingColorValueId = stringId(existingColorValue);
      if (existingColorValueId) {
        catalogValueExistingIds.set(colorValueRef, existingColorValueId);
      }
      actions.push({
        actionKey: colorValueActionKey,
        group: existingColorValue ? "REUSE" : "CREATE",
        actionType: "upsert_catalog_option_value",
        targetKind: "catalog_option_value",
        clientId: colorValueRef,
        ...(existingColorValue
          ? {
              existingId: stringId(existingColorValue),
              sourceFingerprint: fingerprint(existingColorValue),
            }
          : { clientId: colorValueRef }),
        dependsOn: [colorOptionActionKey],
        payload: {
          optionRef: colorOptionRef,
          value: variant.label,
          sortOrder,
        },
      });

      const currentFamilyMatch = activeVariants.find((row) => {
        const id = stringId(row);
        const signature = id ? variantSignatures.get(id) : undefined;
        return (
          signature &&
          [family.name, ...(family.aliases ?? [])]
            .map(normalizeIdentity)
            .includes(normalizeIdentity(signature.familyName)) &&
          sameSignature(signature.values, {
            [family.optionName]: variant.label,
          })
        );
      });
      const legacyVariantMatch = variant.legacyMatch
        ? activeVariants.find((row) => {
            const id = stringId(row);
            const signature = id ? variantSignatures.get(id) : undefined;
            return (
              signature &&
              normalizeIdentity(signature.familyName) ===
                normalizeIdentity(variant.legacyMatch?.familyName) &&
              sameSignature(
                signature.values,
                variant.legacyMatch?.optionValues ?? {},
              )
            );
          })
        : undefined;
      const existingVariant = currentFamilyMatch ?? legacyVariantMatch;
      const existingVariantId = stringId(existingVariant);
      if (existingVariantId) {
        matchedVariantIds.add(existingVariantId);
        variantExistingIds.set(variant.clientId, existingVariantId);
      }
      const isMove =
        !!existingVariantId &&
        String(existingVariant?.catalog_item_id) !== existingFamilyId;
      const variantActionKey = existingVariantId
        ? `${isMove ? "move" : "reuse"}:catalog-variant:${existingVariantId}`
        : `create:catalog-variant:${variant.clientId}`;
      variantActionKeys.set(variant.clientId, variantActionKey);

      actions.push({
        actionKey: variantActionKey,
        group: existingVariantId ? (isMove ? "UPDATE" : "REUSE") : "CREATE",
        actionType: isMove
          ? "move_catalog_variant"
          : "upsert_catalog_variant",
        targetKind: "catalog_variant",
        clientId: variant.clientId,
        ...(existingVariantId
          ? {
              existingId: existingVariantId,
              sourceFingerprint: fingerprint(existingVariant),
            }
          : { clientId: variant.clientId }),
        dependsOn: [familyActionKey],
        payload: {
          familyRef: family.clientId,
          ...(isMove ? { destinationFamilyRef: family.clientId } : {}),
          label: variant.label,
          supplierSku: variant.supplierSku,
          unitCost: variant.unitCost ?? null,
        },
      });

      actions.push({
        actionKey: `update:variant-values:${variant.clientId}`,
        group: "UPDATE",
        actionType: "replace_variant_option_values",
        targetKind: "catalog_variant_option_values",
        clientId: `variant-values:${variant.clientId}`,
        dependsOn: [variantActionKey, colorValueActionKey],
        payload: {
          variantRef: existingVariantId ?? variant.clientId,
          optionValueRefs: [colorValueRef],
        },
      });

      for (const profile of variant.costProfiles ?? []) {
        const existingProfile = existingVariantId
          ? activeRows(snapshot.supplierCostProfiles).find(
              (row) =>
                row.catalog_variant_id === existingVariantId &&
                normalizeIdentity(row.profile_key) ===
                  normalizeIdentity(profile.profileKey),
            )
          : undefined;
        actions.push({
          actionKey: `${existingProfile ? "update" : "create"}:supplier-cost:${variant.clientId}:${profile.profileKey}`,
          group: existingProfile ? "UPDATE" : "CREATE",
          actionType: "upsert_supplier_cost_profile",
          targetKind: "catalog_supplier_cost_profile",
          clientId: `${variant.clientId}:cost:${profile.profileKey}`,
          ...(existingProfile
            ? {
                existingId: stringId(existingProfile),
                sourceFingerprint: fingerprint(existingProfile),
              }
            : {
                clientId: `${variant.clientId}:cost:${profile.profileKey}`,
              }),
          dependsOn: [variantActionKey],
          payload: {
            variantRef: variant.clientId,
            profileKey: profile.profileKey,
            label: profile.label,
            unitCost: profile.unitCost,
            currencyCode: "CAD",
            isDefault: profile.isDefault,
            activationRule: profile.activationRule,
          },
        });
      }
    }
  }

  for (const product of desired.products ?? []) {
    const productMatches = activeRows(snapshot.products).filter(
      (row) => normalizeIdentity(row.name) === normalizeIdentity(product.name),
    );
    if (productMatches.length > 1) {
      issues.push({
        code: "ambiguous_match",
        severity: "blocker",
        message: `Multiple products match ${product.name}.`,
      });
      continue;
    }
    const existingProduct = productMatches[0];
    const existingProductId = stringId(existingProduct);
    const productActionKey = `${existingProduct ? "update" : "create"}:product:${product.clientId}`;
    const taskActionKey = taskActionKeys.get(product.taskTypeClientId);
    const familyActionKey = familyActionKeys.get(product.linkedFamilyRef);
    const productDependencies = [taskActionKey, familyActionKey].filter(
      (value): value is string => Boolean(value),
    );
    if (!taskActionKey || !familyActionKey) {
      issues.push({
        code: "unresolved_product_reference",
        severity: "blocker",
        actionKey: productActionKey,
        message: `Product ${product.name} has an unresolved task type or catalog family.`,
      });
    }
    actions.push({
      actionKey: productActionKey,
      group: existingProduct ? "UPDATE" : "CREATE",
      actionType: "upsert_product",
      targetKind: "product",
      clientId: product.clientId,
      ...(existingProduct
        ? {
            existingId: existingProductId,
            sourceFingerprint: fingerprint(existingProduct),
          }
        : { clientId: product.clientId }),
      dependsOn: productDependencies,
      payload: {
        name: product.name,
        description: product.description,
        basePrice: product.basePrice,
        defaultPrice: product.basePrice,
        unitCost: product.unitCost,
        pricingUnit: product.pricingUnit,
        unit: product.pricingUnit,
        minimumCharge: product.minimumCharge,
        isTaxable: product.isTaxable,
        showInStorefront: product.showInStorefront,
        type: "LABOR",
        kind: "service",
        taskTypeClientId: product.taskTypeClientId,
        linkedFamilyRef: product.linkedFamilyRef,
      },
    });

    const existingOptions = existingProductId
      ? activeRows(snapshot.productOptions).filter(
          (row) => row.product_id === existingProductId,
        )
      : [];
    for (const [optionIndex, option] of product.options.entries()) {
      const existingOption = existingOptions.find(
        (row) => normalizeIdentity(row.name) === normalizeIdentity(option.name),
      );
      const optionActionKey = `${existingOption ? "update" : "create"}:product-option:${option.clientId}`;
      actions.push({
        actionKey: optionActionKey,
        group: existingOption ? "UPDATE" : "CREATE",
        actionType: "upsert_product_option",
        targetKind: "product_option",
        clientId: option.clientId,
        ...(existingOption
          ? {
              existingId: stringId(existingOption),
              sourceFingerprint: fingerprint(existingOption),
            }
          : { clientId: option.clientId }),
        dependsOn: [productActionKey],
        payload: {
          productRef: product.clientId,
          name: option.name,
          kind: "select",
          affectsPrice: false,
          affectsRecipe: option.affectsRecipe,
          required: option.required,
          defaultValue: null,
          sortOrder: optionIndex,
        },
      });

      const existingValues = existingOption
        ? activeRows(snapshot.productOptionValues).filter(
            (row) => row.option_id === existingOption.id,
          )
        : [];
      for (const [valueIndex, value] of option.values.entries()) {
        const existingValue = existingValues.find(
          (row) =>
            normalizeIdentity(row.value) === normalizeIdentity(value.label),
        );
        const valueActionKey = `${existingValue ? "update" : "create"}:product-option-value:${value.clientId}`;
        actions.push({
          actionKey: valueActionKey,
          group: existingValue ? "UPDATE" : "CREATE",
          actionType: "upsert_product_option_value",
          targetKind: "product_option_value",
          clientId: value.clientId,
          ...(existingValue
            ? {
                existingId: stringId(existingValue),
                sourceFingerprint: fingerprint(existingValue),
              }
            : { clientId: value.clientId }),
          dependsOn: [optionActionKey],
          payload: {
            optionRef: option.clientId,
            value: value.label,
            sortOrder: valueIndex,
          },
        });

        const catalogValueAction = catalogValueActionKeys.get(
          value.catalogValueRef,
        );
        const catalogOptionAction = catalogOptionActionKeys.get(
          option.catalogOptionRef,
        );
        const mappingClientId = `${product.clientId}:map:${value.clientId}`;
        const existingMapping =
          existingProductId &&
          stringId(existingOption) &&
          stringId(existingValue) &&
          familyExistingIds.get(product.linkedFamilyRef) &&
          catalogOptionExistingIds.get(option.catalogOptionRef) &&
          catalogValueExistingIds.get(value.catalogValueRef)
            ? activeRows(snapshot.productOptionMappings).find(
                (row) =>
                  row.product_id === existingProductId &&
                  row.product_option_id === stringId(existingOption) &&
                  row.product_option_value_id === stringId(existingValue) &&
                  row.catalog_item_id ===
                    familyExistingIds.get(product.linkedFamilyRef) &&
                  row.catalog_option_id ===
                    catalogOptionExistingIds.get(option.catalogOptionRef) &&
                  row.catalog_option_value_id ===
                    catalogValueExistingIds.get(value.catalogValueRef),
              )
            : undefined;
        actions.push({
          actionKey: `${existingMapping ? "update" : "create"}:product-catalog-map:${mappingClientId}`,
          group: existingMapping ? "UPDATE" : "CREATE",
          actionType: "map_product_catalog_option",
          targetKind: "catalog_product_option_mapping",
          clientId: mappingClientId,
          ...(existingMapping
            ? {
                existingId: stringId(existingMapping),
                sourceFingerprint: fingerprint(existingMapping),
              }
            : {}),
          dependsOn: [
            productActionKey,
            optionActionKey,
            valueActionKey,
            ...(catalogOptionAction ? [catalogOptionAction] : []),
            ...(catalogValueAction ? [catalogValueAction] : []),
          ],
          payload: {
            productRef: product.clientId,
            catalogItemRef: product.linkedFamilyRef,
            catalogOptionRef: option.catalogOptionRef,
            productOptionRef: option.clientId,
            catalogOptionValueRef: value.catalogValueRef,
            productOptionValueRef: value.clientId,
            mappingKind: "value",
          },
        });
      }
    }

    const existingMaterialIds = new Set<string>();
    for (const material of product.materials) {
      const targetVariantId = material.catalogVariantRef
        ? variantExistingIds.get(material.catalogVariantRef)
        : undefined;
      const targetFamilyId = material.catalogItemRef
        ? familyExistingIds.get(material.catalogItemRef)
        : undefined;
      const existingMaterial = existingProductId
        ? activeRows(snapshot.productMaterials).find((row) => {
            const rowId = stringId(row);
            if (!rowId || existingMaterialIds.has(rowId)) return false;
            if (row.product_id !== existingProductId) return false;
            if (targetVariantId) {
              return row.catalog_variant_id === targetVariantId;
            }
            if (targetFamilyId) {
              return (
                row.catalog_item_id === targetFamilyId &&
                JSON.stringify(stableValue(row.variant_selector ?? {})) ===
                  JSON.stringify(
                    stableValue(material.variantSelector ?? {}),
                  )
              );
            }
            return false;
          })
        : undefined;
      const existingMaterialId = stringId(existingMaterial);
      if (existingMaterialId) existingMaterialIds.add(existingMaterialId);
      const materialActionKey = `${existingMaterial ? "update" : "create"}:product-material:${material.clientId}`;
      const targetDependency = material.catalogVariantRef
        ? variantActionKeys.get(material.catalogVariantRef)
        : material.catalogItemRef
          ? familyActionKeys.get(material.catalogItemRef)
          : undefined;
      actions.push({
        actionKey: materialActionKey,
        group: existingMaterial ? "UPDATE" : "CREATE",
        actionType: "upsert_product_material",
        targetKind: "product_material",
        clientId: material.clientId,
        ...(existingMaterial
          ? {
              existingId: existingMaterialId,
              sourceFingerprint: fingerprint(existingMaterial),
            }
          : {}),
        dependsOn: [
          productActionKey,
          ...(targetDependency ? [targetDependency] : []),
        ],
        payload: {
          productRef: product.clientId,
          catalogItemRef: material.catalogItemRef,
          catalogVariantRef: material.catalogVariantRef,
          variantSelector: material.variantSelector,
          quantityPerUnit: material.quantityPerUnit,
          notes: material.notes ?? null,
        },
      });
      const existingRule = existingMaterialId
        ? activeRows(snapshot.materialQuantityRules).find(
            (row) => row.product_material_id === existingMaterialId,
          )
        : undefined;
      actions.push({
        actionKey: `${existingRule ? "update" : "create"}:material-rule:${material.clientId}`,
        group: existingRule ? "UPDATE" : "CREATE",
        actionType: "upsert_material_quantity_rule",
        targetKind: "product_material_quantity_rule",
        clientId: `${material.clientId}:rule`,
        ...(existingRule
          ? {
              existingId: stringId(existingRule),
              sourceFingerprint: fingerprint(existingRule),
            }
          : {}),
        dependsOn: [materialActionKey],
        payload: {
          productMaterialRef: material.clientId,
          ...material.quantityRule,
        },
      });
    }

    if (product.capability) {
      const capabilityToken = actionToken(product.capability.capabilityKey);
      const existingCapability = existingProductId
        ? activeRows(snapshot.capabilityBindings).find(
            (row) =>
              row.product_id === existingProductId &&
              normalizeIdentity(row.capability_key) ===
                normalizeIdentity(product.capability?.capabilityKey),
          )
        : undefined;
      actions.push({
        actionKey: `${existingCapability ? "update" : "create"}:capability:${product.clientId}:${capabilityToken}`,
        group: existingCapability ? "UPDATE" : "CREATE",
        actionType: "upsert_capability_binding",
        targetKind: "catalog_product_capability_binding",
        clientId: `${product.clientId}:capability:${capabilityToken}`,
        ...(existingCapability
          ? {
              existingId: stringId(existingCapability),
              sourceFingerprint: fingerprint(existingCapability),
            }
          : {}),
        dependsOn: [productActionKey],
        payload: {
          productRef: product.clientId,
          capabilityKey: product.capability.capabilityKey,
          requiredInputs: product.capability.requiredInputs,
          fallbackBehavior: product.capability.fallbackBehavior,
          enabled: true,
        },
      });
    }
  }

  for (const option of activeOptions) {
    if (normalizeIdentity(option.name) !== "type") continue;
    const family = familiesById.get(String(option.catalog_item_id ?? ""));
    if (!family || normalizeIdentity(family.name) !== "vinyl") continue;
    actions.push({
      actionKey: `archive:catalog-option:${String(option.id)}`,
      group: "ARCHIVE",
      actionType: "archive_catalog_option",
      targetKind: "catalog_option",
      existingId: stringId(option),
      sourceFingerprint: fingerprint(option),
      dependsOn: desired.families.flatMap((entry) =>
        entry.variants.map((variant) => `update:variant-values:${variant.clientId}`),
      ),
      payload: { name: option.name },
    });
  }

  for (const variant of activeVariants) {
    const id = stringId(variant);
    if (!id || matchedVariantIds.has(id)) continue;
    const signature = variantSignatures.get(id);
    if (!signature || Object.keys(signature.values).length > 0) continue;
    const verificationKey = `verify:catalog_variant:${id}`;
    actions.push({
      actionKey: verificationKey,
      group: "NEEDS_INPUT",
      actionType: "create_verification_item",
      targetKind: "catalog_setup_verification_item",
      clientId: verificationKey,
      sourceFingerprint: fingerprint(variant),
      dependsOn: [],
      payload: {
        subjectKind: "catalog_variant",
        subjectId: id,
        check: "variant_reference_preflight",
        message: "Confirm the empty variant has no dependent records before archive.",
      },
    });
    actions.push({
      actionKey: `archive:catalog-variant:${id}`,
      group: "ARCHIVE",
      actionType: "archive_catalog_variant",
      targetKind: "catalog_variant",
      existingId: id,
      sourceFingerprint: fingerprint(variant),
      dependsOn: [verificationKey],
      payload: { reason: "empty_variant_after_reference_preflight" },
    });
    issues.push({
      code: "blank_variant_reference_preflight",
      severity: "verification",
      actionKey: `archive:catalog-variant:${id}`,
      message: "The empty vinyl record will be archived only after reference checks pass.",
    });
  }

  const duplicateActionKeys = actions
    .map((action) => action.actionKey)
    .filter((key, index, all) => all.indexOf(key) !== index);
  if (duplicateActionKeys.length > 0) {
    issues.push({
      code: "duplicate_action_identity",
      severity: "blocker",
      message: `Duplicate action identity: ${duplicateActionKeys[0]}.`,
    });
  }

  const blueprint = {
    version: 1,
    summary: `${desired.products?.length ?? 0} products, ${desired.families.length} catalog families, ${desired.taskTypes.length} task types`,
    ready: !issues.some((issue) => issue.severity === "blocker"),
    actions,
    issues,
  };
  return CatalogBlueprintSchema.parse(blueprint);
}
