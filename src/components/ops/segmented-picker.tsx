"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils/cn";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SegmentedPickerOption<T extends string = string> {
  value: T;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
}

export interface SegmentedPickerProps<T extends string = string> {
  options: SegmentedPickerOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Show only icons (no labels) */
  iconOnly?: boolean;
  className?: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function SegmentedPicker<T extends string = string>({
  options,
  value,
  onChange,
  iconOnly = false,
  className,
}: SegmentedPickerProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [underlineStyle, setUnderlineStyle] = useState({ left: 0, width: 0 });

  const updateUnderline = useCallback(() => {
    const el = itemRefs.current.get(value);
    const container = containerRef.current;
    if (el && container) {
      const containerRect = container.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      setUnderlineStyle({
        left: elRect.left - containerRect.left,
        width: elRect.width,
      });
    }
  }, [value]);

  useEffect(() => {
    updateUnderline();
  }, [updateUnderline]);

  // Update on resize
  useEffect(() => {
    const observer = new ResizeObserver(() => updateUnderline());
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [updateUnderline]);

  return (
    <div
      ref={containerRef}
      className={cn("relative flex items-center gap-0", className)}
    >
      {options.map((option) => {
        const isActive = value === option.value;
        const Icon = option.icon;

        return (
          <button
            key={option.value}
            ref={(el) => {
              if (el) itemRefs.current.set(option.value, el);
            }}
            onClick={() => onChange(option.value)}
            className={cn(
              "relative flex items-center justify-center gap-[6px] transition-colors duration-200",
              iconOnly ? "px-[10px] py-[8px]" : "px-1.5 py-[8px]",
              isActive
                ? "text-text-primary"
                : "text-text-tertiary hover:text-text-secondary"
            )}
          >
            {Icon && <Icon className="w-[16px] h-[16px]" />}
            {!iconOnly && (
              <span className="font-mohave text-body-sm whitespace-nowrap">
                {option.label}
              </span>
            )}
          </button>
        );
      })}

      {/* Sliding underline */}
      <div
        className="absolute bottom-0 h-[2px] bg-text-primary rounded-full transition-all duration-200 ease-out"
        style={{
          left: underlineStyle.left,
          width: underlineStyle.width,
        }}
      />
    </div>
  );
}
