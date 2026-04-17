"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, GripVertical, Pencil, Trash2, Check, X } from "lucide-react";
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
import type { ShopCategory } from "@/lib/admin/shop-types";

interface CategoriesListProps {
  categories: ShopCategory[];
}

function SortableCategory({
  category,
  onUpdate,
  onDelete,
}: {
  category: ShopCategory;
  onUpdate: (id: string, fields: { name?: string; slug?: string }) => void;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(category.name);
  const [editSlug, setEditSlug] = useState(category.slug);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: category.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  function handleSave() {
    onUpdate(category.id, { name: editName, slug: editSlug });
    setEditing(false);
  }

  function handleCancel() {
    setEditName(category.name);
    setEditSlug(category.slug);
    setEditing(false);
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06] hover:bg-white/[0.02] transition-colors"
    >
      <button
        {...attributes}
        {...listeners}
        className="text-[#6B6B6B] cursor-grab active:cursor-grabbing"
      >
        <GripVertical size={14} />
      </button>

      {editing ? (
        <>
          <input
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            autoFocus
            className="flex-1 bg-white/[0.04] border border-[#597794] rounded-sm px-3 py-1.5 font-mohave text-[13px] text-[#E5E5E5] focus:outline-none"
          />
          <input
            type="text"
            value={editSlug}
            onChange={(e) => setEditSlug(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            className="w-40 bg-white/[0.04] border border-white/[0.08] rounded-sm px-3 py-1.5 font-mohave text-[12px] text-[#6B6B6B] focus:border-[#597794] focus:outline-none"
          />
          <button onClick={handleSave} className="p-1.5 rounded-sm text-emerald-400 hover:bg-emerald-500/10 transition-colors">
            <Check size={14} />
          </button>
          <button onClick={handleCancel} className="p-1.5 rounded-sm text-[#6B6B6B] hover:text-[#E5E5E5] transition-colors">
            <X size={14} />
          </button>
        </>
      ) : (
        <>
          <span className="flex-1 font-mohave text-[13px] text-[#E5E5E5]">{category.name}</span>
          <span className="px-2 py-0.5 bg-white/[0.05] rounded-sm font-mono text-micro uppercase tracking-widest text-[#6B6B6B]">
            {category.slug}
          </span>
          <button
            onClick={() => setEditing(true)}
            className="p-1.5 rounded-sm text-[#6B6B6B] hover:text-[#E5E5E5] transition-colors"
          >
            <Pencil size={14} />
          </button>
          <button
            onClick={() => onDelete(category.id)}
            className="p-1.5 rounded-sm text-[#6B6B6B] hover:text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <Trash2 size={14} />
          </button>
        </>
      )}
    </div>
  );
}

export function CategoriesList({ categories: initialCategories }: CategoriesListProps) {
  const router = useRouter();
  const [categories, setCategories] = useState(initialCategories);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = categories.findIndex((c) => c.id === active.id);
    const newIndex = categories.findIndex((c) => c.id === over.id);
    const reordered = arrayMove(categories, oldIndex, newIndex);
    setCategories(reordered);

    // Fire-and-forget — optimistic state is already applied via setCategories above
    fetch("/api/admin/shop/categories", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderedIds: reordered.map((c) => c.id) }),
    });
  }

  async function handleUpdate(id: string, fields: { name?: string; slug?: string }) {
    await fetch(`/api/admin/shop/categories/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    router.refresh();
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this category?")) return;
    const res = await fetch(`/api/admin/shop/categories/${id}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error);
      return;
    }
    setCategories(categories.filter((c) => c.id !== id));
    router.refresh();
  }

  async function handleAdd() {
    if (!newName.trim()) return;
    const res = await fetch("/api/admin/shop/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim() }),
    });
    if (res.ok) {
      setNewName("");
      setAdding(false);
      router.refresh();
    }
  }

  return (
    <div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={categories.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          <div className="border border-white/[0.08] rounded-sm overflow-hidden">
            {categories.map((c) => (
              <SortableCategory
                key={c.id}
                category={c}
                onUpdate={handleUpdate}
                onDelete={handleDelete}
              />
            ))}
            {categories.length === 0 && (
              <div className="px-4 py-12 text-center font-mohave text-[13px] text-[#6B6B6B]">
                No categories yet
              </div>
            )}
          </div>
        </SortableContext>
      </DndContext>

      {adding ? (
        <div className="mt-4 flex items-center gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            placeholder="Category name..."
            autoFocus
            className="bg-white/[0.04] border border-white/[0.08] rounded-sm px-3 py-1.5 font-mohave text-[13px] text-[#E5E5E5] focus:border-[#597794] focus:outline-none"
          />
          <button
            onClick={handleAdd}
            disabled={!newName.trim()}
            className="px-4 py-1.5 bg-ops-accent rounded-sm font-mono text-[11px] uppercase tracking-widest text-white hover:bg-ops-accent/80 transition-colors disabled:opacity-50"
          >
            Add
          </button>
          <button
            onClick={() => { setAdding(false); setNewName(""); }}
            className="px-3 py-1.5 font-mono text-[11px] uppercase tracking-widest text-[#6B6B6B]"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="mt-4 flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-widest text-[#6B6B6B] hover:text-[#E5E5E5] transition-colors"
        >
          <Plus size={14} /> Add Category
        </button>
      )}
    </div>
  );
}
