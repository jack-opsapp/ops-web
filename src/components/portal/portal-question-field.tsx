"use client";

import { useState } from "react";
import { Check } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type QuestionAnswerType = "text" | "select" | "multiselect" | "color" | "number";

export interface PortalQuestionFieldProps {
  questionId: string;
  questionText: string;
  answerType: QuestionAnswerType;
  options: string[];
  isRequired: boolean;
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
}

// ─── Color Swatch ─────────────────────────────────────────────────────────────

/** Known color names mapped to hex values for rendering swatches */
const COLOR_MAP: Record<string, string> = {
  red: "#EF4444",
  blue: "#3B82F6",
  green: "#22C55E",
  yellow: "#EAB308",
  orange: "#F97316",
  purple: "#A855F7",
  pink: "#EC4899",
  black: "#111111",
  white: "#FFFFFF",
  gray: "#6B7280",
  grey: "#6B7280",
  brown: "#92400E",
  navy: "#1E3A5F",
  teal: "#14B8A6",
  beige: "#D4C5A9",
  tan: "#D2B48C",
  cream: "#FFFDD0",
  gold: "#FFD700",
  silver: "#C0C0C0",
  charcoal: "#36454F",
};

function resolveColor(option: string): string | null {
  // If it looks like a hex code, use it directly
  if (/^#[0-9a-fA-F]{3,8}$/.test(option.trim())) {
    return option.trim();
  }
  // Check known color names
  return COLOR_MAP[option.trim().toLowerCase()] ?? null;
}

// ─── Input Styles ─────────────────────────────────────────────────────────────

const inputBaseStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: "var(--portal-radius, 8px)",
  border: "1px solid var(--portal-border)",
  backgroundColor: "var(--portal-bg)",
  color: "var(--portal-text)",
  fontSize: "14px",
  lineHeight: "1.5",
  outline: "none",
  transition: "border-color 0.15s ease",
};

const inputFocusColor = "var(--portal-accent)";

// ─── Component ────────────────────────────────────────────────────────────────

export function PortalQuestionField({
  questionId,
  questionText,
  answerType,
  options,
  isRequired,
  value,
  onChange,
  error,
}: PortalQuestionFieldProps) {
  const [focused, setFocused] = useState(false);

  const currentStyle: React.CSSProperties = {
    ...inputBaseStyle,
    borderColor: error
      ? "var(--portal-error)"
      : focused
        ? inputFocusColor
        : "var(--portal-border)",
  };

  return (
    <div style={{ marginBottom: "20px" }}>
      {/* Label */}
      <label
        htmlFor={questionId}
        className="block text-sm font-medium"
        style={{
          marginBottom: "6px",
          color: "var(--portal-text)",
        }}
      >
        {questionText}
        {isRequired && (
          <span
            style={{
              color: "var(--portal-error)",
              marginLeft: "4px",
              fontSize: "12px",
            }}
          >
            Required
          </span>
        )}
      </label>

      {/* Text */}
      {answerType === "text" && (
        <input
          id={questionId}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={currentStyle}
          placeholder="Your answer..."
        />
      )}

      {/* Number */}
      {answerType === "number" && (
        <input
          id={questionId}
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={currentStyle}
          placeholder="0"
        />
      )}

      {/* Select */}
      {answerType === "select" && (
        <select
          id={questionId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            ...currentStyle,
            cursor: "pointer",
            appearance: "none",
            backgroundImage:
              'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 12 12\'%3E%3Cpath fill=\'%236B7280\' d=\'M6 8.825L0.35 3.175l1.175-1.175L6 6.475 10.475 2l1.175 1.175z\'/%3E%3C/svg%3E")',
            backgroundRepeat: "no-repeat",
            backgroundPosition: "right 12px center",
            paddingRight: "36px",
          }}
        >
          <option value="">Select an option...</option>
          {options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      )}

      {/* Multiselect (checkbox group) */}
      {answerType === "multiselect" && (
        <div className="space-y-2" style={{ marginTop: "4px" }}>
          {options.map((opt) => {
            const selectedValues = value ? value.split(",").map((v) => v.trim()).filter(Boolean) : [];
            const isChecked = selectedValues.includes(opt);

            function toggle() {
              const next = isChecked
                ? selectedValues.filter((v) => v !== opt)
                : [...selectedValues, opt];
              onChange(next.join(", "));
            }

            return (
              <button
                type="button"
                key={opt}
                onClick={toggle}
                className="flex items-center gap-3 cursor-pointer rounded-lg w-full text-left"
                style={{
                  padding: "8px 12px",
                  border: "1px solid",
                  borderColor: isChecked
                    ? "var(--portal-accent)"
                    : "var(--portal-border)",
                  backgroundColor: isChecked
                    ? "rgba(var(--portal-accent-rgb, 65,115,148), 0.08)"
                    : "transparent",
                  borderRadius: "var(--portal-radius, 8px)",
                  transition: "all 0.15s ease",
                }}
              >
                <div
                  className="flex items-center justify-center shrink-0"
                  style={{
                    width: "20px",
                    height: "20px",
                    borderRadius: "4px",
                    border: "2px solid",
                    borderColor: isChecked
                      ? "var(--portal-accent)"
                      : "var(--portal-border-strong, var(--portal-border))",
                    backgroundColor: isChecked
                      ? "var(--portal-accent)"
                      : "transparent",
                    transition: "all 0.15s ease",
                  }}
                >
                  {isChecked && <Check className="w-3 h-3" style={{ color: "var(--portal-accent-text, #fff)" }} />}
                </div>
                <span className="text-sm" style={{ color: "var(--portal-text)" }}>
                  {opt}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Color */}
      {answerType === "color" && (
        <div>
          {/* Swatches if options exist */}
          {options.length > 0 ? (
            <div className="flex flex-wrap gap-3" style={{ marginTop: "4px" }}>
              {options.map((opt) => {
                const hex = resolveColor(opt);
                const isSelected = value === opt;

                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => onChange(opt)}
                    className="flex flex-col items-center gap-1.5"
                    style={{ background: "none", border: "none", cursor: "pointer", padding: "4px" }}
                    title={opt}
                  >
                    <div
                      style={{
                        width: "40px",
                        height: "40px",
                        borderRadius: "50%",
                        backgroundColor: hex ?? "var(--portal-text-tertiary)",
                        border: isSelected
                          ? "3px solid var(--portal-accent)"
                          : "2px solid var(--portal-border)",
                        boxShadow: isSelected
                          ? "0 0 0 2px var(--portal-bg), 0 0 0 4px var(--portal-accent)"
                          : "none",
                        transition: "all 0.15s ease",
                      }}
                    />
                    <span
                      className="text-xs"
                      style={{
                        color: isSelected
                          ? "var(--portal-accent)"
                          : "var(--portal-text-secondary)",
                        fontWeight: isSelected ? "600" : "400",
                      }}
                    >
                      {opt}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            /* Fallback: text input for free-form color entry */
            <input
              id={questionId}
              type="text"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              style={currentStyle}
              placeholder="Enter color (e.g., Navy Blue, #3B82F6)"
            />
          )}
        </div>
      )}

      {/* Error message */}
      {error && (
        <p
          className="text-xs mt-1"
          style={{ color: "var(--portal-error)" }}
        >
          {error}
        </p>
      )}
    </div>
  );
}
