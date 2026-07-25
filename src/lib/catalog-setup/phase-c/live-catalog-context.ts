import { createHash } from "crypto";

export interface LiveCatalogContextRowSets {
  products: Array<Record<string, unknown>>;
  productOptions: Array<Record<string, unknown>>;
  productOptionValues: Array<Record<string, unknown>>;
  pricingModifiers: Array<Record<string, unknown>>;
  productMaterials: Array<Record<string, unknown>>;
  materialQuantityRules: Array<Record<string, unknown>>;
  families: Array<Record<string, unknown>>;
  catalogOptions: Array<Record<string, unknown>>;
  catalogOptionValues: Array<Record<string, unknown>>;
  variants: Array<Record<string, unknown>>;
  variantOptionValues: Array<Record<string, unknown>>;
  productOptionMappings: Array<Record<string, unknown>>;
  stockUnits: Array<Record<string, unknown>>;
  supplierCostProfiles: Array<Record<string, unknown>>;
  capabilityBindings: Array<Record<string, unknown>>;
  units: Array<Record<string, unknown>>;
  categories: Array<Record<string, unknown>>;
  taskTypes: Array<Record<string, unknown>>;
  verificationItems: Array<Record<string, unknown>>;
}

export interface LiveCatalogSnapshot extends LiveCatalogContextRowSets {
  companyId: string;
  hash: string;
}

const NUMERIC_FIELDS = new Set([
  "amount",
  "base_price",
  "critical_threshold",
  "default_critical_threshold",
  "default_price",
  "default_unit_cost",
  "default_warning_threshold",
  "minimum_charge",
  "minimum_quantity",
  "original_length_value",
  "price_override",
  "quantity",
  "quantity_per_unit",
  "quantity_value",
  "remaining_length_value",
  "unit_cost",
  "unit_cost_override",
  "warning_threshold",
  "width_value",
]);

function normalizeValue(value: unknown, key?: string): unknown {
  if (
    key &&
    NUMERIC_FIELDS.has(key) &&
    typeof value === "string" &&
    value.trim() !== "" &&
    Number.isFinite(Number(value))
  ) {
    return Number(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeValue(entry));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([childKey, childValue]) => [
          childKey,
          normalizeValue(childValue, childKey),
        ]),
    );
  }
  return value;
}

function normalizeRows(
  rows: Array<Record<string, unknown>>,
  companyId: string,
): Array<Record<string, unknown>> {
  const normalized = rows.map((row) => {
    if (
      typeof row.company_id === "string" &&
      row.company_id !== companyId
    ) {
      throw new Error(
        `Live catalog company scope mismatch for row ${String(row.id ?? "unknown")}`,
      );
    }
    return normalizeValue(row) as Record<string, unknown>;
  });

  return normalized.sort((a, b) =>
    String(a.id ?? "").localeCompare(String(b.id ?? "")),
  );
}

const ROW_SET_KEYS: Array<keyof LiveCatalogContextRowSets> = [
  "products",
  "productOptions",
  "productOptionValues",
  "pricingModifiers",
  "productMaterials",
  "materialQuantityRules",
  "families",
  "catalogOptions",
  "catalogOptionValues",
  "variants",
  "variantOptionValues",
  "productOptionMappings",
  "stockUnits",
  "supplierCostProfiles",
  "capabilityBindings",
  "units",
  "categories",
  "taskTypes",
  "verificationItems",
];

export function buildLiveCatalogSnapshot(
  companyId: string,
  rows: LiveCatalogContextRowSets,
): LiveCatalogSnapshot {
  const normalized = Object.fromEntries(
    ROW_SET_KEYS.map((key) => [key, normalizeRows(rows[key], companyId)]),
  ) as unknown as LiveCatalogContextRowSets;

  const canonical = JSON.stringify({ companyId, ...normalized });
  const hash = `sha256:${createHash("sha256").update(canonical).digest("hex")}`;

  return { companyId, ...normalized, hash };
}
