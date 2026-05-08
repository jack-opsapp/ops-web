"use client";

/**
 * Product Option Form Dialog
 *
 * Create or edit a single ProductOption. For SELECT-kind options the dialog
 * also exposes a value sub-list (add / rename / reorder / delete). All
 * sub-list mutations call the service immediately so the page reflects
 * reality even if the user closes the dialog without "saving" the option.
 *
 * Default-value interpretation depends on kind:
 *   - SELECT  → option-value id (pick from existing values)
 *   - INTEGER → numeric string
 *   - BOOLEAN → "true" | "false"
 */

import { useEffect, useMemo, useState } from "react";
import { GripVertical, Plus, Trash2, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ops/confirm-dialog";
import { cn } from "@/lib/utils/cn";
import {
  PRODUCT_OPTION_KINDS,
  OPTION_KIND_LABEL,
  type ProductOption,
  type ProductOptionKind,
  type ProductOptionValue,
} from "@/lib/types/product-options";
import {
  useCreateProductOption,
  useUpdateProductOption,
  useCreateProductOptionValue,
  useUpdateProductOptionValue,
  useDeleteProductOptionValue,
  useReorderProductOptionValues,
} from "@/lib/hooks";
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

interface Props {
  open: boolean;
  mode: "create" | "edit";
  productId: string;
  option?: ProductOption;
  allOptions: ProductOption[];
  allValues: ProductOptionValue[];
  onClose: () => void;
}

export function ProductOptionFormDialog({
  open,
  mode,
  productId,
  option,
  allOptions,
  allValues,
  onClose,
}: Props) {
  const isEdit = mode === "edit" && !!option;

  // Sort order assigned to a new option = max existing + 1.
  const nextSortOrder = useMemo(() => {
    if (allOptions.length === 0) return 0;
    return Math.max(...allOptions.map((o) => o.sortOrder)) + 1;
  }, [allOptions]);

  // Form state
  const [name, setName] = useState(option?.name ?? "");
  const [kind, setKind] = useState<ProductOptionKind>(option?.kind ?? "select");
  const [affectsPrice, setAffectsPrice] = useState(
    option?.affectsPrice ?? false
  );
  const [affectsRecipe, setAffectsRecipe] = useState(
    option?.affectsRecipe ?? false
  );
  const [required, setRequired] = useState(option?.required ?? true);
  const [defaultValue, setDefaultValue] = useState(option?.defaultValue ?? "");
  const [optionDefaultSource, setOptionDefaultSource] = useState(
    option?.optionDefaultSource ?? ""
  );

  // Reset form when prop changes
  useEffect(() => {
    setName(option?.name ?? "");
    setKind(option?.kind ?? "select");
    setAffectsPrice(option?.affectsPrice ?? false);
    setAffectsRecipe(option?.affectsRecipe ?? false);
    setRequired(option?.required ?? true);
    setDefaultValue(option?.defaultValue ?? "");
    setOptionDefaultSource(option?.optionDefaultSource ?? "");
  }, [option]);

  const createOption = useCreateProductOption();
  const updateOption = useUpdateProductOption(productId);

  const trimmedName = name.trim();
  const isSubmittable = trimmedName.length > 0 && !createOption.isPending && !updateOption.isPending;

  function handleSubmit() {
    if (!isSubmittable) return;
    const payload = {
      name: trimmedName,
      kind,
      affectsPrice,
      affectsRecipe,
      required,
      defaultValue: defaultValue.trim() || null,
      optionDefaultSource: optionDefaultSource.trim() || null,
    };

    if (isEdit && option) {
      updateOption.mutate(
        { id: option.id, data: payload },
        { onSuccess: () => onClose() }
      );
    } else {
      createOption.mutate(
        {
          productId,
          ...payload,
          sortOrder: nextSortOrder,
        },
        { onSuccess: () => onClose() }
      );
    }
  }

  // Values for this option (only meaningful for SELECT kind on edit).
  const ownValues = useMemo(() => {
    if (!option) return [];
    return allValues
      .filter((v) => v.optionId === option.id)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.value.localeCompare(b.value));
  }, [option, allValues]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="font-cakemono font-light uppercase tracking-wider">
            {isEdit ? `// EDIT OPTION :: ${option?.name}` : "// NEW OPTION"}
          </DialogTitle>
          <p className="font-mono text-caption-sm uppercase tracking-widest text-text-mute">
            [{isEdit ? "UPDATE" : "CREATE"} A CONFIGURABLE KNOB]
          </p>
        </DialogHeader>

        <div className="space-y-3">
          {/* Name */}
          <FormField label="NAME" required>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Color, Mount Surface, Width (in)"
              autoFocus
            />
          </FormField>

          {/* Kind segmented */}
          <FormField label="KIND" required>
            <div className="flex border border-border rounded overflow-hidden">
              {PRODUCT_OPTION_KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={cn(
                    "flex-1 px-2 py-1.5 font-mono text-caption-sm uppercase tracking-widest transition-colors",
                    "border-r border-border last:border-r-0",
                    kind === k
                      ? "bg-ops-accent text-black"
                      : "text-text-3 hover:text-text hover:bg-[rgba(255,255,255,0.04)]"
                  )}
                >
                  {OPTION_KIND_LABEL[k]}
                </button>
              ))}
            </div>
          </FormField>

          {/* Toggles */}
          <FormField label="BEHAVIOR">
            <div className="flex flex-wrap gap-3">
              <ToggleField
                label="REQUIRED"
                checked={required}
                onChange={setRequired}
              />
              <ToggleField
                label="AFFECTS PRICE"
                checked={affectsPrice}
                onChange={setAffectsPrice}
              />
              <ToggleField
                label="AFFECTS RECIPE"
                checked={affectsRecipe}
                onChange={setAffectsRecipe}
              />
            </div>
          </FormField>

          {/* Default value */}
          <FormField
            label="DEFAULT VALUE"
            hint={defaultHint(kind)}
          >
            {kind === "boolean" ? (
              <select
                value={defaultValue}
                onChange={(e) => setDefaultValue(e.target.value)}
                className="w-full bg-fill-neutral-dim border border-border rounded px-2 py-1.5 font-mohave text-body text-text"
              >
                <option value="">— none —</option>
                <option value="true">TRUE</option>
                <option value="false">FALSE</option>
              </select>
            ) : kind === "select" && isEdit ? (
              <select
                value={defaultValue}
                onChange={(e) => setDefaultValue(e.target.value)}
                className="w-full bg-fill-neutral-dim border border-border rounded px-2 py-1.5 font-mohave text-body text-text"
              >
                <option value="">— none —</option>
                {ownValues.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.value}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                value={defaultValue}
                onChange={(e) => setDefaultValue(e.target.value)}
                placeholder={
                  kind === "integer" ? "e.g. 1" : "e.g. concrete"
                }
                type={kind === "integer" ? "number" : "text"}
              />
            )}
          </FormField>

          {/* Default source (advanced) */}
          <FormField
            label="DEFAULT SOURCE"
            hint="[OPTIONAL DESIGN-VAR REFERENCE — E.G. $design.color]"
          >
            <Input
              value={optionDefaultSource}
              onChange={(e) => setOptionDefaultSource(e.target.value)}
              placeholder="$design.color"
            />
          </FormField>

          {/* Allowed values — only for SELECT kind on existing options */}
          {kind === "select" && isEdit && option && (
            <FormField label="ALLOWED VALUES">
              <OptionValuesEditor
                productId={productId}
                optionId={option.id}
                values={ownValues}
              />
            </FormField>
          )}

          {kind === "select" && !isEdit && (
            <p className="font-mono text-caption-sm uppercase tracking-widest text-text-mute">
              [SAVE FIRST — THEN ADD ALLOWED VALUES BELOW]
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={handleSubmit}
            disabled={!isSubmittable}
          >
            {isEdit ? "Update" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

function FormField({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-0.5">
      <label className="font-mono text-caption-sm text-text-3 uppercase tracking-widest">
        {label}
        {required && <span className="text-ops-accent ml-0.5">*</span>}
      </label>
      {children}
      {hint && (
        <p className="font-mono text-micro text-text-mute uppercase tracking-widest">
          {hint}
        </p>
      )}
    </div>
  );
}

function ToggleField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="rounded border-border"
      />
      <span className="font-mono text-caption-sm text-text-2 uppercase tracking-widest">
        {label}
      </span>
    </label>
  );
}

function defaultHint(kind: ProductOptionKind): string {
  switch (kind) {
    case "select":
      return "[CHOOSE FROM ALLOWED VALUES — ADD VALUES BELOW]";
    case "integer":
      return "[NUMERIC DEFAULT — E.G. 1]";
    case "boolean":
      return "[TRUE OR FALSE]";
  }
}

// ─── Allowed-values editor (drag-reorder + inline rename) ──────────────────

function OptionValuesEditor({
  productId,
  optionId,
  values,
}: {
  productId: string;
  optionId: string;
  values: ProductOptionValue[];
}) {
  const createValue = useCreateProductOptionValue(productId);
  const updateValue = useUpdateProductOptionValue(productId);
  const deleteValue = useDeleteProductOptionValue(productId);
  const reorderValues = useReorderProductOptionValues(productId);

  const [adding, setAdding] = useState(false);
  const [newValue, setNewValue] = useState("");
  const [pendingDelete, setPendingDelete] =
    useState<ProductOptionValue | null>(null);
  const [localOrder, setLocalOrder] = useState<ProductOptionValue[] | null>(
    null
  );
  const ordered = localOrder ?? values;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const nextSortOrder =
    values.length === 0 ? 0 : Math.max(...values.map((v) => v.sortOrder)) + 1;

  function handleAdd() {
    const trimmed = newValue.trim();
    if (!trimmed) return;
    createValue.mutate(
      { optionId, value: trimmed, sortOrder: nextSortOrder },
      {
        onSuccess: () => {
          setNewValue("");
          setAdding(false);
        },
      }
    );
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      setLocalOrder(null);
      return;
    }
    const oldIndex = ordered.findIndex((v) => v.id === active.id);
    const newIndex = ordered.findIndex((v) => v.id === over.id);
    if (oldIndex === -1 || newIndex === -1) {
      setLocalOrder(null);
      return;
    }
    const next = arrayMove(ordered, oldIndex, newIndex);
    setLocalOrder(next);
    reorderValues.mutate(
      { optionId, orderedIds: next.map((v) => v.id) },
      { onSettled: () => setLocalOrder(null) }
    );
  }

  return (
    <div className="space-y-1.5">
      {ordered.length === 0 ? (
        <div className="font-mono text-caption-sm uppercase tracking-widest text-text-mute py-1">
          {"// NO VALUES YET"}
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={ordered.map((v) => v.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="space-y-1">
              {ordered.map((v) => (
                <SortableValueRow
                  key={v.id}
                  value={v}
                  onRename={(next) => {
                    if (!next.trim() || next === v.value) return;
                    updateValue.mutate({ id: v.id, data: { value: next.trim() } });
                  }}
                  onDelete={() => setPendingDelete(v)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      {adding ? (
        <div className="flex items-center gap-1.5">
          <Input
            autoFocus
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAdd();
              if (e.key === "Escape") {
                setNewValue("");
                setAdding(false);
              }
            }}
            placeholder="value"
            className="flex-1"
          />
          <Button
            variant="default"
            size="sm"
            onClick={handleAdd}
            disabled={!newValue.trim() || createValue.isPending}
          >
            Add
          </Button>
          <button
            type="button"
            onClick={() => {
              setNewValue("");
              setAdding(false);
            }}
            className="p-1 text-text-mute hover:text-text-2"
            aria-label="Cancel"
          >
            <X className="w-[14px] h-[14px]" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex items-center gap-1 font-mono text-caption-sm uppercase tracking-widest text-text-3 hover:text-text-2 transition-colors"
        >
          <Plus className="w-[14px] h-[14px]" />
          Add value
        </button>
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(o) => {
          if (!o) setPendingDelete(null);
        }}
        title="Delete value?"
        description={
          pendingDelete
            ? `Delete "${pendingDelete.value}"? Any pricing modifier triggered by this value will also be removed.`
            : ""
        }
        confirmLabel="Delete"
        variant="destructive"
        loading={deleteValue.isPending}
        onConfirm={() => {
          if (!pendingDelete) return;
          deleteValue.mutate(pendingDelete.id, {
            onSuccess: () => setPendingDelete(null),
          });
        }}
      />
    </div>
  );
}

function SortableValueRow({
  value,
  onRename,
  onDelete,
}: {
  value: ProductOptionValue;
  onRename: (next: string) => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: value.id });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value.value);

  useEffect(() => {
    setDraft(value.value);
  }, [value.value]);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 px-1.5 py-1 border border-border rounded bg-[rgba(255,255,255,0.02)]"
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="p-0.5 text-text-mute hover:text-text-3 cursor-grab active:cursor-grabbing"
        aria-label="Reorder"
      >
        <GripVertical className="w-[12px] h-[12px]" />
      </button>

      {editing ? (
        <Input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            setEditing(false);
            onRename(draft);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              setEditing(false);
              onRename(draft);
            }
            if (e.key === "Escape") {
              setDraft(value.value);
              setEditing(false);
            }
          }}
          className="flex-1 h-7"
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="flex-1 text-left font-mohave text-body text-text hover:text-ops-accent transition-colors truncate"
        >
          {value.value}
        </button>
      )}

      <button
        type="button"
        onClick={onDelete}
        className="p-0.5 text-text-mute hover:text-ops-error transition-colors"
        aria-label="Delete"
      >
        <Trash2 className="w-[12px] h-[12px]" />
      </button>
    </li>
  );
}
