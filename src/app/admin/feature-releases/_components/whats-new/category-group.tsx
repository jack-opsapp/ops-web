"use client";

import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  GripVertical, Plus, Eye, EyeOff, Edit2, Trash2, Check, X,
} from "lucide-react";
import { ItemRow } from "./item-row";
import { NewItemForm } from "./new-item-form";
import type { WhatsNewCategory, WhatsNewItem } from "./types";

interface CategoryGroupProps {
  category: WhatsNewCategory;
  filteredItems: WhatsNewItem[];
  isFiltered: boolean;
  onUpdateCategory: (id: string, updates: Partial<WhatsNewCategory>) => void;
  onDeleteCategory: (id: string) => void;
  onStatusChange: (id: string, status: string) => void;
  onToggleItemVisibility: (id: string, isActive: boolean) => void;
  onUpdateItem: (id: string, updates: Partial<WhatsNewItem>) => void;
  onDeleteItem: (id: string) => void;
  onCreateItem: (
    categoryId: string,
    title: string,
    description: string,
    icon: string,
    status: string,
    featureFlagSlug: string
  ) => void;
}

export function CategoryGroup({
  category,
  filteredItems,
  isFiltered,
  onUpdateCategory,
  onDeleteCategory,
  onStatusChange,
  onToggleItemVisibility,
  onUpdateItem,
  onDeleteItem,
  onCreateItem,
}: CategoryGroupProps) {
  const [isEditingHeader, setIsEditingHeader] = useState(false);
  const [editName, setEditName] = useState(category.name);
  const [editIcon, setEditIcon] = useState(category.icon);
  const [showAddItem, setShowAddItem] = useState(false);

  // Make the category itself sortable (for category reorder)
  const {
    attributes: catAttributes,
    listeners: catListeners,
    setNodeRef: setCatNodeRef,
    transform: catTransform,
    transition: catTransition,
    isDragging: isCatDragging,
  } = useSortable({
    id: `cat-${category.id}`,
    data: { type: "category", categoryId: category.id },
  });

  const catStyle = {
    transform: CSS.Transform.toString(catTransform),
    transition: catTransition,
  };

  // Make the category body a droppable target for items
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `cat-drop-${category.id}`,
    data: { type: "category-drop", categoryId: category.id },
  });

  const itemIds = filteredItems.map((item) => item.id);

  const handleSaveHeader = () => {
    onUpdateCategory(category.id, { name: editName, icon: editIcon });
    setIsEditingHeader(false);
  };

  return (
    <div
      ref={setCatNodeRef}
      style={catStyle}
      className={`border rounded overflow-hidden transition-colors ${
        category.is_active ? "border-white/[0.08]" : "border-white/[0.04] opacity-60"
      } ${isCatDragging ? "opacity-60 border-[#597794]/40" : ""} ${
        isOver ? "border-[#597794]/30" : ""
      }`}
    >
      {/* Category Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-white/[0.02]">
        <div className="flex items-center gap-3 min-w-0">
          <button
            {...catAttributes}
            {...catListeners}
            className="text-[#6B6B6B] hover:text-[#A0A0A0] cursor-grab active:cursor-grabbing flex-shrink-0 touch-none"
          >
            <GripVertical className="w-4 h-4" />
          </button>

          {isEditingHeader ? (
            <div className="flex items-center gap-2">
              <input
                value={editIcon}
                onChange={(e) => setEditIcon(e.target.value)}
                className="w-20 bg-white/[0.05] border border-white/[0.08] rounded px-2 py-1 font-mono text-[11px] text-[#E5E5E5] outline-none"
                placeholder="icon"
              />
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="flex-1 bg-white/[0.05] border border-white/[0.08] rounded px-2 py-1 font-mohave text-[14px] text-[#E5E5E5] outline-none"
                autoFocus
              />
              <button onClick={handleSaveHeader} className="text-[#9DB582] hover:text-[#9DB582]/80">
                <Check className="w-4 h-4" />
              </button>
              <button onClick={() => setIsEditingHeader(false)} className="text-[#6B6B6B] hover:text-[#E5E5E5]">
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <>
              <span className="font-mono text-[11px] text-[#6B6B6B] bg-white/[0.05] px-1.5 py-0.5 rounded">
                {category.icon}
              </span>
              <h3 className="font-cakemono text-[15px] font-light uppercase text-[#E5E5E5]">
                {category.name}
              </h3>
              <span className="font-kosugi text-[11px] text-[#6B6B6B]">
                {category.whats_new_items.length} items
              </span>
            </>
          )}
        </div>

        {!isEditingHeader && (
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => setShowAddItem(true)}
              className="text-[#6B6B6B] hover:text-[#E5E5E5] transition-colors"
              title="Add item"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onUpdateCategory(category.id, { is_active: !category.is_active })}
              className="text-[#6B6B6B] hover:text-[#E5E5E5] transition-colors"
              title={category.is_active ? "Hide" : "Show"}
            >
              {category.is_active ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={() => {
                setIsEditingHeader(true);
                setEditName(category.name);
                setEditIcon(category.icon);
              }}
              className="text-[#6B6B6B] hover:text-[#597794] transition-colors"
            >
              <Edit2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => {
                if (confirm("Delete this category and all its items?")) {
                  onDeleteCategory(category.id);
                }
              }}
              className="text-[#6B6B6B] hover:text-[#93321A] transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Items List */}
      <div ref={setDropRef} className="border-t border-white/[0.06]">
        {filteredItems.length === 0 && isFiltered ? (
          <div className="px-6 py-3 text-center">
            <span className="font-kosugi text-[11px] text-[#6B6B6B]">
              No matching items
            </span>
          </div>
        ) : (
          <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
            {filteredItems.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                onStatusChange={onStatusChange}
                onToggleVisibility={onToggleItemVisibility}
                onUpdate={onUpdateItem}
                onDelete={onDeleteItem}
              />
            ))}
          </SortableContext>
        )}

        {/* Add Item Form */}
        {showAddItem ? (
          <NewItemForm
            onSubmit={(title, desc, icon, status, slug) => {
              onCreateItem(category.id, title, desc, icon, status, slug);
              setShowAddItem(false);
            }}
            onCancel={() => setShowAddItem(false)}
          />
        ) : (
          !isFiltered && (
            <button
              onClick={() => setShowAddItem(true)}
              className="flex items-center gap-2 px-6 py-2.5 w-full text-[#6B6B6B] hover:text-[#E5E5E5] hover:bg-white/[0.02] transition-colors"
            >
              <Plus className="w-3 h-3" />
              <span className="font-mohave text-[11px] uppercase tracking-wider">Add Item</span>
            </button>
          )
        )}
      </div>
    </div>
  );
}
