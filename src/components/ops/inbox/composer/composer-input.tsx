"use client";

import { forwardRef, useEffect, useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils/cn";

interface ComposerInputProps {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  /** Tints the body when an AI draft is loaded. */
  agentTinted?: boolean;
  /** Disables the textarea (used while sending). */
  disabled?: boolean;
  className?: string;
}

const MIN_HEIGHT = 20;
const MAX_HEIGHT = 144;

export const ComposerInput = forwardRef<
  HTMLTextAreaElement,
  ComposerInputProps
>(function ComposerInput(
  { value, onChange, onSubmit, placeholder, agentTinted, disabled, className },
  ref
) {
  const localRef = useRef<HTMLTextAreaElement | null>(null);

  function setRef(el: HTMLTextAreaElement | null) {
    localRef.current = el;
    if (typeof ref === "function") ref(el);
    else if (ref)
      (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = el;
  }

  useEffect(() => {
    const el = localRef.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.max(MIN_HEIGHT, Math.min(el.scrollHeight, MAX_HEIGHT));
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT ? "auto" : "hidden";
  }, [value]);

  function handleKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onSubmit();
    }
  }

  return (
    <textarea
      ref={setRef}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={handleKey}
      placeholder={placeholder}
      disabled={disabled}
      rows={1}
      className={cn(
        "w-full min-w-0 resize-none bg-transparent font-mohave text-[13px] leading-[1.45]",
        "max-h-[144px] min-h-[20px]",
        "placeholder:text-text-mute focus:outline-none",
        agentTinted ? "text-agent-text" : "text-text",
        className
      )}
    />
  );
});
