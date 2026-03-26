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
      className="flex items-center gap-1 cursor-pointer font-kosugi"
      style={{
        background: "none",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: 3,
        padding: isVisible ? "3px 6px" : "3px 8px",
        color: "#6B6B6B",
        fontSize: 9,
        textTransform: "uppercase",
        letterSpacing: "1px",
      }}
    >
      {isVisible ? "✕" : (
        <>
          <span style={{ fontSize: 8 }}>▼</span>
          <span>Metrics</span>
        </>
      )}
    </button>
  );
}
