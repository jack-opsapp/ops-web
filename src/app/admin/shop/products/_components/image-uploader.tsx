"use client";

import { useState, useCallback } from "react";
import Image from "next/image";
import { Upload, X, GripVertical } from "lucide-react";
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
  horizontalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface ImageUploaderProps {
  images: string[];
  onChange: (images: string[]) => void;
}

function SortableImage({
  url,
  index,
  onRemove,
}: {
  url: string;
  index: number;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: url,
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
      className="relative group w-24 h-24 flex-shrink-0 rounded-sm border border-white/[0.08] overflow-hidden"
    >
      <Image src={url} alt="" fill className="object-cover" sizes="96px" />
      {index === 0 && (
        <span className="absolute top-1 left-1 px-1.5 py-0.5 bg-ops-accent/80 rounded-sm font-mono text-micro uppercase tracking-widest text-white">
          Primary
        </span>
      )}
      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
        <button
          {...attributes}
          {...listeners}
          className="p-1 rounded-sm bg-white/20 hover:bg-white/30 transition-colors cursor-grab"
        >
          <GripVertical size={14} className="text-white" />
        </button>
        <button
          onClick={onRemove}
          className="p-1 rounded-sm bg-red-500/40 hover:bg-red-500/60 transition-colors"
        >
          <X size={14} className="text-white" />
        </button>
      </div>
    </div>
  );
}

export function ImageUploader({ images, onChange }: ImageUploaderProps) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleUpload = useCallback(
    async (files: FileList | File[]) => {
      setUploading(true);
      const newUrls: string[] = [];

      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append("file", file);

        try {
          const res = await fetch("/api/admin/shop/upload", {
            method: "POST",
            body: formData,
          });
          const data = await res.json();
          if (data.url) newUrls.push(data.url);
        } catch (err) {
          console.error("Upload failed:", err);
        }
      }

      onChange([...images, ...newUrls]);
      setUploading(false);
    },
    [images, onChange]
  );

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) handleUpload(e.dataTransfer.files);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = images.indexOf(active.id as string);
    const newIndex = images.indexOf(over.id as string);
    onChange(arrayMove(images, oldIndex, newIndex));
  }

  return (
    <div>
      <p className="font-mono text-[11px] uppercase tracking-widest text-[#6B6B6B] mb-3">
        Images
      </p>

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-sm p-6 text-center mb-4 transition-colors ${
          dragOver ? "border-[#597794] bg-ops-accent/5" : "border-white/[0.08] bg-white/[0.02]"
        }`}
      >
        <Upload size={20} className="mx-auto mb-2 text-[#6B6B6B]" />
        <p className="font-mohave text-[13px] text-[#6B6B6B] mb-2">
          {uploading ? "Uploading..." : "Drop images here or click to browse"}
        </p>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          onChange={(e) => e.target.files?.length && handleUpload(e.target.files)}
          className="hidden"
          id="shop-image-upload"
        />
        <label
          htmlFor="shop-image-upload"
          className="inline-block px-4 py-1.5 border border-white/[0.12] rounded-sm font-mono text-[11px] uppercase tracking-widest text-[#6B6B6B] hover:text-[#E5E5E5] cursor-pointer transition-colors"
        >
          Browse
        </label>
      </div>

      {/* Image grid with reorder */}
      {images.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={images} strategy={horizontalListSortingStrategy}>
            <div className="flex gap-3 flex-wrap">
              {images.map((url, i) => (
                <SortableImage
                  key={url}
                  url={url}
                  index={i}
                  onRemove={() => onChange(images.filter((_, idx) => idx !== i))}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}
