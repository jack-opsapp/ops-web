"use client";

import { useState, useMemo } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useInventoryTags,
  useInventoryUnits,
  useInventoryItemTags,
  useInventoryItems,
  useDeleteInventoryTag,
  useDeleteInventoryUnit,
} from "@/lib/hooks/use-inventory";
import type { InventoryTag } from "@/lib/types/inventory";
import { TagFormDialog } from "./tag-form-dialog";
import { UnitFormDialog } from "./unit-form-dialog";

export function TagsUnitsTab() {
  const { data: tags = [], isLoading: tagsLoading } = useInventoryTags();
  const { data: units = [], isLoading: unitsLoading } = useInventoryUnits();
  const { data: itemTags = [] } = useInventoryItemTags();
  const { data: items = [] } = useInventoryItems();

  const deleteTag = useDeleteInventoryTag();
  const deleteUnit = useDeleteInventoryUnit();

  // ─── Dialog State ──────────────────────────────────────────────────────────
  const [showTagForm, setShowTagForm] = useState(false);
  const [editTag, setEditTag] = useState<InventoryTag | null>(null);
  const [showUnitForm, setShowUnitForm] = useState(false);

  // ─── Computed: item count per tag ──────────────────────────────────────────
  const tagItemCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const jt of itemTags) {
      counts.set(jt.tagId, (counts.get(jt.tagId) ?? 0) + 1);
    }
    return counts;
  }, [itemTags]);

  // ─── Computed: item count per unit ─────────────────────────────────────────
  const unitItemCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      if (item.unitId) {
        counts.set(item.unitId, (counts.get(item.unitId) ?? 0) + 1);
      }
    }
    return counts;
  }, [items]);

  // ─── Handlers ──────────────────────────────────────────────────────────────
  const handleDeleteTag = (tag: InventoryTag) => {
    if (confirm(`Delete tag "${tag.name}"? This cannot be undone.`)) {
      deleteTag.mutate(tag.id);
    }
  };

  const handleDeleteUnit = (unit: { id: string; display: string }) => {
    const count = unitItemCounts.get(unit.id) ?? 0;
    const message =
      count > 0
        ? `Delete unit "${unit.display}"? ${count} item${count !== 1 ? "s" : ""} currently use this unit.`
        : `Delete unit "${unit.display}"? This cannot be undone.`;

    if (confirm(message)) {
      deleteUnit.mutate(unit.id);
    }
  };

  // Sort units by sortOrder
  const sortedUnits = useMemo(
    () => [...units].sort((a, b) => a.sortOrder - b.sortOrder),
    [units]
  );

  return (
    <div className="space-y-6 py-2">
      {/* ─── Tags Section ─────────────────────────────────────────────────────── */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="font-kosugi text-caption-sm uppercase tracking-widest text-text-tertiary">
            [ TAGS ]
          </span>
          <Button
            variant="default"
            size="sm"
            onClick={() => setShowTagForm(true)}
            className="gap-1"
          >
            <Plus className="w-[14px] h-[14px]" />
            New Tag
          </Button>
        </div>

        {tagsLoading ? (
          <div className="flex items-center justify-center py-8">
            <span className="font-kosugi text-caption text-text-disabled">
              Loading tags...
            </span>
          </div>
        ) : tags.length === 0 ? (
          <div className="py-6 text-center">
            <span className="font-kosugi text-caption text-text-disabled">
              No tags yet. Create one to categorize inventory items.
            </span>
          </div>
        ) : (
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-[rgba(255,255,255,0.02)]">
                  <th className="text-left px-2 py-1.5 font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">
                    Name
                  </th>
                  <th className="text-right px-2 py-1.5 font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest hidden sm:table-cell">
                    Warning Threshold
                  </th>
                  <th className="text-right px-2 py-1.5 font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest hidden sm:table-cell">
                    Critical Threshold
                  </th>
                  <th className="text-right px-2 py-1.5 font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">
                    Item Count
                  </th>
                  <th className="text-right px-2 py-1.5 font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest w-[80px]">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {tags.map((tag) => (
                  <tr
                    key={tag.id}
                    className="border-b border-border-subtle last:border-b-0 hover:bg-[rgba(255,255,255,0.02)] transition-colors"
                  >
                    <td className="px-2 py-1.5">
                      <span className="font-mohave text-body text-text-primary">
                        {tag.name}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right hidden sm:table-cell">
                      <span className="font-mono text-data-sm text-text-secondary">
                        {tag.warningThreshold != null
                          ? tag.warningThreshold
                          : "\u2014"}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right hidden sm:table-cell">
                      <span className="font-mono text-data-sm text-text-secondary">
                        {tag.criticalThreshold != null
                          ? tag.criticalThreshold
                          : "\u2014"}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <span className="font-mono text-data-sm text-text-tertiary">
                        {tagItemCounts.get(tag.id) ?? 0}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <div className="flex items-center justify-end gap-0.5">
                        <button
                          onClick={() => {
                            setEditTag(tag);
                            setShowTagForm(true);
                          }}
                          className="p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-[rgba(255,255,255,0.05)] transition-colors"
                          title="Edit tag"
                        >
                          <Pencil className="w-[14px] h-[14px]" />
                        </button>
                        <button
                          onClick={() => handleDeleteTag(tag)}
                          className="p-1 rounded text-text-disabled hover:text-ops-error hover:bg-ops-error-muted transition-colors"
                          title="Delete tag"
                        >
                          <Trash2 className="w-[14px] h-[14px]" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ─── Units Section ────────────────────────────────────────────────────── */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="font-kosugi text-caption-sm uppercase tracking-widest text-text-tertiary">
            [ UNITS ]
          </span>
          <Button
            variant="default"
            size="sm"
            onClick={() => setShowUnitForm(true)}
            className="gap-1"
          >
            <Plus className="w-[14px] h-[14px]" />
            New Unit
          </Button>
        </div>

        {unitsLoading ? (
          <div className="flex items-center justify-center py-8">
            <span className="font-kosugi text-caption text-text-disabled">
              Loading units...
            </span>
          </div>
        ) : sortedUnits.length === 0 ? (
          <div className="py-6 text-center">
            <span className="font-kosugi text-caption text-text-disabled">
              No units yet. Create one to track inventory measurements.
            </span>
          </div>
        ) : (
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-[rgba(255,255,255,0.02)]">
                  <th className="text-left px-2 py-1.5 font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">
                    Display
                  </th>
                  <th className="text-center px-2 py-1.5 font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">
                    Default
                  </th>
                  <th className="text-right px-2 py-1.5 font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest hidden sm:table-cell">
                    Sort Order
                  </th>
                  <th className="text-right px-2 py-1.5 font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest w-[80px]">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedUnits.map((unit) => (
                  <tr
                    key={unit.id}
                    className="border-b border-border-subtle last:border-b-0 hover:bg-[rgba(255,255,255,0.02)] transition-colors"
                  >
                    <td className="px-2 py-1.5">
                      <span className="font-mohave text-body text-text-primary">
                        {unit.display}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      {unit.isDefault && (
                        <span
                          className="inline-block w-[8px] h-[8px] rounded-full bg-status-success"
                          title="Default unit"
                        />
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right hidden sm:table-cell">
                      <span className="font-mono text-data-sm text-text-tertiary">
                        {unit.sortOrder}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <div className="flex items-center justify-end gap-0.5">
                        {unit.isDefault ? (
                          <button
                            disabled
                            className="p-1 rounded text-text-disabled opacity-40 cursor-not-allowed"
                            title="Default units cannot be deleted"
                          >
                            <Trash2 className="w-[14px] h-[14px]" />
                          </button>
                        ) : (
                          <button
                            onClick={() => handleDeleteUnit(unit)}
                            className="p-1 rounded text-text-disabled hover:text-ops-error hover:bg-ops-error-muted transition-colors"
                            title="Delete unit"
                          >
                            <Trash2 className="w-[14px] h-[14px]" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ─── Dialogs ──────────────────────────────────────────────────────────── */}
      <TagFormDialog
        open={showTagForm}
        onOpenChange={(open) => {
          setShowTagForm(open);
          if (!open) setEditTag(null);
        }}
        editTag={editTag}
      />

      <UnitFormDialog open={showUnitForm} onOpenChange={setShowUnitForm} />
    </div>
  );
}
