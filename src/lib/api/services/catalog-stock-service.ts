/**
 * OPS Web — Catalog Stock Service
 *
 * Variant-aware reads + mutations against the `catalog_*` tables (NOT the
 * legacy `inventory_*` compatibility views). Every quantity mutation writes an
 * `inventory_deductions` audit row keyed by `catalog_variant_id` so the
 * drawer ledger shows web edits alongside iOS-written rows (capability
 * inventory §6 S1). RLS: `company_isolation` on `{public}` lets the
 * Firebase-auth browser client read/write these directly.
 */

import { requireSupabase, parseDate } from "@/lib/supabase/helpers";
import {
  effectiveThresholds,
  statusFor,
  type CatalogStockRow,
  type CatalogAdjustment,
  type AdjustmentReason,
  type CatalogUsedIn,
  type ThresholdSource,
} from "@/lib/types/catalog";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asUuid(value: string | null | undefined): string | null {
  return value && UUID_RE.test(value) ? value : null;
}

// ─── Row assembly helpers ─────────────────────────────────────────────────────

interface FamilyMeta {
  name: string;
  description: string | null;
  imageUrl: string | null;
  categoryId: string | null;
  defaultUnitCost: number | null;
  defaultUnitId: string | null;
  warning: number | null;
  critical: number | null;
}

interface CategoryMeta {
  name: string;
  warning: number | null;
  critical: number | null;
}

interface UnitMeta {
  display: string;
  abbreviation: string | null;
}

function num(v: unknown): number | null {
  return v == null ? null : Number(v);
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const CatalogStockService = {
  /**
   * Fetch every variant for a company, assembled into flat per-variant rows
   * with derived option-value labels, resolved cost, and the 3-level
   * threshold cascade + status. A fixed number of parallel queries — never
   * N+1 per variant.
   */
  async fetchStock(companyId: string): Promise<CatalogStockRow[]> {
    const supabase = requireSupabase();

    const [
      variantsRes,
      itemsRes,
      categoriesRes,
      unitsRes,
      optionsRes,
      optionValuesRes,
      vovRes,
      itemTagsRes,
      tagsRes,
    ] = await Promise.all([
      supabase
        .from("catalog_variants")
        .select(
          "id, catalog_item_id, sku, quantity, unit_cost_override, warning_threshold, critical_threshold, unit_id, is_active, updated_at",
        )
        .eq("company_id", companyId)
        .is("deleted_at", null),
      supabase
        .from("catalog_items")
        .select(
          "id, name, description, image_url, category_id, default_unit_cost, default_unit_id, default_warning_threshold, default_critical_threshold",
        )
        .eq("company_id", companyId)
        .is("deleted_at", null),
      supabase
        .from("catalog_categories")
        .select("id, name, default_warning_threshold, default_critical_threshold")
        .eq("company_id", companyId)
        .is("deleted_at", null),
      supabase
        .from("catalog_units")
        .select("id, display, abbreviation")
        .eq("company_id", companyId)
        .is("deleted_at", null),
      supabase
        .from("catalog_options")
        .select("id, catalog_item_id, sort_order")
        .is("deleted_at", null),
      supabase
        .from("catalog_option_values")
        .select("id, option_id, value")
        .is("deleted_at", null),
      supabase
        .from("catalog_variant_option_values")
        .select("variant_id, option_value_id")
        .is("deleted_at", null),
      supabase.from("catalog_item_tags").select("catalog_item_id, tag_id"),
      supabase
        .from("catalog_tags")
        .select("id, name")
        .eq("company_id", companyId)
        .is("deleted_at", null),
    ]);

    for (const res of [
      variantsRes,
      itemsRes,
      categoriesRes,
      unitsRes,
      optionsRes,
      optionValuesRes,
      vovRes,
      itemTagsRes,
      tagsRes,
    ]) {
      if (res.error) throw new Error(`Failed to fetch catalog stock: ${res.error.message}`);
    }

    // Family / category / unit lookups
    const families = new Map<string, FamilyMeta>();
    for (const r of itemsRes.data ?? []) {
      families.set(r.id as string, {
        name: r.name as string,
        description: (r.description as string) ?? null,
        imageUrl: (r.image_url as string) ?? null,
        categoryId: (r.category_id as string) ?? null,
        defaultUnitCost: num(r.default_unit_cost),
        defaultUnitId: (r.default_unit_id as string) ?? null,
        warning: num(r.default_warning_threshold),
        critical: num(r.default_critical_threshold),
      });
    }

    const categories = new Map<string, CategoryMeta>();
    for (const r of categoriesRes.data ?? []) {
      categories.set(r.id as string, {
        name: r.name as string,
        warning: num(r.default_warning_threshold),
        critical: num(r.default_critical_threshold),
      });
    }

    const units = new Map<string, UnitMeta>();
    for (const r of unitsRes.data ?? []) {
      units.set(r.id as string, {
        display: r.display as string,
        abbreviation: (r.abbreviation as string) ?? null,
      });
    }

    // option_id → { itemId, sortOrder }
    const optionInfo = new Map<string, { itemId: string; sortOrder: number }>();
    for (const r of optionsRes.data ?? []) {
      optionInfo.set(r.id as string, {
        itemId: r.catalog_item_id as string,
        sortOrder: (r.sort_order as number) ?? 0,
      });
    }
    // option_value_id → { optionId, value }
    const optionValueInfo = new Map<string, { optionId: string; value: string }>();
    for (const r of optionValuesRes.data ?? []) {
      optionValueInfo.set(r.id as string, {
        optionId: r.option_id as string,
        value: r.value as string,
      });
    }
    // variant_id → [{ sortOrder, value }] (sorted by the option's sort_order)
    const variantValues = new Map<string, { sortOrder: number; value: string }[]>();
    for (const r of vovRes.data ?? []) {
      const ovi = optionValueInfo.get(r.option_value_id as string);
      if (!ovi) continue;
      const oi = optionInfo.get(ovi.optionId);
      if (!oi) continue;
      const list = variantValues.get(r.variant_id as string) ?? [];
      list.push({ sortOrder: oi.sortOrder, value: ovi.value });
      variantValues.set(r.variant_id as string, list);
    }

    // tag_id → name; familyId → tag names
    const tagNames = new Map<string, string>();
    for (const r of tagsRes.data ?? []) tagNames.set(r.id as string, r.name as string);
    const familyTags = new Map<string, string[]>();
    for (const r of itemTagsRes.data ?? []) {
      const name = tagNames.get(r.tag_id as string);
      if (!name) continue;
      const list = familyTags.get(r.catalog_item_id as string) ?? [];
      list.push(name);
      familyTags.set(r.catalog_item_id as string, list);
    }

    const rows: CatalogStockRow[] = [];
    for (const v of variantsRes.data ?? []) {
      const itemId = v.catalog_item_id as string;
      const fam = families.get(itemId);
      if (!fam) continue; // orphan variant — family deleted; skip

      const cat = fam.categoryId ? categories.get(fam.categoryId) ?? null : null;

      const warningOverride = num(v.warning_threshold);
      const criticalOverride = num(v.critical_threshold);
      const eff = effectiveThresholds(
        { warning: warningOverride, critical: criticalOverride },
        { warning: fam.warning, critical: fam.critical },
        cat ? { warning: cat.warning, critical: cat.critical } : null,
      );

      const warningSource: ThresholdSource =
        warningOverride != null
          ? "variant"
          : fam.warning != null
            ? "family"
            : cat?.warning != null
              ? "category"
              : "none";
      const criticalSource: ThresholdSource =
        criticalOverride != null
          ? "variant"
          : fam.critical != null
            ? "family"
            : cat?.critical != null
              ? "category"
              : "none";

      const quantity = Number(v.quantity ?? 0);
      const unitCostOverride = num(v.unit_cost_override);
      const effectiveCost = unitCostOverride ?? fam.defaultUnitCost ?? null;

      const unitId = (v.unit_id as string) ?? fam.defaultUnitId ?? null;
      const unit = unitId ? units.get(unitId) ?? null : null;

      const valueParts = (variantValues.get(v.id as string) ?? [])
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((p) => p.value);

      rows.push({
        variantId: v.id as string,
        itemId,
        companyId,
        familyName: fam.name,
        familyDescription: fam.description,
        imageUrl: fam.imageUrl,
        variantLabel: valueParts.length > 0 ? valueParts.join(" · ") : null,
        categoryId: fam.categoryId,
        categoryName: cat?.name ?? null,
        sku: (v.sku as string) ?? null,
        quantity,
        unitId,
        unitDisplay: unit?.display ?? null,
        unitAbbreviation: unit?.abbreviation ?? null,
        unitCostOverride,
        familyDefaultCost: fam.defaultUnitCost,
        effectiveCost,
        warningOverride,
        criticalOverride,
        effectiveWarning: eff.warning,
        effectiveCritical: eff.critical,
        warningSource,
        criticalSource,
        status: statusFor(quantity, eff),
        tags: familyTags.get(itemId) ?? [],
        isActive: (v.is_active as boolean) ?? true,
        updatedAt: parseDate(v.updated_at),
      });
    }

    // Stable order: family name, then variant label.
    rows.sort((a, b) => {
      const fn = a.familyName.localeCompare(b.familyName);
      if (fn !== 0) return fn;
      return (a.variantLabel ?? "").localeCompare(b.variantLabel ?? "");
    });

    return rows;
  },

  /**
   * Adjust a variant's quantity and write an audit row. `mode: "set"` writes
   * an absolute count; `mode: "delta"` applies a signed change (+received /
   * −removed). Floors at zero (iOS parity). Returns the committed quantity.
   */
  async adjustQuantity(params: {
    variantId: string;
    companyId: string;
    mode: "set" | "delta";
    value: number;
    deductedBy: string | null;
    notes?: string | null;
  }): Promise<number> {
    const supabase = requireSupabase();

    const { data: current, error: readErr } = await supabase
      .from("catalog_variants")
      .select("quantity")
      .eq("id", params.variantId)
      .single();
    if (readErr || !current) {
      throw new Error(`Failed to read variant: ${readErr?.message ?? "not found"}`);
    }

    const previous = Number(current.quantity ?? 0);
    const target =
      params.mode === "set" ? params.value : previous + params.value;
    const newQty = Math.max(0, target);

    const { error: updErr } = await supabase
      .from("catalog_variants")
      .update({ quantity: newQty, updated_at: new Date().toISOString() })
      .eq("id", params.variantId);
    if (updErr) throw new Error(`Failed to update quantity: ${updErr.message}`);

    // quantity_deducted follows the existing "positive = removed" convention.
    const { error: auditErr } = await supabase.from("inventory_deductions").insert({
      company_id: params.companyId,
      catalog_variant_id: params.variantId,
      quantity_deducted: previous - newQty,
      previous_quantity: previous,
      new_quantity: newQty,
      reason: "manual_adjustment",
      deducted_by: asUuid(params.deductedBy),
      notes: params.notes ?? null,
    });
    if (auditErr) throw new Error(`Failed to write adjustment audit: ${auditErr.message}`);

    return newQty;
  },

  /** Update editable variant fields (sparse — only sets provided keys). */
  async updateVariant(
    variantId: string,
    patch: {
      sku?: string | null;
      unitCostOverride?: number | null;
      warningOverride?: number | null;
      criticalOverride?: number | null;
      unitId?: string | null;
      isActive?: boolean;
    },
  ): Promise<void> {
    const supabase = requireSupabase();
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.sku !== undefined) row.sku = patch.sku;
    if (patch.unitCostOverride !== undefined)
      row.unit_cost_override = patch.unitCostOverride;
    if (patch.warningOverride !== undefined)
      row.warning_threshold = patch.warningOverride;
    if (patch.criticalOverride !== undefined)
      row.critical_threshold = patch.criticalOverride;
    if (patch.unitId !== undefined) row.unit_id = patch.unitId;
    if (patch.isActive !== undefined) row.is_active = patch.isActive;

    const { error } = await supabase
      .from("catalog_variants")
      .update(row)
      .eq("id", variantId);
    if (error) throw new Error(`Failed to update variant: ${error.message}`);
  },

  /**
   * Create a family (catalog_items) plus its first default variant. The
   * single-variant "good" path — no option axes. Returns the new variant id.
   */
  async createFamily(input: {
    companyId: string;
    name: string;
    categoryId: string | null;
    unitId: string | null;
    quantity: number;
    sku: string | null;
    defaultUnitCost: number | null;
    warningThreshold: number | null;
    criticalThreshold: number | null;
  }): Promise<{ itemId: string; variantId: string }> {
    const supabase = requireSupabase();

    const { data: item, error: itemErr } = await supabase
      .from("catalog_items")
      .insert({
        company_id: input.companyId,
        name: input.name.trim(),
        category_id: input.categoryId,
        default_unit_id: input.unitId,
        default_unit_cost: input.defaultUnitCost,
        default_warning_threshold: input.warningThreshold,
        default_critical_threshold: input.criticalThreshold,
        is_active: true,
      })
      .select("id")
      .single();
    if (itemErr || !item) throw new Error(`Failed to create family: ${itemErr?.message}`);

    const itemId = item.id as string;
    const { data: variant, error: varErr } = await supabase
      .from("catalog_variants")
      .insert({
        company_id: input.companyId,
        catalog_item_id: itemId,
        sku: input.sku,
        quantity: input.quantity,
        unit_id: input.unitId,
        is_active: true,
      })
      .select("id")
      .single();
    if (varErr || !variant) throw new Error(`Failed to create variant: ${varErr?.message}`);

    return { itemId, variantId: variant.id as string };
  },

  /** Soft-delete a variant. */
  async deleteVariant(variantId: string): Promise<void> {
    const supabase = requireSupabase();
    const { error } = await supabase
      .from("catalog_variants")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", variantId);
    if (error) throw new Error(`Failed to delete variant: ${error.message}`);
  },

  /** Bulk soft-delete. */
  async bulkDelete(variantIds: string[]): Promise<void> {
    if (variantIds.length === 0) return;
    const supabase = requireSupabase();
    const { error } = await supabase
      .from("catalog_variants")
      .update({ deleted_at: new Date().toISOString() })
      .in("id", variantIds);
    if (error) throw new Error(`Failed to delete variants: ${error.message}`);
  },

  /** Bulk apply a signed delta across variants, each audited. */
  async bulkAdjust(params: {
    variantIds: string[];
    companyId: string;
    delta: number;
    deductedBy: string | null;
  }): Promise<void> {
    for (const variantId of params.variantIds) {
      await CatalogStockService.adjustQuantity({
        variantId,
        companyId: params.companyId,
        mode: "delta",
        value: params.delta,
        deductedBy: params.deductedBy,
        notes: "Bulk adjustment",
      });
    }
  },

  /**
   * Family-level tag replacement across the selected variants' families.
   * Tags live on `catalog_item_tags`; setting them affects every sibling
   * variant of each family (confirmation copy must say so).
   */
  async bulkSetFamilyTags(params: {
    variantIds: string[];
    companyId: string;
    tagIds: string[];
  }): Promise<void> {
    const supabase = requireSupabase();
    // Resolve the distinct families behind the selected variants.
    const { data: vars, error } = await supabase
      .from("catalog_variants")
      .select("catalog_item_id")
      .in("id", params.variantIds);
    if (error) throw new Error(`Failed to resolve families: ${error.message}`);
    const itemIds = Array.from(
      new Set((vars ?? []).map((v) => v.catalog_item_id as string)),
    );
    for (const itemId of itemIds) {
      await supabase.from("catalog_item_tags").delete().eq("catalog_item_id", itemId);
      if (params.tagIds.length > 0) {
        await supabase.from("catalog_item_tags").insert(
          params.tagIds.map((tagId) => ({
            catalog_item_id: itemId,
            tag_id: tagId,
          })),
        );
      }
    }
  },

  /** Adjustment ledger for a variant — COALESCEs catalog-variant-written
   *  (web) and inventory-item-written (iOS legacy) rows. */
  async fetchAdjustments(
    variantId: string,
    itemId: string,
  ): Promise<CatalogAdjustment[]> {
    const supabase = requireSupabase();
    // The legacy iOS rows reference inventory_item_id, which equals the
    // variant id under the compat-view mapping (one variant ⇒ one legacy item
    // row with the same id). So both columns key by the same variant id.
    const { data, error } = await supabase
      .from("inventory_deductions")
      .select(
        "id, quantity_deducted, previous_quantity, new_quantity, reason, notes, deducted_at, task_id, project_id",
      )
      .or(`catalog_variant_id.eq.${variantId},inventory_item_id.eq.${variantId}`)
      .order("deducted_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(`Failed to fetch adjustments: ${error.message}`);

    // Resolve task/project labels for task-attributed rows.
    const taskIds = Array.from(
      new Set((data ?? []).map((r) => r.task_id as string | null).filter(Boolean)),
    ) as string[];
    const taskLabels = new Map<string, string>();
    if (taskIds.length > 0) {
      const { data: tasks } = await supabase
        .from("project_tasks")
        .select("id, title, project_id")
        .in("id", taskIds);
      const projIds = Array.from(
        new Set((tasks ?? []).map((t) => t.project_id as string | null).filter(Boolean)),
      ) as string[];
      const projTitles = new Map<string, string>();
      if (projIds.length > 0) {
        const { data: projs } = await supabase
          .from("projects")
          .select("id, title")
          .in("id", projIds);
        for (const p of projs ?? []) projTitles.set(p.id as string, p.title as string);
      }
      for (const t of tasks ?? []) {
        const label =
          (t.title as string) ||
          (t.project_id ? projTitles.get(t.project_id as string) : null) ||
          "Task";
        taskLabels.set(t.id as string, label);
      }
    }

    void itemId;
    return (data ?? []).map((r) => {
      const previous = Number(r.previous_quantity ?? 0);
      const next = Number(r.new_quantity ?? 0);
      const reason = ((r.reason as string) ?? "manual_adjustment") as AdjustmentReason;
      const taskId = r.task_id as string | null;
      return {
        id: r.id as string,
        quantityDelta: next - previous,
        previousQuantity: previous,
        newQuantity: next,
        reason,
        taskLabel: taskId ? taskLabels.get(taskId) ?? null : null,
        notes: (r.notes as string) ?? null,
        at: parseDate(r.deducted_at) ?? new Date(),
      };
    });
  },

  /**
   * Products that reference this variant — via a recipe row
   * (product_materials) or a family stock link (products.linked_catalog_item_id).
   */
  async fetchUsedIn(variantId: string, itemId: string): Promise<CatalogUsedIn[]> {
    const supabase = requireSupabase();
    const [recipeRes, linkRes] = await Promise.all([
      supabase
        .from("product_materials")
        .select("product_id")
        .or(`catalog_variant_id.eq.${variantId},catalog_item_id.eq.${itemId}`),
      supabase
        .from("products")
        .select("id, name")
        .eq("linked_catalog_item_id", itemId)
        .is("deleted_at", null),
    ]);

    const out: CatalogUsedIn[] = [];
    const seen = new Set<string>();

    const recipeProductIds = Array.from(
      new Set((recipeRes.data ?? []).map((r) => r.product_id as string)),
    );
    if (recipeProductIds.length > 0) {
      const { data: prods } = await supabase
        .from("products")
        .select("id, name")
        .in("id", recipeProductIds)
        .is("deleted_at", null);
      for (const p of prods ?? []) {
        if (seen.has(p.id as string)) continue;
        seen.add(p.id as string);
        out.push({ productId: p.id as string, productName: p.name as string, via: "recipe" });
      }
    }
    for (const p of linkRes.data ?? []) {
      if (seen.has(p.id as string)) continue;
      seen.add(p.id as string);
      out.push({ productId: p.id as string, productName: p.name as string, via: "stock_link" });
    }
    return out;
  },
};

export default CatalogStockService;
