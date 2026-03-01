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

// ─── Industry List ──────────────────────────────────────────────────────────

const INDUSTRIES = [
  "Architecture",
  "Bricklaying",
  "Cabinetry",
  "Carpentry",
  "Ceiling Installations",
  "Concrete Finishing",
  "Consulting",
  "Crane Operation",
  "Deck Construction",
  "Deck Surfacing",
  "Demolition",
  "Drywall",
  "Electrical",
  "Excavation",
  "Flooring",
  "Glazing",
  "HVAC",
  "Insulation",
  "Landscaping",
  "Masonry",
  "Metal Fabrication",
  "Millwrighting",
  "Painting",
  "Plumbing",
  "Railings",
  "Rebar",
  "Renovations",
  "Roofing",
  "Scaffolding",
  "Sheet Metal",
  "Siding",
  "Stonework",
  "Surveying",
  "Tile Setting",
  "Vinyl Deck Membranes",
  "Waterproofing",
  "Welding",
  "Windows",
  "Other",
] as const;

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
      className={cn(
        "px-3 py-2 rounded-lg border text-center transition-all duration-150",
        "font-mohave text-body-sm",
        selected
          ? "bg-ops-accent/10 border-ops-accent text-text-primary shadow-[0_0_8px_rgba(65,115,148,0.15)]"
          : "bg-background-input border-border text-text-secondary hover:border-border-medium"
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
  value: string;
  onChange: (val: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [customValue, setCustomValue] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const filtered = INDUSTRIES.filter((ind) =>
    ind.toLowerCase().includes(search.toLowerCase())
  );

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Focus search on open
  useEffect(() => {
    if (open && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [open]);

  const isOther = value === "Other" || (value !== "" && !INDUSTRIES.includes(value as typeof INDUSTRIES[number]));

  return (
    <div ref={dropdownRef} className="relative">
      <label className="font-kosugi text-caption-sm text-text-secondary uppercase tracking-widest mb-0.5 block">
        Industry
      </label>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          "w-full flex items-center justify-between",
          "bg-background-input text-text-primary font-mohave text-body",
          "px-1.5 py-1.5 rounded-lg",
          "border border-border",
          "transition-all duration-150",
          "focus:border-ops-accent focus:outline-none focus:shadow-glow-accent",
          !value && "text-text-tertiary"
        )}
      >
        <span>{value || "Select your industry"}</span>
        <ChevronDown
          className={cn(
            "w-4 h-4 text-text-tertiary transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full bg-background-card border border-border rounded-lg shadow-lg overflow-hidden">
          {/* Search */}
          <div className="p-1.5 border-b border-border">
            <div className="relative">
              <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-tertiary" />
              <input
                ref={searchInputRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search industries..."
                className="w-full bg-background-input text-text-primary font-mohave text-body-sm pl-4 pr-1.5 py-1 rounded border border-border focus:border-ops-accent focus:outline-none placeholder:text-text-tertiary"
              />
            </div>
          </div>

          {/* Options */}
          <div className="max-h-[200px] overflow-y-auto">
            {filtered.map((ind) => (
              <button
                key={ind}
                type="button"
                onClick={() => {
                  if (ind === "Other") {
                    onChange("Other");
                  } else {
                    onChange(ind);
                  }
                  setOpen(false);
                  setSearch("");
                }}
                className={cn(
                  "w-full flex items-center justify-between px-1.5 py-1 text-left",
                  "font-mohave text-body-sm transition-colors",
                  value === ind
                    ? "bg-ops-accent/10 text-ops-accent"
                    : "text-text-secondary hover:bg-background-elevated hover:text-text-primary"
                )}
              >
                <span>{ind}</span>
                {value === ind && <Check className="w-3.5 h-3.5" />}
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="px-1.5 py-2 font-kosugi text-caption text-text-tertiary text-center">
                No industries match &quot;{search}&quot;
              </p>
            )}
          </div>
        </div>
      )}

      {/* Custom input for "Other" */}
      {isOther && (
        <div className="mt-1">
          <Input
            placeholder="Enter your industry"
            value={value === "Other" ? customValue : value}
            onChange={(e) => {
              setCustomValue(e.target.value);
              onChange(e.target.value || "Other");
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
    <div className="w-full max-w-[440px] mx-auto">
      <div className="text-center mb-4">
        <h2 className="font-mohave text-display text-text-primary">
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

interface IdentityStep2Props {
  companyName: string;
  industry: string;
  companySize: string;
  companyAge: string;
  onUpdate: (data: {
    companyName?: string;
    industry?: string;
    companySize?: string;
    companyAge?: string;
  }) => void;
}

export function IdentityStep2({
  companyName,
  industry,
  companySize,
  companyAge,
  onUpdate,
}: IdentityStep2Props) {
  return (
    <div className="w-full max-w-[440px] mx-auto">
      <div className="text-center mb-4">
        <h2 className="font-mohave text-display text-text-primary">
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
          value={industry}
          onChange={(val) => onUpdate({ industry: val })}
        />

        {/* Company Size */}
        <div>
          <label className="font-kosugi text-caption-sm text-text-secondary uppercase tracking-widest mb-0.5 block">
            Team Size
          </label>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-1">
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
        <div>
          <label className="font-kosugi text-caption-sm text-text-secondary uppercase tracking-widest mb-0.5 block">
            Years in Business
          </label>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-1">
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
      </div>
    </div>
  );
}
