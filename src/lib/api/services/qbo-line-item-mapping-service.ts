import type { SupabaseClient } from "@supabase/supabase-js";

export interface QboReplacementParent {
  invoiceId?: string;
  estimateId?: string;
}

export interface QboReplacementLineInput {
  name?: unknown;
  description?: unknown;
  quantity?: unknown;
  unit_price?: unknown;
  is_taxable?: unknown;
  sort_order?: unknown;
  qb_item_id?: unknown;
  qb_item_name?: unknown;
  qb_item_type?: unknown;
}

export interface MissingQboItemMapping {
  qb_item_id: string;
  qb_item_name: string | null;
  line_name: string;
}

interface ProductMappingRow {
  qb_item_id: string;
  product_id: string;
  connection_id: string | null;
  deleted_at: string | null;
}

interface ProductRow {
  id: string;
  company_id: string;
  name: string | null;
  type: string | null;
  task_type_ref: string | null;
  task_type_id: string | null;
  unit: string | null;
  unit_id: string | null;
  deleted_at: string | null;
}

interface ResolvedLineProduct {
  product_id: string;
  type: "LABOR" | "MATERIAL" | "OTHER" | null;
  task_type_ref: string | null;
  task_type_id: string | null;
  unit: string | null;
  unit_id: string | null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v : null;
}

function num(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function normalizeLineType(value: unknown): "LABOR" | "MATERIAL" | "OTHER" | null {
  if (value === "LABOR" || value === "MATERIAL" || value === "OTHER") return value;
  return null;
}

function opsTypeFromQboItemType(
  itemType: string | null,
  parent: QboReplacementParent
): "LABOR" | "MATERIAL" | "OTHER" {
  if (itemType === "Inventory" || itemType === "NonInventory") return "MATERIAL";
  if (itemType === "Service" || (!itemType && Boolean(parent.estimateId))) return "LABOR";
  return "OTHER";
}

function chooseMapping(
  rows: ProductMappingRow[],
  qbItemId: string,
  connectionId: string | null
): ProductMappingRow | null {
  const matches = rows.filter((row) => row.qb_item_id === qbItemId && row.deleted_at == null);
  if (connectionId) {
    const exact = matches.find((row) => row.connection_id === connectionId);
    if (exact) return exact;
  }
  return matches.find((row) => row.connection_id == null) ?? null;
}

async function resolveQboItemProducts(args: {
  supabase: SupabaseClient;
  companyId: string;
  connectionId?: string | null;
  lines: QboReplacementLineInput[];
}): Promise<Map<string, ResolvedLineProduct>> {
  const qbItemIds = Array.from(
    new Set(args.lines.map((line) => str(line.qb_item_id)).filter((id): id is string => !!id))
  );
  if (qbItemIds.length === 0) return new Map();

  const { data: rawMappings, error: mappingError } = await args.supabase
    .from("qbo_item_product_mappings")
    .select("qb_item_id, product_id, connection_id, deleted_at")
    .eq("company_id", args.companyId)
    .in("qb_item_id", qbItemIds);
  if (mappingError) {
    throw new Error(`QBO item mapping lookup failed: ${mappingError.message}`);
  }

  const mappings = ((rawMappings ?? []) as ProductMappingRow[]).filter(
    (row) => row.deleted_at == null
  );
  if (mappings.length === 0) return new Map();

  const chosenMappings = qbItemIds
    .map((qbItemId) => chooseMapping(mappings, qbItemId, args.connectionId ?? null))
    .filter((row): row is ProductMappingRow => !!row);
  if (chosenMappings.length === 0) return new Map();

  const productIds = Array.from(new Set(chosenMappings.map((row) => row.product_id)));
  const { data: rawProducts, error: productError } = await args.supabase
    .from("products")
    .select("id, company_id, name, type, task_type_ref, task_type_id, unit, unit_id, deleted_at")
    .eq("company_id", args.companyId)
    .in("id", productIds);
  if (productError) {
    throw new Error(`QBO item product lookup failed: ${productError.message}`);
  }

  const productById = new Map<string, ProductRow>();
  for (const product of (rawProducts ?? []) as ProductRow[]) {
    if (product.deleted_at == null) productById.set(product.id, product);
  }

  const resolved = new Map<string, ResolvedLineProduct>();
  for (const mapping of chosenMappings) {
    const product = productById.get(mapping.product_id);
    if (!product) continue;
    resolved.set(mapping.qb_item_id, {
      product_id: product.id,
      type: normalizeLineType(product.type),
      task_type_ref: product.task_type_ref ?? null,
      task_type_id: product.task_type_id ?? null,
      unit: product.unit ?? null,
      unit_id: product.unit_id ?? null,
    });
  }
  return resolved;
}

export async function buildQboLineReplacementPayload(args: {
  supabase: SupabaseClient;
  companyId: string;
  connectionId?: string | null;
  parent: QboReplacementParent;
  lines: QboReplacementLineInput[];
}): Promise<Array<Record<string, unknown>>> {
  const mappingByQbItemId = await resolveQboItemProducts(args);

  return args.lines.map((line) => {
    const qbItemId = str(line.qb_item_id);
    const qbItemName = str(line.qb_item_name);
    const qbItemType = str(line.qb_item_type);
    const mapped = qbItemId ? mappingByQbItemId.get(qbItemId) ?? null : null;
    const fallbackType = opsTypeFromQboItemType(qbItemType, args.parent);

    return {
      name: str(line.name) ?? "Line item",
      description: str(line.description),
      quantity: num(line.quantity, 1),
      unit_price: num(line.unit_price, 0),
      is_taxable: bool(line.is_taxable, false),
      sort_order: Math.trunc(num(line.sort_order, 0)),
      type: mapped?.type ?? fallbackType,
      qb_item_id: qbItemId,
      qb_item_name: qbItemName,
      product_id: mapped?.product_id ?? null,
      task_type_ref: mapped?.task_type_ref ?? null,
      task_type_id: mapped?.task_type_id ?? null,
      unit: mapped?.unit ?? null,
      unit_id: mapped?.unit_id ?? null,
    };
  });
}

export function getMissingQboItemMappings(
  payload: Array<Record<string, unknown>>
): MissingQboItemMapping[] {
  const seen = new Set<string>();
  const missing: MissingQboItemMapping[] = [];
  for (const line of payload) {
    const qbItemId = str(line.qb_item_id);
    if (!qbItemId || str(line.product_id)) continue;
    if (seen.has(qbItemId)) continue;
    seen.add(qbItemId);
    missing.push({
      qb_item_id: qbItemId,
      qb_item_name: str(line.qb_item_name),
      line_name: str(line.name) ?? "Line item",
    });
  }
  return missing;
}

export function formatQboItemMappingWarning(missing: MissingQboItemMapping[]): string | null {
  if (missing.length === 0) return null;
  const labels = missing
    .slice(0, 4)
    .map((item) => item.qb_item_name ?? item.line_name)
    .join(", ");
  const suffix = missing.length > 4 ? `, +${missing.length - 4}` : "";
  return `QuickBooks item mapping needed: ${labels}${suffix}`;
}
