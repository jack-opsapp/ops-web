"use client";

/**
 * OPS Web - Image Upload Components
 *
 * Reusable single and multi-image upload components with
 * drag-and-drop, previews, loading states, and error display.
 */

import { useCallback, useRef } from "react";
import {
  Upload,
  X,
  Image as ImageIcon,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import {
  useImageUpload,
  useMultiImageUpload,
} from "@/lib/hooks/use-image-upload";

// ─── Single Image Upload ────────────────────────────────────────────────────

interface SingleImageUploadProps {
  value?: string | null;
  onChange?: (url: string | null) => void;
  className?: string;
  label?: string;
  size?: "sm" | "md" | "lg";
}

export function ImageUpload({
  value,
  onChange,
  className,
  label,
  size = "md",
}: SingleImageUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { selectFile, preview, clearPreview, isUploading, error, uploadedUrl } =
    useImageUpload({
      onSuccess: (url) => onChange?.(url),
    });

  const displayUrl = uploadedUrl || value;
  const displayPreview = preview || (displayUrl ? displayUrl : null);

  const sizeClasses = {
    sm: "w-[64px] h-[64px]",
    md: "w-[120px] h-[120px]",
    lg: "w-[200px] h-[200px]",
  };

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) selectFile(file);
    },
    [selectFile]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) selectFile(file);
    },
    [selectFile]
  );

  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      {label && (
        <label className="font-kosugi text-caption-sm text-text-secondary uppercase tracking-widest">
          {label}
        </label>
      )}
      <div
        className={cn(
          sizeClasses[size],
          "relative rounded-lg border-2 border-dashed border-border",
          "flex items-center justify-center overflow-hidden cursor-pointer",
          "hover:border-ops-accent transition-colors group",
          isUploading && "pointer-events-none",
          error && "border-ops-error"
        )}
        onClick={() => inputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
      >
        {displayPreview ? (
          <>
            <img
              src={displayPreview}
              alt=""
              className="w-full h-full object-cover"
            />
            {isUploading && (
              <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                <Loader2 className="w-[24px] h-[24px] text-ops-accent animate-spin" />
              </div>
            )}
            {!isUploading && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onChange?.(null);
                  clearPreview();
                }}
                className="absolute top-1 right-1 w-[20px] h-[20px] rounded-full bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="w-[12px] h-[12px] text-white" />
              </button>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center gap-[4px] text-text-disabled group-hover:text-text-tertiary transition-colors">
            <Upload className="w-[20px] h-[20px]" />
            <span className="font-kosugi text-[10px]">Upload</span>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic"
          className="hidden"
          onChange={handleFileSelect}
        />
      </div>
      {error && (
        <div className="flex items-center gap-[4px] text-ops-error">
          <AlertCircle className="w-[12px] h-[12px]" />
          <span className="font-kosugi text-[10px]">{error.message}</span>
        </div>
      )}
    </div>
  );
}

// ─── Multiple Image Upload ──────────────────────────────────────────────────

interface MultiImageUploadProps {
  values?: string[];
  onChange?: (urls: string[]) => void;
  className?: string;
  label?: string;
  maxFiles?: number;
}

export function MultiImageUpload({
  values = [],
  onChange,
  className,
  label,
  maxFiles = 10,
}: MultiImageUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { selectFiles, previews, isUploading, error } = useMultiImageUpload({
    onSuccess: (urls) => onChange?.([...values, ...urls]),
  });

  const allImages = [
    ...values,
    ...previews.filter((p) => !values.includes(p)),
  ];

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      const remaining = maxFiles - values.length;
      if (remaining > 0) {
        selectFiles(files.slice(0, remaining));
      }
    },
    [selectFiles, maxFiles, values.length]
  );

  const removeImage = useCallback(
    (index: number) => {
      const newValues = values.filter((_, i) => i !== index);
      onChange?.(newValues);
    },
    [values, onChange]
  );

  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      {label && (
        <label className="font-kosugi text-caption-sm text-text-secondary uppercase tracking-widest">
          {label}
        </label>
      )}
      <div className="flex flex-wrap gap-1">
        {allImages.map((url, i) => (
          <div
            key={`${url}-${i}`}
            className="relative w-[80px] h-[80px] rounded-lg overflow-hidden border border-border group"
          >
            <img src={url} alt="" className="w-full h-full object-cover" />
            <button
              onClick={() => removeImage(i)}
              className="absolute top-[2px] right-[2px] w-[18px] h-[18px] rounded-full bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <X className="w-[10px] h-[10px] text-white" />
            </button>
          </div>
        ))}
        {values.length < maxFiles && (
          <button
            onClick={() => inputRef.current?.click()}
            className={cn(
              "w-[80px] h-[80px] rounded-lg border-2 border-dashed border-border",
              "flex flex-col items-center justify-center gap-[2px]",
              "text-text-disabled hover:text-text-tertiary hover:border-ops-accent",
              "transition-colors cursor-pointer",
              isUploading && "pointer-events-none"
            )}
          >
            {isUploading ? (
              <Loader2 className="w-[18px] h-[18px] animate-spin" />
            ) : (
              <>
                <ImageIcon className="w-[18px] h-[18px]" />
                <span className="font-kosugi text-[9px]">Add</span>
              </>
            )}
          </button>
        )}
      </div>
      {error && (
        <div className="flex items-center gap-[4px] text-ops-error">
          <AlertCircle className="w-[12px] h-[12px]" />
          <span className="font-kosugi text-[10px]">{error.message}</span>
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic"
        multiple
        className="hidden"
        onChange={handleFileSelect}
      />
    </div>
  );
}
