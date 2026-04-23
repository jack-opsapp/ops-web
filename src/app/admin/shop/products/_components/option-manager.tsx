"use client";

import { useState } from "react";
import { Plus, X, GripVertical } from "lucide-react";
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

export interface EditorOption {
  id?: string;
  name: string;
  values: { id?: string; value: string }[];
}

interface OptionManagerProps {
  options: EditorOption[];
  onChange: (options: EditorOption[]) => void;
}

/** Stable ID for dnd-kit — uses existing DB id or a generated key */
function optionKey(opt: EditorOption, index: number): string {
  return opt.id ?? `new-${index}`;
}

function SortableOptionCard({
  opt,
  index,
  onUpdateName,
  onRemove,
  onAddValue,
  onRemoveValue,
}: {
  opt: EditorOption;
  index: number;
  onUpdateName: (index: number, name: string) => void;
  onRemove: (index: number) => void;
  onAddValue: (optionIndex: number, value: string) => void;
  onRemoveValue: (optionIndex: number, valueIndex: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: optionKey(opt, index),
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="mb-4 border border-white/[0.08] rounded-sm p-4"
    >
      <div className="flex items-center gap-3 mb-3">
        <button
          {...attributes}
          {...listeners}
          className="text-[#6B6B6B] cursor-grab active:cursor-grabbing"
        >
          <GripVertical size={14} />
        </button>
        <input
          type="text"
          value={opt.name}
          onChange={(e) => onUpdateName(index, e.target.value)}
          className="flex-1 bg-white/[0.04] border border-white/[0.08] rounded-sm px-3 py-1.5 font-mohave text-[13px] text-[#EDEDED] focus:border-[#6F94B0] focus:outline-none"
          placeholder="Option name (e.g., Size)"
        />
        <button
          onClick={() => onRemove(index)}
          className="p-1.5 rounded-sm text-[#6B6B6B] hover:text-red-400 hover:bg-red-500/10 transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      <div className="flex flex-wrap gap-2 ml-7">
        {opt.values.map((val, vi) => (
          <span
            key={vi}
            className="flex items-center gap-1.5 px-2.5 py-1 bg-white/[0.04] border border-white/[0.08] rounded-sm font-mohave text-[12px] text-[#EDEDED]"
          >
            {val.value}
            <button
              onClick={() => onRemoveValue(index, vi)}
              className="text-[#6B6B6B] hover:text-red-400 transition-colors"
            >
              <X size={10} />
            </button>
          </span>
        ))}
        <ValueInput onAdd={(v) => onAddValue(index, v)} />
      </div>
    </div>
  );
}

export function OptionManager({ options, onChange }: OptionManagerProps) {
  const [addingOption, setAddingOption] = useState(false);
  const [newOptionName, setNewOptionName] = useState("");

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = options.findIndex((o, i) => optionKey(o, i) === active.id);
    const newIndex = options.findIndex((o, i) => optionKey(o, i) === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    onChange(arrayMove(options, oldIndex, newIndex));
  }

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

  const sortableIds = options.map((o, i) => optionKey(o, i));

  return (
    <div>
      <p className="font-mono text-[11px] uppercase tracking-widest text-[#6B6B6B] mb-3">
        Options
      </p>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
          {options.map((opt, oi) => (
            <SortableOptionCard
              key={optionKey(opt, oi)}
              opt={opt}
              index={oi}
              onUpdateName={updateOptionName}
              onRemove={removeOption}
              onAddValue={addValue}
              onRemoveValue={removeValue}
            />
          ))}
        </SortableContext>
      </DndContext>

      {addingOption ? (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newOptionName}
            onChange={(e) => setNewOptionName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addOption()}
            placeholder="Option name..."
            autoFocus
            className="bg-white/[0.04] border border-white/[0.08] rounded-sm px-3 py-1.5 font-mohave text-[13px] text-[#EDEDED] focus:border-[#6F94B0] focus:outline-none"
          />
          <button
            onClick={addOption}
            className="px-3 py-1.5 bg-ops-accent rounded-sm font-mono text-[11px] uppercase tracking-widest text-white"
          >
            Add
          </button>
          <button
            onClick={() => { setAddingOption(false); setNewOptionName(""); }}
            className="px-3 py-1.5 font-mono text-[11px] uppercase tracking-widest text-[#6B6B6B]"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setAddingOption(true)}
          className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-widest text-[#6B6B6B] hover:text-[#EDEDED] transition-colors"
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
      className="w-20 bg-transparent border-b border-white/[0.08] px-1 py-1 font-mohave text-[12px] text-[#6B6B6B] focus:text-[#EDEDED] focus:border-[#6F94B0] focus:outline-none placeholder:text-[#6B6B6B]/50"
    />
  );
}
