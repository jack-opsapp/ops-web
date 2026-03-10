"use client";

import { useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { CURATED_COLORS, type ColorFamily } from "@/lib/data/curated-colors";

const FAMILY_LABELS: Record<ColorFamily, string> = {
  warm: "Warm",
  neutral: "Neutral",
  earth: "Earth",
  cool: "Cool",
  muted: "Muted",
};

const FAMILY_ORDER: ColorFamily[] = ["warm", "neutral", "earth", "cool", "muted"];

interface ColorPickerPopoverProps {
  selectedColor: string;
  onSelect: (hex: string) => void;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
}

export function ColorPickerPopover({
  selectedColor,
  onSelect,
  onClose,
  anchorRef,
}: ColorPickerPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose, anchorRef]);

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // Group colors by family
  const grouped = FAMILY_ORDER.map((family) => ({
    family,
    label: FAMILY_LABELS[family],
    colors: CURATED_COLORS.filter((c) => c.family === family),
  }));

  return (
    <motion.div
      ref={popoverRef}
      initial={{ opacity: 0, scale: 0.95, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: -4 }}
      transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
      className="absolute z-50 top-full mt-[6px] left-0 w-[240px] p-[10px] rounded border border-[rgba(255,255,255,0.08)] shadow-lg"
      style={{
        background: "rgba(10, 10, 10, 0.85)",
        backdropFilter: "blur(20px) saturate(1.2)",
        WebkitBackdropFilter: "blur(20px) saturate(1.2)",
      }}
    >
      {grouped.map(({ family, label, colors }) => (
        <div key={family} className="mb-[8px] last:mb-0">
          <span className="font-kosugi text-[9px] text-text-disabled uppercase tracking-widest mb-[4px] block">
            {label}
          </span>
          <div className="flex flex-wrap gap-[6px]">
            {colors.map((color) => {
              const isSelected = color.hex.toLowerCase() === selectedColor.toLowerCase();
              return (
                <button
                  key={color.hex}
                  type="button"
                  onClick={() => {
                    onSelect(color.hex);
                    onClose();
                  }}
                  title={`${color.name} — ${color.source}`}
                  className="relative w-[20px] h-[20px] rounded-sm transition-transform hover:scale-110 focus:outline-none"
                  style={{ backgroundColor: color.hex }}
                >
                  {isSelected && (
                    <motion.div
                      layoutId="color-ring"
                      className="absolute inset-[-3px] rounded-sm border-2 border-white pointer-events-none"
                      transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <div className="mt-[8px] pt-[6px] border-t border-[rgba(255,255,255,0.06)]">
        <span className="font-kosugi text-[9px] text-text-disabled">
          Colors from Farrow & Ball, Benjamin Moore, Sherwin-Williams
        </span>
      </div>
    </motion.div>
  );
}
