"use client";

/**
 * Full product editor — the home of the configurable-product authoring layer
 * (options, pricing modifiers, recipe/BOM) that the estimate builder reads.
 * Lives at /catalog/products/[id]; also the target of the iOS "VIEW ON WEB →"
 * deep link to /products/{id} (redirected here). Survives the retired
 * /products edit-modal + /products/[id]/options page as one superset surface.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  GripVertical,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { usePageTitle } from "@/lib/hooks/use-page-title";
import { useDictionary } from "@/i18n/client";
import { usePermissionStore } from "@/lib/store/permissions-store";
import {
  useProduct,
  useUpdateProduct,
  useProductOptions,
  useProductOptionValues,
  useProductPricingModifiers,
  useReorderProductOptions,
  useDeleteProductOption,
  useDeleteProductPricingModifier,
  useTaskTypes,
} from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ops/confirm-dialog";
import { ProductBomEditor } from "@/components/ops/product-bom-editor";
import { ProductOptionFormDialog } from "@/components/ops/product-option-form-dialog";
import { ProductPricingModifierFormDialog } from "@/components/ops/product-pricing-modifier-form-dialog";
import {
  formatModifierRule,
  OPTION_KIND_LABEL,
  type ProductOption,
  type ProductPricingModifier,
} from "@/lib/types/product-options";
import { productMargin } from "@/lib/types/catalog";
import { fmtMargin } from "./format";
import { cn } from "@/lib/utils/cn";

const labelCls = "font-mono text-[11px] uppercase tracking-[0.14em] text-text-3";
/** Radix Select forbids an empty-string item value — sentinel for the "none" row. */
const NONE = "__none__";

export function ProductEditor({ productId }: { productId: string }) {
  const { t } = useDictionary("catalog");
  const router = useRouter();
  const can = usePermissionStore((s) => s.can);

  const { data: product, isLoading } = useProduct(productId);
  const { data: taskTypes = [] } = useTaskTypes();
  const updateProduct = useUpdateProduct();

  const { data: options = [], isLoading: optionsLoading } = useProductOptions(productId);
  const optionIds = useMemo(() => options.map((o) => o.id), [options]);
  const { data: values = [] } = useProductOptionValues(productId, optionIds);
  const { data: modifiers = [] } = useProductPricingModifiers(productId);
  const reorderOptions = useReorderProductOptions(productId);
  const deleteOption = useDeleteProductOption(productId);
  const deleteModifier = useDeleteProductPricingModifier(productId);

  usePageTitle(product ? `${product.name} · Catalog` : "Catalog");

  // ── Base fields (local form, explicit save) ───────────────────────────────
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("0");
  const [cost, setCost] = useState("");
  const [unit, setUnit] = useState("each");
  const [taskTypeId, setTaskTypeId] = useState<string>("");
  const [isTaxable, setIsTaxable] = useState(true);
  const [isActive, setIsActive] = useState(true);
  const [isFavorite, setIsFavorite] = useState(false);

  useEffect(() => {
    if (!product) return;
    setName(product.name);
    setDescription(product.description ?? "");
    setPrice(String(product.defaultPrice ?? 0));
    setCost(product.unitCost != null ? String(product.unitCost) : "");
    setUnit(product.unit ?? "each");
    setTaskTypeId(product.taskTypeId ?? "");
    setIsTaxable(product.isTaxable);
    setIsActive(product.isActive);
    setIsFavorite(product.isFavorite ?? false);
  }, [product]);

  const saveBase = () => {
    updateProduct.mutate({
      id: productId,
      data: {
        name: name.trim(),
        description: description.trim() || null,
        defaultPrice: Number(price) || 0,
        unitCost: cost.trim() === "" ? null : Number(cost),
        unit,
        taskTypeId: taskTypeId || null,
        isTaxable,
        isActive,
        isFavorite,
      },
    });
  };

  // ── Options dnd ─────────────────────────────────────────────────────────
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const [localOrder, setLocalOrder] = useState<ProductOption[] | null>(null);
  const orderedOptions = localOrder ?? options;

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      setLocalOrder(null);
      return;
    }
    const oldIndex = orderedOptions.findIndex((o) => o.id === active.id);
    const newIndex = orderedOptions.findIndex((o) => o.id === over.id);
    if (oldIndex === -1 || newIndex === -1) {
      setLocalOrder(null);
      return;
    }
    const next = arrayMove(orderedOptions, oldIndex, newIndex);
    setLocalOrder(next);
    reorderOptions.mutate(
      next.map((o) => o.id),
      { onSettled: () => setLocalOrder(null) },
    );
  }

  const [optionDialog, setOptionDialog] = useState<
    { mode: "create" } | { mode: "edit"; option: ProductOption } | null
  >(null);
  const [modifierDialog, setModifierDialog] = useState<
    { mode: "create" } | { mode: "edit"; modifier: ProductPricingModifier } | null
  >(null);
  const [optionToDelete, setOptionToDelete] = useState<ProductOption | null>(null);
  const [modifierToDelete, setModifierToDelete] = useState<ProductPricingModifier | null>(null);

  if (!can("products.manage")) {
    return (
      <div className="flex flex-col items-start gap-2 px-3 py-6">
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-mute">
          {"// ACCESS DENIED"}
        </span>
        <Button variant="ghost" size="sm" onClick={() => router.push("/catalog?segment=products")}>
          {t("editor.backToCatalog", "Back to catalog")}
        </Button>
      </div>
    );
  }

  if (isLoading || !product) {
    return (
      <div className="px-3 py-8">
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-mute">
          {isLoading ? "// LOADING…" : "// PRODUCT NOT FOUND"}
        </span>
      </div>
    );
  }

  const valuesByOption = new Map<string, typeof values>();
  for (const v of values) {
    const list = valuesByOption.get(v.optionId) ?? [];
    list.push(v);
    valuesByOption.set(v.optionId, list);
  }

  const margin = productMargin(Number(price) || 0, cost.trim() === "" ? null : Number(cost));

  return (
    <div className="max-w-[860px] space-y-5">
      {/* Header */}
      <div className="space-y-0.5">
        <button
          type="button"
          onClick={() => router.push("/catalog?segment=products")}
          className="flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.16em] text-text-mute transition-colors hover:text-text-2"
        >
          <ChevronLeft className="h-[12px] w-[12px]" />
          {t("title", "Catalog")}
        </button>
        <h1 className="font-cakemono text-[22px] font-light uppercase tracking-[0.02em] text-text">
          {`// PRODUCT :: ${product.name}`}
        </h1>
      </div>

      {/* Base fields */}
      <section className="glass-surface space-y-3 p-4">
        <div className="space-y-1">
          <label className={labelCls}>{t("add.itemName", "Name")} *</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1">
          <label className={labelCls}>Description</label>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="space-y-1">
            <label className={labelCls}>{t("products.col.price", "Price")} *</label>
            <Input type="number" min={0} step={0.01} value={price} onChange={(e) => setPrice(e.target.value)} className="font-mono" />
          </div>
          <div className="space-y-1">
            <label className={labelCls}>{t("products.col.cost", "Cost")}</label>
            <Input type="number" min={0} step={0.01} value={cost} onChange={(e) => setCost(e.target.value)} className="font-mono" placeholder="—" />
          </div>
          <div className="space-y-1">
            <label className={labelCls}>{t("add.unit", "Unit")}</label>
            <Input value={unit} onChange={(e) => setUnit(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className={labelCls}>{t("products.col.margin", "Margin")}</label>
            <div className="flex h-9 items-center font-mono text-[14px] tabular-nums">
              <span className={margin != null ? "text-olive" : "text-text-mute"}>{fmtMargin(margin)}</span>
            </div>
          </div>
        </div>
        <div className="space-y-1">
          <label className={labelCls}>{t("products.col.task", "Task type")}</label>
          <Select
            value={taskTypeId || NONE}
            onValueChange={(v) => setTaskTypeId(v === NONE ? "" : v)}
          >
            <SelectTrigger className="h-9">
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>—</SelectItem>
              {taskTypes.map((tt) => (
                <SelectItem key={tt.id} value={tt.id}>
                  {tt.display}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {[
            { v: isTaxable, set: setIsTaxable, label: "Taxable" },
            { v: isActive, set: setIsActive, label: "Active" },
            { v: isFavorite, set: setIsFavorite, label: "Favorite" },
          ].map((tg) => (
            <label key={tg.label} className="flex cursor-pointer items-center gap-1.5">
              <input type="checkbox" checked={tg.v} onChange={(e) => tg.set(e.target.checked)} className="rounded border-border" />
              <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-text-2">{tg.label}</span>
            </label>
          ))}
        </div>
        <div className="flex justify-end">
          <Button variant="secondary" size="sm" loading={updateProduct.isPending} disabled={!name.trim()} onClick={saveBase}>
            {t("drawer.save", "SAVE")}
          </Button>
        </div>
      </section>

      {/* Options */}
      <section className="space-y-2">
        <div className="flex items-center justify-between border-b border-border pb-1">
          <h2 className="font-cakemono text-[15px] font-light uppercase tracking-[0.02em] text-text-2">
            {t("products.options", "// OPTIONS")}
          </h2>
          <Button variant="default" size="sm" className="gap-1" onClick={() => setOptionDialog({ mode: "create" })}>
            <Plus className="h-[14px] w-[14px]" />
            {t("editor.addOption", "Add Option")}
          </Button>
        </div>
        {optionsLoading ? (
          <span className="block px-3 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-text-mute">{"// LOADING…"}</span>
        ) : orderedOptions.length === 0 ? (
          <span className="block border-l-2 border-l-border px-3 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-text-mute">
            {"// NO OPTIONS YET — TAP + ADD OPTION"}
          </span>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={orderedOptions.map((o) => o.id)} strategy={verticalListSortingStrategy}>
              <ul className="space-y-1.5">
                {orderedOptions.map((option) => (
                  <SortableOptionRow
                    key={option.id}
                    option={option}
                    valueCount={(valuesByOption.get(option.id) ?? []).length}
                    onEdit={() => setOptionDialog({ mode: "edit", option })}
                    onDelete={() => setOptionToDelete(option)}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </section>

      {/* Pricing modifiers */}
      <section className="space-y-2">
        <div className="flex items-center justify-between border-b border-border pb-1">
          <h2 className="font-cakemono text-[15px] font-light uppercase tracking-[0.02em] text-text-2">
            {"// PRICING MODIFIERS"}
          </h2>
          <Button
            variant="default"
            size="sm"
            className="gap-1"
            disabled={options.length === 0}
            onClick={() => setModifierDialog({ mode: "create" })}
          >
            <Plus className="h-[14px] w-[14px]" />
            {t("editor.addModifier", "Add Modifier")}
          </Button>
        </div>
        {options.length === 0 ? (
          <span className="block border-l-2 border-l-border px-3 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-text-mute">
            {"// ADD AN OPTION FIRST"}
          </span>
        ) : modifiers.length === 0 ? (
          <span className="block border-l-2 border-l-border px-3 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-text-mute">
            {"// NO MODIFIERS YET"}
          </span>
        ) : (
          <ul className="space-y-1.5">
            {modifiers.map((modifier) => (
              <li
                key={modifier.id}
                className="flex items-center justify-between gap-2 rounded border border-border bg-surface-hover-subtle px-2 py-1.5"
              >
                <span className="truncate font-mohave text-[14px] text-text">
                  {formatModifierRule(modifier, options, values)}
                </span>
                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => setModifierDialog({ mode: "edit", modifier })}
                    className="rounded p-1 text-text-3 transition-colors hover:bg-surface-active hover:text-text"
                  >
                    <Pencil className="h-[14px] w-[14px]" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setModifierToDelete(modifier)}
                    className="rounded p-1 text-text-mute transition-colors hover:bg-rose-soft hover:text-rose"
                  >
                    <Trash2 className="h-[14px] w-[14px]" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Materials (BOM) */}
      <section className="space-y-2">
        <h2 className="border-b border-border pb-1 font-cakemono text-[15px] font-light uppercase tracking-[0.02em] text-text-2">
          {t("products.materials", "// MATERIALS")}
        </h2>
        <ProductBomEditor productId={productId} productUnit={unit} />
      </section>

      {/* Dialogs */}
      {optionDialog && (
        <ProductOptionFormDialog
          open
          mode={optionDialog.mode}
          productId={productId}
          option={optionDialog.mode === "edit" ? optionDialog.option : undefined}
          allOptions={options}
          allValues={values}
          onClose={() => setOptionDialog(null)}
        />
      )}
      {modifierDialog && (
        <ProductPricingModifierFormDialog
          open
          mode={modifierDialog.mode}
          productId={productId}
          modifier={modifierDialog.mode === "edit" ? modifierDialog.modifier : undefined}
          options={options}
          values={values}
          onClose={() => setModifierDialog(null)}
        />
      )}
      <ConfirmDialog
        open={!!optionToDelete}
        onOpenChange={(o) => !o && setOptionToDelete(null)}
        title="Delete option?"
        description={
          optionToDelete
            ? `This will permanently delete "${optionToDelete.name}", any values it owns, and any pricing modifier that references it. This cannot be undone.`
            : ""
        }
        confirmLabel="Delete"
        variant="destructive"
        loading={deleteOption.isPending}
        onConfirm={() => {
          if (!optionToDelete) return;
          deleteOption.mutate(optionToDelete.id, { onSuccess: () => setOptionToDelete(null) });
        }}
      />
      <ConfirmDialog
        open={!!modifierToDelete}
        onOpenChange={(o) => !o && setModifierToDelete(null)}
        title="Delete modifier?"
        description={
          modifierToDelete
            ? `Permanently delete "${formatModifierRule(modifierToDelete, options, values)}"? This cannot be undone.`
            : ""
        }
        confirmLabel="Delete"
        variant="destructive"
        loading={deleteModifier.isPending}
        onConfirm={() => {
          if (!modifierToDelete) return;
          deleteModifier.mutate(modifierToDelete.id, { onSuccess: () => setModifierToDelete(null) });
        }}
      />
    </div>
  );
}

// ─── Sortable option row (ported from the retired options page) ────────────────

function SortableOptionRow({
  option,
  valueCount,
  onEdit,
  onDelete,
}: {
  option: ProductOption;
  valueCount: number;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: option.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 rounded border border-border bg-surface-hover-subtle px-2 py-1.5"
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="cursor-grab p-1 text-text-mute hover:text-text-3 active:cursor-grabbing"
        aria-label="Reorder"
      >
        <GripVertical className="h-[14px] w-[14px]" />
      </button>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-mohave text-[14px] text-text">{option.name}</span>
          <span className="rounded border border-border px-1 py-0.5 font-mono text-[11px] uppercase tracking-[0.1em] text-text-3">
            {OPTION_KIND_LABEL[option.kind]}
          </span>
          {option.required && (
            <span className="rounded border border-tan-line px-1 py-0.5 font-mono text-[11px] uppercase tracking-[0.1em] text-tan">
              REQUIRED
            </span>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          {option.affectsPrice && <FlagChip label="PRICE" />}
          {option.affectsRecipe && <FlagChip label="RECIPE" />}
          {option.kind === "select" && (
            <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-mute">
              [{valueCount} {valueCount === 1 ? "VALUE" : "VALUES"}]
            </span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <button type="button" onClick={onEdit} className="rounded p-1 text-text-3 transition-colors hover:bg-surface-active hover:text-text">
          <Pencil className="h-[14px] w-[14px]" />
        </button>
        <button type="button" onClick={onDelete} className="rounded p-1 text-text-mute transition-colors hover:bg-rose-soft hover:text-rose">
          <Trash2 className="h-[14px] w-[14px]" />
        </button>
      </div>
    </li>
  );
}

function FlagChip({ label }: { label: string }) {
  return (
    <span className={cn("rounded border border-border px-1 py-0.5 font-mono text-[11px] uppercase tracking-[0.16em] text-text-2")}>
      {label}
    </span>
  );
}
