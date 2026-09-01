/**
 * Pure planning contract for expanding one real catalog option axis across
 * existing stock families. PostgreSQL repeats every safety check under locks;
 * this module exists for immediate review feedback and exact stale snapshots.
 */

export interface BulkVariantOptionValueSnapshot {
  id: string;
  value: string;
  sortOrder: number;
}

export interface BulkVariantOptionSnapshot {
  id: string;
  name: string;
  sortOrder: number;
  values: BulkVariantOptionValueSnapshot[];
}

export interface BulkVariantSnapshot {
  id: string;
  sku?: string;
  quantity: number;
  priceOverride?: number;
  unitCostOverride?: number;
  warningThreshold?: number;
  criticalThreshold?: number;
  unitId?: string;
  isActive: boolean;
  optionValueIds: string[];
}

export interface BulkVariantFamilySnapshot {
  id: string;
  name: string;
  options: BulkVariantOptionSnapshot[];
  variants: BulkVariantSnapshot[];
}

export interface BulkVariantOptionSelection {
  optionName: string;
  value: string;
}

export type BulkVariantBlockerCode =
  | "axis_name_required"
  | "existing_value_required"
  | "new_value_required"
  | "too_many_new_values"
  | "duplicate_new_value"
  | "new_value_matches_existing"
  | "families_required"
  | "no_active_variants"
  | "duplicate_option_axis"
  | "duplicate_option_value"
  | "unknown_option_value"
  | "incomplete_variant_options"
  | "multiple_values_for_option"
  | "duplicate_variant_signature"
  | "existing_value_missing"
  | "source_variants_missing"
  | "no_variants_to_add";

export interface BulkVariantBlocker {
  code: BulkVariantBlockerCode;
  familyId: string | null;
  familyName?: string;
  axisName?: string;
  value?: string;
}

export interface BulkVariantExistingAssignment {
  variantId: string;
}

export interface BulkVariantNewVariantPlan {
  sourceVariantId: string;
  newValue: string;
  sku: null;
  quantity: 0;
  priceOverride: number | null;
  unitCostOverride: number | null;
  warningThreshold: number | null;
  criticalThreshold: number | null;
  unitId: string | null;
  isActive: boolean;
  optionSelections: BulkVariantOptionSelection[];
}

export interface BulkVariantCombinationChange {
  sourceVariantId: string;
  sourceSku: string | null;
  before: BulkVariantOptionSelection[];
  after: BulkVariantOptionSelection[][];
  skipped: BulkVariantOptionSelection[][];
}

export interface BulkVariantFamilyPlan {
  familyId: string;
  familyName: string;
  targetOptionId: string | null;
  existingAssignments: BulkVariantExistingAssignment[];
  newVariants: BulkVariantNewVariantPlan[];
  combinationChanges: BulkVariantCombinationChange[];
  skippedExistingCombinationCount: number;
  sourceFingerprint: string;
  source: BulkVariantFamilySnapshot;
}

export interface BulkVariantExpansionPreview {
  axisName: string;
  existingValue: string;
  newValues: string[];
  familyPlans: BulkVariantFamilyPlan[];
  blockers: BulkVariantBlocker[];
  familyCount: number;
  existingVariantAssignmentCount: number;
  newVariantCount: number;
  skippedExistingCombinationCount: number;
  canApply: boolean;
}

export interface BulkVariantFamilyRecord {
  snapshot: BulkVariantFamilySnapshot;
  categoryName: string | null;
  searchText: string;
  issue: BulkVariantBlocker | null;
}

export interface BulkVariantExpansionPayload {
  axis_name: string;
  existing_value: string;
  new_values: string[];
  families: Array<{
    family_id: string;
    source_fingerprint: string;
    source: BulkVariantFamilySnapshot;
  }>;
}

export interface BulkVariantExpansionRequest {
  companyId: string;
  idempotencyKey: string;
  payload: BulkVariantExpansionPayload;
}

const LOWERCASE_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function cleanBulkVariantText(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

export function normalizeBulkVariantText(value: string): string {
  return cleanBulkVariantText(value).toLocaleLowerCase("en-US");
}

function compareTextThenId(
  left: { name: string; id: string },
  right: { name: string; id: string }
): number {
  const byName = cleanBulkVariantText(left.name).localeCompare(
    cleanBulkVariantText(right.name),
    "en-US",
    { sensitivity: "base" }
  );
  return byName || left.id.localeCompare(right.id);
}

function sortedOptions(
  family: BulkVariantFamilySnapshot
): BulkVariantOptionSnapshot[] {
  return [...family.options].sort(
    (left, right) =>
      left.sortOrder - right.sortOrder || left.id.localeCompare(right.id)
  );
}

function sortedValues(
  option: BulkVariantOptionSnapshot
): BulkVariantOptionValueSnapshot[] {
  return [...option.values].sort(
    (left, right) =>
      left.sortOrder - right.sortOrder || left.id.localeCompare(right.id)
  );
}

function issue(
  code: BulkVariantBlockerCode,
  family?: BulkVariantFamilySnapshot,
  detail: Pick<BulkVariantBlocker, "axisName" | "value"> = {}
): BulkVariantBlocker {
  return {
    code,
    familyId: family?.id ?? null,
    familyName: family?.name,
    ...detail,
  };
}

interface IndexedFamily {
  options: BulkVariantOptionSnapshot[];
  variants: BulkVariantSnapshot[];
  valuesById: Map<
    string,
    { option: BulkVariantOptionSnapshot; value: BulkVariantOptionValueSnapshot }
  >;
  pinsByVariant: Map<string, Map<string, BulkVariantOptionValueSnapshot>>;
  variantBySignature: Map<string, BulkVariantSnapshot>;
}

function signature(
  pins: Map<string, BulkVariantOptionValueSnapshot>,
  options: BulkVariantOptionSnapshot[]
): string {
  return options
    .map((option) => `${option.id}=${pins.get(option.id)?.id ?? "missing"}`)
    .join("|");
}

function indexFamily(family: BulkVariantFamilySnapshot): {
  indexed?: IndexedFamily;
  blocker?: BulkVariantBlocker;
} {
  const options = sortedOptions(family);
  const variants = family.variants
    .filter((variant) => variant.isActive)
    .sort((a, b) => a.id.localeCompare(b.id));
  if (variants.length === 0)
    return { blocker: issue("no_active_variants", family) };

  const axisNames = new Set<string>();
  const valuesById = new Map<
    string,
    { option: BulkVariantOptionSnapshot; value: BulkVariantOptionValueSnapshot }
  >();
  for (const option of options) {
    const normalizedAxis = normalizeBulkVariantText(option.name);
    if (axisNames.has(normalizedAxis)) {
      return {
        blocker: issue("duplicate_option_axis", family, {
          axisName: cleanBulkVariantText(option.name),
        }),
      };
    }
    axisNames.add(normalizedAxis);

    const valueNames = new Set<string>();
    for (const value of sortedValues(option)) {
      const normalizedValue = normalizeBulkVariantText(value.value);
      if (valueNames.has(normalizedValue)) {
        return {
          blocker: issue("duplicate_option_value", family, {
            axisName: cleanBulkVariantText(option.name),
            value: cleanBulkVariantText(value.value),
          }),
        };
      }
      valueNames.add(normalizedValue);
      valuesById.set(value.id, { option, value });
    }
  }

  const pinsByVariant = new Map<
    string,
    Map<string, BulkVariantOptionValueSnapshot>
  >();
  const variantBySignature = new Map<string, BulkVariantSnapshot>();
  for (const variant of variants) {
    const pins = new Map<string, BulkVariantOptionValueSnapshot>();
    for (const valueId of variant.optionValueIds) {
      const known = valuesById.get(valueId);
      if (!known) return { blocker: issue("unknown_option_value", family) };
      if (pins.has(known.option.id)) {
        return {
          blocker: issue("multiple_values_for_option", family, {
            axisName: cleanBulkVariantText(known.option.name),
          }),
        };
      }
      pins.set(known.option.id, known.value);
    }
    const missing = options.find((option) => !pins.has(option.id));
    if (missing) {
      return {
        blocker: issue("incomplete_variant_options", family, {
          axisName: cleanBulkVariantText(missing.name),
        }),
      };
    }
    const variantSignature = signature(pins, options);
    if (variantBySignature.has(variantSignature)) {
      return { blocker: issue("duplicate_variant_signature", family) };
    }
    pinsByVariant.set(variant.id, pins);
    variantBySignature.set(variantSignature, variant);
  }

  return {
    indexed: {
      options,
      variants,
      valuesById,
      pinsByVariant,
      variantBySignature,
    },
  };
}

export function familyStructureIssue(
  family: BulkVariantFamilySnapshot
): BulkVariantBlocker | null {
  return indexFamily(family).blocker ?? null;
}

function selectionsFor(
  variantId: string,
  indexed: IndexedFamily
): BulkVariantOptionSelection[] {
  const pins = indexed.pinsByVariant.get(variantId) ?? new Map();
  return indexed.options.map((option) => ({
    optionName: cleanBulkVariantText(option.name),
    value: cleanBulkVariantText(pins.get(option.id)?.value ?? ""),
  }));
}

function clonePlan(
  source: BulkVariantSnapshot,
  optionSelections: BulkVariantOptionSelection[],
  newValue: string
): BulkVariantNewVariantPlan {
  return {
    sourceVariantId: source.id,
    newValue,
    sku: null,
    quantity: 0,
    priceOverride: source.priceOverride ?? null,
    unitCostOverride: source.unitCostOverride ?? null,
    warningThreshold: source.warningThreshold ?? null,
    criticalThreshold: source.criticalThreshold ?? null,
    unitId: source.unitId ?? null,
    isActive: source.isActive,
    optionSelections,
  };
}

const SHA256_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const;

function rotateRight(value: number, count: number): number {
  return (value >>> count) | (value << (32 - count));
}

/** Browser-safe synchronous SHA-256; avoids a server-only `node:crypto` edge. */
function sha256Hex(value: string): string {
  const input = new TextEncoder().encode(value);
  const paddedLength = Math.ceil((input.length + 9) / 64) * 64;
  const bytes = new Uint8Array(paddedLength);
  bytes.set(input);
  bytes[input.length] = 0x80;
  const view = new DataView(bytes.buffer);
  const bitLength = input.length * 8;
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);

  const state = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ];
  const words = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4, false);
    }
    for (let index = 16; index < 64; index += 1) {
      const left = words[index - 15];
      const right = words[index - 2];
      const sigma0 =
        rotateRight(left, 7) ^ rotateRight(left, 18) ^ (left >>> 3);
      const sigma1 =
        rotateRight(right, 17) ^ rotateRight(right, 19) ^ (right >>> 10);
      words[index] =
        (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = state;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 =
        (h + sum1 + choice + SHA256_CONSTANTS[index] + words[index]) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    state[0] = (state[0] + a) >>> 0;
    state[1] = (state[1] + b) >>> 0;
    state[2] = (state[2] + c) >>> 0;
    state[3] = (state[3] + d) >>> 0;
    state[4] = (state[4] + e) >>> 0;
    state[5] = (state[5] + f) >>> 0;
    state[6] = (state[6] + g) >>> 0;
    state[7] = (state[7] + h) >>> 0;
  }
  return state.map((part) => part.toString(16).padStart(8, "0")).join("");
}

function stableDouble(value: number | undefined): string {
  if (value == null) return "nil";
  const bytes = new ArrayBuffer(8);
  const view = new DataView(bytes);
  view.setFloat64(0, value, false);
  return `${view.getUint32(0, false).toString(16).padStart(8, "0")}${view
    .getUint32(4, false)
    .toString(16)
    .padStart(8, "0")}`.replace(/^0+(?=[0-9a-f])/, "");
}

/** Mirrors the approved iOS planner's canonical SHA-256 draft identity. */
function sourceFingerprint(source: BulkVariantFamilySnapshot): string {
  const optionState = sortedOptions(source)
    .map((option) => {
      const values = sortedValues(option)
        .map((value) => `${value.id},${value.value.trim()},${value.sortOrder}`)
        .join(";");
      return `${option.id},${option.name.trim()},${option.sortOrder}[${values}]`;
    })
    .join("|");
  const variantState = source.variants
    .filter((variant) => variant.isActive)
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((variant) =>
      [
        variant.id,
        variant.sku ?? "nil",
        stableDouble(variant.quantity),
        stableDouble(variant.priceOverride),
        stableDouble(variant.unitCostOverride),
        stableDouble(variant.warningThreshold),
        stableDouble(variant.criticalThreshold),
        variant.unitId ?? "nil",
        String(variant.isActive),
        [...variant.optionValueIds].sort().join(","),
      ].join(",")
    )
    .join("|");
  return sha256Hex(
    `${source.id}#${source.name.trim()}#${optionState}#${variantState}`
  );
}

function emptyPreview(
  axisName: string,
  existingValue: string,
  newValues: string[],
  blocker: BulkVariantBlocker
): BulkVariantExpansionPreview {
  return {
    axisName,
    existingValue,
    newValues,
    familyPlans: [],
    blockers: [blocker],
    familyCount: 0,
    existingVariantAssignmentCount: 0,
    newVariantCount: 0,
    skippedExistingCombinationCount: 0,
    canApply: false,
  };
}

export function planBulkVariantExpansion(input: {
  axisName: string;
  existingValue: string;
  newValues: string[];
  families: BulkVariantFamilySnapshot[];
}): BulkVariantExpansionPreview {
  const axisName = cleanBulkVariantText(input.axisName);
  const existingValue = cleanBulkVariantText(input.existingValue);
  const newValues = input.newValues.map(cleanBulkVariantText);

  if (!axisName)
    return emptyPreview(
      axisName,
      existingValue,
      newValues,
      issue("axis_name_required")
    );
  if (!existingValue) {
    return emptyPreview(
      axisName,
      existingValue,
      newValues,
      issue("existing_value_required")
    );
  }
  if (newValues.length === 0 || newValues.some((value) => !value)) {
    return emptyPreview(
      axisName,
      existingValue,
      newValues,
      issue("new_value_required")
    );
  }
  if (newValues.length > 20) {
    return emptyPreview(
      axisName,
      existingValue,
      newValues,
      issue("too_many_new_values")
    );
  }
  const normalizedNewValues = newValues.map(normalizeBulkVariantText);
  if (new Set(normalizedNewValues).size !== normalizedNewValues.length) {
    return emptyPreview(
      axisName,
      existingValue,
      newValues,
      issue("duplicate_new_value")
    );
  }
  if (normalizedNewValues.includes(normalizeBulkVariantText(existingValue))) {
    return emptyPreview(
      axisName,
      existingValue,
      newValues,
      issue("new_value_matches_existing")
    );
  }
  if (input.families.length === 0) {
    return emptyPreview(
      axisName,
      existingValue,
      newValues,
      issue("families_required")
    );
  }

  const familyPlans: BulkVariantFamilyPlan[] = [];
  const blockers: BulkVariantBlocker[] = [];
  for (const source of [...input.families].sort(compareTextThenId)) {
    const result = indexFamily(source);
    if (!result.indexed) {
      blockers.push(
        result.blocker ?? issue("incomplete_variant_options", source)
      );
      continue;
    }
    const indexed = result.indexed;
    const target = indexed.options.find(
      (option) =>
        normalizeBulkVariantText(option.name) ===
        normalizeBulkVariantText(axisName)
    );
    const existingAssignments: BulkVariantExistingAssignment[] = [];
    const newVariants: BulkVariantNewVariantPlan[] = [];
    const combinationChanges: BulkVariantCombinationChange[] = [];
    let skipped = 0;

    if (!target) {
      for (const variant of indexed.variants) {
        const before = selectionsFor(variant.id, indexed);
        const after = newValues.map((newValue) => [
          ...before,
          { optionName: axisName, value: newValue },
        ]);
        existingAssignments.push({ variantId: variant.id });
        newVariants.push(
          ...after.map((selections, index) =>
            clonePlan(variant, selections, newValues[index])
          )
        );
        combinationChanges.push({
          sourceVariantId: variant.id,
          sourceSku: variant.sku ?? null,
          before,
          after,
          skipped: [],
        });
      }
    } else {
      const existingMatches = target.values.filter(
        (value) =>
          normalizeBulkVariantText(value.value) ===
          normalizeBulkVariantText(existingValue)
      );
      if (existingMatches.length !== 1) {
        blockers.push(
          issue(
            existingMatches.length > 1
              ? "duplicate_option_value"
              : "existing_value_missing",
            source,
            {
              axisName,
              value: existingValue,
            }
          )
        );
        continue;
      }
      const existing = existingMatches[0];
      const sources = indexed.variants.filter(
        (variant) =>
          indexed.pinsByVariant.get(variant.id)?.get(target.id)?.id ===
          existing.id
      );
      if (sources.length === 0) {
        blockers.push(
          issue("source_variants_missing", source, {
            axisName,
            value: existingValue,
          })
        );
        continue;
      }
      const resolvedNewValues = new Map(
        target.values.map((value) => [
          normalizeBulkVariantText(value.value),
          value,
        ])
      );

      for (const variant of sources) {
        const before = selectionsFor(variant.id, indexed);
        const after: BulkVariantOptionSelection[][] = [];
        const skippedSelections: BulkVariantOptionSelection[][] = [];
        for (const newValue of newValues) {
          const desiredPins = new Map(indexed.pinsByVariant.get(variant.id));
          const resolved = resolvedNewValues.get(
            normalizeBulkVariantText(newValue)
          );
          if (resolved) desiredPins.set(target.id, resolved);
          const desiredSelections = indexed.options.map((option) => ({
            optionName: cleanBulkVariantText(option.name),
            value:
              option.id === target.id
                ? newValue
                : cleanBulkVariantText(desiredPins.get(option.id)?.value ?? ""),
          }));
          if (
            resolved &&
            indexed.variantBySignature.has(
              signature(desiredPins, indexed.options)
            )
          ) {
            skipped += 1;
            skippedSelections.push(desiredSelections);
            continue;
          }
          after.push(desiredSelections);
          newVariants.push(clonePlan(variant, desiredSelections, newValue));
        }
        combinationChanges.push({
          sourceVariantId: variant.id,
          sourceSku: variant.sku ?? null,
          before,
          after,
          skipped: skippedSelections,
        });
      }
    }

    familyPlans.push({
      familyId: source.id,
      familyName: cleanBulkVariantText(source.name),
      targetOptionId: target?.id ?? null,
      existingAssignments,
      newVariants,
      combinationChanges,
      skippedExistingCombinationCount: skipped,
      sourceFingerprint: sourceFingerprint(source),
      source,
    });
  }

  const existingVariantAssignmentCount = familyPlans.reduce(
    (total, plan) => total + plan.existingAssignments.length,
    0
  );
  const newVariantCount = familyPlans.reduce(
    (total, plan) => total + plan.newVariants.length,
    0
  );
  const skippedExistingCombinationCount = familyPlans.reduce(
    (total, plan) => total + plan.skippedExistingCombinationCount,
    0
  );
  if (blockers.length === 0 && newVariantCount === 0)
    blockers.push(issue("no_variants_to_add"));

  return {
    axisName,
    existingValue,
    newValues,
    familyPlans,
    blockers,
    familyCount: familyPlans.length,
    existingVariantAssignmentCount,
    newVariantCount,
    skippedExistingCombinationCount,
    canApply: blockers.length === 0 && newVariantCount > 0,
  };
}

export function buildBulkVariantExpansionRequest(input: {
  companyId: string;
  idempotencyKey: string;
  preview: BulkVariantExpansionPreview;
}): BulkVariantExpansionRequest {
  if (!LOWERCASE_UUID.test(input.companyId))
    throw new Error("Invalid company id");
  if (!LOWERCASE_UUID.test(input.idempotencyKey))
    throw new Error("Invalid idempotency key");
  if (!input.preview.canApply)
    throw new Error("Bulk variant preview is not safe to apply");
  return {
    companyId: input.companyId,
    idempotencyKey: input.idempotencyKey,
    payload: {
      axis_name: input.preview.axisName,
      existing_value: input.preview.existingValue,
      new_values: input.preview.newValues,
      families: input.preview.familyPlans.map((plan) => ({
        family_id: plan.familyId,
        source_fingerprint: plan.sourceFingerprint,
        source: plan.source,
      })),
    },
  };
}

interface RawFamilyItem {
  id: string;
  companyId: string;
  categoryId: string | null;
  name: string;
  isActive: boolean;
}

interface RawCategory {
  id: string;
  name: string;
}

interface RawOption {
  id: string;
  catalogItemId: string;
  name: string;
  sortOrder: number;
}

interface RawValue extends BulkVariantOptionValueSnapshot {
  optionId: string;
}

interface RawVariant extends BulkVariantSnapshot {
  companyId: string;
  catalogItemId: string;
}

interface RawJoin {
  variantId: string;
  optionValueId: string;
}

/** Assemble exact RPC source snapshots from fixed-count catalog reads. */
export function buildBulkVariantFamilyRecords(input: {
  companyId: string;
  items: RawFamilyItem[];
  categories: RawCategory[];
  options: RawOption[];
  values: RawValue[];
  variants: RawVariant[];
  joins: RawJoin[];
}): BulkVariantFamilyRecord[] {
  const categories = new Map(
    input.categories.map((category) => [category.id, category.name])
  );
  const valuesByOption = new Map<string, RawValue[]>();
  for (const value of input.values) {
    const current = valuesByOption.get(value.optionId) ?? [];
    current.push(value);
    valuesByOption.set(value.optionId, current);
  }
  const joinsByVariant = new Map<string, string[]>();
  for (const join of input.joins) {
    const current = joinsByVariant.get(join.variantId) ?? [];
    current.push(join.optionValueId);
    joinsByVariant.set(join.variantId, current);
  }

  return input.items
    .filter((item) => item.companyId === input.companyId && item.isActive)
    .sort(compareTextThenId)
    .map((item) => {
      const options = input.options
        .filter((option) => option.catalogItemId === item.id)
        .sort(
          (left, right) =>
            left.sortOrder - right.sortOrder || left.id.localeCompare(right.id)
        )
        .map(
          (option): BulkVariantOptionSnapshot => ({
            id: option.id,
            name: option.name,
            sortOrder: option.sortOrder,
            values: (valuesByOption.get(option.id) ?? [])
              .sort(
                (left, right) =>
                  left.sortOrder - right.sortOrder ||
                  left.id.localeCompare(right.id)
              )
              .map(({ id, value, sortOrder }) => ({ id, value, sortOrder })),
          })
        );
      const variants = input.variants
        .filter(
          (variant) =>
            variant.companyId === input.companyId &&
            variant.catalogItemId === item.id &&
            variant.isActive
        )
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((variant): BulkVariantSnapshot => {
          const snapshot: BulkVariantSnapshot = {
            id: variant.id,
            quantity: variant.quantity,
            isActive: variant.isActive,
            optionValueIds: [...(joinsByVariant.get(variant.id) ?? [])].sort(),
          };
          if (variant.sku != null) snapshot.sku = variant.sku;
          if (variant.priceOverride != null)
            snapshot.priceOverride = variant.priceOverride;
          if (variant.unitCostOverride != null)
            snapshot.unitCostOverride = variant.unitCostOverride;
          if (variant.warningThreshold != null)
            snapshot.warningThreshold = variant.warningThreshold;
          if (variant.criticalThreshold != null)
            snapshot.criticalThreshold = variant.criticalThreshold;
          if (variant.unitId != null) snapshot.unitId = variant.unitId;
          return snapshot;
        });
      const snapshot: BulkVariantFamilySnapshot = {
        id: item.id,
        name: item.name,
        options,
        variants,
      };
      const categoryName = item.categoryId
        ? (categories.get(item.categoryId) ?? null)
        : null;
      const searchText = [
        item.name,
        categoryName ?? "",
        ...options.flatMap((option) => [
          option.name,
          ...option.values.map((value) => value.value),
        ]),
      ].join(" ");
      return {
        snapshot,
        categoryName,
        searchText,
        issue: familyStructureIssue(snapshot),
      };
    });
}
