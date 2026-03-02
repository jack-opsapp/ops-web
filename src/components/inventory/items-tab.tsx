"use client";

import { useState, useMemo, useCallback } from "react";
import {
  Plus,
  Search,
  Package,
  Pencil,
  Trash2,
  SlidersHorizontal,
  Tag,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/ops/empty-state";
import { ConfirmDialog } from "@/components/ops/confirm-dialog";
import { ItemFormDialog } from "./item-form-dialog";
import { QuantityAdjustDialog } from "./quantity-adjust-dialog";
import { BulkQuantityDialog } from "./bulk-quantity-dialog";
import { BulkTagsDialog } from "./bulk-tags-dialog";
import {
  useInventoryItems,
  useInventoryTags,
  useInventoryItemTags,
  useInventoryUnits,
  useBulkDeleteItems,
} from "@/lib/hooks/use-inventory";
import { useAuthStore } from "@/lib/store/auth-store";
import { selectIsOfficeOrAdmin } from "@/lib/store/auth-store";
import {
  getEffectiveThresholds,
  getThresholdStatus,
} from "@/lib/types/inventory";
import type { InventoryItem, ThresholdStatus } from "@/lib/types/inventory";
import { cn } from "@/lib/utils/cn";
import { toast } from "sonner";

// ─── Props ──────────────────────────────────────────────────────────────────────

interface ItemsTabProps {
  showCreateForm: boolean;
  onCreateFormClose: () => void;
}

// ─── Sort Options ───────────────────────────────────────────────────────────────

type SortField = "name" | "quantity" | "status" | "updatedAt";

// ─── Component ──────────────────────────────────────────────────────────────────

export function ItemsTab({ showCreateForm, onCreateFormClose }: ItemsTabProps) {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const isOfficeOrAdmin = useAuthStore(selectIsOfficeOrAdmin);

  // ── Data hooks ──────────────────────────────────────────────────────────────
  const { data: items = [], isLoading } = useInventoryItems();
  const { data: tags = [] } = useInventoryTags();
  const { data: itemTags = [] } = useInventoryItemTags();
  const { data: units = [] } = useInventoryUnits();
  const bulkDelete = useBulkDeleteItems();

  // ── Filter / sort state ─────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState<string>("__all__");
  const [statusFilter, setStatusFilter] = useState<string>("__all__");
  const [sortField, setSortField] = useState<SortField>("name");

  // ── Selection state ─────────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // ── Dialog state ────────────────────────────────────────────────────────────
  const [editItem, setEditItem] = useState<InventoryItem | null>(null);
  const [adjustItem, setAdjustItem] = useState<InventoryItem | null>(null);
  const [showBulkQuantity, setShowBulkQuantity] = useState(false);
  const [showBulkTags, setShowBulkTags] = useState(false);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);

  // ── Lookup maps ─────────────────────────────────────────────────────────────
  const unitMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const unit of units) {
      map.set(unit.id, unit.display);
    }
    return map;
  }, [units]);

  const tagMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const tag of tags) {
      map.set(tag.id, tag.name);
    }
    return map;
  }, [tags]);

  // itemId -> tagId[]
  const itemTagMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const it of itemTags) {
      const existing = map.get(it.itemId) ?? [];
      existing.push(it.tagId);
      map.set(it.itemId, existing);
    }
    return map;
  }, [itemTags]);

  // ── Compute threshold status for each item ────────────────────────────────
  const itemStatusMap = useMemo(() => {
    const map = new Map<string, ThresholdStatus>();
    for (const item of items) {
      const tagIds = itemTagMap.get(item.id) ?? [];
      const associatedTags = tagIds
        .map((id) => tags.find((t) => t.id === id))
        .filter((t): t is NonNullable<typeof t> => t != null);
      const effective = getEffectiveThresholds(item, associatedTags);
      const status = getThresholdStatus(
        item.quantity,
        effective.warningThreshold,
        effective.criticalThreshold
      );
      map.set(item.id, status);
    }
    return map;
  }, [items, itemTagMap, tags]);

  // ── Filtering & sorting ───────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let result = items.filter((item) => !item.deletedAt);

    // Search filter
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (item) =>
          item.name.toLowerCase().includes(q) ||
          (item.sku ?? "").toLowerCase().includes(q) ||
          (item.description ?? "").toLowerCase().includes(q)
      );
    }

    // Tag filter
    if (tagFilter !== "__all__") {
      result = result.filter((item) => {
        const tagIds = itemTagMap.get(item.id) ?? [];
        return tagIds.includes(tagFilter);
      });
    }

    // Status filter
    if (statusFilter !== "__all__") {
      result = result.filter((item) => {
        const status = itemStatusMap.get(item.id) ?? "normal";
        return status === statusFilter;
      });
    }

    // Sort
    result = [...result].sort((a, b) => {
      switch (sortField) {
        case "name":
          return a.name.localeCompare(b.name);
        case "quantity":
          return a.quantity - b.quantity;
        case "status": {
          const order: Record<ThresholdStatus, number> = {
            critical: 0,
            warning: 1,
            normal: 2,
          };
          const sa = itemStatusMap.get(a.id) ?? "normal";
          const sb = itemStatusMap.get(b.id) ?? "normal";
          return order[sa] - order[sb];
        }
        case "updatedAt": {
          const ta = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
          const tb = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
          return tb - ta; // most recent first
        }
        default:
          return 0;
      }
    });

    return result;
  }, [items, search, tagFilter, statusFilter, sortField, itemTagMap, itemStatusMap]);

  // ── Selection helpers ─────────────────────────────────────────────────────
  const allSelected =
    filtered.length > 0 && filtered.every((item) => selectedIds.has(item.id));
  const someSelected =
    filtered.some((item) => selectedIds.has(item.id)) && !allSelected;

  const handleSelectAll = useCallback(() => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((item) => item.id)));
    }
  }, [allSelected, filtered]);

  const handleSelectRow = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // ── Bulk delete handler ───────────────────────────────────────────────────
  async function handleBulkDelete() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    try {
      await bulkDelete.mutateAsync(ids);
      toast.success(
        `Deleted ${ids.length} item${ids.length === 1 ? "" : "s"}`
      );
      setSelectedIds(new Set());
      setShowBulkDeleteConfirm(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to delete items"
      );
    }
  }

  // ── Tag IDs for currently editing item ─────────────────────────────────────
  const editItemTagIds = editItem
    ? (itemTagMap.get(editItem.id) ?? [])
    : [];

  // ── Unit display for adjust item ──────────────────────────────────────────
  const adjustUnitDisplay = adjustItem?.unitId
    ? unitMap.get(adjustItem.unitId)
    : undefined;

  // ── Status badge helper ───────────────────────────────────────────────────
  function renderStatusBadge(status: ThresholdStatus) {
    switch (status) {
      case "normal":
        return <Badge variant="success">OK</Badge>;
      case "warning":
        return <Badge variant="warning">LOW</Badge>;
      case "critical":
        return (
          <Badge variant="error" pulse>
            CRITICAL
          </Badge>
        );
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      {/* Filter Bar */}
      <div className="flex flex-col sm:flex-row gap-2">
        {/* Search */}
        <div className="relative flex-1 max-w-[320px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-[14px] h-[14px] text-text-tertiary" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, SKU, description..."
            className="pl-7"
          />
        </div>

        {/* Tag filter */}
        <Select value={tagFilter} onValueChange={setTagFilter}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="All Tags" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Tags</SelectItem>
            {tags
              .filter((t) => !t.deletedAt)
              .map((tag) => (
                <SelectItem key={tag.id} value={tag.id}>
                  {tag.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>

        {/* Status filter */}
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="All Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Status</SelectItem>
            <SelectItem value="normal">Normal</SelectItem>
            <SelectItem value="warning">Warning</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
          </SelectContent>
        </Select>

        {/* Sort */}
        <Select value={sortField} onValueChange={(v) => setSortField(v as SortField)}>
          <SelectTrigger className="w-[170px]">
            <SelectValue placeholder="Sort by..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name">Name</SelectItem>
            <SelectItem value="quantity">Quantity</SelectItem>
            <SelectItem value="status">Status</SelectItem>
            <SelectItem value="updatedAt">Recently Updated</SelectItem>
          </SelectContent>
        </Select>

        {/* New Item button */}
        <Button
          variant="default"
          size="sm"
          onClick={onCreateFormClose}
          className="gap-1 ml-auto"
        >
          <Plus className="w-[14px] h-[14px]" />
          New Item
        </Button>
      </div>

      {/* Bulk Actions Bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 px-2 py-1.5 bg-[rgba(255,255,255,0.03)] border border-border rounded-lg animate-fade-in">
          <span className="text-caption-sm text-ops-accent font-mono">
            {selectedIds.size} selected
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowBulkQuantity(true)}
            className="gap-1"
          >
            <SlidersHorizontal className="w-[14px] h-[14px]" />
            Adjust Quantity
          </Button>
          {isOfficeOrAdmin && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowBulkTags(true)}
              className="gap-1"
            >
              <Tag className="w-[14px] h-[14px]" />
              Apply Tags
            </Button>
          )}
          {isOfficeOrAdmin && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowBulkDeleteConfirm(true)}
              className="gap-1 text-ops-error hover:text-ops-error"
            >
              <Trash2 className="w-[14px] h-[14px]" />
              Delete
            </Button>
          )}
        </div>
      )}

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <span className="font-kosugi text-caption text-text-disabled">
            Loading inventory...
          </span>
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Package className="w-[32px] h-[32px]" />}
          title="No items found"
          description={
            search || tagFilter !== "__all__" || statusFilter !== "__all__"
              ? "Try adjusting your filters."
              : "Add your first inventory item to get started."
          }
          action={
            !search && tagFilter === "__all__" && statusFilter === "__all__"
              ? {
                  label: "Add Item",
                  onClick: onCreateFormClose,
                }
              : undefined
          }
        />
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-[rgba(255,255,255,0.02)]">
                {/* Checkbox */}
                <th className="w-[40px] px-1 py-1.5">
                  <Checkbox
                    checked={allSelected}
                    ref={(el) => {
                      if (el) {
                        (el as unknown as HTMLInputElement).indeterminate =
                          someSelected;
                      }
                    }}
                    onCheckedChange={handleSelectAll}
                    aria-label="Select all rows"
                  />
                </th>
                {/* Name */}
                <th className="text-left px-2 py-1.5 font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">
                  Name
                </th>
                {/* Quantity */}
                <th className="text-left px-2 py-1.5 font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">
                  Quantity
                </th>
                {/* Status */}
                <th className="text-left px-2 py-1.5 font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">
                  Status
                </th>
                {/* Tags */}
                <th className="text-left px-2 py-1.5 font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest hidden md:table-cell">
                  Tags
                </th>
                {/* SKU */}
                <th className="text-left px-2 py-1.5 font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest hidden sm:table-cell">
                  SKU
                </th>
                {/* Actions */}
                <th className="text-right px-2 py-1.5 font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest w-[100px]">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => {
                const isSelected = selectedIds.has(item.id);
                const status = itemStatusMap.get(item.id) ?? "normal";
                const tagIds = itemTagMap.get(item.id) ?? [];
                const unitDisplay = item.unitId
                  ? unitMap.get(item.unitId) ?? ""
                  : "ea";

                return (
                  <tr
                    key={item.id}
                    className={cn(
                      "border-b border-border last:border-b-0 hover:bg-[rgba(255,255,255,0.02)] transition-colors",
                      isSelected && "bg-ops-accent-muted"
                    )}
                  >
                    {/* Checkbox */}
                    <td className="w-[40px] px-1 py-1.5">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => handleSelectRow(item.id)}
                        aria-label={`Select ${item.name}`}
                      />
                    </td>

                    {/* Name + Description */}
                    <td className="px-2 py-1.5">
                      <div>
                        <span className="font-mohave text-body text-text-primary block">
                          {item.name}
                        </span>
                        {item.description && (
                          <span className="font-kosugi text-[10px] text-text-disabled truncate block max-w-[300px]">
                            {item.description}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Quantity */}
                    <td className="px-2 py-1.5">
                      <span className="font-mono text-data-sm text-text-primary">
                        {item.quantity} {unitDisplay}
                      </span>
                    </td>

                    {/* Status */}
                    <td className="px-2 py-1.5">
                      {renderStatusBadge(status)}
                    </td>

                    {/* Tags */}
                    <td className="px-2 py-1.5 hidden md:table-cell">
                      <div className="flex flex-wrap gap-1">
                        {tagIds.length === 0 ? (
                          <span className="font-kosugi text-[10px] text-text-disabled">
                            —
                          </span>
                        ) : (
                          tagIds.map((tagId) => {
                            const tagName = tagMap.get(tagId);
                            if (!tagName) return null;
                            return (
                              <span
                                key={tagId}
                                className={cn(
                                  "inline-flex items-center",
                                  "px-1 py-[1px] rounded-sm",
                                  "bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.1)]",
                                  "font-mohave text-[10px] text-text-secondary uppercase tracking-wider"
                                )}
                              >
                                {tagName}
                              </span>
                            );
                          })
                        )}
                      </div>
                    </td>

                    {/* SKU */}
                    <td className="px-2 py-1.5 hidden sm:table-cell">
                      <span className="font-kosugi text-caption-sm text-text-tertiary">
                        {item.sku || "—"}
                      </span>
                    </td>

                    {/* Actions */}
                    <td className="px-2 py-1.5 text-right">
                      <div className="flex items-center justify-end gap-0.5">
                        {isOfficeOrAdmin && (
                          <button
                            onClick={() => setEditItem(item)}
                            className="p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-[rgba(255,255,255,0.05)] transition-colors"
                            title="Edit item"
                          >
                            <Pencil className="w-[14px] h-[14px]" />
                          </button>
                        )}
                        <button
                          onClick={() => setAdjustItem(item)}
                          className="p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-[rgba(255,255,255,0.05)] transition-colors"
                          title="Adjust quantity"
                        >
                          <SlidersHorizontal className="w-[14px] h-[14px]" />
                        </button>
                        {isOfficeOrAdmin && (
                          <button
                            onClick={() => {
                              setSelectedIds(new Set([item.id]));
                              setShowBulkDeleteConfirm(true);
                            }}
                            className="p-1 rounded text-text-disabled hover:text-ops-error hover:bg-ops-error-muted transition-colors"
                            title="Delete item"
                          >
                            <Trash2 className="w-[14px] h-[14px]" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Dialogs ──────────────────────────────────────────────────────────── */}

      {/* Create / Edit Item */}
      <ItemFormDialog
        open={showCreateForm || !!editItem}
        onOpenChange={(open) => {
          if (!open) {
            if (showCreateForm) onCreateFormClose();
            setEditItem(null);
          }
        }}
        editItem={editItem}
        editItemTagIds={editItemTagIds}
      />

      {/* Single Quantity Adjust */}
      {adjustItem && (
        <QuantityAdjustDialog
          open={!!adjustItem}
          onOpenChange={(open) => {
            if (!open) setAdjustItem(null);
          }}
          item={adjustItem}
          unitDisplay={adjustUnitDisplay}
        />
      )}

      {/* Bulk Quantity Adjust */}
      <BulkQuantityDialog
        open={showBulkQuantity}
        onOpenChange={(open) => {
          setShowBulkQuantity(open);
          if (!open) setSelectedIds(new Set());
        }}
        selectedItemIds={Array.from(selectedIds)}
      />

      {/* Bulk Tags */}
      <BulkTagsDialog
        open={showBulkTags}
        onOpenChange={(open) => {
          setShowBulkTags(open);
          if (!open) setSelectedIds(new Set());
        }}
        selectedItemIds={Array.from(selectedIds)}
      />

      {/* Bulk Delete Confirmation */}
      <ConfirmDialog
        open={showBulkDeleteConfirm}
        onOpenChange={setShowBulkDeleteConfirm}
        title="Delete Items"
        description={`Are you sure you want to delete ${selectedIds.size} item${selectedIds.size === 1 ? "" : "s"}? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleBulkDelete}
        loading={bulkDelete.isPending}
      />
    </div>
  );
}
