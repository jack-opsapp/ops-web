/**
 * OPS Web — Catalog Snapshot Service
 *
 * Variant-aware point-in-time stock captures, written DIRECTLY to
 * `catalog_snapshots` / `catalog_snapshot_items`. The legacy
 * `inventory_snapshots` view path the retired page used is read-only
 * (INSTEAD OF triggers were not authored for it) and would silently fail at
 * the year-end count — the exact moment it matters (capability inventory §6).
 */

import { requireSupabase, parseDate } from "@/lib/supabase/helpers";
import type {
  CatalogSnapshot,
  CatalogSnapshotItem,
  CatalogStockRow,
} from "@/lib/types/catalog";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asUuid = (v: string | null | undefined): string | null =>
  v && UUID_RE.test(v) ? v : null;

export const CatalogSnapshotService = {
  async fetchSnapshots(companyId: string): Promise<CatalogSnapshot[]> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("catalog_snapshots")
      .select("id, company_id, created_by_id, is_automatic, item_count, notes, created_at")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(`Failed to fetch snapshots: ${error.message}`);
    return (data ?? []).map((r) => ({
      id: r.id as string,
      companyId: r.company_id as string,
      createdById: (r.created_by_id as string) ?? null,
      isAutomatic: (r.is_automatic as boolean) ?? false,
      itemCount: (r.item_count as number) ?? 0,
      notes: (r.notes as string) ?? null,
      createdAt: parseDate(r.created_at),
    }));
  },

  async fetchSnapshotItems(snapshotId: string): Promise<CatalogSnapshotItem[]> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("catalog_snapshot_items")
      .select(
        "id, snapshot_id, original_variant_id, family_name, variant_label, quantity, unit_display, sku, description",
      )
      .eq("snapshot_id", snapshotId);
    if (error) throw new Error(`Failed to fetch snapshot items: ${error.message}`);
    return (data ?? []).map((r) => ({
      id: r.id as string,
      snapshotId: r.snapshot_id as string,
      originalVariantId: (r.original_variant_id as string) ?? null,
      familyName: r.family_name as string,
      variantLabel: (r.variant_label as string) ?? null,
      quantity: Number(r.quantity ?? 0),
      unitDisplay: (r.unit_display as string) ?? null,
      sku: (r.sku as string) ?? null,
      description: (r.description as string) ?? null,
    }));
  },

  /**
   * Capture the supplied stock rows as a manual snapshot. The caller passes
   * the current `CatalogStockRow[]` so the snapshot reflects exactly what the
   * operator sees (family name + variant label baked in, never a fragile join).
   */
  async createSnapshot(params: {
    companyId: string;
    createdById: string | null;
    notes: string | null;
    rows: CatalogStockRow[];
  }): Promise<CatalogSnapshot> {
    const supabase = requireSupabase();

    const { data: snap, error: snapErr } = await supabase
      .from("catalog_snapshots")
      .insert({
        company_id: params.companyId,
        created_by_id: asUuid(params.createdById),
        is_automatic: false,
        item_count: params.rows.length,
        notes: params.notes,
      })
      .select("id, company_id, created_by_id, is_automatic, item_count, notes, created_at")
      .single();
    if (snapErr || !snap) throw new Error(`Failed to create snapshot: ${snapErr?.message}`);

    if (params.rows.length > 0) {
      const items = params.rows.map((r) => ({
        snapshot_id: snap.id as string,
        original_variant_id: r.variantId,
        family_name: r.familyName,
        variant_label: r.variantLabel,
        quantity: r.quantity,
        unit_display: r.unitDisplay,
        sku: r.sku,
        description: r.familyDescription,
      }));
      const { error: itemsErr } = await supabase
        .from("catalog_snapshot_items")
        .insert(items);
      if (itemsErr) throw new Error(`Failed to write snapshot items: ${itemsErr.message}`);
    }

    return {
      id: snap.id as string,
      companyId: snap.company_id as string,
      createdById: (snap.created_by_id as string) ?? null,
      isAutomatic: (snap.is_automatic as boolean) ?? false,
      itemCount: (snap.item_count as number) ?? 0,
      notes: (snap.notes as string) ?? null,
      createdAt: parseDate(snap.created_at),
    };
  },
};

export default CatalogSnapshotService;
