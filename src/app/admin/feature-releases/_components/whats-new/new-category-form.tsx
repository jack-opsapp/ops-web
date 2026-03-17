"use client";

import { useState } from "react";

interface NewCategoryFormProps {
  onSubmit: (name: string, icon: string) => void;
  onCancel: () => void;
}

export function NewCategoryForm({ onSubmit, onCancel }: NewCategoryFormProps) {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("star");

  return (
    <div className="border border-[#597794]/30 rounded-lg px-4 py-3 space-y-2">
      <div className="flex gap-2">
        <input
          value={icon}
          onChange={(e) => setIcon(e.target.value)}
          placeholder="icon"
          className="w-24 bg-white/[0.05] border border-white/[0.08] rounded px-2 py-1.5 font-mono text-[11px] text-[#E5E5E5] outline-none"
        />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Category name"
          className="flex-1 bg-white/[0.05] border border-white/[0.08] rounded px-2 py-1.5 font-mohave text-[14px] text-[#E5E5E5] outline-none"
          autoFocus
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
          onClick={() => name && onSubmit(name, icon)}
          disabled={!name}
          className="px-3 py-1.5 bg-[#597794] rounded font-mohave text-[11px] uppercase text-white hover:bg-[#597794]/80 disabled:opacity-40"
        >
          Create
        </button>
      </div>
    </div>
  );
}
