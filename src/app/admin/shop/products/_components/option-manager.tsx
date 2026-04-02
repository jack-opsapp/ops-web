"use client";

import { useState } from "react";
import { Plus, X, GripVertical } from "lucide-react";

export interface EditorOption {
  id?: string;
  name: string;
  values: { id?: string; value: string }[];
}

interface OptionManagerProps {
  options: EditorOption[];
  onChange: (options: EditorOption[]) => void;
}

export function OptionManager({ options, onChange }: OptionManagerProps) {
  const [addingOption, setAddingOption] = useState(false);
  const [newOptionName, setNewOptionName] = useState("");

  function addOption() {
    if (!newOptionName.trim()) return;
    onChange([...options, { name: newOptionName.trim(), values: [] }]);
    setNewOptionName("");
    setAddingOption(false);
  }

  function removeOption(index: number) {
    onChange(options.filter((_, i) => i !== index));
  }

  function updateOptionName(index: number, name: string) {
    const updated = [...options];
    updated[index] = { ...updated[index], name };
    onChange(updated);
  }

  function addValue(optionIndex: number, value: string) {
    if (!value.trim()) return;
    const updated = [...options];
    updated[optionIndex] = {
      ...updated[optionIndex],
      values: [...updated[optionIndex].values, { value: value.trim() }],
    };
    onChange(updated);
  }

  function removeValue(optionIndex: number, valueIndex: number) {
    const updated = [...options];
    updated[optionIndex] = {
      ...updated[optionIndex],
      values: updated[optionIndex].values.filter((_, i) => i !== valueIndex),
    };
    onChange(updated);
  }

  return (
    <div>
      <p className="font-kosugi text-[11px] uppercase tracking-widest text-[#6B6B6B] mb-3">
        Options
      </p>

      {options.map((opt, oi) => (
        <div key={oi} className="mb-4 border border-white/[0.08] rounded-sm p-4">
          <div className="flex items-center gap-3 mb-3">
            <GripVertical size={14} className="text-[#6B6B6B] cursor-grab" />
            <input
              type="text"
              value={opt.name}
              onChange={(e) => updateOptionName(oi, e.target.value)}
              className="flex-1 bg-white/[0.04] border border-white/[0.08] rounded-sm px-3 py-1.5 font-mohave text-[13px] text-[#E5E5E5] focus:border-[#597794] focus:outline-none"
              placeholder="Option name (e.g., Size)"
            />
            <button
              onClick={() => removeOption(oi)}
              className="p-1.5 rounded-sm text-[#6B6B6B] hover:text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <X size={14} />
            </button>
          </div>

          <div className="flex flex-wrap gap-2 ml-7">
            {opt.values.map((val, vi) => (
              <span
                key={vi}
                className="flex items-center gap-1.5 px-2.5 py-1 bg-white/[0.04] border border-white/[0.08] rounded-sm font-mohave text-[12px] text-[#E5E5E5]"
              >
                {val.value}
                <button
                  onClick={() => removeValue(oi, vi)}
                  className="text-[#6B6B6B] hover:text-red-400 transition-colors"
                >
                  <X size={10} />
                </button>
              </span>
            ))}
            <ValueInput onAdd={(v) => addValue(oi, v)} />
          </div>
        </div>
      ))}

      {addingOption ? (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newOptionName}
            onChange={(e) => setNewOptionName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addOption()}
            placeholder="Option name..."
            autoFocus
            className="bg-white/[0.04] border border-white/[0.08] rounded-sm px-3 py-1.5 font-mohave text-[13px] text-[#E5E5E5] focus:border-[#597794] focus:outline-none"
          />
          <button
            onClick={addOption}
            className="px-3 py-1.5 bg-[#597794] rounded-sm font-kosugi text-[11px] uppercase tracking-widest text-white"
          >
            Add
          </button>
          <button
            onClick={() => { setAddingOption(false); setNewOptionName(""); }}
            className="px-3 py-1.5 font-kosugi text-[11px] uppercase tracking-widest text-[#6B6B6B]"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setAddingOption(true)}
          className="flex items-center gap-1.5 font-kosugi text-[11px] uppercase tracking-widest text-[#6B6B6B] hover:text-[#E5E5E5] transition-colors"
        >
          <Plus size={14} /> Add Option
        </button>
      )}
    </div>
  );
}

/** Inline value input that submits on Enter */
function ValueInput({ onAdd }: { onAdd: (value: string) => void }) {
  const [value, setValue] = useState("");

  return (
    <input
      type="text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && value.trim()) {
          onAdd(value.trim());
          setValue("");
        }
      }}
      placeholder="+ value"
      className="w-20 bg-transparent border-b border-white/[0.08] px-1 py-1 font-mohave text-[12px] text-[#6B6B6B] focus:text-[#E5E5E5] focus:border-[#597794] focus:outline-none placeholder:text-[#6B6B6B]/50"
    />
  );
}
