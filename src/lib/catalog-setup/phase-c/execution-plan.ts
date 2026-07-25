import type {
  FamilyInput,
  ProductInput,
  ProductOptionInput,
} from "@/lib/catalog-setup/commit/payload-builder";
import type { CatalogAction, CatalogBlueprint } from "./types";

export interface CompiledProductPlan {
  action: CatalogAction;
  options: ProductOptionInput[];
  materials: CatalogAction[];
  mappings: CatalogAction[];
}

export interface CompiledCatalogExecutionBlueprint {
  families: Array<{
    action: CatalogAction;
    family: FamilyInput;
  }>;
  products: CompiledProductPlan[];
  taskTypes: CatalogAction[];
  taxRates: CatalogAction[];
  materialRules: CatalogAction[];
  supplierCostProfiles: CatalogAction[];
  capabilityBindings: CatalogAction[];
  verificationItems: CatalogAction[];
  archives: CatalogAction[];
}

export class CatalogExecutionReferenceError extends Error {
  constructor(reference: string) {
    super(`Catalog execution reference is unresolved: ${reference}`);
    this.name = "CatalogExecutionReferenceError";
  }
}

function ref(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function resolveId(
  reference: unknown,
  idMap: Readonly<Record<string, string>>,
): string {
  const logicalRef = ref(reference);
  const id = logicalRef ? idMap[logicalRef] : undefined;
  if (!logicalRef || !id) {
    throw new CatalogExecutionReferenceError(logicalRef || "<empty>");
  }
  return id;
}

export function compileCatalogExecutionBlueprint(
  blueprint: CatalogBlueprint,
): CompiledCatalogExecutionBlueprint {
  const actions = blueprint.actions;
  const familyActions = actions.filter(
    (action) => action.actionType === "upsert_catalog_family",
  );
  const catalogOptions = actions.filter(
    (action) => action.actionType === "upsert_catalog_option",
  );
  const catalogValues = actions.filter(
    (action) => action.actionType === "upsert_catalog_option_value",
  );
  const variants = actions.filter(
    (action) =>
      action.actionType === "upsert_catalog_variant" ||
      action.actionType === "move_catalog_variant",
  );
  const variantValues = actions.filter(
    (action) => action.actionType === "replace_variant_option_values",
  );

  const families = familyActions.map((action) => {
    const familyRef = action.clientId ?? ref(action.payload.familyRef);
    const ownOptions = catalogOptions.filter(
      (option) => ref(option.payload.familyRef) === familyRef,
    );
    const ownVariants = variants.filter(
      (variant) =>
        ref(
          variant.payload.destinationFamilyRef ?? variant.payload.familyRef,
        ) === familyRef,
    );
    const family: FamilyInput = {
      clientId: familyRef,
      ...(action.existingId ? { id: action.existingId } : {}),
      name: ref(action.payload.name),
      options: ownOptions.map((option, optionIndex) => {
        const optionRef = option.clientId ?? ref(option.payload.optionRef);
        return {
          clientId: optionRef,
          ...(option.existingId ? { id: option.existingId } : {}),
          name: ref(option.payload.name),
          sortOrder:
            numberValue(option.payload.sortOrder) ?? optionIndex,
          values: catalogValues
            .filter((value) => ref(value.payload.optionRef) === optionRef)
            .map((value, valueIndex) => ({
              clientId: value.clientId,
              ...(value.existingId ? { id: value.existingId } : {}),
              label: ref(value.payload.value),
              sortOrder:
                numberValue(value.payload.sortOrder) ?? valueIndex,
            })),
        };
      }),
      variants: ownVariants.map((variant) => {
        const variantRef = variant.clientId ?? variant.existingId ?? "";
        const join = variantValues.find(
          (candidate) =>
            ref(candidate.payload.variantRef) === variantRef ||
            ref(candidate.payload.variantRef) === variant.clientId ||
            ref(candidate.payload.variantRef) === variant.existingId,
        );
        return {
          clientId: variant.clientId ?? `variant:${variant.existingId}`,
          ...(variant.existingId ? { id: variant.existingId } : {}),
          ...(typeof variant.payload.supplierSku === "string"
            ? { sku: variant.payload.supplierSku }
            : {}),
          ...(numberValue(variant.payload.unitCost) != null
            ? { unitCost: numberValue(variant.payload.unitCost) }
            : {}),
          optionValueClientIds: Array.isArray(
            join?.payload.optionValueRefs,
          )
            ? join.payload.optionValueRefs.filter(
                (value): value is string => typeof value === "string",
              )
            : [],
        };
      }),
    };
    return { action, family };
  });

  const productActions = actions.filter(
    (action) => action.actionType === "upsert_product",
  );
  const products = productActions.map((action) => {
    const productRef = action.clientId ?? action.existingId ?? "";
    const optionActions = actions.filter(
      (candidate) =>
        candidate.actionType === "upsert_product_option" &&
        ref(candidate.payload.productRef) === productRef,
    );
    const options = optionActions.map((option, optionIndex) => {
      const optionRef = option.clientId ?? option.existingId ?? "";
      return {
        clientId: optionRef,
        ...(option.existingId ? { id: option.existingId } : {}),
        name: ref(option.payload.name),
        kind:
          option.payload.kind === "integer" ||
          option.payload.kind === "boolean" ||
          option.payload.kind === "text"
            ? option.payload.kind
            : "select",
        affectsPrice: option.payload.affectsPrice === true,
        affectsRecipe: option.payload.affectsRecipe === true,
        required: option.payload.required !== false,
        defaultValue:
          typeof option.payload.defaultValue === "string"
            ? option.payload.defaultValue
            : null,
        sortOrder:
          numberValue(option.payload.sortOrder) ?? optionIndex,
        values: actions
          .filter(
            (candidate) =>
              candidate.actionType === "upsert_product_option_value" &&
              ref(candidate.payload.optionRef) === optionRef,
          )
          .map((value, valueIndex) => ({
            clientId: value.clientId,
            ...(value.existingId ? { id: value.existingId } : {}),
            label: ref(value.payload.value),
            sortOrder:
              numberValue(value.payload.sortOrder) ?? valueIndex,
          })),
      } satisfies ProductOptionInput;
    });
    return {
      action,
      options,
      materials: actions.filter(
        (candidate) =>
          candidate.actionType === "upsert_product_material" &&
          ref(candidate.payload.productRef) === productRef,
      ),
      mappings: actions.filter(
        (candidate) =>
          candidate.actionType === "map_product_catalog_option" &&
          ref(candidate.payload.productRef) === productRef,
      ),
    };
  });

  return {
    families,
    products,
    taskTypes: actions.filter(
      (action) =>
        action.actionType === "reuse_task_type" ||
        action.actionType === "create_task_type",
    ),
    taxRates: actions.filter(
      (action) => action.actionType === "upsert_tax_rate",
    ),
    materialRules: actions.filter(
      (action) => action.actionType === "upsert_material_quantity_rule",
    ),
    supplierCostProfiles: actions.filter(
      (action) => action.actionType === "upsert_supplier_cost_profile",
    ),
    capabilityBindings: actions.filter(
      (action) => action.actionType === "upsert_capability_binding",
    ),
    verificationItems: actions.filter(
      (action) => action.actionType === "create_verification_item",
    ),
    archives: actions.filter(
      (action) =>
        action.actionType === "archive_catalog_variant" ||
        action.actionType === "archive_catalog_option",
    ),
  };
}

/**
 * Turns one server-owned product action group into the existing catalog RPC's
 * input shape after family/task actions have produced real UUIDs. Logical
 * client references never cross an RPC boundary unresolved.
 */
export function buildResolvedProductInput(
  plan: CompiledProductPlan,
  idMap: Readonly<Record<string, string>>,
): ProductInput {
  const payload = plan.action.payload;
  const productRef =
    plan.action.clientId ?? plan.action.existingId ?? "<product>";

  return {
    clientId: productRef,
    ...(plan.action.existingId ? { id: plan.action.existingId } : {}),
    name: ref(payload.name),
    kind:
      payload.kind === "material" || payload.kind === "package"
        ? payload.kind
        : "service",
    ...(typeof payload.description === "string"
      ? { description: payload.description }
      : {}),
    ...(numberValue(payload.basePrice) != null
      ? { basePrice: numberValue(payload.basePrice) }
      : {}),
    ...(numberValue(payload.unitCost) != null
      ? { unitCost: numberValue(payload.unitCost) }
      : {}),
    ...(typeof payload.pricingUnit === "string"
      ? { pricingUnit: payload.pricingUnit }
      : {}),
    ...(numberValue(payload.minimumCharge) != null
      ? { minimumCharge: numberValue(payload.minimumCharge) }
      : {}),
    ...(booleanValue(payload.isTaxable) != null
      ? { isTaxable: booleanValue(payload.isTaxable) }
      : {}),
    ...(booleanValue(payload.showInStorefront) != null
      ? { showInStorefront: booleanValue(payload.showInStorefront) }
      : {}),
    isActive: true,
    linkedCatalogItemId: resolveId(payload.linkedFamilyRef, idMap),
    taskTypeRef: resolveId(payload.taskTypeClientId, idMap),
    options: plan.options,
    recipes: plan.materials.map((material) => ({
      clientId:
        material.clientId ?? material.existingId ?? material.actionKey,
      ...(material.existingId ? { id: material.existingId } : {}),
      ...(typeof material.payload.catalogVariantRef === "string"
        ? {
            catalogVariantId: resolveId(
              material.payload.catalogVariantRef,
              idMap,
            ),
          }
        : {
            catalogItemId: resolveId(
              material.payload.catalogItemRef,
              idMap,
            ),
          }),
      ...(material.payload.variantSelector &&
      typeof material.payload.variantSelector === "object" &&
      !Array.isArray(material.payload.variantSelector)
        ? {
            variantSelector: material.payload
              .variantSelector as Record<string, unknown>,
          }
        : {}),
      ...(numberValue(material.payload.quantityPerUnit) != null
        ? {
            quantityPerUnit: numberValue(
              material.payload.quantityPerUnit,
            ),
          }
        : {}),
      ...(typeof material.payload.notes === "string"
        ? { notes: material.payload.notes }
        : {}),
    })),
    catalogOptionMappings: plan.mappings.map((mapping) => ({
      clientId:
        mapping.clientId ?? mapping.existingId ?? mapping.actionKey,
      ...(mapping.existingId ? { id: mapping.existingId } : {}),
      catalogItemId: resolveId(mapping.payload.catalogItemRef, idMap),
      catalogOptionId: resolveId(
        mapping.payload.catalogOptionRef,
        idMap,
      ),
      productOptionClientId: ref(mapping.payload.productOptionRef),
      ...(typeof mapping.payload.catalogOptionValueRef === "string"
        ? {
            catalogOptionValueId: resolveId(
              mapping.payload.catalogOptionValueRef,
              idMap,
            ),
          }
        : {}),
      ...(typeof mapping.payload.productOptionValueRef === "string"
        ? {
            productOptionValueClientId: mapping.payload
              .productOptionValueRef as string,
          }
        : {}),
      mappingKind: ref(mapping.payload.mappingKind) || "value",
    })),
  };
}
