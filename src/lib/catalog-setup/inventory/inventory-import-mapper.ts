import { createHash } from "crypto";
import type { ParsedSheet } from "@/lib/catalog-setup/csv-parse";
import type { LiveCatalogSnapshot } from "@/lib/catalog-setup/phase-c/live-catalog-context";

export interface InventoryImportIssue {
  code:
    | "missing_item"
    | "invalid_quantity"
    | "invalid_fraction"
    | "invalid_physical_quantity"
    | "variant_not_found"
    | "variant_ambiguous";
  message: string;
}

export interface ProposedInventoryStockUnit {
  catalog_variant_id: string;
  unit_kind: "roll" | "offcut" | "box" | "each" | "lot" | "pallet" | "length";
  label: string | null;
  lot_code: string | null;
  width_value: number | null;
  width_unit: string | null;
  original_length_value: number | null;
  remaining_length_value: number | null;
  length_unit: string | null;
  quantity_value: number;
  location: string;
  status: "full" | "partial";
  notes: string | null;
}

export interface MappedInventoryImportRow {
  rowNumber: number;
  fingerprint: string;
  rawData: Record<string, string>;
  normalizedData: Record<string, unknown>;
  matchedVariantId: string | null;
  proposedStockUnit: ProposedInventoryStockUnit | null;
  issues: InventoryImportIssue[];
  status: "matched" | "needs_input";
}

interface VariantDescriptor {
  id: string;
  sku: string | null;
  family: string;
  values: string[];
  searchable: string;
}

const HEADER_ALIASES: Record<string, string[]> = {
  item: ["item", "product", "material", "name", "description"],
  sku: ["sku", "item sku", "product sku"],
  color: ["color", "colour", "pattern"],
  thickness: ["thickness", "mil", "system"],
  quantity: ["quantity", "qty", "on hand", "amount", "fraction"],
  unitKind: ["unit kind", "unit type", "kind"],
  width: ["width", "width in", "roll width"],
  widthUnit: ["width unit"],
  length: ["length", "length ft", "remaining length", "remaining"],
  lengthUnit: ["length unit"],
  location: ["location", "shop", "warehouse"],
  lotCode: ["lot", "lot code", "batch"],
  notes: ["notes", "note"],
};

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en-CA")
    .replace(/[^a-z0-9.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findCell(
  row: Record<string, string>,
  canonical: keyof typeof HEADER_ALIASES,
): string {
  const aliases = new Set(HEADER_ALIASES[canonical].map(normalize));
  const entry = Object.entries(row).find(([header]) =>
    aliases.has(normalize(header)),
  );
  return entry?.[1]?.trim() ?? "";
}

function numberCell(value: string): number | null {
  if (!value.trim()) return null;
  const cleaned = value.replace(/[$,%\s]/g, "");
  const fraction = cleaned.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (fraction) {
    const denominator = Number(fraction[2]);
    return denominator > 0 ? Number(fraction[1]) / denominator : null;
  }
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function descriptors(snapshot: LiveCatalogSnapshot): VariantDescriptor[] {
  const families = new Map(
    snapshot.families
      .filter((row) => row.deleted_at == null)
      .map((row) => [String(row.id), String(row.name ?? "")]),
  );
  const optionValues = new Map(
    snapshot.catalogOptionValues
      .filter((row) => row.deleted_at == null)
      .map((row) => [String(row.id), String(row.value ?? "")]),
  );
  const valuesByVariant = new Map<string, string[]>();
  for (const join of snapshot.variantOptionValues) {
    if (join.deleted_at != null) continue;
    const value = optionValues.get(String(join.option_value_id));
    if (!value) continue;
    const variantId = String(join.variant_id);
    valuesByVariant.set(variantId, [
      ...(valuesByVariant.get(variantId) ?? []),
      value,
    ]);
  }
  return snapshot.variants
    .filter((row) => row.deleted_at == null && row.is_active !== false)
    .flatMap((row) => {
      const id = String(row.id ?? "");
      const family = families.get(String(row.catalog_item_id ?? ""));
      if (!id || !family) return [];
      const values = valuesByVariant.get(id) ?? [];
      const sku =
        typeof row.sku === "string" && row.sku.trim()
          ? row.sku.trim()
          : null;
      return [
        {
          id,
          sku,
          family,
          values,
          searchable: normalize([family, ...values, sku ?? ""].join(" ")),
        },
      ];
    });
}

function matches(
  variants: VariantDescriptor[],
  input: {
    item: string;
    sku: string;
    color: string;
    thickness: string;
  },
): VariantDescriptor[] {
  if (input.sku) {
    const sku = normalize(input.sku);
    return variants.filter(
      (variant) => variant.sku && normalize(variant.sku) === sku,
    );
  }
  const item = normalize(input.item);
  const color = normalize(input.color);
  const thickness = normalize(input.thickness);
  return variants.filter((variant) => {
    const normalizedFamily = normalize(variant.family);
    const normalizedValues = variant.values.map(normalize);
    const itemMatch =
      !item ||
      variant.searchable.includes(item) ||
      item.includes(normalizedFamily) ||
      normalizedValues.some(
        (value) => value.includes(item) || item.includes(value),
      ) ||
      (item.includes("vinyl") &&
        normalizedFamily.includes("deksmart") &&
        (normalizedFamily.includes("68") ||
          normalizedFamily.includes("60")));
    const colorMatch =
      !color ||
      normalizedValues.some((value) => value === color) ||
      variant.searchable.includes(color);
    const thicknessMatch =
      !thickness ||
      normalizedFamily.includes(thickness.replace(/\s*mil$/, "")) ||
      variant.searchable.includes(thickness);
    return itemMatch && colorMatch && thicknessMatch;
  });
}

function unitKind(
  authored: string,
  descriptor: VariantDescriptor,
  length: number | null,
  quantity: number,
): ProposedInventoryStockUnit["unit_kind"] {
  const normalized = normalize(authored);
  if (
    ["roll", "offcut", "box", "each", "lot", "pallet", "length"].includes(
      normalized,
    )
  ) {
    return normalized as ProposedInventoryStockUnit["unit_kind"];
  }
  if (descriptor.family.toLocaleLowerCase("en-CA").includes("membrane")) {
    return length != null && length < 75 ? "offcut" : "roll";
  }
  if (
    descriptor.searchable.includes("flashing") ||
    descriptor.searchable.includes("clip")
  ) {
    return "length";
  }
  if (length != null) return "length";
  if (quantity > 1) return "each";
  return "each";
}

export function mapInventorySheet(
  sheet: ParsedSheet,
  snapshot: LiveCatalogSnapshot,
  defaultLocation: string,
): MappedInventoryImportRow[] {
  const catalog = descriptors(snapshot);
  return sheet.rows.map((rawData, index) => {
    const rowNumber = sheet.lineNumbers[index] ?? index + 2;
    const item = findCell(rawData, "item");
    const sku = findCell(rawData, "sku");
    const color = findCell(rawData, "color");
    const thickness = findCell(rawData, "thickness");
    const quantityRaw = findCell(rawData, "quantity") || "1";
    const quantity = numberCell(quantityRaw);
    const authoredWidth = numberCell(findCell(rawData, "width"));
    const authoredLength = numberCell(findCell(rawData, "length"));
    const issues: InventoryImportIssue[] = [];
    if (!item && !sku) {
      issues.push({
        code: "missing_item",
        message: "Add an item name or SKU.",
      });
    }
    if (quantity == null || quantity <= 0) {
      issues.push({
        code: "invalid_quantity",
        message: "Quantity must be greater than zero.",
      });
    }

    const candidates = matches(catalog, { item, sku, color, thickness });
    if (candidates.length === 0) {
      issues.push({
        code: "variant_not_found",
        message: "No catalog item matches this row.",
      });
    } else if (candidates.length > 1) {
      issues.push({
        code: "variant_ambiguous",
        message: "Add a color, thickness, or SKU to identify one catalog item.",
      });
    }
    const matched = candidates.length === 1 ? candidates[0] : null;
    const resolvedQuantity = quantity ?? 0;
    const kind = matched
      ? unitKind(
          findCell(rawData, "unitKind"),
          matched,
          authoredLength,
          resolvedQuantity,
        )
      : "each";
    const isMembrane =
      matched?.family.toLocaleLowerCase("en-CA").includes("membrane") === true;
    const width = authoredWidth ?? (isMembrane ? 72 : null);
    const length =
      authoredLength ??
      (kind === "roll" && isMembrane
        ? 75
        : matched?.searchable.includes("flashing")
          ? 8
          : matched?.searchable.includes("clip")
            ? 10
            : null);
    const isPail =
      matched?.searchable.includes("contact") ||
      matched?.searchable.includes("latex");
    const isPhysicalLength = ["roll", "offcut", "length"].includes(kind);
    if (
      isPhysicalLength &&
      (!Number.isInteger(resolvedQuantity) || resolvedQuantity <= 0)
    ) {
      issues.push({
        code: "invalid_physical_quantity",
        message:
          "Rolls, offcuts, flashing, and clips require a whole-unit count.",
      });
    }
    if (
      isPail &&
      ![0.25, 0.5, 0.75, 1].some(
        (fraction) => Math.abs(resolvedQuantity - fraction) < 0.0001,
      )
    ) {
      issues.push({
        code: "invalid_fraction",
        message: "Adhesive inventory uses conservative quarter-pail amounts.",
      });
    }

    const location =
      findCell(rawData, "location") || defaultLocation.trim();
    const label = [item, color, thickness].filter(Boolean).join(" · ");
    const proposedStockUnit =
      matched && issues.length === 0
        ? {
            catalog_variant_id: matched.id,
            unit_kind: kind,
            label: label || null,
            lot_code: findCell(rawData, "lotCode") || null,
            width_value: width,
            width_unit:
              width == null
                ? null
                : findCell(rawData, "widthUnit") || "in",
            original_length_value: length,
            remaining_length_value: length,
            length_unit:
              length == null
                ? null
                : findCell(rawData, "lengthUnit") || "ft",
            quantity_value: resolvedQuantity,
            location,
            status:
              kind === "offcut" || resolvedQuantity < 1
                ? ("partial" as const)
                : ("full" as const),
            notes: findCell(rawData, "notes") || null,
          }
        : null;
    const normalizedData = {
      item,
      sku,
      color,
      thickness,
      quantity: resolvedQuantity,
      width,
      length,
      location,
    };
    return {
      rowNumber,
      fingerprint: createHash("sha256")
        .update(JSON.stringify({ rowNumber, rawData }))
        .digest("hex"),
      rawData,
      normalizedData,
      matchedVariantId: matched?.id ?? null,
      proposedStockUnit,
      issues,
      status: proposedStockUnit ? "matched" : "needs_input",
    };
  });
}
