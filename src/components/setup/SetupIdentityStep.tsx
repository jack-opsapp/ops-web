"use client";

/**
 * SetupIdentityStep — Phase 1 identity forms
 *
 * Step 1: First name, Last name, Phone (optional)
 * Step 2: Company name, Industry (searchable), Company size, Years in business
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils/cn";
import { Check, ChevronDown, Search } from "lucide-react";
import { INDUSTRIES } from "@/lib/data/industries";

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
        "px-3 py-2 rounded-sm border transition-all duration-150 whitespace-nowrap cursor-pointer text-center",
        "font-mohave text-body-sm min-h-[44px] min-w-[56px] flex-1",
        selected
          ? "bg-white border-white text-[#0A0A0A]"
          : "bg-background-input border-border text-text-secondary hover:border-[rgba(255,255,255,0.25)] hover:text-text-primary"
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
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [customValue, setCustomValue] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);

  const filtered = INDUSTRIES.filter((ind) =>
    ind.toLowerCase().includes(search.toLowerCase())
  );

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
        setHighlightedIndex(-1);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Focus search on open
  useEffect(() => {
    if (open && searchInputRef.current) {
      searchInputRef.current.focus();
      setHighlightedIndex(-1);
    }
  }, [open]);

  // Scroll highlighted option into view
  useEffect(() => {
    if (highlightedIndex >= 0 && listboxRef.current) {
      const options = listboxRef.current.querySelectorAll('[role="option"]');
      options[highlightedIndex]?.scrollIntoView({ block: "nearest" });
    }
  }, [highlightedIndex]);

  const toggleOption = useCallback((ind: string) => {
    if (ind === "Other") {
      // "Other" is exclusive — selecting it replaces all
      if (value.includes("Other")) {
        onChange(value.filter((v) => v !== "Other"));
      } else {
        onChange([...value, "Other"]);
      }
    } else {
      if (value.includes(ind)) {
        onChange(value.filter((v) => v !== ind));
      } else {
        // Remove "Other" placeholder when selecting a real industry
        onChange([...value.filter((v) => v !== "Other"), ind]);
      }
    }
  }, [onChange, value]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!open) return;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlightedIndex((prev) =>
          prev < filtered.length - 1 ? prev + 1 : 0
        );
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlightedIndex((prev) =>
          prev > 0 ? prev - 1 : filtered.length - 1
        );
        break;
      case "Enter":
        e.preventDefault();
        if (highlightedIndex >= 0 && highlightedIndex < filtered.length) {
          toggleOption(filtered[highlightedIndex]);
        }
        break;
      case "Escape":
        e.preventDefault();
        setOpen(false);
        setSearch("");
        setHighlightedIndex(-1);
        break;
    }
  }, [open, filtered, highlightedIndex, toggleOption]);

  const hasOther = value.includes("Other") || value.some((v) => !INDUSTRIES.includes(v as typeof INDUSTRIES[number]));
  const listboxId = "industry-listbox";

  const displayText = value.length === 0
    ? ""
    : value.length <= 2
      ? value.join(", ")
      : `${value.slice(0, 2).join(", ")} +${value.length - 2}`;

  return (
    <div ref={dropdownRef} className="relative" onKeyDown={handleKeyDown}>
      <label className="font-kosugi text-caption-sm text-text-secondary uppercase tracking-widest mb-0.5 block">
        Industry
      </label>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        className={cn(
          "w-full flex items-center justify-between",
          "bg-background-input text-text-primary font-mohave text-body",
          "px-1.5 py-1.5 rounded-sm min-h-[44px]",
          "border border-border",
          "transition-all duration-150",
          "focus:border-[rgba(255,255,255,0.25)] focus:outline-none",
          value.length === 0 && "text-text-tertiary"
        )}
      >
        <span className="truncate">{displayText || "Select industries"}</span>
        <ChevronDown
          className={cn(
            "w-4 h-4 text-text-tertiary transition-transform flex-shrink-0",
            open && "rotate-180"
          )}
          aria-hidden="true"
        />
      </button>

      {/* Selected chips */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {value.filter((v) => v !== "Other").map((ind) => (
            <span
              key={ind}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.08)] font-mohave text-caption text-text-secondary"
            >
              {ind}
              <button
                type="button"
                onClick={() => toggleOption(ind)}
                className="text-text-disabled hover:text-text-primary transition-colors"
                aria-label={`Remove ${ind}`}
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}

      {open && (
        <div className="absolute z-50 mt-1 w-full bg-[rgba(10,10,10,0.70)] backdrop-blur-[20px] backdrop-saturate-[1.2] border border-[rgba(255,255,255,0.08)] rounded-sm overflow-hidden">
          {/* Search */}
          <div className="p-1.5 border-b border-border">
            <div className="relative">
              <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-tertiary" aria-hidden="true" />
              <input
                ref={searchInputRef}
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setHighlightedIndex(-1);
                }}
                placeholder="Search industries..."
                aria-label="Search industries"
                aria-controls={listboxId}
                aria-activedescendant={
                  highlightedIndex >= 0 ? `industry-option-${highlightedIndex}` : undefined
                }
                className="w-full bg-background-input text-text-primary font-mohave text-body-sm pl-4 pr-1.5 py-1 rounded-sm border border-border focus:border-[rgba(255,255,255,0.25)] focus:outline-none placeholder:text-text-tertiary"
              />
            </div>
          </div>

          {/* Options */}
          <div
            ref={listboxRef}
            id={listboxId}
            role="listbox"
            aria-label="Industries"
            aria-multiselectable="true"
            className="max-h-[200px] overflow-y-auto"
          >
            {filtered.map((ind, index) => {
              const isSelected = value.includes(ind);
              return (
                <button
                  key={ind}
                  id={`industry-option-${index}`}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => toggleOption(ind)}
                  className={cn(
                    "w-full flex items-center justify-between px-1.5 py-1 text-left min-h-[44px]",
                    "font-mohave text-body-sm transition-colors",
                    isSelected
                      ? "bg-[rgba(255,255,255,0.08)] text-text-primary"
                      : highlightedIndex === index
                        ? "bg-background-elevated text-text-primary"
                        : "text-text-secondary hover:bg-background-elevated hover:text-text-primary"
                  )}
                >
                  <span>{ind}</span>
                  {isSelected && <Check className="w-3.5 h-3.5" aria-hidden="true" />}
                </button>
              );
            })}
            {filtered.length === 0 && (
              <p className="px-1.5 py-2 font-kosugi text-caption text-text-tertiary" role="status">
                No industries match &quot;{search}&quot;
              </p>
            )}
          </div>
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
  onUpdate: (data: { firstName?: string; lastName?: string; phone?: string }) => void;
}

export function IdentityStep1({
  firstName,
  lastName,
  phone,
  onUpdate,
}: IdentityStep1Props) {
  return (
    <div className="w-full">
      <div className="mb-4">
        <h2 className="font-mohave text-heading text-text-primary">
          About You
        </h2>
        <p className="font-kosugi text-caption text-text-tertiary mt-0.5">
          The name behind the operation
        </p>
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
          helperText="Recovery only. We don't call."
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
      <div className="mb-4">
        <h2 className="font-mohave text-heading text-text-primary">
          Your Company
        </h2>
        <p className="font-kosugi text-caption text-text-tertiary mt-0.5">
          This shapes your command center
        </p>
      </div>

      <div className="space-y-2.5">
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
          <label className="font-kosugi text-caption-sm text-text-secondary uppercase tracking-widest mb-0.5 block">
            Team Size
          </label>
          <div className="flex gap-1 overflow-x-auto -mx-1 px-1 pb-1 scrollbar-none">
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
          <label className="font-kosugi text-caption-sm text-text-secondary uppercase tracking-widest mb-0.5 block">
            Years in Business
          </label>
          <div className="flex gap-1 overflow-x-auto -mx-1 px-1 pb-1 scrollbar-none">
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
          <label className="font-kosugi text-caption-sm text-text-secondary uppercase tracking-widest mb-0.5 block">
            Is your work weather-dependent?
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
