"use client";

import { useState, useEffect, useCallback } from "react";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { Plus, Flag } from "lucide-react";
import { SummaryBar } from "./summary-bar";
import { CategoryGroup } from "./category-group";
import { NewCategoryForm } from "./new-category-form";
import { BetaRequestsDrawer } from "./beta-requests-drawer";
import { ItemRow } from "./item-row";
import type { WhatsNewCategory, WhatsNewItem, BetaRequest } from "./types";

export function WhatsNewContent() {
  const [categories, setCategories] = useState<WhatsNewCategory[]>([]);
  const [requests, setRequests] = useState<BetaRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);

  const pendingCount = requests.filter((r) => r.status === "pending").length;

  const showMsg = useCallback((text: string, type: "success" | "error") => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 3000);
  }, []);

  // ── Data fetching ──

  const fetchAll = useCallback(async () => {
    try {
      const [catRes, reqRes] = await Promise.all([
        fetch("/api/admin/whats-new/categories"),
        fetch("/api/admin/whats-new/requests"),
      ]);
      if (catRes.ok) setCategories(await catRes.json());
      if (reqRes.ok) setRequests(await reqRes.json());
    } catch {
      showMsg("Failed to load data", "error");
    } finally {
      setLoading(false);
    }
  }, [showMsg]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // ── Category CRUD ──

  const createCategory = async (name: string, icon: string) => {
    const maxSort = Math.max(0, ...categories.map((c) => c.sort_order));
    const res = await fetch("/api/admin/whats-new/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, icon, sort_order: maxSort + 1 }),
    });
    if (!res.ok) {
      showMsg("Failed to create category", "error");
      return;
    }
    showMsg(`Created "${name}"`, "success");
    setShowNewCategory(false);
    fetchAll();
  };

  const updateCategory = async (id: string, updates: Partial<WhatsNewCategory>) => {
    const res = await fetch("/api/admin/whats-new/categories", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...updates }),
    });
    if (!res.ok) {
      showMsg("Failed to update", "error");
      return;
    }
    showMsg("Updated", "success");
    fetchAll();
  };

  const deleteCategory = async (id: string) => {
    const res = await fetch("/api/admin/whats-new/categories", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (!res.ok) {
      showMsg("Failed to delete", "error");
      return;
    }
    showMsg("Deleted", "success");
    fetchAll();
  };

  // ── Item CRUD ──

  const createItem = async (
    categoryId: string,
    title: string,
    description: string,
    icon: string,
    status: string,
    featureFlagSlug: string
  ) => {
    const cat = categories.find((c) => c.id === categoryId);
    const maxSort = Math.max(0, ...(cat?.whats_new_items ?? []).map((i) => i.sort_order));
    const res = await fetch("/api/admin/whats-new/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category_id: categoryId,
        title,
        description,
        icon,
        status,
        feature_flag_slug: featureFlagSlug || null,
        sort_order: maxSort + 1,
      }),
    });
    if (!res.ok) {
      showMsg("Failed to create item", "error");
      return;
    }
    showMsg(`Created "${title}"`, "success");
    fetchAll();
  };

  const updateItem = async (id: string, updates: Partial<WhatsNewItem>) => {
    // Optimistic update for status changes
    if (updates.status || updates.is_active !== undefined) {
      setCategories((prev) =>
        prev.map((cat) => ({
          ...cat,
          whats_new_items: cat.whats_new_items.map((item) =>
            item.id === id ? { ...item, ...updates } : item
          ),
        }))
      );
    }

    const res = await fetch("/api/admin/whats-new/items", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...updates }),
    });
    if (!res.ok) {
      showMsg("Failed to update", "error");
      fetchAll(); // Revert on failure
      return;
    }
    showMsg("Updated", "success");
    // Re-fetch to ensure consistency for non-optimistic updates
    if (!updates.status && updates.is_active === undefined) {
      fetchAll();
    }
  };

  const handleStatusChange = (id: string, status: string) => {
    updateItem(id, { status });
  };

  const handleToggleVisibility = (id: string, isActive: boolean) => {
    updateItem(id, { is_active: isActive });
  };

  const deleteItem = async (id: string) => {
    const res = await fetch("/api/admin/whats-new/items", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (!res.ok) {
      showMsg("Failed to delete", "error");
      return;
    }
    showMsg("Deleted", "success");
    fetchAll();
  };

  // ── Beta request management ──

  const handleRequestDecision = async (
    requestId: string,
    status: "approved" | "rejected",
    notes: string
  ) => {
    const res = await fetch("/api/admin/whats-new/requests", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: requestId, status, admin_notes: notes || null }),
    });
    if (!res.ok) {
      showMsg("Failed to process request", "error");
      return;
    }
    showMsg(
      status === "approved" ? "Approved — email sent" : "Rejected — email sent",
      "success"
    );
    fetchAll();
  };

  // ── Batch reorder ──

  const batchReorder = async (
    type: "items" | "categories",
    updates: Array<{ id: string; sort_order: number }>
  ) => {
    const res = await fetch("/api/admin/whats-new/reorder", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, updates }),
    });
    if (!res.ok) {
      showMsg("Failed to reorder", "error");
      fetchAll(); // Revert
    }
  };

  // ── Drag & Drop ──

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  // Find which category an item belongs to
  const findCategoryByItemId = (itemId: string): WhatsNewCategory | undefined => {
    return categories.find((cat) =>
      cat.whats_new_items.some((item) => item.id === itemId)
    );
  };

  // Find the active item for DragOverlay
  const activeItem = activeItemId
    ? categories.flatMap((c) => c.whats_new_items).find((i) => i.id === activeItemId)
    : null;

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const id = String(active.id);

    // Only set active item for item drags, not category drags
    if (!id.startsWith("cat-")) {
      setActiveItemId(id);
    }
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    // Skip category-level drags
    if (activeId.startsWith("cat-")) return;

    const activeCat = findCategoryByItemId(activeId);

    // Determine the target category
    let overCat: WhatsNewCategory | undefined;
    if (overId.startsWith("cat-drop-")) {
      // Dropped on a category drop zone
      const catId = overId.replace("cat-drop-", "");
      overCat = categories.find((c) => c.id === catId);
    } else {
      // Dropped on another item
      overCat = findCategoryByItemId(overId);
    }

    if (!activeCat || !overCat || activeCat.id === overCat.id) return;

    // Move item between categories in local state
    setCategories((prev) => {
      const item = activeCat.whats_new_items.find((i) => i.id === activeId);
      if (!item) return prev;

      return prev.map((cat) => {
        if (cat.id === activeCat.id) {
          return {
            ...cat,
            whats_new_items: cat.whats_new_items.filter((i) => i.id !== activeId),
          };
        }
        if (cat.id === overCat!.id) {
          const overIndex = cat.whats_new_items.findIndex((i) => i.id === overId);
          const insertIndex = overIndex >= 0 ? overIndex : cat.whats_new_items.length;
          const newItems = [...cat.whats_new_items];
          newItems.splice(insertIndex, 0, { ...item, category_id: overCat!.id });
          return { ...cat, whats_new_items: newItems };
        }
        return cat;
      });
    });
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveItemId(null);

    if (!over) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    // ── Category reorder ──
    if (activeId.startsWith("cat-") && overId.startsWith("cat-")) {
      const activeCatId = activeId.replace("cat-", "");
      const overCatId = overId.replace("cat-", "");

      if (activeCatId === overCatId) return;

      const oldIndex = categories.findIndex((c) => c.id === activeCatId);
      const newIndex = categories.findIndex((c) => c.id === overCatId);

      if (oldIndex === -1 || newIndex === -1) return;

      const reordered = arrayMove(categories, oldIndex, newIndex);
      setCategories(reordered);

      const updates = reordered.map((cat, i) => ({ id: cat.id, sort_order: i }));
      await batchReorder("categories", updates);
      return;
    }

    // ── Item reorder / move ──
    if (activeId.startsWith("cat-")) return; // Safety

    const activeCat = findCategoryByItemId(activeId);
    if (!activeCat) return;

    // Same container reorder
    const activeIdx = activeCat.whats_new_items.findIndex((i) => i.id === activeId);
    const overIdx = activeCat.whats_new_items.findIndex((i) => i.id === overId);

    if (activeIdx !== -1 && overIdx !== -1 && activeIdx !== overIdx) {
      const reordered = arrayMove(activeCat.whats_new_items, activeIdx, overIdx);
      setCategories((prev) =>
        prev.map((cat) =>
          cat.id === activeCat.id ? { ...cat, whats_new_items: reordered } : cat
        )
      );

      const updates = reordered.map((item, i) => ({ id: item.id, sort_order: i }));
      await batchReorder("items", updates);
      return;
    }

    // Cross-container move was handled in onDragOver (state already updated).
    // Now persist the change:
    const newCat = findCategoryByItemId(activeId);
    if (newCat && newCat.id !== (active.data.current as { categoryId?: string })?.categoryId) {
      // Update category_id on the item
      await fetch("/api/admin/whats-new/items", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: activeId, category_id: newCat.id }),
      });

      // Batch reorder the destination category
      const destUpdates = newCat.whats_new_items.map((item, i) => ({
        id: item.id,
        sort_order: i,
      }));
      await batchReorder("items", destUpdates);
    }
  };

  // ── Filtered items per category ──

  const getFilteredItems = (cat: WhatsNewCategory): WhatsNewItem[] => {
    if (!statusFilter) return cat.whats_new_items;
    return cat.whats_new_items.filter((item) => item.status === statusFilter);
  };

  // ── Category sortable IDs ──

  const categorySortableIds = categories.map((c) => `cat-${c.id}`);

  // ── Render ──

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="font-mohave text-[14px] uppercase tracking-widest text-[#6B6B6B] animate-pulse">
          Loading...
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toast */}
      {message && (
        <div
          className={`px-4 py-2 rounded text-[13px] font-mohave ${
            message.type === "success"
              ? "bg-[#9DB582]/20 text-[#9DB582]"
              : "bg-[#93321A]/20 text-[#93321A]"
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Header row: title + beta requests badge */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="font-mohave text-[14px] uppercase tracking-widest text-[#E5E5E5]">
            Categories & Items
          </h2>
          <span className="font-kosugi text-[12px] text-[#6B6B6B]">
            {categories.length} categories ·{" "}
            {categories.reduce((sum, c) => sum + c.whats_new_items.length, 0)} items
          </span>
        </div>
        <button
          onClick={() => setDrawerOpen(true)}
          className="flex items-center gap-2 px-3 py-1.5 rounded border border-white/[0.08] text-[#6B6B6B] hover:text-[#E5E5E5] hover:border-white/[0.15] transition-colors"
        >
          <Flag className="w-3.5 h-3.5" />
          <span className="font-mohave text-[11px] uppercase tracking-wider">Beta Requests</span>
          {pendingCount > 0 && (
            <span className="px-1.5 py-0.5 bg-[#C4A868]/20 text-[#C4A868] text-[10px] font-mohave rounded">
              {pendingCount}
            </span>
          )}
        </button>
      </div>

      {/* Summary bar */}
      <SummaryBar
        categories={categories}
        activeFilter={statusFilter}
        onFilterChange={setStatusFilter}
      />

      {/* Categories with drag & drop */}
      {categories.length === 0 ? (
        <div className="py-16 text-center space-y-4">
          <p className="font-kosugi text-[12px] text-[#6B6B6B]">No categories yet</p>
          <button
            onClick={() => setShowNewCategory(true)}
            className="inline-flex items-center gap-2 px-4 py-2 border border-dashed border-white/[0.12] rounded text-[#6B6B6B] hover:text-[#E5E5E5] hover:border-white/[0.2] transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span className="font-mohave text-[13px] uppercase tracking-wider">Add Category</span>
          </button>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={categorySortableIds} strategy={verticalListSortingStrategy}>
            <div className="space-y-3">
              {categories.map((cat) => (
                <CategoryGroup
                  key={cat.id}
                  category={cat}
                  filteredItems={getFilteredItems(cat)}
                  isFiltered={!!statusFilter}
                  onUpdateCategory={updateCategory}
                  onDeleteCategory={deleteCategory}
                  onStatusChange={handleStatusChange}
                  onToggleItemVisibility={handleToggleVisibility}
                  onUpdateItem={updateItem}
                  onDeleteItem={deleteItem}
                  onCreateItem={createItem}
                />
              ))}
            </div>
          </SortableContext>

          {/* Drag overlay — renders a ghost of the dragged item */}
          <DragOverlay>
            {activeItem ? (
              <div className="bg-glass glass-surface border border-[#597794]/40 rounded opacity-90 shadow-lg">
                <ItemRow
                  item={activeItem}
                  onStatusChange={() => {}}
                  onToggleVisibility={() => {}}
                  onUpdate={() => {}}
                  onDelete={() => {}}
                />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {/* Add category */}
      {categories.length > 0 && (
        showNewCategory ? (
          <NewCategoryForm
            onSubmit={createCategory}
            onCancel={() => setShowNewCategory(false)}
          />
        ) : (
          <button
            onClick={() => setShowNewCategory(true)}
            className="flex items-center gap-2 px-4 py-3 w-full border border-dashed border-white/[0.12] rounded text-[#6B6B6B] hover:text-[#E5E5E5] hover:border-white/[0.2] transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span className="font-mohave text-[13px] uppercase tracking-wider">Add Category</span>
          </button>
        )
      )}

      {/* Beta Requests Drawer */}
      <BetaRequestsDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        requests={requests}
        onDecision={async (id, status, notes) => {
          await handleRequestDecision(id, status, notes);
          setDrawerOpen(false);
        }}
      />
    </div>
  );
}
