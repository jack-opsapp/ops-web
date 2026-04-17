"use client";

import { useState } from "react";
import { StatusChipBar } from "./status-chip-bar";

interface NewItemFormProps {
  onSubmit: (
    title: string,
    description: string,
    icon: string,
    status: string,
    featureFlagSlug: string
  ) => void;
  onCancel: () => void;
}

export function NewItemForm({ onSubmit, onCancel }: NewItemFormProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("star");
  const [status, setStatus] = useState("planned");
  const [slug, setSlug] = useState("");

  return (
    <div className="px-6 py-3 border-t border-[#597794]/20 bg-ops-accent/5 space-y-2">
      <div className="grid grid-cols-[80px_1fr] gap-2">
        <input
          value={icon}
          onChange={(e) => setIcon(e.target.value)}
          placeholder="icon"
          className="bg-white/[0.05] border border-white/[0.08] rounded px-2 py-1.5 font-mono text-[11px] text-[#E5E5E5] outline-none"
        />
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          className="bg-white/[0.05] border border-white/[0.08] rounded px-2 py-1.5 font-mono text-[12px] text-[#E5E5E5] outline-none"
          autoFocus
        />
      </div>
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Description"
        rows={2}
        className="w-full bg-white/[0.05] border border-white/[0.08] rounded px-2 py-1.5 font-mono text-[12px] text-[#E5E5E5] outline-none resize-none"
      />
      <div className="flex items-center gap-3">
        <StatusChipBar currentStatus={status} onStatusChange={setStatus} />
        <input
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="feature_flag_slug (optional)"
          className="flex-1 bg-white/[0.05] border border-white/[0.08] rounded px-2 py-1.5 font-mono text-[11px] text-[#E5E5E5] outline-none"
        />
      </div>
      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 font-mohave text-[11px] uppercase text-[#6B6B6B] hover:text-[#E5E5E5]"
        >
          Cancel
        </button>
        <button
          onClick={() => title && onSubmit(title, description, icon, status, slug)}
          disabled={!title}
          className="px-3 py-1.5 bg-ops-accent rounded font-mohave text-[11px] uppercase text-white hover:bg-ops-accent/80 disabled:opacity-40"
        >
          Create
        </button>
      </div>
    </div>
  );
}
