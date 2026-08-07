import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { CatalogAction } from "./types";

const ReferenceSchema = z.string().trim().min(1).max(240);
const LabelSchema = z.string().trim().min(1).max(500);
const MoneySchema = z.number().finite().nonnegative();
const SortOrderSchema = z.number().int().nonnegative();
const OptionalMoneySchema = MoneySchema.nullable().optional();

const ProductPayloadSchema = z
  .object({
    name: LabelSchema,
    description: z.string().trim().max(8_000).optional(),
    basePrice: MoneySchema,
    defaultPrice: MoneySchema.optional(),
    unitCost: OptionalMoneySchema,
    pricingUnit: LabelSchema,
    minimumCharge: MoneySchema.nullable(),
    isTaxable: z.boolean(),
    showInStorefront: z.boolean(),
    type: z.enum(["LABOR", "MATERIAL", "OTHER"]),
    kind: z.enum(["service", "material", "package"]),
    taskTypeClientId: ReferenceSchema,
    linkedFamilyRef: ReferenceSchema,
  })
  .strict()
  .superRefine((payload, context) => {
    const expectedType = {
      service: "LABOR",
      material: "MATERIAL",
      package: "OTHER",
    }[payload.kind];
    if (payload.type !== expectedType) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["type"],
        message: `Product kind ${payload.kind} requires type ${expectedType}`,
      });
    }
  });

const ProductMaterialPayloadSchema = z
  .object({
    productRef: ReferenceSchema,
    catalogItemRef: ReferenceSchema.optional(),
    catalogVariantRef: ReferenceSchema.optional(),
    variantSelector: z.record(z.unknown()).optional(),
    quantityPerUnit: z.number().finite().positive(),
    notes: z.string().trim().max(8_000).nullable().optional(),
  })
  .strict()
  .superRefine((payload, context) => {
    const referenceCount = [
      payload.catalogItemRef,
      payload.catalogVariantRef,
    ].filter(Boolean).length;
    if (referenceCount !== 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["catalogItemRef"],
        message: "A product material requires exactly one catalog target",
      });
    }
  });

const ACTION_PAYLOAD_CONTRACTS: Partial<
  Record<CatalogAction["actionType"], z.ZodTypeAny>
> = {
  upsert_product: ProductPayloadSchema,
  upsert_product_option: z
    .object({
      productRef: ReferenceSchema,
      name: LabelSchema,
      kind: z.enum(["select", "integer", "boolean", "text"]),
      affectsPrice: z.boolean(),
      affectsRecipe: z.boolean(),
      required: z.boolean(),
      defaultValue: z.string().max(500).nullable(),
      sortOrder: SortOrderSchema,
    })
    .strict(),
  upsert_product_option_value: z
    .object({
      optionRef: ReferenceSchema,
      value: LabelSchema,
      sortOrder: SortOrderSchema,
    })
    .strict(),
  upsert_catalog_family: z.object({ name: LabelSchema }).strict(),
  upsert_catalog_option: z
    .object({
      familyRef: ReferenceSchema,
      name: LabelSchema,
      sortOrder: SortOrderSchema,
    })
    .strict(),
  upsert_catalog_option_value: z
    .object({
      optionRef: ReferenceSchema,
      value: LabelSchema,
      sortOrder: SortOrderSchema,
    })
    .strict(),
  upsert_catalog_variant: z
    .object({
      familyRef: ReferenceSchema,
      supplierSku: z.string().trim().max(500).nullable().optional(),
      unitCost: OptionalMoneySchema,
    })
    .strict(),
  replace_variant_option_values: z
    .object({
      variantRef: ReferenceSchema,
      optionValueRefs: z.array(ReferenceSchema).min(1),
    })
    .strict(),
  map_product_catalog_option: z
    .object({
      productRef: ReferenceSchema,
      catalogItemRef: ReferenceSchema,
      catalogOptionRef: ReferenceSchema,
      productOptionRef: ReferenceSchema,
      catalogOptionValueRef: ReferenceSchema,
      productOptionValueRef: ReferenceSchema,
      mappingKind: z.literal("value"),
    })
    .strict(),
  upsert_product_material: ProductMaterialPayloadSchema,
  reuse_task_type: z
    .object({ clientId: ReferenceSchema, display: LabelSchema })
    .strict(),
  create_task_type: z.object({ display: LabelSchema }).strict(),
  move_catalog_variant: z
    .object({
      familyRef: ReferenceSchema,
      destinationFamilyRef: ReferenceSchema,
      supplierSku: z.string().trim().max(500).nullable().optional(),
      unitCost: OptionalMoneySchema,
    })
    .strict(),
  archive_catalog_variant: z
    .object({ reason: LabelSchema })
    .strict(),
  archive_catalog_option: z.object({ name: LabelSchema }).strict(),
  create_verification_item: z
    .object({
      subjectKind: ReferenceSchema,
      subjectId: ReferenceSchema,
      check: ReferenceSchema,
      message: z.string().trim().min(1).max(8_000),
    })
    .strict(),
};

interface CatalogActionReferenceIssue {
  actionKey: string;
  field: string;
  reference: string;
}

interface CatalogActionReferenceRule {
  field: string;
  targetActionTypes: readonly CatalogAction["actionType"][];
  multiple?: boolean;
  allowExistingId?: boolean;
}

const ACTION_REFERENCE_RULES: Partial<
  Record<CatalogAction["actionType"], readonly CatalogActionReferenceRule[]>
> = {
  upsert_product: [
    {
      field: "taskTypeClientId",
      targetActionTypes: ["reuse_task_type", "create_task_type"],
    },
    {
      field: "linkedFamilyRef",
      targetActionTypes: ["upsert_catalog_family"],
    },
  ],
  upsert_product_option: [
    { field: "productRef", targetActionTypes: ["upsert_product"] },
  ],
  upsert_product_option_value: [
    {
      field: "optionRef",
      targetActionTypes: ["upsert_product_option"],
    },
  ],
  upsert_catalog_option: [
    {
      field: "familyRef",
      targetActionTypes: ["upsert_catalog_family"],
    },
  ],
  upsert_catalog_option_value: [
    {
      field: "optionRef",
      targetActionTypes: ["upsert_catalog_option"],
    },
  ],
  upsert_catalog_variant: [
    {
      field: "familyRef",
      targetActionTypes: ["upsert_catalog_family"],
    },
  ],
  replace_variant_option_values: [
    {
      field: "variantRef",
      targetActionTypes: [
        "upsert_catalog_variant",
        "move_catalog_variant",
      ],
      allowExistingId: true,
    },
    {
      field: "optionValueRefs",
      targetActionTypes: ["upsert_catalog_option_value"],
      multiple: true,
    },
  ],
  map_product_catalog_option: [
    { field: "productRef", targetActionTypes: ["upsert_product"] },
    {
      field: "catalogItemRef",
      targetActionTypes: ["upsert_catalog_family"],
    },
    {
      field: "catalogOptionRef",
      targetActionTypes: ["upsert_catalog_option"],
    },
    {
      field: "productOptionRef",
      targetActionTypes: ["upsert_product_option"],
    },
    {
      field: "catalogOptionValueRef",
      targetActionTypes: ["upsert_catalog_option_value"],
    },
    {
      field: "productOptionValueRef",
      targetActionTypes: ["upsert_product_option_value"],
    },
  ],
  upsert_product_material: [
    { field: "productRef", targetActionTypes: ["upsert_product"] },
    {
      field: "catalogItemRef",
      targetActionTypes: ["upsert_catalog_family"],
    },
    {
      field: "catalogVariantRef",
      targetActionTypes: [
        "upsert_catalog_variant",
        "move_catalog_variant",
      ],
    },
  ],
  upsert_material_quantity_rule: [
    {
      field: "productMaterialRef",
      targetActionTypes: ["upsert_product_material"],
    },
  ],
  upsert_supplier_cost_profile: [
    {
      field: "variantRef",
      targetActionTypes: [
        "upsert_catalog_variant",
        "move_catalog_variant",
      ],
    },
  ],
  upsert_capability_binding: [
    { field: "productRef", targetActionTypes: ["upsert_product"] },
  ],
  move_catalog_variant: [
    {
      field: "familyRef",
      targetActionTypes: ["upsert_catalog_family"],
    },
    {
      field: "destinationFamilyRef",
      targetActionTypes: ["upsert_catalog_family"],
    },
  ],
};

export function unresolvedCatalogActionReferences(
  actions: readonly CatalogAction[],
): CatalogActionReferenceIssue[] {
  const actionKeys = new Set(actions.map((action) => action.actionKey));
  const issues: CatalogActionReferenceIssue[] = [];
  const clientIdOwners = new Map<string, string>();

  for (const action of actions) {
    if (!action.clientId) continue;
    const owner = clientIdOwners.get(action.clientId);
    if (owner) {
      issues.push({
        actionKey: action.actionKey,
        field: "clientId",
        reference: action.clientId,
      });
    } else {
      clientIdOwners.set(action.clientId, action.actionKey);
    }
  }

  for (const action of actions) {
    for (const dependency of action.dependsOn) {
      if (!actionKeys.has(dependency)) {
        issues.push({
          actionKey: action.actionKey,
          field: "dependsOn",
          reference: dependency,
        });
      }
    }

    for (const rule of ACTION_REFERENCE_RULES[action.actionType] ?? []) {
      const raw = action.payload[rule.field];
      if (raw == null) continue;
      const references = rule.multiple
        ? Array.isArray(raw)
          ? raw
          : []
        : [raw];
      const resolvable = new Set(
        actions
          .filter((candidate) =>
            rule.targetActionTypes.includes(candidate.actionType),
          )
          .flatMap((candidate) =>
            [
              candidate.clientId,
              ...(rule.allowExistingId ? [candidate.existingId] : []),
            ].filter(
              (value): value is string => typeof value === "string",
            ),
          ),
      );
      for (const reference of references) {
        if (typeof reference === "string" && !resolvable.has(reference)) {
          issues.push({
            actionKey: action.actionKey,
            field: rule.field,
            reference,
          });
        }
      }
    }
  }

  return issues;
}

export function catalogActionPayloadContractsForModel(): Record<
  string,
  Record<string, unknown>
> {
  return Object.fromEntries(
    Object.entries(ACTION_PAYLOAD_CONTRACTS).map(
      ([actionType, contract]) => [
        actionType,
        zodToJsonSchema(contract, {
          $refStrategy: "none",
          target: "jsonSchema7",
        }) as Record<string, unknown>,
      ],
    ),
  );
}

export function validateCatalogActionPayload(
  actionType: CatalogAction["actionType"],
  payload: Record<string, unknown>,
): { success: boolean; unsupportedFields: string[] } {
  const contract = ACTION_PAYLOAD_CONTRACTS[actionType];
  if (!contract) {
    return {
      success: false,
      unsupportedFields: ["missing_action_contract"],
    };
  }

  const parsed = contract.safeParse(payload);
  if (parsed.success) {
    return { success: true, unsupportedFields: [] };
  }

  const invalidFields = parsed.error.issues.flatMap((issue) => {
    if (issue.code === "unrecognized_keys") return issue.keys;
    const [field] = issue.path;
    return typeof field === "string" ? [field] : [];
  });
  return {
    success: false,
    unsupportedFields:
      invalidFields.length > 0
        ? [...new Set(invalidFields)].sort()
        : ["invalid_payload"],
  };
}
