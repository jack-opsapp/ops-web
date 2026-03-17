"use client";

import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  GripVertical, Eye, EyeOff, Edit2, Trash2, Check, X,
} from "lucide-react";
import { StatusChipBar } from "./status-chip-bar";
import type { WhatsNewItem } from "./types";

interface ItemRowProps {
  item: WhatsNewItem;
  onStatusChange: (id: string, status: string) => void;
  onToggleVisibility: (id: string, isActive: boolean) => void;
  onUpdate: (id: string, updates: Partial<WhatsNewItem>) => void;
  onDelete: (id: string) => void;
}

export function ItemRow({
  item,
  onStatusChange,
  onToggleVisibility,
  onUpdate,
  onDelete,
}: ItemRowProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(item.title);
  const [editDescription, setEditDescription] = useState(item.description);
  const [editIcon, setEditIcon] = useState(item.icon);
  const [editStatus, setEditStatus] = useState(item.status);
  const [editSlug, setEditSlug] = useState(item.feature_flag_slug ?? "");

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const handleStartEdit = () => {
    setEditTitle(item.title);
    setEditDescription(item.description);
    setEditIcon(item.icon);
    setEditStatus(item.status);
    setEditSlug(item.feature_flag_slug ?? "");
    setIsEditing(true);
  };

  const handleSaveEdit = () => {
    onUpdate(item.id, {
      title: editTitle,
      description: editDescription,
      icon: editIcon,
      status: editStatus,
      feature_flag_slug: editSlug || null,
    });
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className="px-6 py-3 border-b border-white/[0.04] space-y-2 bg-white/[0.02]"
      >
        <div className="grid grid-cols-[80px_1fr] gap-2">
          <input
            value={editIcon}
            onChange={(e) => setEditIcon(e.target.value)}
            placeholder="icon"
            className="bg-white/[0.05] border border-white/[0.08] rounded px-2 py-1.5 font-mono text-[11px] text-[#E5E5E5] outline-none"
          />
          <input
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            placeholder="Title"
            className="bg-white/[0.05] border border-white/[0.08] rounded px-2 py-1.5 font-kosugi text-[12px] text-[#E5E5E5] outline-none"
            autoFocus
          />
        </div>
        <textarea
          value={editDescription}
          onChange={(e) => setEditDescription(e.target.value)}
          placeholder="Description"
          rows={2}
          className="w-full bg-white/[0.05] border border-white/[0.08] rounded px-2 py-1.5 font-kosugi text-[12px] text-[#E5E5E5] outline-none resize-none"
        />
        <div className="flex items-center gap-3">
          <StatusChipBar currentStatus={editStatus} onStatusChange={setEditStatus} />
          <input
            value={editSlug}
            onChange={(e) => setEditSlug(e.target.value)}
            placeholder="feature_flag_slug (optional)"
            className="flex-1 bg-white/[0.05] border border-white/[0.08] rounded px-2 py-1.5 font-mono text-[11px] text-[#E5E5E5] outline-none"
          />
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={() => setIsEditing(false)}
            className="px-3 py-1.5 font-mohave text-[11px] uppercase text-[#6B6B6B] hover:text-[#E5E5E5]"
          >
            Cancel
          </button>
          <button
            onClick={handleSaveEdit}
            className="flex items-center gap-1 px-3 py-1.5 bg-[#9DB582]/20 border border-[#9DB582]/30 rounded font-mohave text-[11px] uppercase text-[#9DB582] hover:bg-[#9DB582]/30"
          >
            <Check className="w-3 h-3" /> Save
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center justify-between px-4 py-2.5 border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors ${
        !item.is_active ? "opacity-50" : ""
      } ${isDragging ? "opacity-60 border-[#597794]/40 bg-white/[0.03]" : ""}`}
    >
      {/* Left zone: drag handle + icon + title */}
      <div className="flex items-center gap-3 min-w-0 flex-shrink-0">
        <button
          {...attributes}
          {...listeners}
          className="text-[#6B6B6B] hover:text-[#A0A0A0] cursor-grab active:cursor-grabbing flex-shrink-0 touch-none"
        >
          <GripVertical className="w-4 h-4" />
        </button>
        <span className="font-mono text-[10px] text-[#6B6B6B] w-12 truncate flex-shrink-0">
          {item.icon}
        </span>
        <span className="font-kosugi text-[13px] text-[#E5E5E5] truncate">
          {item.title}
        </span>
        {item.feature_flag_slug && (
          <span className="ml-1 font-mono text-[10px] text-[#597794] bg-[#597794]/10 px-1.5 py-0.5 rounded flex-shrink-0">
            {item.feature_flag_slug}
          </span>
        )}
      </div>

      {/* Center zone: status chips */}
      <div className="flex-shrink-0 mx-4">
        <StatusChipBar
          currentStatus={item.status}
          onStatusChange={(status) => onStatusChange(item.id, status)}
        />
      </div>

      {/* Right zone: actions */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={() => onToggleVisibility(item.id, !item.is_active)}
          className="text-[#6B6B6B] hover:text-[#E5E5E5] transition-colors"
          title={item.is_active ? "Hide" : "Show"}
        >
          {item.is_active ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
        </button>
        <button
          onClick={handleStartEdit}
          className="text-[#6B6B6B] hover:text-[#597794] transition-colors"
        >
          <Edit2 className="w-3 h-3" />
        </button>
        <button
          onClick={() => {
            if (confirm("Delete this item?")) onDelete(item.id);
          }}
          className="text-[#6B6B6B] hover:text-[#93321A] transition-colors"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}
