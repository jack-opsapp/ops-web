"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { X } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import type { InventoryItem } from "@/lib/types/inventory";
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

// ─── Section Label ──────────────────────────────────────────────────────────────

const SECTION_LABEL =
  "font-kosugi text-caption-sm uppercase tracking-widest text-text-tertiary mb-3";

const FORM_LABEL =
  "font-kosugi text-caption-sm uppercase tracking-widest text-text-tertiary";

// ─── Component ──────────────────────────────────────────────────────────────────

export function ItemFormDialog({
  open,
  onOpenChange,
  editItem,
  editItemTagIds,
}: ItemFormDialogProps) {
  const isEditing = !!editItem;

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
  const [tagSearch, setTagSearch] = useState("");
  const [showTagDropdown, setShowTagDropdown] = useState(false);

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

  const tagInputRef = useRef<HTMLInputElement>(null);

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
    setTagSearch("");
    setShowTagDropdown(false);
  }, [open, editItem, editItemTagIds, tags]);

  // ── Tag filtering ───────────────────────────────────────────────────────────
  const selectedTagIds = useMemo(
    () =>
      new Set(
        selectedTags
          .filter((t): t is TagEntry => t.type === "existing")
          .map((t) => t.id)
      ),
    [selectedTags]
  );

  const selectedNewNames = useMemo(
    () =>
      new Set(
        selectedTags
          .filter((t): t is NewTagEntry => t.type === "new")
          .map((t) => t.name.toLowerCase())
      ),
    [selectedTags]
  );

  const filteredTags = useMemo(() => {
    const search = tagSearch.toLowerCase().trim();
    return tags.filter(
      (t) =>
        !selectedTagIds.has(t.id) &&
        (search === "" || t.name.toLowerCase().includes(search))
    );
  }, [tags, tagSearch, selectedTagIds]);

  const canCreateNewTag = useMemo(() => {
    const search = tagSearch.trim();
    if (search === "") return false;
    // Don't allow if an existing tag matches exactly
    const lowerSearch = search.toLowerCase();
    if (tags.some((t) => t.name.toLowerCase() === lowerSearch)) return false;
    // Don't allow if already selected as new
    if (selectedNewNames.has(lowerSearch)) return false;
    return true;
  }, [tagSearch, tags, selectedNewNames]);

  // ── Tag actions ─────────────────────────────────────────────────────────────
  function addExistingTag(tagId: string) {
    const tag = tags.find((t) => t.id === tagId);
    if (!tag || selectedTagIds.has(tagId)) return;
    setSelectedTags((prev) => [
      ...prev,
      { type: "existing", id: tag.id, name: tag.name },
    ]);
    setTagSearch("");
  }

  function addNewTag(tagName: string) {
    const trimmed = tagName.trim();
    if (!trimmed) return;
    setSelectedTags((prev) => [...prev, { type: "new", name: trimmed }]);
    setTagSearch("");
  }

  function removeTag(index: number) {
    setSelectedTags((prev) => prev.filter((_, i) => i !== index));
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
                    <Select value={unitId} onValueChange={setUnitId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select unit" />
                      </SelectTrigger>
                      <SelectContent>
                        {units.map((unit) => (
                          <SelectItem key={unit.id} value={unit.id}>
                            {unit.display}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
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
                            "bg-[rgba(255,255,255,0.08)] border border-[rgba(255,255,255,0.12)]",
                            "text-caption-sm text-text-secondary font-mohave"
                          )}
                        >
                          {tag.name}
                          {tag.type === "new" && (
                            <span className="text-ops-accent text-[10px] ml-0.5">
                              NEW
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => removeTag(index)}
                            className="text-text-tertiary hover:text-text-primary ml-0.5"
                          >
                            <X className="h-[12px] w-[12px]" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Tag search input */}
                  <div className="relative">
                    <Input
                      ref={tagInputRef}
                      placeholder="Search or create tags..."
                      value={tagSearch}
                      onChange={(e) => {
                        setTagSearch(e.target.value);
                        setShowTagDropdown(true);
                      }}
                      onFocus={() => setShowTagDropdown(true)}
                      onBlur={() => {
                        // Delay to allow click on dropdown
                        setTimeout(() => setShowTagDropdown(false), 200);
                      }}
                    />

                    {showTagDropdown &&
                      (filteredTags.length > 0 || canCreateNewTag) && (
                        <div
                          className={cn(
                            "absolute left-0 right-0 top-full z-50 mt-0.5",
                            "max-h-[200px] overflow-y-auto",
                            "bg-[rgba(13,13,13,0.95)] backdrop-blur-xl",
                            "border border-[rgba(255,255,255,0.12)] rounded-sm",
                            "py-0.5"
                          )}
                        >
                          {filteredTags.map((tag) => (
                            <button
                              key={tag.id}
                              type="button"
                              className={cn(
                                "w-full px-1.5 py-1 text-left",
                                "text-body-sm text-text-primary font-mohave",
                                "hover:bg-[rgba(255,255,255,0.06)]",
                                "transition-colors"
                              )}
                              onMouseDown={(e) => {
                                e.preventDefault();
                                addExistingTag(tag.id);
                              }}
                            >
                              {tag.name}
                            </button>
                          ))}

                          {canCreateNewTag && (
                            <button
                              type="button"
                              className={cn(
                                "w-full px-1.5 py-1 text-left",
                                "text-body-sm text-ops-accent font-mohave",
                                "hover:bg-[rgba(255,255,255,0.06)]",
                                "transition-colors",
                                "border-t border-[rgba(255,255,255,0.06)]"
                              )}
                              onMouseDown={(e) => {
                                e.preventDefault();
                                addNewTag(tagSearch);
                              }}
                            >
                              + Create &ldquo;{tagSearch.trim()}&rdquo;
                            </button>
                          )}
                        </div>
                      )}
                  </div>
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
                <p className="text-text-disabled text-caption-sm font-mohave">
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
