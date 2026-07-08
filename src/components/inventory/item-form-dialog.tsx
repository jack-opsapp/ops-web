"use client";

import { useState, useEffect, useMemo } from "react";
import { X, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { EntityPicker } from "@/components/ui/entity-picker";
import { ConfirmDialog } from "@/components/ops/confirm-dialog";
import {
  useInventoryUnits,
  useInventoryTags,
  useCreateInventoryItem,
  useUpdateInventoryItem,
  useDeleteInventoryItem,
  useCreateInventoryTag,
  useSetItemTags,
} from "@/lib/hooks/use-inventory";
import { useAuthStore } from "@/lib/store/auth-store";
import { useDictionary } from "@/i18n/client";
import type { InventoryItem, InventoryUnit } from "@/lib/types/inventory";
import { toast } from "sonner";

// ─── Props ──────────────────────────────────────────────────────────────────────

interface ItemFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editItem?: InventoryItem | null;
  editItemTagIds?: string[];
}

// ─── Tag Entry (existing ID or new name to create) ──────────────────────────────

interface TagEntry {
  type: "existing";
  id: string;
  name: string;
}

interface NewTagEntry {
  type: "new";
  name: string;
}

type TagSelection = TagEntry | NewTagEntry;

/** A row offered by the tag picker — an existing tag or a staged new one. */
interface TagOption {
  id: string;
  name: string;
  isNew: boolean;
}

// ─── Section Label ──────────────────────────────────────────────────────────────

const SECTION_LABEL =
  "font-mono text-caption-sm uppercase tracking-widest text-text-3 mb-3";

const FORM_LABEL =
  "font-mono text-caption-sm uppercase tracking-widest text-text-3";

// ─── Component ──────────────────────────────────────────────────────────────────

export function ItemFormDialog({
  open,
  onOpenChange,
  editItem,
  editItemTagIds,
}: ItemFormDialogProps) {
  const isEditing = !!editItem;
  const { t: tp } = useDictionary("picker");

  // ── Auth ────────────────────────────────────────────────────────────────────
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  // ── Data hooks ──────────────────────────────────────────────────────────────
  const { data: units = [] } = useInventoryUnits();
  const { data: tags = [] } = useInventoryTags();

  // ── Mutations ───────────────────────────────────────────────────────────────
  const createItem = useCreateInventoryItem();
  const updateItem = useUpdateInventoryItem();
  const deleteItem = useDeleteInventoryItem();
  const createTag = useCreateInventoryTag();
  const setItemTags = useSetItemTags();

  // ── Form state ──────────────────────────────────────────────────────────────
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState<number>(0);
  const [unitId, setUnitId] = useState<string>("");
  const [selectedTags, setSelectedTags] = useState<TagSelection[]>([]);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [unitPickerOpen, setUnitPickerOpen] = useState(false);

  const [description, setDescription] = useState("");
  const [sku, setSku] = useState("");
  const [notes, setNotes] = useState("");
  const [imageUrl, setImageUrl] = useState("");

  const [warningThreshold, setWarningThreshold] = useState("");
  const [criticalThreshold, setCriticalThreshold] = useState("");

  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // ── Section collapse state ──────────────────────────────────────────────────
  const [expandedSections, setExpandedSections] = useState({
    details: true,
    additional: false,
    thresholds: false,
  });

  // ── Populate form on open / edit ────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;

    if (editItem) {
      setName(editItem.name);
      setQuantity(editItem.quantity);
      setUnitId(editItem.unitId ?? "");
      setDescription(editItem.description ?? "");
      setSku(editItem.sku ?? "");
      setNotes(editItem.notes ?? "");
      setImageUrl(editItem.imageUrl ?? "");
      setWarningThreshold(
        editItem.warningThreshold !== null
          ? String(editItem.warningThreshold)
          : ""
      );
      setCriticalThreshold(
        editItem.criticalThreshold !== null
          ? String(editItem.criticalThreshold)
          : ""
      );

      // Build tag selections from editItemTagIds
      const tagEntries: TagSelection[] = (editItemTagIds ?? [])
        .map((tagId) => {
          const tag = tags.find((t) => t.id === tagId);
          if (!tag) return null;
          return { type: "existing" as const, id: tag.id, name: tag.name };
        })
        .filter((t): t is TagEntry => t !== null);
      setSelectedTags(tagEntries);

      setExpandedSections({ details: true, additional: true, thresholds: true });
    } else {
      // Reset for create
      setName("");
      setQuantity(0);
      setUnitId("");
      setSelectedTags([]);
      setDescription("");
      setSku("");
      setNotes("");
      setImageUrl("");
      setWarningThreshold("");
      setCriticalThreshold("");
      setExpandedSections({ details: true, additional: false, thresholds: false });
    }
    setTagPickerOpen(false);
    setUnitPickerOpen(false);
  }, [open, editItem, editItemTagIds, tags]);

  // ── Tag picker plumbing ───────────────────────────────────────────────────
  // The picker is a multi-select over string IDs, but a pending (not-yet-saved)
  // tag has no real ID — it's created on save. We bridge by giving each pending
  // tag a synthetic, name-stable id (`new:<lowercased name>`), so it can render
  // as a checked row and toggle off like any existing tag. `selectedTags` (the
  // TagSelection[] the save path reads) stays the single source of truth.
  const NEW_TAG_PREFIX = "new:";

  const newTagId = (name: string) => `${NEW_TAG_PREFIX}${name.toLowerCase()}`;

  const selectedNewNames = useMemo(
    () =>
      new Set(
        selectedTags
          .filter((t): t is NewTagEntry => t.type === "new")
          .map((t) => t.name.toLowerCase())
      ),
    [selectedTags]
  );

  // Options offered to the picker: every existing tag, plus any pending new
  // tags (so they show as checked rows and can be un-checked).
  const tagPickerItems = useMemo<TagOption[]>(() => {
    const existing: TagOption[] = tags.map((t) => ({
      id: t.id,
      name: t.name,
      isNew: false,
    }));
    const pending: TagOption[] = selectedTags
      .filter((t): t is NewTagEntry => t.type === "new")
      .map((t) => ({ id: newTagId(t.name), name: t.name, isNew: true }));
    return [...existing, ...pending];
  }, [tags, selectedTags]);

  // IDs currently selected, in the picker's id-space (real ids + synthetic
  // `new:` ids), preserving the order the user added them in.
  const selectedTagValues = useMemo(
    () =>
      selectedTags.map((t) =>
        t.type === "existing" ? t.id : newTagId(t.name)
      ),
    [selectedTags]
  );

  // Currently-chosen unit (drives the picker trigger label).
  const selectedUnit = useMemo(
    () => units.find((u) => u.id === unitId) ?? null,
    [units, unitId]
  );

  // ── Tag actions ─────────────────────────────────────────────────────────────
  // Toggle-reconcile from the picker: rebuild selectedTags from the next id set,
  // mapping each id back to an existing tag or a pending new entry (preserving
  // the pending entry's original-cased name).
  function handleTagsChange(nextIds: string[]) {
    setSelectedTags((prev) => {
      const prevNewByName = new Map(
        prev
          .filter((t): t is NewTagEntry => t.type === "new")
          .map((t) => [t.name.toLowerCase(), t])
      );
      const next: TagSelection[] = [];
      for (const id of nextIds) {
        if (id.startsWith(NEW_TAG_PREFIX)) {
          const key = id.slice(NEW_TAG_PREFIX.length);
          const existingNew = prevNewByName.get(key);
          if (existingNew) next.push(existingNew);
          continue;
        }
        const tag = tags.find((t) => t.id === id);
        if (tag) next.push({ type: "existing", id: tag.id, name: tag.name });
      }
      return next;
    });
  }

  // Create-new-tag from the picker footer (query-seeded). Mirrors the former
  // "+ Create" affordance: stage a pending new tag from the live search text.
  function addNewTag(tagName: string) {
    const trimmed = tagName.trim();
    if (!trimmed) return;
    const lower = trimmed.toLowerCase();
    // Don't stage a duplicate of an existing tag or an already-pending new tag.
    if (tags.some((t) => t.name.toLowerCase() === lower)) return;
    if (selectedNewNames.has(lower)) return;
    setSelectedTags((prev) => [...prev, { type: "new", name: trimmed }]);
    setTagPickerOpen(false);
  }

  function removeTag(index: number) {
    setSelectedTags((prev) => prev.filter((_, i) => i !== index));
  }

  // Whether the live query is stageable as a new tag (drives the footer action).
  function canStageNewTag(query: string) {
    const trimmed = query.trim();
    if (!trimmed) return false;
    const lower = trimmed.toLowerCase();
    if (tags.some((t) => t.name.toLowerCase() === lower)) return false;
    if (selectedNewNames.has(lower)) return false;
    return true;
  }

  // ── Section toggle ──────────────────────────────────────────────────────────
  function toggleSection(section: keyof typeof expandedSections) {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  }

  // ── Save handler ────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!name.trim()) {
      toast.error("Item name is required");
      return;
    }
    if (!companyId) {
      toast.error("No company selected");
      return;
    }

    setSaving(true);

    try {
      // 1. Create any new tags first
      const resolvedTagIds: string[] = [];

      for (const tagSel of selectedTags) {
        if (tagSel.type === "existing") {
          resolvedTagIds.push(tagSel.id);
        } else {
          const newTag = await createTag.mutateAsync({
            companyId,
            name: tagSel.name,
          });
          resolvedTagIds.push(newTag.id);
        }
      }

      // 2. Create or update the item
      let itemId: string;

      if (isEditing && editItem) {
        await updateItem.mutateAsync({
          id: editItem.id,
          data: {
            name: name.trim(),
            quantity,
            unitId: unitId || null,
            description: description.trim() || null,
            sku: sku.trim() || null,
            notes: notes.trim() || null,
            imageUrl: imageUrl.trim() || null,
            warningThreshold:
              warningThreshold !== "" ? Number(warningThreshold) : null,
            criticalThreshold:
              criticalThreshold !== "" ? Number(criticalThreshold) : null,
          },
        });
        itemId = editItem.id;
      } else {
        const created = await createItem.mutateAsync({
          companyId,
          name: name.trim(),
          quantity,
          unitId: unitId || null,
          description: description.trim() || null,
          sku: sku.trim() || null,
          notes: notes.trim() || null,
          imageUrl: imageUrl.trim() || null,
          warningThreshold:
            warningThreshold !== "" ? Number(warningThreshold) : null,
          criticalThreshold:
            criticalThreshold !== "" ? Number(criticalThreshold) : null,
        });
        itemId = created.id;
      }

      // 3. Set item tags
      await setItemTags.mutateAsync({ itemId, tagIds: resolvedTagIds });

      toast.success(isEditing ? "Item updated" : "Item created");
      onOpenChange(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to save item"
      );
    } finally {
      setSaving(false);
    }
  }

  // ── Delete handler ──────────────────────────────────────────────────────────
  async function handleDelete() {
    if (!editItem) return;

    try {
      await deleteItem.mutateAsync(editItem.id);
      toast.success("Item deleted");
      setShowDeleteConfirm(false);
      onOpenChange(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to delete item"
      );
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[540px]">
          <DialogHeader>
            <DialogTitle>
              {isEditing ? "Edit Item" : "New Item"}
            </DialogTitle>
            <DialogDescription>
              {isEditing
                ? "Update the details for this inventory item."
                : "Add a new item to your inventory."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-2">
            {/* ── Section 1: Item Details ────────────────────────────────── */}
            <button
              type="button"
              className={cn(SECTION_LABEL, "text-left cursor-pointer mb-0")}
              onClick={() => toggleSection("details")}
            >
              [ {expandedSections.details ? "-" : "+"} ITEM DETAILS ]
            </button>

            {expandedSections.details && (
              <div className="flex flex-col gap-3">
                <Input
                  label="Name"
                  placeholder="Item name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />

                <div className="grid grid-cols-2 gap-4">
                  <Input
                    label="Quantity"
                    type="number"
                    min={0}
                    placeholder="0"
                    value={quantity}
                    onChange={(e) =>
                      setQuantity(Math.max(0, Number(e.target.value) || 0))
                    }
                  />

                  <div className="flex flex-col gap-0.5">
                    <label className={FORM_LABEL}>Unit</label>
                    <EntityPicker<InventoryUnit>
                      trigger={
                        <button
                          type="button"
                          className={cn(
                            "flex items-center justify-between w-full",
                            "bg-surface-input border rounded-sm",
                            "px-1.5 py-1.5",
                            "font-mohave text-body transition-all duration-150",
                            unitPickerOpen ? "border-line-hi" : "border-border",
                            "focus:border-line-hi focus:outline-none"
                          )}
                        >
                          {selectedUnit ? (
                            <span className="text-text">
                              {selectedUnit.display}
                            </span>
                          ) : (
                            <span className="text-text-3">{tp("unit.placeholder")}</span>
                          )}
                          <ChevronDown
                            className={cn(
                              "w-[16px] h-[16px] text-text-3 transition-transform duration-150",
                              unitPickerOpen && "rotate-180"
                            )}
                          />
                        </button>
                      }
                      open={unitPickerOpen}
                      onOpenChange={setUnitPickerOpen}
                      label={tp("unit.label")}
                      items={units}
                      value={unitId || null}
                      onChange={(id) => setUnitId(id ?? "")}
                      getId={(u) => u.id}
                      getLabel={(u) => u.display}
                      noneOption
                      noneLabel={tp("unit.none")}
                      searchPlaceholder={tp("unit.search")}
                      emptyLabel={tp("unit.empty")}
                      clearLabel={tp("clear")}
                      contentClassName="z-modal"
                    />
                  </div>
                </div>

                {/* Tags multi-select */}
                <div className="flex flex-col gap-0.5">
                  <label className={FORM_LABEL}>Tags</label>

                  {/* Selected tag chips */}
                  {selectedTags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-1">
                      {selectedTags.map((tag, index) => (
                        <span
                          key={
                            tag.type === "existing"
                              ? tag.id
                              : `new-${tag.name}`
                          }
                          className={cn(
                            "inline-flex items-center gap-0.5",
                            "px-1.5 py-0.5 rounded-sm",
                            "bg-surface-active border border-border",
                            "text-caption-sm text-text-2 font-mohave"
                          )}
                        >
                          {tag.name}
                          {tag.type === "new" && (
                            <span className="text-text text-micro ml-0.5">
                              NEW
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => removeTag(index)}
                            className="text-text-3 hover:text-text ml-0.5"
                          >
                            <X className="h-[12px] w-[12px]" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Tag picker — search existing or create new */}
                  <EntityPicker<TagOption>
                    multiple
                    trigger={
                      <button
                        type="button"
                        className={cn(
                          "flex items-center justify-between w-full",
                          "bg-surface-input border rounded-sm",
                          "px-1.5 py-1.5",
                          "font-mohave text-body transition-all duration-150",
                          tagPickerOpen ? "border-line-hi" : "border-border",
                          "focus:border-line-hi focus:outline-none"
                        )}
                      >
                        {selectedTags.length > 0 ? (
                          <span className="text-text-2">
                            {tp("tag.count", { count: selectedTags.length })}
                          </span>
                        ) : (
                          <span className="text-text-3">
                            {tp("tag.search")}
                          </span>
                        )}
                        <ChevronDown
                          className={cn(
                            "w-[16px] h-[16px] text-text-3 transition-transform duration-150",
                            tagPickerOpen && "rotate-180"
                          )}
                        />
                      </button>
                    }
                    open={tagPickerOpen}
                    onOpenChange={setTagPickerOpen}
                    label={tp("tag.label")}
                    items={tagPickerItems}
                    value={selectedTagValues}
                    onChange={handleTagsChange}
                    getId={(o) => o.id}
                    getLabel={(o) => o.name}
                    getSubLabel={(o) =>
                      o.isNew ? (
                        <span className="font-mono text-micro uppercase tracking-wider text-text-3">
                          {tp("tag.new")}
                        </span>
                      ) : undefined
                    }
                    searchPlaceholder={tp("tag.search")}
                    emptyLabel={tp("tag.empty")}
                    clearLabel={tp("clear")}
                    createAction={{
                      label: (query) =>
                        canStageNewTag(query)
                          ? tp("tag.createNamed", { name: query.trim() })
                          : tp("tag.create"),
                      onCreate: (query) => addNewTag(query),
                    }}
                    contentClassName="z-modal"
                  />
                </div>
              </div>
            )}

            {/* ── Section 2: Additional Details ─────────────────────────── */}
            <button
              type="button"
              className={cn(SECTION_LABEL, "text-left cursor-pointer mb-0")}
              onClick={() => toggleSection("additional")}
            >
              [ {expandedSections.additional ? "-" : "+"} ADDITIONAL DETAILS ]
            </button>

            {expandedSections.additional && (
              <div className="flex flex-col gap-3">
                <Textarea
                  label="Description"
                  placeholder="Item description"
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />

                <Input
                  label="SKU"
                  placeholder="SKU or part number"
                  value={sku}
                  onChange={(e) => setSku(e.target.value)}
                />

                <Textarea
                  label="Notes"
                  placeholder="Additional notes"
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />

                <Input
                  label="Image URL"
                  placeholder="https://..."
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                />
              </div>
            )}

            {/* ── Section 3: Thresholds ─────────────────────────────────── */}
            <button
              type="button"
              className={cn(SECTION_LABEL, "text-left cursor-pointer mb-0")}
              onClick={() => toggleSection("thresholds")}
            >
              [ {expandedSections.thresholds ? "-" : "+"} THRESHOLDS ]
            </button>

            {expandedSections.thresholds && (
              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-4">
                  <Input
                    label="Warning Level"
                    type="number"
                    min={0}
                    placeholder="e.g. 20"
                    value={warningThreshold}
                    onChange={(e) => setWarningThreshold(e.target.value)}
                  />
                  <Input
                    label="Critical Level"
                    type="number"
                    min={0}
                    placeholder="e.g. 5"
                    value={criticalThreshold}
                    onChange={(e) => setCriticalThreshold(e.target.value)}
                  />
                </div>
                <p className="text-text-mute text-caption-sm font-mohave">
                  Leave empty to use tag defaults
                </p>
              </div>
            )}
          </div>

          {/* ── Footer ──────────────────────────────────────────────────── */}
          <DialogFooter
            className={cn(
              isEditing ? "justify-between" : "justify-end"
            )}
          >
            {isEditing && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setShowDeleteConfirm(true)}
                disabled={saving}
              >
                Delete
              </Button>
            )}
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onOpenChange(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleSave}
                loading={saving}
              >
                {isEditing ? "Save" : "Create"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title="Delete Item"
        description={`Are you sure you want to delete "${editItem?.name ?? "this item"}"? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDelete}
        loading={deleteItem.isPending}
      />
    </>
  );
}
