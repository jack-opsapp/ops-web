"use client";

interface MetricsToggleProps {
  isVisible: boolean;
  onToggle: () => void;
}

export function MetricsToggle({ isVisible, onToggle }: MetricsToggleProps) {
  return (
    <button
      onClick={onToggle}
      aria-label={isVisible ? "Hide metrics" : "Show metrics"}
      aria-live="polite"
      className="flex items-center gap-1 cursor-pointer font-kosugi bg-transparent border border-white/[0.06] rounded-sm text-micro-xs uppercase tracking-[1px] text-[#6B6B6B]"
      style={{ padding: isVisible ? "3px 6px" : "3px 8px" }}
    >
      {isVisible ? "✕" : (
        <>
          <span className="text-[8px]">▼</span>
          <span>Metrics</span>
        </>
      )}
    </button>
  );
}
