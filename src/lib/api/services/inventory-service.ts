/**
 * OPS Web - Inventory Service
 *
 * CRUD operations for inventory items, units, tags, item-tag associations,
 * and snapshots using Supabase.
 * Database columns use snake_case; TypeScript uses camelCase.
 */

import { requireSupabase, parseDate } from "@/lib/supabase/helpers";
import type {
  InventoryItem,
  CreateInventoryItem,
  UpdateInventoryItem,
  InventoryUnit,
  CreateInventoryUnit,
  InventoryTag,
  CreateInventoryTag,
  UpdateInventoryTag,
  InventoryItemTag,
  InventorySnapshot,
  InventorySnapshotItem,
} from "@/lib/types/inventory";

// ─── Database ↔ TypeScript Mapping ────────────────────────────────────────────

function mapItemFromDb(row: Record<string, unknown>): InventoryItem {
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    name: row.name as string,
    description: (row.description as string) ?? null,
    quantity: Number(row.quantity ?? 0),
    unitId: (row.unit_id as string) ?? null,
    sku: (row.sku as string) ?? null,
    notes: (row.notes as string) ?? null,
    imageUrl: (row.image_url as string) ?? null,
    warningThreshold:
      row.warning_threshold != null ? Number(row.warning_threshold) : null,
    criticalThreshold:
      row.critical_threshold != null ? Number(row.critical_threshold) : null,
    createdAt: parseDate(row.created_at),
    updatedAt: parseDate(row.updated_at),
    deletedAt: parseDate(row.deleted_at),
  };
}

function mapItemToDb(
  data: Partial<CreateInventoryItem & UpdateInventoryItem>
): Record<string, unknown> {
  const row: Record<string, unknown> = {};

  if (data.companyId !== undefined) row.company_id = data.companyId;
  if (data.name !== undefined) row.name = data.name;
  if (data.description !== undefined) row.description = data.description;
  if (data.quantity !== undefined) row.quantity = data.quantity;
  if (data.unitId !== undefined) row.unit_id = data.unitId;
  if (data.sku !== undefined) row.sku = data.sku;
  if (data.notes !== undefined) row.notes = data.notes;
  if (data.imageUrl !== undefined) row.image_url = data.imageUrl;
  if (data.warningThreshold !== undefined)
    row.warning_threshold = data.warningThreshold;
  if (data.criticalThreshold !== undefined)
    row.critical_threshold = data.criticalThreshold;

  return row;
}

function mapUnitFromDb(row: Record<string, unknown>): InventoryUnit {
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    display: row.display as string,
    isDefault: (row.is_default as boolean) ?? false,
    sortOrder: Number(row.sort_order ?? 0),
    createdAt: parseDate(row.created_at),
    updatedAt: parseDate(row.updated_at),
    deletedAt: parseDate(row.deleted_at),
  };
}

function mapUnitToDb(
  data: Partial<CreateInventoryUnit>
): Record<string, unknown> {
  const row: Record<string, unknown> = {};

  if (data.companyId !== undefined) row.company_id = data.companyId;
  if (data.display !== undefined) row.display = data.display;
  if (data.isDefault !== undefined) row.is_default = data.isDefault;
  if (data.sortOrder !== undefined) row.sort_order = data.sortOrder;

  return row;
}

function mapTagFromDb(row: Record<string, unknown>): InventoryTag {
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    name: row.name as string,
    warningThreshold:
      row.warning_threshold != null ? Number(row.warning_threshold) : null,
    criticalThreshold:
      row.critical_threshold != null ? Number(row.critical_threshold) : null,
    createdAt: parseDate(row.created_at),
    updatedAt: parseDate(row.updated_at),
    deletedAt: parseDate(row.deleted_at),
  };
}

function mapTagToDb(
  data: Partial<CreateInventoryTag & UpdateInventoryTag>
): Record<string, unknown> {
  const row: Record<string, unknown> = {};

  if (data.companyId !== undefined) row.company_id = data.companyId;
  if (data.name !== undefined) row.name = data.name;
  if (data.warningThreshold !== undefined)
    row.warning_threshold = data.warningThreshold;
  if (data.criticalThreshold !== undefined)
    row.critical_threshold = data.criticalThreshold;

  return row;
}

function mapItemTagFromDb(row: Record<string, unknown>): InventoryItemTag {
  return {
    id: row.id as string,
    itemId: row.item_id as string,
    tagId: row.tag_id as string,
  };
}

function mapSnapshotFromDb(row: Record<string, unknown>): InventorySnapshot {
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    createdById: (row.created_by_id as string) ?? null,
    isAutomatic: (row.is_automatic as boolean) ?? false,
    itemCount: Number(row.item_count ?? 0),
    notes: (row.notes as string) ?? null,
    createdAt: parseDate(row.created_at),
  };
}

function mapSnapshotItemFromDb(
  row: Record<string, unknown>
): InventorySnapshotItem {
  return {
    id: row.id as string,
    snapshotId: row.snapshot_id as string,
    originalItemId: (row.original_item_id as string) ?? null,
    name: row.name as string,
    quantity: Number(row.quantity ?? 0),
    unitDisplay: (row.unit_display as string) ?? null,
    sku: (row.sku as string) ?? null,
    tagsString: (row.tags_string as string) ?? null,
    description: (row.description as string) ?? null,
  };
}

// ─── Default Units ───────────────────────────────────────────────────────────

const DEFAULT_UNITS = [
  "ea",
  "box",
  "ft",
  "m",
  "kg",
  "lb",
  "gal",
  "L",
  "roll",
  "sheet",
  "bag",
  "pallet",
];

// ─── Service ──────────────────────────────────────────────────────────────────

export const InventoryService = {
  // ── Items ────────────────────────────────────────────────────────────────────

  async fetchItems(companyId: string): Promise<InventoryItem[]> {
    const supabase = requireSupabase();

    const { data, error } = await supabase
      .from("inventory_items")
      .select("*")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .order("name");

    if (error)
      throw new Error(`Failed to fetch inventory items: ${error.message}`);
    return (data ?? []).map(mapItemFromDb);
  },

  async fetchItem(id: string): Promise<InventoryItem> {
    const supabase = requireSupabase();

    const { data, error } = await supabase
      .from("inventory_items")
      .select("*")
      .eq("id", id)
      .single();

    if (error)
      throw new Error(`Failed to fetch inventory item: ${error.message}`);
    return mapItemFromDb(data);
  },

  async createItem(data: CreateInventoryItem): Promise<InventoryItem> {
    const supabase = requireSupabase();
    const row = mapItemToDb(data);

    const { data: created, error } = await supabase
      .from("inventory_items")
      .insert(row)
      .select()
      .single();

    if (error)
      throw new Error(`Failed to create inventory item: ${error.message}`);
    return mapItemFromDb(created);
  },

  async updateItem(
    id: string,
    data: UpdateInventoryItem
  ): Promise<InventoryItem> {
    const supabase = requireSupabase();
    const row = mapItemToDb(data);

    const { data: updated, error } = await supabase
      .from("inventory_items")
      .update(row)
      .eq("id", id)
      .select()
      .single();

    if (error)
      throw new Error(`Failed to update inventory item: ${error.message}`);
    return mapItemFromDb(updated);
  },

  async deleteItem(id: string): Promise<void> {
    const supabase = requireSupabase();

    const { error } = await supabase
      .from("inventory_items")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);

    if (error)
      throw new Error(`Failed to delete inventory item: ${error.message}`);
  },

  async bulkDeleteItems(ids: string[]): Promise<void> {
    const supabase = requireSupabase();

    const { error } = await supabase
      .from("inventory_items")
      .update({ deleted_at: new Date().toISOString() })
      .in("id", ids);

    if (error)
      throw new Error(`Failed to bulk delete inventory items: ${error.message}`);
  },

  async bulkAdjustQuantity(ids: string[], delta: number): Promise<void> {
    const supabase = requireSupabase();

    // Fetch current quantities
    const { data: items, error: fetchError } = await supabase
      .from("inventory_items")
      .select("id, quantity")
      .in("id", ids);

    if (fetchError)
      throw new Error(
        `Failed to fetch items for bulk adjust: ${fetchError.message}`
      );

    // Update each item (minimum quantity 0)
    const updates = (items ?? []).map((item) => {
      const newQty = Math.max(0, Number(item.quantity ?? 0) + delta);
      return supabase
        .from("inventory_items")
        .update({ quantity: newQty })
        .eq("id", item.id as string);
    });

    const results = await Promise.all(updates);
    const failed = results.find((r) => r.error);
    if (failed?.error)
      throw new Error(
        `Failed to bulk adjust quantities: ${failed.error.message}`
      );
  },

  // ── Units ────────────────────────────────────────────────────────────────────

  async fetchUnits(companyId: string): Promise<InventoryUnit[]> {
    const supabase = requireSupabase();

    const { data, error } = await supabase
      .from("inventory_units")
      .select("*")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .order("sort_order");

    if (error)
      throw new Error(`Failed to fetch inventory units: ${error.message}`);
    return (data ?? []).map(mapUnitFromDb);
  },

  async createUnit(data: CreateInventoryUnit): Promise<InventoryUnit> {
    const supabase = requireSupabase();
    const row = mapUnitToDb(data);

    const { data: created, error } = await supabase
      .from("inventory_units")
      .insert(row)
      .select()
      .single();

    if (error)
      throw new Error(`Failed to create inventory unit: ${error.message}`);
    return mapUnitFromDb(created);
  },

  async deleteUnit(id: string): Promise<void> {
    const supabase = requireSupabase();

    const { error } = await supabase
      .from("inventory_units")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);

    if (error)
      throw new Error(`Failed to delete inventory unit: ${error.message}`);
  },

  async createDefaultUnits(companyId: string): Promise<InventoryUnit[]> {
    const supabase = requireSupabase();

    const rows = DEFAULT_UNITS.map((display, index) => ({
      company_id: companyId,
      display,
      is_default: true,
      sort_order: index,
    }));

    const { data, error } = await supabase
      .from("inventory_units")
      .insert(rows)
      .select();

    if (error)
      throw new Error(`Failed to create default units: ${error.message}`);
    return (data ?? []).map(mapUnitFromDb);
  },

  // ── Tags ─────────────────────────────────────────────────────────────────────

  async fetchTags(companyId: string): Promise<InventoryTag[]> {
    const supabase = requireSupabase();

    const { data, error } = await supabase
      .from("inventory_tags")
      .select("*")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .order("name");

    if (error)
      throw new Error(`Failed to fetch inventory tags: ${error.message}`);
    return (data ?? []).map(mapTagFromDb);
  },

  async createTag(data: CreateInventoryTag): Promise<InventoryTag> {
    const supabase = requireSupabase();
    const row = mapTagToDb(data);

    const { data: created, error } = await supabase
      .from("inventory_tags")
      .insert(row)
      .select()
      .single();

    if (error)
      throw new Error(`Failed to create inventory tag: ${error.message}`);
    return mapTagFromDb(created);
  },

  async updateTag(
    id: string,
    data: UpdateInventoryTag
  ): Promise<InventoryTag> {
    const supabase = requireSupabase();
    const row = mapTagToDb(data);

    const { data: updated, error } = await supabase
      .from("inventory_tags")
      .update(row)
      .eq("id", id)
      .select()
      .single();

    if (error)
      throw new Error(`Failed to update inventory tag: ${error.message}`);
    return mapTagFromDb(updated);
  },

  async deleteTag(id: string): Promise<void> {
    const supabase = requireSupabase();

    const { error } = await supabase
      .from("inventory_tags")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);

    if (error)
      throw new Error(`Failed to delete inventory tag: ${error.message}`);
  },

  // ── Item-Tag Junction ────────────────────────────────────────────────────────

  async fetchItemTags(companyId: string): Promise<InventoryItemTag[]> {
    const supabase = requireSupabase();

    // Join through inventory_items to filter by company_id
    const { data, error } = await supabase
      .from("inventory_item_tags")
      .select("id, item_id, tag_id, inventory_items!inner(company_id)")
      .eq("inventory_items.company_id", companyId);

    if (error)
      throw new Error(`Failed to fetch item tags: ${error.message}`);
    return (data ?? []).map(mapItemTagFromDb);
  },

  async setItemTags(itemId: string, tagIds: string[]): Promise<void> {
    const supabase = requireSupabase();

    // Delete existing tags for this item
    const { error: deleteError } = await supabase
      .from("inventory_item_tags")
      .delete()
      .eq("item_id", itemId);

    if (deleteError)
      throw new Error(
        `Failed to clear item tags: ${deleteError.message}`
      );

    // Insert new tags (if any)
    if (tagIds.length > 0) {
      const rows = tagIds.map((tagId) => ({
        item_id: itemId,
        tag_id: tagId,
      }));

      const { error: insertError } = await supabase
        .from("inventory_item_tags")
        .insert(rows);

      if (insertError)
        throw new Error(
          `Failed to set item tags: ${insertError.message}`
        );
    }
  },

  async bulkSetTags(itemIds: string[], tagIds: string[]): Promise<void> {
    const supabase = requireSupabase();

    // Delete existing tags for all items
    const { error: deleteError } = await supabase
      .from("inventory_item_tags")
      .delete()
      .in("item_id", itemIds);

    if (deleteError)
      throw new Error(
        `Failed to clear bulk item tags: ${deleteError.message}`
      );

    // Insert new tags for each item
    if (tagIds.length > 0) {
      const rows = itemIds.flatMap((itemId) =>
        tagIds.map((tagId) => ({
          item_id: itemId,
          tag_id: tagId,
        }))
      );

      const { error: insertError } = await supabase
        .from("inventory_item_tags")
        .insert(rows);

      if (insertError)
        throw new Error(
          `Failed to bulk set item tags: ${insertError.message}`
        );
    }
  },

  // ── Snapshots ────────────────────────────────────────────────────────────────

  async fetchSnapshots(companyId: string): Promise<InventorySnapshot[]> {
    const supabase = requireSupabase();

    const { data, error } = await supabase
      .from("inventory_snapshots")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });

    if (error)
      throw new Error(`Failed to fetch snapshots: ${error.message}`);
    return (data ?? []).map(mapSnapshotFromDb);
  },

  async fetchSnapshotItems(
    snapshotId: string
  ): Promise<InventorySnapshotItem[]> {
    const supabase = requireSupabase();

    const { data, error } = await supabase
      .from("inventory_snapshot_items")
      .select("*")
      .eq("snapshot_id", snapshotId)
      .order("name");

    if (error)
      throw new Error(`Failed to fetch snapshot items: ${error.message}`);
    return (data ?? []).map(mapSnapshotItemFromDb);
  },

  async createFullSnapshot(
    companyId: string,
    userId: string,
    isAutomatic: boolean,
    items: InventoryItem[],
    units: InventoryUnit[],
    itemTags: InventoryItemTag[],
    tags: InventoryTag[],
    notes?: string
  ): Promise<InventorySnapshot> {
    const supabase = requireSupabase();

    // 1. Insert the snapshot record
    const { data: snapshot, error: snapshotError } = await supabase
      .from("inventory_snapshots")
      .insert({
        company_id: companyId,
        created_by_id: userId,
        is_automatic: isAutomatic,
        item_count: items.length,
        notes: notes ?? null,
      })
      .select()
      .single();

    if (snapshotError)
      throw new Error(
        `Failed to create snapshot: ${snapshotError.message}`
      );

    // 2. Build lookup maps for unit display and tags
    const unitMap = new Map(units.map((u) => [u.id, u.display]));

    const tagMap = new Map(tags.map((t) => [t.id, t.name]));
    const itemTagMap = new Map<string, string[]>();
    for (const it of itemTags) {
      const existing = itemTagMap.get(it.itemId) ?? [];
      const tagName = tagMap.get(it.tagId);
      if (tagName) existing.push(tagName);
      itemTagMap.set(it.itemId, existing);
    }

    // 3. Insert all snapshot items
    const snapshotItems = items.map((item) => ({
      snapshot_id: snapshot.id as string,
      original_item_id: item.id,
      name: item.name,
      quantity: item.quantity,
      unit_display: item.unitId ? (unitMap.get(item.unitId) ?? null) : null,
      sku: item.sku,
      tags_string: itemTagMap.get(item.id)?.join(", ") ?? null,
      description: item.description,
    }));

    if (snapshotItems.length > 0) {
      const { error: itemsError } = await supabase
        .from("inventory_snapshot_items")
        .insert(snapshotItems);

      if (itemsError)
        throw new Error(
          `Failed to create snapshot items: ${itemsError.message}`
        );
    }

    return mapSnapshotFromDb(snapshot);
  },
};
