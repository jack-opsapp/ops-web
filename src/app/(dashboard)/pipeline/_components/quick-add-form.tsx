"use client";

import { useState, useRef, useEffect, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils/cn";
import { X, Check } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface QuickAddFormProps {
  onSubmit: (data: {
    title: string;
    contactName: string;
    estimatedValue?: number;
  }) => void;
  onCancel: () => void;
}

// ---------------------------------------------------------------------------
// Quick Add Form - Inline new lead form for the New Lead column
// ---------------------------------------------------------------------------
export function QuickAddForm({ onSubmit, onCancel }: QuickAddFormProps) {
  const [contactName, setContactName] = useState("");
  const [title, setTitle] = useState("");
  const [titleManuallyEdited, setTitleManuallyEdited] = useState(false);
  const [estimatedValue, setEstimatedValue] = useState("");
  const contactRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    contactRef.current?.focus();
  }, []);

  // Auto-generate title from contact name unless user manually edited it
  const handleContactNameChange = (value: string) => {
    setContactName(value);
    if (!titleManuallyEdited) {
      setTitle(value ? `${value} - Lead` : "");
    }
  };

  const handleTitleChange = (value: string) => {
    setTitle(value);
    setTitleManuallyEdited(true);
  };

  const handleSubmit = () => {
    if (!contactName.trim()) return;

    const finalTitle = title.trim() || `${contactName.trim()} - Lead`;
    const value = estimatedValue ? parseFloat(estimatedValue) : undefined;

    onSubmit({
      title: finalTitle,
      contactName: contactName.trim(),
      estimatedValue: value && !isNaN(value) ? value : undefined,
    });
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div
      className={cn(
        "bg-[rgba(13,13,13,0.6)] backdrop-blur-xl border border-ops-accent/40 rounded-[5px] p-1.5",
        "space-y-1 animate-scale-in"
      )}
      onKeyDown={handleKeyDown}
    >
      {/* Contact name */}
      <input
        ref={contactRef}
        type="text"
        placeholder="Contact name *"
        value={contactName}
        onChange={(e) => handleContactNameChange(e.target.value)}
        className={cn(
          "w-full bg-background-input text-text-primary font-mohave text-body-sm",
          "px-1 py-[5px] rounded border border-border",
          "placeholder:text-text-tertiary",
          "focus:border-ops-accent focus:outline-none"
        )}
      />

      {/* Deal title */}
      <input
        type="text"
        placeholder="Deal title"
        value={title}
        onChange={(e) => handleTitleChange(e.target.value)}
        className={cn(
          "w-full bg-background-input text-text-primary font-mohave text-body-sm",
          "px-1 py-[5px] rounded border border-border",
          "placeholder:text-text-tertiary",
          "focus:border-ops-accent focus:outline-none"
        )}
      />

      {/* Estimated value */}
      <input
        type="number"
        placeholder="Est. value ($)"
        value={estimatedValue}
        onChange={(e) => setEstimatedValue(e.target.value)}
        className={cn(
          "w-full bg-background-input text-text-primary font-mono text-[11px]",
          "px-1 py-[5px] rounded border border-border",
          "placeholder:text-text-tertiary",
          "focus:border-ops-accent focus:outline-none"
        )}
      />

      {/* Action buttons */}
      <div className="flex items-center justify-end gap-1 pt-0.5">
        <button
          onClick={onCancel}
          className={cn(
            "p-[4px] rounded",
            "text-text-disabled hover:text-text-tertiary hover:bg-[rgba(255,255,255,0.06)]",
            "transition-colors"
          )}
          title="Cancel (Esc)"
        >
          <X className="w-[14px] h-[14px]" />
        </button>
        <button
          onClick={handleSubmit}
          disabled={!contactName.trim()}
          className={cn(
            "p-[4px] rounded",
            "text-status-success hover:bg-status-success/10",
            "transition-colors",
            "disabled:opacity-30 disabled:cursor-not-allowed"
          )}
          title="Add Lead (Enter)"
        >
          <Check className="w-[14px] h-[14px]" />
        </button>
      </div>
    </div>
  );
}
