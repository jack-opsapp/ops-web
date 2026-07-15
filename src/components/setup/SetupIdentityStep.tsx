"use client";

/**
 * SetupIdentityStep — Phase 1 identity forms
 *
 * Step 1: First name, Last name, Phone (optional)
 * Step 2: Company name, Industry (searchable), Company size, Years in business
 *
 * Design system: glass surfaces, UPPERCASE titles, [bracket] captions,
 * 56dp touch targets, 8dp grid, no pure white, accent sparingly
 */

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { EntityPicker } from "@/components/ui/entity-picker";
import { cn } from "@/lib/utils/cn";
import { ChevronDown } from "lucide-react";
import { INDUSTRIES } from "@/lib/data/industries";
import { useDictionary } from "@/i18n/client";

const COMPANY_SIZES = ["1", "2-3", "4-5", "6-10", "10-20", "20+"] as const;
const COMPANY_AGES = ["<1", "1-2", "2-5", "5-10", "10+"] as const;

// ─── Selector Button ────────────────────────────────────────────────────────

function SelectorButton({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "px-2 py-1.5 rounded-sm border transition-all duration-150 whitespace-nowrap cursor-pointer text-center",
        "font-mohave text-body-sm uppercase min-h-[36px] min-w-[56px] flex-1",
        selected
          ? "bg-[rgba(255,255,255,0.10)] border-[rgba(255,255,255,0.30)] text-text"
          : "bg-transparent border-[rgba(255,255,255,0.08)] text-text-3 hover:border-[rgba(255,255,255,0.18)] hover:text-text-2"
      )}
    >
      {label}
    </button>
  );
}

// ─── Searchable Dropdown ────────────────────────────────────────────────────

function IndustryDropdown({
  value,
  onChange,
}: {
  value: string[];
  onChange: (val: string[]) => void;
}) {
  const { t: tp } = useDictionary("picker");
  const [open, setOpen] = useState(false);
  const [customValue, setCustomValue] = useState("");

  // Remove a chip below the trigger. Mirrors the old toggleOption removal path
  // (a plain filter — no "Other" bookkeeping needed on removal).
  const removeIndustry = (ind: string) => {
    onChange(value.filter((v) => v !== ind));
  };

  const hasOther = value.includes("Other") || value.some((v) => !INDUSTRIES.includes(v as typeof INDUSTRIES[number]));

  const displayText = value.length === 0
    ? ""
    : value.length <= 2
      ? value.join(", ")
      : `${value.slice(0, 2).join(", ")} +${value.length - 2}`;

  return (
    <div className="relative">
      <label className="font-mohave text-caption-sm text-text-3 uppercase tracking-[0.08em] mb-1 block">
        INDUSTRY
      </label>

      <EntityPicker<string>
        multiple
        trigger={
          <button
            type="button"
            className={cn(
              "w-full flex items-center justify-between",
              "bg-surface-input text-text font-mohave text-body",
              "px-2 py-1.5 rounded-sm min-h-[36px]",
              "border transition-all duration-150 ease-smooth",
              open ? "border-line-hi" : "border-border",
              "focus:border-line-hi focus:outline-none",
              value.length === 0 && "text-text-mute"
            )}
          >
            <span className="truncate">{displayText || "Select industries"}</span>
            <ChevronDown
              className={cn(
                "w-5 h-5 text-text-3 transition-transform duration-150 ease-smooth flex-shrink-0",
                open && "rotate-180"
              )}
              aria-hidden="true"
            />
          </button>
        }
        open={open}
        onOpenChange={setOpen}
        label="INDUSTRY"
        items={INDUSTRIES}
        value={value}
        onChange={(nextIds) => {
          const added = nextIds.find((id) => !value.includes(id));
          // Selecting a real industry clears the "Other" escape hatch (mirrors
          // the old toggleOption: presets and "Other" don't coexist once a
          // preset is picked).
          if (added && added !== "Other") {
            onChange(nextIds.filter((v) => v !== "Other"));
          } else {
            onChange(nextIds);
          }
        }}
        getId={(i) => i}
        getLabel={(i) => i}
        searchPlaceholder={tp("industry.search")}
        emptyLabel={tp("industry.empty")}
        clearLabel={tp("clear")}
        contentClassName="z-modal"
      />

      {/* Selected chips */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {value.filter((v) => v !== "Other").map((ind) => (
            <span
              key={ind}
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-sm bg-surface-active border border-border font-mohave text-caption-sm text-text-2 uppercase"
            >
              {ind}
              <button
                type="button"
                onClick={() => removeIndustry(ind)}
                className="text-text-mute hover:text-text transition-colors ml-0.5"
                aria-label={`Remove ${ind}`}
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Custom input for "Other" */}
      {hasOther && (
        <div className="mt-1">
          <Input
            placeholder="Enter your industry"
            aria-label="Custom industry name"
            value={customValue}
            onChange={(e) => {
              setCustomValue(e.target.value);
            }}
          />
        </div>
      )}
    </div>
  );
}

// ─── Step 1: About You ──────────────────────────────────────────────────────

interface IdentityStep1Props {
  firstName: string;
  lastName: string;
  phone: string;
  avatarUrl?: string | null;
  onUpdate: (data: { firstName?: string; lastName?: string; phone?: string }) => void;
}

export function IdentityStep1({
  firstName,
  lastName,
  phone,
  avatarUrl,
  onUpdate,
}: IdentityStep1Props) {
  const initials = [firstName, lastName]
    .filter(Boolean)
    .map((n) => n.charAt(0).toUpperCase())
    .join("");

  return (
    <div className="w-full">
      <div className="mb-3">
        <h2 className="font-mohave text-heading text-text uppercase">
          ABOUT YOU
        </h2>
        <p className="font-mono text-caption-sm text-text-3 mt-0.5">
          [the name behind the operation]
        </p>
      </div>

      {/* Avatar from Google/Apple */}
      <div className="flex items-center gap-3 mb-3">
        <div className="w-[56px] h-[56px] rounded-sm overflow-hidden border border-[rgba(255,255,255,0.08)] flex-shrink-0">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt="Profile"
              className="w-full h-full object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-[rgba(255,255,255,0.06)]">
              <span className="font-mohave text-body text-text-3">
                {initials || "?"}
              </span>
            </div>
          )}
        </div>
        {avatarUrl && (
          <p className="font-mono text-[11px] text-text-mute">
            Imported from your sign-in account
          </p>
        )}
      </div>

      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <Input
            label="First Name"
            placeholder="John"
            value={firstName}
            onChange={(e) => onUpdate({ firstName: e.target.value })}
            autoFocus
          />
          <Input
            label="Last Name"
            placeholder="Smith"
            value={lastName}
            onChange={(e) => onUpdate({ lastName: e.target.value })}
          />
        </div>
        <Input
          label="Phone (Optional)"
          type="tel"
          placeholder="(555) 123-4567"
          value={phone}
          onChange={(e) => onUpdate({ phone: e.target.value })}
          helperText="[recovery only — we don't call]"
        />
      </div>
    </div>
  );
}

// ─── Step 2: Your Company ───────────────────────────────────────────────────

const WEATHER_OPTIONS = ["Yes", "No"] as const;

interface IdentityStep2Props {
  companyName: string;
  industries: string[];
  companySize: string;
  companyAge: string;
  weatherDependent?: string;
  onUpdate: (data: {
    companyName?: string;
    industries?: string[];
    companySize?: string;
    companyAge?: string;
    weatherDependent?: string;
  }) => void;
}

export function IdentityStep2({
  companyName,
  industries,
  companySize,
  companyAge,
  weatherDependent = "",
  onUpdate,
}: IdentityStep2Props) {
  return (
    <div className="w-full">
      <div className="mb-3">
        <h2 className="font-mohave text-heading text-text uppercase">
          YOUR COMPANY
        </h2>
        <p className="font-mono text-caption-sm text-text-3 mt-0.5">
          [this shapes your command center]
        </p>
      </div>

      <div className="space-y-3">
        <Input
          label="Company Name"
          placeholder="Smith Roofing Co."
          value={companyName}
          onChange={(e) => onUpdate({ companyName: e.target.value })}
          autoFocus
        />

        <IndustryDropdown
          value={industries}
          onChange={(val) => onUpdate({ industries: val })}
        />

        {/* Company Size */}
        <div role="group" aria-label="Team Size">
          <label className="font-mohave text-caption-sm text-text-3 uppercase tracking-[0.08em] mb-1 block">
            TEAM SIZE
          </label>
          <div className="flex gap-1 overflow-x-auto scrollbar-none">
            {COMPANY_SIZES.map((size) => (
              <SelectorButton
                key={size}
                label={size}
                selected={companySize === size}
                onClick={() => onUpdate({ companySize: size })}
              />
            ))}
          </div>
        </div>

        {/* Years in Business */}
        <div role="group" aria-label="Years in Business">
          <label className="font-mohave text-caption-sm text-text-3 uppercase tracking-[0.08em] mb-1 block">
            YEARS IN BUSINESS
          </label>
          <div className="flex gap-1 overflow-x-auto scrollbar-none">
            {COMPANY_AGES.map((age) => (
              <SelectorButton
                key={age}
                label={age}
                selected={companyAge === age}
                onClick={() => onUpdate({ companyAge: age })}
              />
            ))}
          </div>
        </div>

        {/* Weather Dependent */}
        <div role="group" aria-label="Weather Dependent">
          <label className="font-mohave text-caption-sm text-text-3 uppercase tracking-[0.08em] mb-1 block">
            WEATHER-DEPENDENT?
          </label>
          <div className="flex gap-1">
            {WEATHER_OPTIONS.map((opt) => (
              <SelectorButton
                key={opt}
                label={opt}
                selected={weatherDependent === opt}
                onClick={() => onUpdate({ weatherDependent: opt })}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
