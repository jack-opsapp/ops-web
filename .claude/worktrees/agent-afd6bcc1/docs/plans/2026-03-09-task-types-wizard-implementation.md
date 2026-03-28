# Task Types Setup Wizard — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a guided setup wizard that auto-suggests industry-specific task types, colors, templates, and dependencies — replacing the confusing task types settings tab empty state.

**Architecture:** Empty-state takeover in the existing task-types-tab. New top-level "Setup" settings group houses all setup wizards. 5-step wizard flow: Industry → Task Types → Dependencies Gate → Dependency Timeline → Review & Create. Industry presets for all 65 trades stored in a static data file. Curated color palette from real paint companies.

**Tech Stack:** Next.js 14, React 18, TypeScript, Framer Motion 12, Zustand, TanStack Query, Tailwind CSS, Sonner toasts

**Design System:** N/A (no `.interface-design/system.md` — follow existing OPS-Web conventions)

**Required Skills:** `interface-design`, `elite-animations`, `ops-copywriter`, `frontend-design`

**Design doc:** `docs/plans/2026-03-09-task-types-wizard-design.md`

---

### Task 1: i18n Translation Keys

> **Skills:** `ops-copywriter` for all user-facing copy

**Files:**
- Modify: `src/i18n/dictionaries/en/settings.json`
- Modify: `src/i18n/dictionaries/es/settings.json`

**Step 1: Add English translation keys**

Add to `src/i18n/dictionaries/en/settings.json`:

```json
"tabs.setup": "Setup",
"sections.setupWizards": "Setup Guides",

"setup.title": "SETUP GUIDES",
"setup.description": "Get your account dialed in. Each guide walks you through one part of OPS.",
"setup.taskTypes.title": "Task Types",
"setup.taskTypes.description": "Configure the types of work your crew does",
"setup.taskTypes.notStarted": "Not started",
"setup.taskTypes.complete": "Complete",
"setup.taskTypes.configured": "task types configured",
"setup.runSetup": "Run Setup",
"setup.runAgain": "Run Again",

"wizard.industry.headlineKnown": "YOUR TRADE, YOUR TASKS",
"wizard.industry.bodyKnown": "You told us you work in {industries}. We put together a setup based on that.",
"wizard.industry.confirm": "That's right",
"wizard.industry.change": "Change my trade",
"wizard.industry.headlineUnknown": "WHAT DO YOU DO?",
"wizard.industry.bodyUnknown": "Tell us your trade. We'll handle the rest.",
"wizard.industry.continue": "Continue",
"wizard.industry.searchPlaceholder": "Search trades...",

"wizard.taskTypes.headline": "HERE'S WHAT WE'D SET UP",
"wizard.taskTypes.subtitle": "Toggle off what you don't need. Tap a color to change it.",
"wizard.taskTypes.colorHint": "Similar tasks share similar colors — prep in warm tones, installation in cool tones, inspections in neutrals.",
"wizard.taskTypes.addCustom": "Add Custom Type",
"wizard.taskTypes.templates": "sub-tasks",
"wizard.taskTypes.hours": "hrs",
"wizard.taskTypes.continue": "Continue",
"wizard.taskTypes.namePlaceholder": "Custom type name...",

"wizard.dependencies.headline": "ONE MORE THING",
"wizard.dependencies.body": "Do any of these tasks need to finish before the next one starts?",
"wizard.dependencies.subtitle": "Set up task dependencies",
"wizard.dependencies.yes": "Yes, set up dependencies",
"wizard.dependencies.no": "No, skip this",

"wizard.timeline.headline": "DRAG TO ORDER. OVERLAP IF THEY RUN TOGETHER.",
"wizard.timeline.subtitle": "Tasks at the top start first. Drag edges to show overlap.",
"wizard.timeline.overlap": "overlap",
"wizard.timeline.done": "Looks good",

"wizard.review.headline": "READY TO GO",
"wizard.review.summary": "{count} task types. {templateCount} sub-tasks.",
"wizard.review.withDeps": "Dependencies configured.",
"wizard.review.create": "Create All",
"wizard.review.back": "Back",
"wizard.review.creating": "Setting up...",
"wizard.review.success": "All set. Your task types are ready.",

"wizard.nudge.message": "Set up your task types. 30 seconds. Makes scheduling 10x easier.",
"wizard.nudge.cta": "Run Setup"
```

**Step 2: Add Spanish translation keys**

Add equivalent keys to `src/i18n/dictionaries/es/settings.json` with Spanish translations.

**Step 3: Verify TypeScript compilation**

Run: `npx tsc --noEmit 2>&1 | grep -i 'settings' | head -5`
Expected: No new errors

**Step 4: Commit**

```bash
git add src/i18n/dictionaries/en/settings.json src/i18n/dictionaries/es/settings.json
git commit -m "feat(wizard): add i18n keys for task types setup wizard"
```

---

### Task 2: Curated Color Palette Data

> **Skills:** `interface-design` for color selection against dark theme

**Files:**
- Create: `src/lib/data/curated-colors.ts`

**Step 1: Create the curated color palette file**

Create `src/lib/data/curated-colors.ts` with colors sourced from Farrow & Ball, Benjamin Moore, Sherwin-Williams, and Japanese traditional color palettes. All colors must be desaturated/pastel, visible against `#0A0A0A`, and distinguishable at 12px.

```typescript
/**
 * Curated color palette for task types.
 * Colors sourced from real paint companies — desaturated pastels
 * that read well against the OPS dark theme (#0A0A0A background).
 *
 * Organized into 5 families for auto-assignment based on task tags.
 */

export interface CuratedColor {
  hex: string;
  name: string;
  source: string; // e.g., "Farrow & Ball", "Benjamin Moore"
  family: ColorFamily;
}

export type ColorFamily =
  | "neutral"    // Assessment, permitting, documentation
  | "warm"       // Site-prep, demolition, repair
  | "cool"       // Rough-in, framing, installation
  | "earth"      // Finishing, grouting, curing
  | "muted"      // Inspection, testing, commissioning, cleanup

/**
 * Tag → color family mapping.
 * Used by auto-assignment logic to pick colors based on task type tags.
 */
export const TAG_TO_FAMILY: Record<string, ColorFamily> = {
  // Neutral family
  assessment: "neutral",
  permitting: "neutral",
  documentation: "neutral",
  coordination: "neutral",
  monitoring: "neutral",
  // Warm family
  "site-prep": "warm",
  demolition: "warm",
  repair: "warm",
  treatment: "warm",
  emergency: "warm",
  // Cool family
  "rough-in": "cool",
  framing: "cool",
  installation: "cool",
  plumbing: "cool",
  electrical: "cool",
  "equipment-set": "cool",
  // Earth family
  finishing: "earth",
  grouting: "earth",
  curing: "earth",
  "trim-out": "earth",
  forming: "earth",
  // Muted family
  inspection: "muted",
  testing: "muted",
  commissioning: "muted",
  cleanup: "muted",
  "follow-up": "muted",
};

/**
 * The curated palette — 30 colors across 5 families.
 *
 * NOTE: These hex values are sourced from real paint company swatches.
 * Replace with verified hex codes from the color research output when available.
 * All colors are desaturated pastels that maintain visibility on #0A0A0A.
 */
export const CURATED_COLORS: CuratedColor[] = [
  // ── Neutral family (warm grays, taupes, putty) ──
  { hex: "#A89F91", name: "London Stone", source: "Farrow & Ball", family: "neutral" },
  { hex: "#B5A898", name: "Oxford Stone", source: "Farrow & Ball", family: "neutral" },
  { hex: "#C4B7A6", name: "Stony Ground", source: "Farrow & Ball", family: "neutral" },
  { hex: "#9E9589", name: "Charleston Gray", source: "Farrow & Ball", family: "neutral" },
  { hex: "#B8AFA7", name: "Cornforth White", source: "Farrow & Ball", family: "neutral" },
  { hex: "#C2B9AE", name: "Elephant's Breath", source: "Farrow & Ball", family: "neutral" },

  // ── Warm family (terracotta, clay, sand, muted reds/oranges) ──
  { hex: "#C17C60", name: "Red Earth", source: "Farrow & Ball", family: "warm" },
  { hex: "#B8836A", name: "Book Room Red", source: "Farrow & Ball", family: "warm" },
  { hex: "#C4956A", name: "India Yellow", source: "Farrow & Ball", family: "warm" },
  { hex: "#D4A574", name: "Ochre", source: "Benjamin Moore", family: "warm" },
  { hex: "#B07D62", name: "Cavern Clay", source: "Sherwin-Williams", family: "warm" },
  { hex: "#C8A07E", name: "Buckram Binding", source: "Benjamin Moore", family: "warm" },

  // ── Cool family (slate, dusty blue, teal, muted indigo) ──
  { hex: "#7B9BAA", name: "Stone Blue", source: "Farrow & Ball", family: "cool" },
  { hex: "#6B8C99", name: "Oval Room Blue", source: "Farrow & Ball", family: "cool" },
  { hex: "#8BA0A8", name: "Parma Gray", source: "Farrow & Ball", family: "cool" },
  { hex: "#5E8C8A", name: "Vardo", source: "Farrow & Ball", family: "cool" },
  { hex: "#6E8B97", name: "Inchyra Blue", source: "Farrow & Ball", family: "cool" },
  { hex: "#8FA3B1", name: "Lulworth Blue", source: "Farrow & Ball", family: "cool" },

  // ── Earth family (sage, moss, olive, muted greens/browns) ──
  { hex: "#8A9A7B", name: "Lichen", source: "Farrow & Ball", family: "earth" },
  { hex: "#7D8E6D", name: "Calke Green", source: "Farrow & Ball", family: "earth" },
  { hex: "#9BA88D", name: "Ball Green", source: "Farrow & Ball", family: "earth" },
  { hex: "#A39E7C", name: "French Gray", source: "Farrow & Ball", family: "earth" },
  { hex: "#8B9977", name: "Card Room Green", source: "Farrow & Ball", family: "earth" },
  { hex: "#97A086", name: "Pigeon", source: "Farrow & Ball", family: "earth" },

  // ── Muted family (lavender, dusty rose, mauve, muted purples/pinks) ──
  { hex: "#9B8EA6", name: "Brassica", source: "Farrow & Ball", family: "muted" },
  { hex: "#A89AAF", name: "Calluna", source: "Farrow & Ball", family: "muted" },
  { hex: "#B5A0A8", name: "Cinder Rose", source: "Farrow & Ball", family: "muted" },
  { hex: "#8E8498", name: "Pelt", source: "Farrow & Ball", family: "muted" },
  { hex: "#A78FA0", name: "Sulking Room Pink", source: "Farrow & Ball", family: "muted" },
  { hex: "#9C93A0", name: "Dove Tale", source: "Farrow & Ball", family: "muted" },
];

/** Get colors filtered by family */
export function getColorsByFamily(family: ColorFamily): CuratedColor[] {
  return CURATED_COLORS.filter((c) => c.family === family);
}

/** Get the best family for a set of tags */
export function getFamilyForTags(tags: string[]): ColorFamily {
  const familyCounts: Record<ColorFamily, number> = {
    neutral: 0,
    warm: 0,
    cool: 0,
    earth: 0,
    muted: 0,
  };
  for (const tag of tags) {
    const family = TAG_TO_FAMILY[tag];
    if (family) familyCounts[family]++;
  }
  // Return the family with the most tag matches
  let best: ColorFamily = "cool"; // default
  let bestCount = 0;
  for (const [family, count] of Object.entries(familyCounts)) {
    if (count > bestCount) {
      best = family as ColorFamily;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Auto-assign colors to a list of task type entries.
 * Assigns from the matching family, cycling through available colors.
 */
export function autoAssignColors(
  taskTypes: Array<{ name: string; tags: string[] }>
): Array<{ name: string; tags: string[]; color: string }> {
  // Track usage per family to cycle through colors
  const familyIndex: Record<ColorFamily, number> = {
    neutral: 0,
    warm: 0,
    cool: 0,
    earth: 0,
    muted: 0,
  };

  return taskTypes.map((tt) => {
    const family = getFamilyForTags(tt.tags);
    const familyColors = getColorsByFamily(family);
    const idx = familyIndex[family] % familyColors.length;
    familyIndex[family]++;
    return { ...tt, color: familyColors[idx].hex };
  });
}
```

**Step 2: Verify compilation**

Run: `npx tsc --noEmit 2>&1 | grep 'curated-colors' | head -5`
Expected: No errors

**Step 3: Commit**

```bash
git add src/lib/data/curated-colors.ts
git commit -m "feat(wizard): add curated color palette from paint company swatches"
```

---

### Task 3: Industry Presets Data File

> **Skills:** None (pure data)

**Files:**
- Create: `src/lib/data/industry-presets.ts`

This is the largest data file. It contains preset task types for all 65 industries, with task names, hour estimates, tags, dependency order, and template lists.

**Step 1: Create the industry presets file**

Create `src/lib/data/industry-presets.ts`. The file exports:

```typescript
import { autoAssignColors, type ColorFamily } from "./curated-colors";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PresetTaskTemplate {
  title: string;
  estimatedHours: number | null;
}

export interface PresetTaskType {
  name: string;
  tags: string[];
  estimatedHoursMin: number;
  estimatedHoursMax: number;
  templates: PresetTaskTemplate[];
}

export interface IndustryPreset {
  industry: string;
  taskTypes: PresetTaskType[]; // In dependency order (index 0 = first)
}

export interface MergedTaskType extends PresetTaskType {
  color: string;
  sourceIndustries: string[];
}

export interface MergedPreset {
  taskTypes: MergedTaskType[];
}

// ─── Preset Data ──────────────────────────────────────────────────────────────

export const INDUSTRY_PRESETS: Record<string, IndustryPreset> = {
  // NOTE: Include ALL 65 industries from the design doc Section 4.
  // Each entry follows this pattern:

  "Roofing": {
    industry: "Roofing",
    taskTypes: [
      {
        name: "Site Setup",
        tags: ["site-prep"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 3,
        templates: [
          { title: "Property protection (tarps, landscaping cover)", estimatedHours: 0.5 },
          { title: "Safety equipment setup", estimatedHours: 0.5 },
          { title: "Dumpster placement", estimatedHours: 0.25 },
          { title: "Material staging", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Tear-Off",
        tags: ["demolition"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 8,
        templates: [
          { title: "Strip shingles", estimatedHours: 2 },
          { title: "Remove underlayment", estimatedHours: 1 },
          { title: "Pull old flashing", estimatedHours: 0.5 },
          { title: "Dispose debris", estimatedHours: 1 },
        ],
      },
      {
        name: "Deck Inspection",
        tags: ["inspection"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
        templates: [
          { title: "Inspect sheathing for rot/damage", estimatedHours: 0.5 },
          { title: "Check structural integrity", estimatedHours: 0.5 },
          { title: "Mark areas needing repair", estimatedHours: 0.25 },
        ],
      },
      {
        name: "Deck Repair",
        tags: ["repair"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
        templates: [
          { title: "Replace damaged sheathing", estimatedHours: 1.5 },
          { title: "Re-nail loose boards", estimatedHours: 0.5 },
          { title: "Sister damaged rafters", estimatedHours: 1 },
        ],
      },
      {
        name: "Underlayment",
        tags: ["installation"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
        templates: [
          { title: "Install ice & water shield at eaves/valleys", estimatedHours: 1 },
          { title: "Roll out synthetic underlayment", estimatedHours: 1 },
          { title: "Seal overlaps", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Installation",
        tags: ["installation"],
        estimatedHoursMin: 8,
        estimatedHoursMax: 16,
        templates: [
          { title: "Install drip edge", estimatedHours: 1 },
          { title: "Install starter strip", estimatedHours: 0.5 },
          { title: "Lay field shingles", estimatedHours: 6 },
          { title: "Install ridge cap", estimatedHours: 1 },
          { title: "Install flashing at walls/valleys/penetrations", estimatedHours: 2 },
          { title: "Install pipe boots and vents", estimatedHours: 1 },
        ],
      },
      {
        name: "Final Inspection",
        tags: ["inspection"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
        templates: [
          { title: "Walkthrough with client", estimatedHours: 0.5 },
          { title: "Photograph completed work", estimatedHours: 0.25 },
          { title: "Code compliance check", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Cleanup",
        tags: ["cleanup"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
        templates: [
          { title: "Magnetic nail sweep", estimatedHours: 0.25 },
          { title: "Remove tarps", estimatedHours: 0.25 },
          { title: "Debris haul-off", estimatedHours: 0.5 },
          { title: "Gutter cleaning", estimatedHours: 0.25 },
        ],
      },
    ],
  },

  // ... CONTINUE FOR ALL 65 INDUSTRIES ...
  // Each industry follows the same pattern using data from the design doc Section 4.
  // The full list of industries to include:
  // Architecture, Auto Detailing, Bricklaying, Cabinetry, Carpentry,
  // Carpet Cleaning, Ceiling Installations, Chimney Services, Concrete Finishing,
  // Consulting, Crane Operation, Deck Construction, Deck Surfacing, Demolition,
  // Drywall, Electrical, Excavation, Fencing, Flooring, Garage Doors,
  // General Contracting, Glazing, Gutter Installation, Handyman Services,
  // House Cleaning, HVAC, Insulation, Irrigation, Junk Removal, Landscaping,
  // Lawn Care, Locksmith, Masonry, Metal Fabrication, Millwrighting,
  // Moving Services, Painting, Paving, Pest Control, Plumbing, Pool Services,
  // Power Washing, Railings, Rebar, Renovations, Roofing, Scaffolding,
  // Septic Services, Sheet Metal, Siding, Snow Removal, Solar Installation,
  // Stonework, Surveying, Tile Setting, Tree Services, Vinyl Deck Membranes,
  // Waterproofing, Welding, Window Cleaning, Windows, Other

  "Other": {
    industry: "Other",
    taskTypes: [
      { name: "Assessment", tags: ["assessment"], estimatedHoursMin: 1, estimatedHoursMax: 4, templates: [] },
      { name: "Planning", tags: ["assessment"], estimatedHoursMin: 1, estimatedHoursMax: 4, templates: [] },
      { name: "Site Prep", tags: ["site-prep"], estimatedHoursMin: 1, estimatedHoursMax: 4, templates: [] },
      { name: "Execution", tags: ["installation"], estimatedHoursMin: 2, estimatedHoursMax: 16, templates: [] },
      { name: "Quality Check", tags: ["inspection"], estimatedHoursMin: 0.5, estimatedHoursMax: 2, templates: [] },
      { name: "Cleanup", tags: ["cleanup"], estimatedHoursMin: 0.5, estimatedHoursMax: 2, templates: [] },
    ],
  },
};

// ─── Merge Logic ──────────────────────────────────────────────────────────────

/**
 * Merge presets for multiple industries.
 * Deduplicates task types by matching tags — e.g., "Inspection" in Roofing
 * and "Final Inspection" in Electrical both have the `inspection` tag,
 * so only one is kept (the first one encountered).
 *
 * Auto-assigns colors from the curated palette.
 */
export function mergePresets(industries: string[]): MergedPreset {
  const seen = new Map<string, MergedTaskType>(); // tag combo key → merged type
  const ordered: MergedTaskType[] = [];

  for (const industry of industries) {
    const preset = INDUSTRY_PRESETS[industry] ?? INDUSTRY_PRESETS["Other"];
    for (const tt of preset.taskTypes) {
      // Use the primary tag (first tag) as dedup key
      const key = tt.tags[0] ?? tt.name.toLowerCase();
      if (seen.has(key)) {
        // Add source industry to existing
        seen.get(key)!.sourceIndustries.push(industry);
      } else {
        const merged: MergedTaskType = {
          ...tt,
          color: "", // assigned below
          sourceIndustries: [industry],
        };
        seen.set(key, merged);
        ordered.push(merged);
      }
    }
  }

  // Auto-assign colors
  const colored = autoAssignColors(ordered);
  for (let i = 0; i < ordered.length; i++) {
    ordered[i].color = colored[i].color;
  }

  return { taskTypes: ordered };
}
```

**Step 2: Populate ALL 65 industries**

Using the data from `docs/plans/2026-03-09-task-types-wizard-design.md` Section 4, populate every industry entry. This is the most time-intensive step — each industry has 4-8 task types with 2-6 templates each.

**Step 3: Verify compilation**

Run: `npx tsc --noEmit 2>&1 | grep 'industry-presets' | head -5`
Expected: No errors

**Step 4: Commit**

```bash
git add src/lib/data/industry-presets.ts
git commit -m "feat(wizard): add industry presets for all 65 trades with templates and tags"
```

---

### Task 4: Color Picker Popover Component

> **Skills:** `interface-design` for layout, `elite-animations` for popover entrance

**Files:**
- Create: `src/components/settings/wizard/color-picker-popover.tsx`

**Step 1: Create the color picker popover**

```typescript
"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils/cn";
import { CURATED_COLORS, type ColorFamily, type CuratedColor } from "@/lib/data/curated-colors";

const FAMILY_ORDER: ColorFamily[] = ["neutral", "warm", "cool", "earth", "muted"];
const FAMILY_LABELS: Record<ColorFamily, string> = {
  neutral: "Neutral",
  warm: "Warm",
  cool: "Cool",
  earth: "Earth",
  muted: "Muted",
};

interface ColorPickerPopoverProps {
  currentColor: string;
  onSelect: (hex: string) => void;
  /** Anchor element ref for positioning */
  anchorRef: React.RefObject<HTMLElement>;
}

export function ColorPickerPopover({ currentColor, onSelect, anchorRef }: ColorPickerPopoverProps) {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open, anchorRef]);

  return (
    <>
      {/* Color dot trigger */}
      <button
        ref={anchorRef as React.RefObject<HTMLButtonElement>}
        type="button"
        onClick={() => setOpen(!open)}
        className="w-[16px] h-[16px] rounded-full shrink-0 ring-1 ring-[rgba(255,255,255,0.1)] hover:ring-[rgba(255,255,255,0.3)] transition-all cursor-pointer"
        style={{ backgroundColor: currentColor }}
      />

      <AnimatePresence>
        {open && (
          <motion.div
            ref={popoverRef}
            initial={{ opacity: 0, scale: 0.9, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: -4 }}
            transition={{ type: "spring", stiffness: 500, damping: 30 }}
            className="absolute z-50 mt-[4px] p-[8px] rounded-md shadow-lg"
            style={{
              background: "rgba(10, 10, 10, 0.90)",
              backdropFilter: "blur(20px) saturate(1.2)",
              WebkitBackdropFilter: "blur(20px) saturate(1.2)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              minWidth: 200,
            }}
          >
            {FAMILY_ORDER.map((family) => {
              const colors = CURATED_COLORS.filter((c) => c.family === family);
              return (
                <div key={family} className="mb-[6px] last:mb-0">
                  <span className="font-kosugi text-[9px] text-text-disabled uppercase tracking-widest">
                    {FAMILY_LABELS[family]}
                  </span>
                  <div className="flex gap-[4px] mt-[2px]">
                    {colors.map((color) => (
                      <button
                        key={color.hex}
                        type="button"
                        onClick={() => {
                          onSelect(color.hex);
                          setOpen(false);
                        }}
                        title={`${color.name} — ${color.source}`}
                        className={cn(
                          "w-[20px] h-[20px] rounded-sm transition-all",
                          currentColor === color.hex
                            ? "ring-2 ring-text-primary ring-offset-1 ring-offset-[#0A0A0A] scale-110"
                            : "hover:scale-110 ring-1 ring-[rgba(255,255,255,0.06)]"
                        )}
                        style={{ backgroundColor: color.hex }}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
```

**Step 2: Verify compilation**

Run: `npx tsc --noEmit 2>&1 | grep 'color-picker' | head -5`
Expected: No errors

**Step 3: Commit**

```bash
git add src/components/settings/wizard/color-picker-popover.tsx
git commit -m "feat(wizard): add curated color picker popover component"
```

---

### Task 5: Industry Confirmation Step (Step 1)

> **Skills:** `interface-design`, `ops-copywriter`, `elite-animations`

**Files:**
- Create: `src/components/settings/wizard/industry-step.tsx`

**Step 1: Create the industry step component**

This step reads `company.industries` from the auth store. If set, shows a confirmation screen. If not, shows the searchable multi-select industry picker (reuse the same 65-industry list from `SetupIdentityStep.tsx`).

The component receives `onNext(industries: string[])` callback.

Key implementation details:
- Import the `INDUSTRIES_LIST` — either extract from `SetupIdentityStep.tsx` into a shared constant, or duplicate (check which is cleaner)
- Searchable dropdown with checkboxes (same pattern as the onboarding)
- "That's right" button confirms existing industries
- "Change my trade" reveals the picker
- `onNext` passes the confirmed/selected industries array

Animation: Fade-in with `initial={{ opacity: 0, y: 20 }}` → `animate={{ opacity: 1, y: 0 }}`.

**Step 2: Verify compilation and commit**

```bash
git add src/components/settings/wizard/industry-step.tsx
git commit -m "feat(wizard): add industry confirmation step"
```

---

### Task 6: Task Types Selection Step (Step 2)

> **Skills:** `interface-design`, `elite-animations`, `ops-copywriter`

**Files:**
- Create: `src/components/settings/wizard/task-types-step.tsx`

**Step 1: Create the task types step component**

This step receives the selected industries from Step 1 and calls `mergePresets()` to generate the suggested task types with auto-assigned colors.

Layout:
- Headline + subtitle
- Color hint strip (informational)
- 2-column grid of task type cards (1 col on mobile)
- Each card: toggle switch, color dot (opens `ColorPickerPopover`), editable name, hours badge, template count
- "Add Custom Type" button at bottom
- "Continue" button

State management:
- `wizardTaskTypes` — array of `{ id: string, name: string, color: string, tags: string[], enabled: boolean, estimatedHoursMin: number, estimatedHoursMax: number, templates: PresetTaskTemplate[] }`
- Toggle enabled/disabled per card
- Inline edit name on click
- Color change via popover
- Add custom type with name + auto-color

The component receives `onNext(taskTypes: WizardTaskType[])` callback — passes only enabled types.

Animation:
- Cards stagger in: `transition={{ delay: index * 0.03 }}`
- Toggle animation on switch: spring scale
- Card dim when toggled off: `opacity: 0.4`, `scale: 0.98`

**Step 2: Verify compilation and commit**

```bash
git add src/components/settings/wizard/task-types-step.tsx
git commit -m "feat(wizard): add task types selection step with toggles and color picker"
```

---

### Task 7: Dependencies Gate Step (Step 3)

> **Skills:** `ops-copywriter`, `elite-animations`

**Files:**
- Create: `src/components/settings/wizard/dependencies-gate-step.tsx`

**Step 1: Create the dependencies gate component**

Simple yes/no screen:
- Headline: "ONE MORE THING"
- Body text
- Subtitle: "Set up task dependencies"
- Two buttons: "Yes, set up dependencies" → `onNext(true)` / "No, skip this" → `onNext(false)`

Animation: Fade-in same as other steps.

**Step 2: Commit**

```bash
git add src/components/settings/wizard/dependencies-gate-step.tsx
git commit -m "feat(wizard): add dependencies gate step"
```

---

### Task 8: Dependency Timeline Step (Step 4)

> **Skills:** `interface-design`, `elite-animations` (drag physics)

**Files:**
- Create: `src/components/settings/wizard/dependency-timeline-step.tsx`
- Create: `src/components/settings/wizard/dependency-bar.tsx`

This is the most complex UI component. It renders colored horizontal bars that can be:
1. **Dragged to reorder** (grab the bar body, drag up/down)
2. **Dragged to overlap** (grab the right edge handle, extend rightward to overlap with the bar below)

**Step 1: Create the dependency bar component**

`dependency-bar.tsx`:
- Receives: `{ name, color, index, overlapPercent, onReorder, onOverlapChange }`
- Renders a colored horizontal bar with:
  - Name label (left-aligned inside bar)
  - Right-edge drag handle (small grip icon)
  - Overlap zone visualization (striped area between this bar and the next)
- Uses Framer Motion `useDragControls` for the body (reorder)
- Uses pointer events + `useMotionValue` for the right-edge handle (overlap)
- Overlap percentage label appears on the overlap zone

**Step 2: Create the dependency timeline container**

`dependency-timeline-step.tsx`:
- Receives the task types from Step 2 (only enabled ones)
- Pre-populates order from the industry preset (already in dependency order)
- Renders a vertical stack of `DependencyBar` components
- Manages reorder state (drag and drop within the list)
- Manages overlap state per bar (`Record<number, number>` — index → overlap %)
- "Looks good" button → `onNext(dependencies: { fromIndex: number, toIndex: number, overlapPercent: number }[])`

Animation:
- Bar drag: `layout` prop for smooth reorder with spring physics
- Overlap handle: real-time width expansion on drag
- Overlap zone: animated reveal with opacity fade

**Step 3: Verify compilation and commit**

```bash
git add src/components/settings/wizard/dependency-bar.tsx src/components/settings/wizard/dependency-timeline-step.tsx
git commit -m "feat(wizard): add dependency timeline with drag-to-reorder and drag-to-overlap"
```

---

### Task 9: Review & Create Step (Step 5)

> **Skills:** `interface-design`, `ops-copywriter`, `elite-animations`

**Files:**
- Create: `src/components/settings/wizard/review-step.tsx`

**Step 1: Create the review step component**

Summary screen showing:
- Count headline: "{count} task types. {templateCount} sub-tasks."
- Compact list of task types with color dots and names
- Dependency visualization (mini version of timeline, read-only) — only if dependencies were configured
- "Create All" button (primary, full-width)
- "Back" link

On submit:
1. Set `creating` state to true, show loading spinner on button
2. For each task type: call `createTaskType.mutateAsync({ display: name, color: hex })`
3. For each task type's templates: call `createTaskTemplate.mutateAsync({ companyId, taskTypeId, title, estimatedHours, ... })`
4. For each dependency: call `updateTaskType.mutateAsync({ id, data: { dependencies: [...] } })`
5. If `company.industries` was changed: call `updateCompany`
6. On all success: show success state, auto-navigate to management view after 2s

Error handling: If any mutation fails, show toast with specific error, keep other successful ones.

Animation:
- Success state: checkmark scale-in with spring, text fade-in
- Creating state: subtle pulse on the button

**Step 2: Verify compilation and commit**

```bash
git add src/components/settings/wizard/review-step.tsx
git commit -m "feat(wizard): add review and create step with batch mutations"
```

---

### Task 10: Wizard Container (Step Management)

> **Skills:** `elite-animations` for step transitions

**Files:**
- Create: `src/components/settings/task-types-wizard.tsx`

**Step 1: Create the wizard container**

Manages the 5-step flow:
- State: `currentStep` (1-5), `selectedIndustries`, `wizardTaskTypes`, `useDependencies`, `dependencies`
- Renders the current step component based on `currentStep`
- Passes data forward through `onNext` callbacks
- Step transition animation: `AnimatePresence` with horizontal slide (`x: direction * 100` → `x: 0` → `x: -direction * 100`)
- Progress indicator: small dots or step count at top (e.g., "Step 2 of 5")
- Back navigation via "Back" text button (not in header — in-content)

```typescript
interface TaskTypesWizardProps {
  onComplete: () => void; // Called after successful creation
}
```

**Step 2: Verify compilation and commit**

```bash
git add src/components/settings/task-types-wizard.tsx
git commit -m "feat(wizard): add wizard container with step management and transitions"
```

---

### Task 11: Setup Wizards Tab

> **Skills:** `interface-design`

**Files:**
- Create: `src/components/settings/setup-wizards-tab.tsx`
- Modify: `src/app/(dashboard)/settings/page.tsx`

**Step 1: Create the setup wizards tab**

Shows cards for each available wizard. Each card:
- Icon, title, description
- Status badge (based on data query — e.g., task types count)
- Action button ("Run Setup" or "Run Again")
- Clicking "Run Setup" navigates to the relevant settings tab (e.g., `?tab=task-types`)

For now, only one card: Task Types. More can be added later.

```typescript
"use client";

import { Wrench, CheckCircle, Circle } from "lucide-react";
import { useTaskTypes } from "@/lib/hooks";
import { useDictionary } from "@/i18n/client";
import { useRouter } from "next/navigation";

export function SetupWizardsTab() {
  const { t } = useDictionary("settings");
  const router = useRouter();
  const { data: taskTypes = [] } = useTaskTypes();
  const activeCount = taskTypes.filter((tt) => !tt.deletedAt).length;
  const isComplete = activeCount > 0;

  return (
    <div className="space-y-3">
      <div>
        <h2 className="font-mohave text-heading-sm text-text-primary uppercase tracking-wide">
          {t("setup.title")}
        </h2>
        <p className="font-kosugi text-body-sm text-text-secondary mt-[4px]">
          {t("setup.description")}
        </p>
      </div>

      {/* Task Types wizard card */}
      <button
        onClick={() => router.push("/settings?tab=task-types")}
        className="w-full flex items-center gap-3 p-3 rounded-md border border-[rgba(255,255,255,0.08)] hover:border-[rgba(255,255,255,0.15)] bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.04)] transition-all text-left"
      >
        <Wrench className="w-[20px] h-[20px] text-text-disabled shrink-0" />
        <div className="flex-1 min-w-0">
          <h3 className="font-mohave text-body text-text-primary">{t("setup.taskTypes.title")}</h3>
          <p className="font-kosugi text-caption-sm text-text-tertiary">{t("setup.taskTypes.description")}</p>
        </div>
        <div className="flex items-center gap-[6px] shrink-0">
          {isComplete ? (
            <>
              <CheckCircle className="w-[14px] h-[14px] text-ops-success" />
              <span className="font-mono text-[10px] text-text-disabled">
                {activeCount} {t("setup.taskTypes.configured")}
              </span>
            </>
          ) : (
            <>
              <Circle className="w-[14px] h-[14px] text-text-disabled" />
              <span className="font-mono text-[10px] text-text-disabled">
                {t("setup.taskTypes.notStarted")}
              </span>
            </>
          )}
        </div>
      </button>
    </div>
  );
}
```

**Step 2: Register the new settings group**

In `src/app/(dashboard)/settings/page.tsx`:

1. Import `Rocket` from lucide-react and `SetupWizardsTab`
2. Add a new group to `BASE_GROUP_DEFS` — insert before the last entry or at the end (before dev):

```typescript
{
  id: "setup",
  labelKey: "tabs.setup",
  icon: Rocket,
  subTabs: [
    { id: "setup-wizards", labelKey: "sections.setupWizards" },
  ],
},
```

3. Add to `CONTENT_MAP`:
```typescript
"setup-wizards": SetupWizardsTab,
```

4. Add to `legacyTabMap`:
```typescript
setup: { group: "setup", sub: "setup-wizards" },
```

**Step 3: Verify compilation and commit**

```bash
git add src/components/settings/setup-wizards-tab.tsx src/app/\(dashboard\)/settings/page.tsx
git commit -m "feat(wizard): add Setup settings group with setup wizards tab"
```

---

### Task 12: Empty State Takeover in Task Types Tab

> **Skills:** `interface-design`, `elite-animations`

**Files:**
- Modify: `src/components/settings/task-types-tab.tsx`

**Step 1: Add wizard empty state**

In `TaskTypesTab`, when `activeTypes.length === 0` and not loading, render `TaskTypesWizard` instead of the current empty state paragraph.

Modify the existing empty state branch:

```typescript
// Replace:
// <p className="font-mohave text-body-sm text-text-tertiary py-2">
//   {t("taskTypes.emptyState")}
// </p>

// With:
import { TaskTypesWizard } from "./task-types-wizard";

// In the component:
const [showWizard, setShowWizard] = useState(true);

// In the render, replace the empty state:
activeTypes.length === 0 && !isLoading ? (
  showWizard ? (
    <TaskTypesWizard onComplete={() => setShowWizard(false)} />
  ) : (
    <div className="text-center py-4 space-y-2">
      <p className="font-mohave text-body-sm text-text-tertiary">
        {t("taskTypes.emptyState")}
      </p>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setShowWizard(true)}
        className="gap-[4px]"
      >
        {t("setup.runSetup")}
      </Button>
    </div>
  )
) : // ... existing grid
```

Also add a "Run Setup Again" button in the header area when `activeTypes.length > 0`, allowing users to re-run the wizard.

**Step 2: Verify compilation and commit**

```bash
git add src/components/settings/task-types-tab.tsx
git commit -m "feat(wizard): add empty state takeover with wizard in task types tab"
```

---

### Task 13: Nudge System

> **Skills:** `ops-copywriter`

**Files:**
- Create: `src/components/settings/task-type-nudge-banner.tsx`
- Modify: `src/components/settings/task-types-tab.tsx` (add banner above content)

**Step 1: Create the nudge banner component**

A dismissible banner that shows when the user has completed onboarding but has zero task types.

```typescript
"use client";

import { useState } from "react";
import { X, ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useDictionary } from "@/i18n/client";

const DISMISS_KEY = "ops-task-type-nudge-dismissed";

interface TaskTypeNudgeBannerProps {
  variant?: "inline" | "dashboard"; // inline = within settings, dashboard = top banner
}

export function TaskTypeNudgeBanner({ variant = "inline" }: TaskTypeNudgeBannerProps) {
  const { t } = useDictionary("settings");
  const router = useRouter();
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(DISMISS_KEY) === "true";
  });

  if (dismissed) return null;

  function handleDismiss() {
    localStorage.setItem(DISMISS_KEY, "true");
    setDismissed(true);
  }

  return (
    <div className="flex items-center gap-2 px-3 py-[8px] rounded-md bg-[rgba(89,119,148,0.08)] border border-[rgba(89,119,148,0.15)]">
      <p className="flex-1 font-mohave text-body-sm text-text-secondary">
        {t("wizard.nudge.message")}
      </p>
      <button
        onClick={() => router.push("/settings?tab=task-types")}
        className="flex items-center gap-[4px] px-2 py-[4px] rounded font-mohave text-body-sm text-ops-accent hover:text-text-primary transition-colors shrink-0"
      >
        {t("wizard.nudge.cta")}
        <ArrowRight className="w-[12px] h-[12px]" />
      </button>
      <button
        onClick={handleDismiss}
        className="p-[2px] text-text-disabled hover:text-text-secondary transition-colors shrink-0"
      >
        <X className="w-[12px] h-[12px]" />
      </button>
    </div>
  );
}
```

**Step 2: Integrate the banner**

In `task-types-tab.tsx`, render the banner above the card when `activeTypes.length === 0` and the wizard is not showing.

**Step 3: Commit**

```bash
git add src/components/settings/task-type-nudge-banner.tsx src/components/settings/task-types-tab.tsx
git commit -m "feat(wizard): add dismissible nudge banner for task type setup"
```

---

### Task 14: Extract Industries List to Shared Constant

> **Skills:** None (refactor)

**Files:**
- Create: `src/lib/data/industries.ts`
- Modify: `src/components/setup/SetupIdentityStep.tsx` (import from shared constant)

**Step 1: Extract the 65-industry list**

The industry list is currently hardcoded in `SetupIdentityStep.tsx` (lines 17-80). Extract it to `src/lib/data/industries.ts` so both the onboarding flow and the wizard can share it.

```typescript
/** All supported industries in OPS, alphabetically sorted. */
export const INDUSTRIES: string[] = [
  "Architecture",
  "Auto Detailing",
  "Bricklaying",
  // ... all 65 ...
  "Windows",
  "Other",
];
```

Update `SetupIdentityStep.tsx` to import from the shared constant instead of defining inline.

**Step 2: Verify compilation and commit**

```bash
git add src/lib/data/industries.ts src/components/setup/SetupIdentityStep.tsx
git commit -m "refactor: extract industries list to shared constant"
```

---

### Task 15: TypeScript Compilation Verification & Visual Testing

**Files:** All files created/modified in tasks 1-14

**Step 1: Full compilation check**

Run: `npx tsc --noEmit`
Expected: No new errors from wizard files

**Step 2: Dev server test**

Run: `npm run dev`
Navigate to `/settings?tab=setup` — verify Setup tab appears
Navigate to `/settings?tab=task-types` — verify wizard appears in empty state
Walk through the full wizard flow

**Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix(wizard): resolve compilation and integration issues"
```

---

## Execution Summary

| Task | Description | Complexity |
|------|-------------|------------|
| 1 | i18n translations | Low |
| 2 | Curated color palette data | Low |
| 3 | Industry presets (65 trades) | High (data volume) |
| 4 | Color picker popover | Medium |
| 5 | Industry step (Step 1) | Medium |
| 6 | Task types step (Step 2) | High |
| 7 | Dependencies gate (Step 3) | Low |
| 8 | Dependency timeline (Step 4) | High (drag interactions) |
| 9 | Review & create (Step 5) | Medium |
| 10 | Wizard container | Medium |
| 11 | Setup wizards tab + settings registration | Medium |
| 12 | Empty state takeover | Low |
| 13 | Nudge banner | Low |
| 14 | Extract industries list | Low |
| 15 | Compilation & visual testing | Low |

**Critical path:** Tasks 1-3 (data) → 4-9 (wizard steps) → 10 (container) → 11-12 (integration) → 13-14 (polish) → 15 (verify)
