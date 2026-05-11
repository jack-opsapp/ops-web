"use client";

/**
 * Product Options + Pricing Modifiers — authoring surface.
 *
 * Closes the loop on the iOS QuickAddProductSheet footer:
 * "Need product options or pricing modifiers? Edit on web after saving."
 *
 * Permission: products.manage
 */

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ChevronLeft,
  GripVertical,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { usePageTitle } from "@/lib/hooks/use-page-title";
import {
  useProduct,
  useProductOptions,
  useProductOptionValues,
  useProductPricingModifiers,
  useReorderProductOptions,
  useDeleteProductOption,
  useDeleteProductPricingModifier,
} from "@/lib/hooks";
import { useBreadcrumbStore } from "@/stores/breadcrumb-store";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ops/confirm-dialog";
import { cn } from "@/lib/utils/cn";
import {
  formatModifierRule,
  OPTION_KIND_LABEL,
  type ProductOption,
  type ProductPricingModifier,
} from "@/lib/types/product-options";
import { ProductOptionFormDialog } from "@/components/ops/product-option-form-dialog";
import { ProductPricingModifierFormDialog } from "@/components/ops/product-pricing-modifier-form-dialog";
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

// ─── Page ──────────────────────────────────────────────────────────────────

export default function ProductOptionsPage() {
  const params = useParams<{ id: string }>();
  const productId = params?.id ?? "";
  const router = useRouter();
  const can = usePermissionStore((s) => s.can);

  const { data: product, isLoading: productLoading } = useProduct(productId);
  const { data: options = [], isLoading: optionsLoading } =
    useProductOptions(productId);
  const optionIds = useMemo(() => options.map((o) => o.id), [options]);
  const { data: values = [] } = useProductOptionValues(productId, optionIds);
  const { data: modifiers = [] } = useProductPricingModifiers(productId);

  const reorderOptions = useReorderProductOptions(productId);
  const deleteOption = useDeleteProductOption(productId);
  const deleteModifier = useDeleteProductPricingModifier(productId);

  const setEntityName = useBreadcrumbStore((s) => s.setEntityName);
  const clearEntityName = useBreadcrumbStore((s) => s.clearEntityName);
  const setParentCrumbs = useBreadcrumbStore((s) => s.setParentCrumbs);
  const clearParentCrumbs = useBreadcrumbStore((s) => s.clearParentCrumbs);

  usePageTitle(product ? `${product.name} · Options` : "Options");

  useEffect(() => {
    if (product) {
      setEntityName(`${product.name} · Options`);
      setParentCrumbs([
        { label: "Products", href: "/products" },
      ]);
    }
    return () => {
      clearEntityName();
      clearParentCrumbs();
    };
  }, [product, setEntityName, clearEntityName, setParentCrumbs, clearParentCrumbs]);

  // ─── Local UI state ────────────────────────────────────────────────────

  const [optionDialog, setOptionDialog] = useState<
    | { mode: "create" }
    | { mode: "edit"; option: ProductOption }
    | null
  >(null);

  const [modifierDialog, setModifierDialog] = useState<
    | { mode: "create" }
    | { mode: "edit"; modifier: ProductPricingModifier }
    | null
  >(null);

  const [optionToDelete, setOptionToDelete] = useState<ProductOption | null>(
    null
  );
  const [modifierToDelete, setModifierToDelete] =
    useState<ProductPricingModifier | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  // Local order while dragging — committed via reorder mutation onDragEnd.
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
      {
        onSettled: () => setLocalOrder(null),
      }
    );
  }

  // ─── Permission gate ────────────────────────────────────────────────────

  if (!can("products.manage")) {
    return (
      <div className="flex flex-col items-start gap-2 py-6 px-3 max-w-[600px]">
        <span className="font-mono text-caption-sm uppercase tracking-widest text-text-mute">
          {"// ACCESS DENIED"}
        </span>
        <p className="font-mohave text-body text-text-2">
          You do not have permission to manage product options or pricing modifiers.
        </p>
        <Button variant="ghost" size="sm" onClick={() => router.push("/products")}>
          Back to products
        </Button>
      </div>
    );
  }

  if (productLoading || !product) {
    return (
      <div className="py-8 px-3">
        <span className="font-mono text-caption-sm uppercase tracking-widest text-text-mute">
          {productLoading ? "// LOADING…" : "// PRODUCT NOT FOUND"}
        </span>
      </div>
    );
  }

  // ─── Render ────────────────────────────────────────────────────────────

  const valuesByOption = new Map<string, typeof values>();
  for (const v of values) {
    const list = valuesByOption.get(v.optionId) ?? [];
    list.push(v);
    valuesByOption.set(v.optionId, list);
  }

  return (
    <div className="space-y-4 max-w-[820px]">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-0.5">
          <button
            type="button"
            onClick={() => router.push("/products")}
            className="flex items-center gap-1 font-mono text-caption-sm uppercase tracking-widest text-text-mute hover:text-text-2 transition-colors"
          >
            <ChevronLeft className="w-[12px] h-[12px]" />
            Products
          </button>
          <h1 className="font-cakemono font-light text-heading uppercase tracking-wider text-text">
            {`// PRODUCT :: ${product.name}`}
          </h1>
          <p className="font-mono text-caption-sm uppercase tracking-widest text-text-3">
            [OPTIONS &amp; MODIFIERS]
          </p>
        </div>
      </div>

      {/* OPTIONS */}
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2 border-b border-border pb-1">
          <h2 className="font-cakemono font-light text-body-lg uppercase tracking-wider text-text-2">
            {"// OPTIONS"}
          </h2>
          <Button
            variant="default"
            size="sm"
            className="gap-1"
            onClick={() => setOptionDialog({ mode: "create" })}
          >
            <Plus className="w-[14px] h-[14px]" />
            Add Option
          </Button>
        </div>

        {optionsLoading ? (
          <div className="py-3 px-3">
            <span className="font-mono text-caption-sm uppercase tracking-widest text-text-mute">
              {"// LOADING…"}
            </span>
          </div>
        ) : orderedOptions.length === 0 ? (
          <div className="py-3 px-3 border-l-2 border-l-[rgba(255,255,255,0.08)]">
            <span className="font-mono text-caption-sm uppercase tracking-widest text-text-mute">
              {"// NO OPTIONS YET — TAP + ADD OPTION"}
            </span>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={orderedOptions.map((o) => o.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="space-y-1.5">
                {orderedOptions.map((option) => (
                  <SortableOptionRow
                    key={option.id}
                    option={option}
                    valueCount={(valuesByOption.get(option.id) ?? []).length}
                    onEdit={() =>
                      setOptionDialog({ mode: "edit", option })
                    }
                    onDelete={() => setOptionToDelete(option)}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </section>

      {/* PRICING MODIFIERS */}
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2 border-b border-border pb-1">
          <h2 className="font-cakemono font-light text-body-lg uppercase tracking-wider text-text-2">
            {"// PRICING MODIFIERS"}
          </h2>
          <Button
            variant="default"
            size="sm"
            className="gap-1"
            disabled={options.length === 0}
            onClick={() => setModifierDialog({ mode: "create" })}
          >
            <Plus className="w-[14px] h-[14px]" />
            Add Modifier
          </Button>
        </div>

        {options.length === 0 ? (
          <div className="py-3 px-3 border-l-2 border-l-[rgba(255,255,255,0.08)]">
            <span className="font-mono text-caption-sm uppercase tracking-widest text-text-mute">
              {"// ADD AN OPTION FIRST — MODIFIERS REFERENCE OPTIONS"}
            </span>
          </div>
        ) : modifiers.length === 0 ? (
          <div className="py-3 px-3 border-l-2 border-l-[rgba(255,255,255,0.08)]">
            <span className="font-mono text-caption-sm uppercase tracking-widest text-text-mute">
              {"// NO MODIFIERS YET — TAP + ADD MODIFIER"}
            </span>
          </div>
        ) : (
          <ul className="space-y-1.5">
            {modifiers.map((modifier) => (
              <li
                key={modifier.id}
                className="flex items-center justify-between gap-2 px-2 py-1.5 border border-border rounded bg-[rgba(255,255,255,0.02)]"
              >
                <div className="flex flex-col min-w-0">
                  <span className="font-mohave text-body text-text truncate">
                    {formatModifierRule(modifier, options, values)}
                  </span>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    type="button"
                    onClick={() =>
                      setModifierDialog({ mode: "edit", modifier })
                    }
                    className="p-1 rounded text-text-3 hover:text-text hover:bg-[rgba(255,255,255,0.05)] transition-colors"
                    title="Edit"
                  >
                    <Pencil className="w-[14px] h-[14px]" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setModifierToDelete(modifier)}
                    className="p-1 rounded text-text-mute hover:text-ops-error hover:bg-ops-error-muted transition-colors"
                    title="Delete"
                  >
                    <Trash2 className="w-[14px] h-[14px]" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Option create/edit dialog */}
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

      {/* Modifier create/edit dialog */}
      {modifierDialog && (
        <ProductPricingModifierFormDialog
          open
          mode={modifierDialog.mode}
          productId={productId}
          modifier={
            modifierDialog.mode === "edit" ? modifierDialog.modifier : undefined
          }
          options={options}
          values={values}
          onClose={() => setModifierDialog(null)}
        />
      )}

      {/* Delete-option confirm */}
      <ConfirmDialog
        open={!!optionToDelete}
        onOpenChange={(open) => {
          if (!open) setOptionToDelete(null);
        }}
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
          deleteOption.mutate(optionToDelete.id, {
            onSuccess: () => setOptionToDelete(null),
          });
        }}
      />

      {/* Delete-modifier confirm */}
      <ConfirmDialog
        open={!!modifierToDelete}
        onOpenChange={(open) => {
          if (!open) setModifierToDelete(null);
        }}
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
          deleteModifier.mutate(modifierToDelete.id, {
            onSuccess: () => setModifierToDelete(null),
          });
        }}
      />
    </div>
  );
}

// ─── Sortable option row ───────────────────────────────────────────────────

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
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: option.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 px-2 py-1.5 border border-border rounded bg-[rgba(255,255,255,0.02)]"
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="p-1 text-text-mute hover:text-text-3 cursor-grab active:cursor-grabbing"
        aria-label="Reorder"
      >
        <GripVertical className="w-[14px] h-[14px]" />
      </button>

      <div className="flex flex-col min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="font-mohave text-body text-text truncate">
            {option.name}
          </span>
          <KindChip kind={option.kind} />
          {option.required && <RequiredChip />}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          {option.affectsPrice && <FlagChip label="PRICE" />}
          {option.affectsRecipe && <FlagChip label="RECIPE" />}
          {option.kind === "select" && (
            <span className="font-mono text-micro uppercase tracking-widest text-text-mute">
              [{valueCount} {valueCount === 1 ? "VALUE" : "VALUES"}]
            </span>
          )}
          {option.defaultValue && (
            <span className="font-mono text-micro uppercase tracking-widest text-text-mute truncate">
              [DEFAULT :: {option.defaultValue}]
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-0.5 shrink-0">
        <button
          type="button"
          onClick={onEdit}
          className="p-1 rounded text-text-3 hover:text-text hover:bg-[rgba(255,255,255,0.05)] transition-colors"
          title="Edit"
        >
          <Pencil className="w-[14px] h-[14px]" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="p-1 rounded text-text-mute hover:text-ops-error hover:bg-ops-error-muted transition-colors"
          title="Delete"
        >
          <Trash2 className="w-[14px] h-[14px]" />
        </button>
      </div>
    </li>
  );
}

// ─── Tiny presentational chips ─────────────────────────────────────────────

function KindChip({ kind }: { kind: ProductOption["kind"] }) {
  return (
    <span
      className={cn(
        "font-mono text-micro uppercase tracking-widest",
        "px-1 py-0.5 rounded border border-border text-text-3"
      )}
    >
      {OPTION_KIND_LABEL[kind]}
    </span>
  );
}

function RequiredChip() {
  return (
    <span
      className={cn(
        "font-mono text-micro uppercase tracking-widest",
        "px-1 py-0.5 rounded border border-[rgba(196,168,104,0.5)] text-status-warning"
      )}
    >
      REQUIRED
    </span>
  );
}

function FlagChip({ label }: { label: string }) {
  return (
    <span className="font-mono text-micro uppercase tracking-widest px-1 py-0.5 rounded border border-border text-text-2">
      {label}
    </span>
  );
}
