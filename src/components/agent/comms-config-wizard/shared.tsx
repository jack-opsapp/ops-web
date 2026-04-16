"use client";

/**
 * S2 Amendment — Comms Config Wizard shared primitives
 *
 * Primitives used by every wizard step:
 *   - StepShell: header + body + footer layout
 *   - OptionCard: selectable radio-card with left accent border when selected
 *   - Toggle: on/off switch (borders-only, no accent)
 *   - StepSlider: custom slider matching design-system (no default browser)
 *   - PreviewPanel: frosted sub-panel for email previews
 *
 * Every primitive respects prefers-reduced-motion via `motion-reduce:*`.
 */

import { type ReactNode } from "react";
import { Check, Lock } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";

// ─── StepShell ──────────────────────────────────────────────────────────────

export function StepShell({
  stepNumber,
  stepLabel,
  title,
  description,
  children,
}: {
  stepNumber: number;
  stepLabel: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="w-full max-w-[640px] mx-auto">
      <div className="mb-4">
        <span className="font-kosugi text-[11px] text-text-3 uppercase tracking-[0.12em]">
          [{stepLabel} · {String(stepNumber).padStart(2, "0")}]
        </span>
      </div>
      <h1 className="font-mohave text-[28px] leading-tight text-text uppercase tracking-[0.02em] mb-2">
        {title}
      </h1>
      <p className="font-kosugi text-[14px] text-text-2 leading-relaxed mb-6">
        [{description}]
      </p>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

// ─── OptionCard ─────────────────────────────────────────────────────────────

export function OptionCard({
  title,
  description,
  selected,
  disabled,
  recommended,
  locked,
  lockedReason,
  onSelect,
}: {
  title: string;
  description: string;
  selected: boolean;
  disabled?: boolean;
  recommended?: boolean;
  locked?: boolean;
  lockedReason?: string;
  onSelect: () => void;
}) {
  const { t } = useDictionary("comms-wizard");
  return (
    <button
      type="button"
      onClick={locked || disabled ? undefined : onSelect}
      disabled={locked || disabled}
      className={cn(
        "w-full text-left min-h-[56px] p-4 rounded-[8px]",
        "border-l-[3px]",
        "border-t border-r border-b",
        "backdrop-blur-[20px] backdrop-saturate-[1.2]",
        "transition-colors duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]",
        "motion-reduce:transition-none",
        selected
          ? "border-l-[#597794] border-t-[rgba(255,255,255,0.12)] border-r-[rgba(255,255,255,0.12)] border-b-[rgba(255,255,255,0.12)] bg-[rgba(89,119,148,0.08)]"
          : "border-l-transparent border-t-[rgba(255,255,255,0.08)] border-r-[rgba(255,255,255,0.08)] border-b-[rgba(255,255,255,0.08)] bg-[rgba(10,10,10,0.70)] hover:border-l-[rgba(89,119,148,0.4)]",
        (locked || disabled) && "opacity-50 cursor-not-allowed"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span
              className={cn(
                "font-mohave text-[14px] uppercase tracking-[0.04em]",
                selected ? "text-text" : "text-text-2"
              )}
            >
              {title}
            </span>
            {recommended && (
              <span className="font-kosugi text-[10px] uppercase tracking-[0.1em] text-[#597794]">
                [{t("common.recommended")}]
              </span>
            )}
            {locked && (
              <span className="font-kosugi text-[10px] uppercase tracking-[0.1em] text-text-3 flex items-center gap-1">
                <Lock className="w-[10px] h-[10px]" />
                [{t("common.locked")}]
              </span>
            )}
          </div>
          <p className="font-kosugi text-[12px] text-text-3 leading-relaxed">
            {description}
          </p>
          {locked && lockedReason && (
            <p className="font-kosugi text-[11px] text-text-3 mt-2 italic">
              [{lockedReason}]
            </p>
          )}
        </div>
        {selected && (
          <Check className="w-[16px] h-[16px] text-[#597794] shrink-0 mt-0.5" />
        )}
      </div>
    </button>
  );
}

// ─── Toggle ─────────────────────────────────────────────────────────────────

export function Toggle({
  label,
  caption,
  checked,
  onChange,
}: {
  label: string;
  caption?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "w-full flex items-center justify-between gap-3 min-h-[56px] p-4 rounded-[8px]",
        "border border-[rgba(255,255,255,0.08)]",
        "bg-[rgba(10,10,10,0.70)] backdrop-blur-[20px] backdrop-saturate-[1.2]",
        "transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]",
        "hover:border-[rgba(255,255,255,0.16)]",
        "motion-reduce:transition-none"
      )}
    >
      <div className="flex-1 min-w-0 text-left">
        <div className="font-mohave text-[14px] text-text uppercase tracking-[0.04em]">
          {label}
        </div>
        {caption && (
          <div className="font-kosugi text-[11px] text-text-3 mt-1">
            [{caption}]
          </div>
        )}
      </div>
      <div
        className={cn(
          "relative w-[44px] h-[24px] rounded-full border transition-colors duration-150 shrink-0",
          "motion-reduce:transition-none",
          checked
            ? "border-[rgba(255,255,255,0.24)] bg-[rgba(255,255,255,0.04)]"
            : "border-[rgba(255,255,255,0.08)] bg-transparent"
        )}
      >
        <span
          className={cn(
            "absolute top-[2px] w-[18px] h-[18px] rounded-full transition-transform duration-150",
            "motion-reduce:transition-none",
            checked
              ? "bg-text-primary translate-x-[22px]"
              : "bg-text-disabled translate-x-[2px]"
          )}
        />
      </div>
    </button>
  );
}

// ─── StepSlider ─────────────────────────────────────────────────────────────

export function StepSlider({
  label,
  value,
  min,
  max,
  step = 1,
  valueLabel,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  valueLabel: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="p-4 rounded-[8px] border border-[rgba(255,255,255,0.08)] bg-[rgba(10,10,10,0.70)] backdrop-blur-[20px] backdrop-saturate-[1.2]">
      <div className="flex items-center justify-between mb-3">
        <span className="font-mohave text-[13px] text-text-2 uppercase tracking-[0.06em]">
          {label}
        </span>
        <span className="font-kosugi text-[12px] text-text">
          [{valueLabel}]
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-[2px] bg-[rgba(255,255,255,0.08)] rounded-full appearance-none outline-none accent-[#E5E5E5] cursor-pointer"
      />
    </div>
  );
}

// ─── PreviewPanel ───────────────────────────────────────────────────────────

export function PreviewPanel({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="p-4 rounded-[8px] border border-[rgba(255,255,255,0.06)] bg-[rgba(10,10,10,0.50)]">
      <div className="font-kosugi text-[10px] text-text-3 uppercase tracking-[0.12em] mb-2">
        [{label}]
      </div>
      <div className="font-mono text-[12px] text-text-2 whitespace-pre-wrap leading-relaxed">
        {children}
      </div>
    </div>
  );
}

// ─── StepDropdown (native select styled to design system) ──────────────────

export function StepDropdown<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="p-4 rounded-[8px] border border-[rgba(255,255,255,0.08)] bg-[rgba(10,10,10,0.70)] backdrop-blur-[20px] backdrop-saturate-[1.2]">
      <div className="font-mohave text-[13px] text-text-2 uppercase tracking-[0.06em] mb-3">
        {label}
      </div>
      <select
        value={String(value)}
        onChange={(e) => {
          const v = e.target.value;
          const match = options.find((opt) => String(opt.value) === v);
          if (match) onChange(match.value);
        }}
        className={cn(
          "w-full min-h-[56px] px-3 rounded-[4px]",
          "border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)]",
          "font-mohave text-[14px] text-text uppercase tracking-[0.04em]",
          "outline-none focus:border-[#597794] transition-colors",
          "motion-reduce:transition-none"
        )}
      >
        {options.map((opt) => (
          <option
            key={String(opt.value)}
            value={String(opt.value)}
            className="bg-[#0D0D0D]"
          >
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

// ─── WarningBanner ──────────────────────────────────────────────────────────

export function WarningBanner({ children }: { children: ReactNode }) {
  return (
    <div className="p-3 rounded-[4px] border border-[rgba(196,168,104,0.24)] bg-[rgba(196,168,104,0.06)]">
      <p className="font-kosugi text-[12px] text-[#C4A868] leading-relaxed">
        [{children}]
      </p>
    </div>
  );
}
