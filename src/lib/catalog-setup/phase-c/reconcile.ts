import { createHash } from "crypto";
import { CatalogBlueprintSchema } from "./schemas";
import type { LiveCatalogSnapshot } from "./live-catalog-context";
import type {
  CatalogAction,
  CatalogBlueprint,
  CatalogSetupIssue,
} from "./types";

export interface DesiredCatalogStructure {
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
      legacyMatch?: {
        familyName: string;
        optionValues: Record<string, string>;
      };
    }>;
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

  const variantSignatures = new Map<
    string,
    { familyName: string; values: Record<string, string> }
  >();
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
      actions.push({
        actionKey: `reuse:task-type:${taskType.clientId}`,
        group: "REUSE",
        actionType: "reuse_task_type",
        targetKind: "task_type",
        existingId: stringId(matches[0]),
        sourceFingerprint: fingerprint(matches[0]),
        dependsOn: [],
        payload: {
          clientId: taskType.clientId,
          display: taskType.display,
        },
      });
    } else if (matches.length === 0) {
      actions.push({
        actionKey: `create:task-type:${taskType.clientId}`,
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
    if (existingFamilyId) reusedFamilyIds.add(existingFamilyId);
    const familyActionKey = `${existingFamilyId ? "update" : "create"}:catalog-family:${family.clientId}`;
    actions.push({
      actionKey: familyActionKey,
      group: existingFamilyId ? "UPDATE" : "CREATE",
      actionType: "upsert_catalog_family",
      targetKind: "catalog_item",
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
    actions.push({
      actionKey: colorOptionActionKey,
      group: existingColorOption ? "REUSE" : "CREATE",
      actionType: "upsert_catalog_option",
      targetKind: "catalog_option",
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
      actions.push({
        actionKey: colorValueActionKey,
        group: existingColorValue ? "REUSE" : "CREATE",
        actionType: "upsert_catalog_option_value",
        targetKind: "catalog_option_value",
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

      const existingVariant = variant.legacyMatch
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
      const existingVariantId = stringId(existingVariant);
      if (existingVariantId) matchedVariantIds.add(existingVariantId);
      const isMove =
        !!existingVariantId &&
        String(existingVariant?.catalog_item_id) !== existingFamilyId;
      const variantActionKey = existingVariantId
        ? `${isMove ? "move" : "reuse"}:catalog-variant:${existingVariantId}`
        : `create:catalog-variant:${variant.clientId}`;

      actions.push({
        actionKey: variantActionKey,
        group: existingVariantId ? (isMove ? "UPDATE" : "REUSE") : "CREATE",
        actionType: isMove
          ? "move_catalog_variant"
          : "upsert_catalog_variant",
        targetKind: "catalog_variant",
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
    summary: `${desired.families.length} catalog families, ${desired.taskTypes.length} task types`,
    ready: !issues.some((issue) => issue.severity === "blocker"),
    actions,
    issues,
  };
  return CatalogBlueprintSchema.parse(blueprint);
}
