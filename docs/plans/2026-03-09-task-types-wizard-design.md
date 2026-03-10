# Task Types Setup Wizard — Design Document

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the confusing task types settings tab with a guided setup wizard that auto-suggests industry-specific task types, colors, templates, and dependencies — getting a new user from zero to fully configured in under 60 seconds.

**Architecture:** Empty-state takeover pattern — when no task types exist, the wizard replaces the tab content. After completion, transitions to the normal management view. A "Run Again" button in the new Setup hub lets users restart. Gentle nudge banners prompt users who haven't configured task types after signup.

**Tech Stack:** Next.js 14, React 18, TypeScript, Framer Motion 12, Zustand, TanStack Query, Tailwind CSS, Sonner toasts

**Design System:** No `.interface-design/system.md` exists — follow existing OPS-Web conventions (Mohave headings, Kosugi body, dark theme #0A0A0A, accent #597794)

**Required Skills:** `interface-design`, `elite-animations`, `ops-copywriter`

---

## 1. New Settings Group: "Setup"

A new top-level settings group added to `BASE_GROUP_DEFS` in `settings/page.tsx`.

- **Group ID:** `setup`
- **Label:** `tabs.setup` → "Setup"
- **Icon:** `Rocket` (from lucide-react)
- **Sub-tabs:** Single sub-tab `setup-wizards` → "Setup Guides"
- **Position:** Last in the group list (before Developer, if present)

### Setup Guides Tab Content

Cards for each available wizard, each showing:
- Wizard name and one-line description
- Completion status badge: "Not Started" / "Complete" / count (e.g., "6 task types configured")
- "Run Setup" or "Run Again" button
- Icon per wizard

Initial wizards:
- **Task Types** — "Configure the types of work your crew does"
- (Future: Inventory, Expenses, etc.)

---

## 2. Wizard Flow

### Step 1 — Industry Confirmation

**Data source:** `company.industries` from auth store.

**If industries exist:**
- Headline: "YOUR TRADE, YOUR TASKS" (Mohave, uppercase)
- Body: "You told us you're in **{industries.join(' & ')}**. We'll suggest task types based on that."
- Two buttons: "That's right" (primary) / "Change my trade" (ghost)
- Changing trade opens the same searchable multi-select from onboarding (65 industries)

**If industries are empty/null:**
- Headline: "WHAT DO YOU DO?"
- Body: "Tell us your trade and we'll set up your task types in seconds."
- Searchable multi-select (same 65-industry list from `SetupIdentityStep.tsx`)
- "Continue" button

**Copy tone (ops-copywriter):** Direct, zero fluff. The contractor should feel "these people know my world."

### Step 2 — Suggested Task Types

**Data source:** Industry presets (Section 4 below).

For multi-industry companies, presets are merged and deduplicated using cross-trade tags (e.g., "Inspection" appearing in both Roofing and Gutters only shows once).

**Layout:**
- Headline: "HERE'S WHAT WE'D SET UP" (Mohave, uppercase)
- Subtitle: "Toggle off anything you don't need. Tap a color to change it."
- Grid of task type cards (2 columns on desktop, 1 on mobile)

**Each card shows:**
- Toggle switch (ON by default)
- Color dot (auto-assigned from curated palette, tappable → opens color picker popover)
- Task type name (editable inline on click)
- Estimated hours badge
- Template count badge (e.g., "4 sub-tasks")
- Expand chevron → reveals template list

**Color guidance strip** at top of grid:
- Small visual showing color families: "Prep & structural → cool tones / Finishing & detail → warm tones / Admin & review → neutrals"
- This is informational only — colors are already auto-assigned following this logic

**"Add Custom Type" button** at bottom — opens inline form (name + color picker)

**Color picker popover:**
- Shows the curated palette (Section 5) organized by family
- Named colors from real paint companies
- No free-form hex input — pick from the palette only
- Tapping a swatch selects it and closes the popover

### Step 3 — Dependencies Gate

- Headline: "ONE MORE THING"
- Body: "Do any of these tasks need to finish before the next one starts?"
- Subtitle in smaller text: "Set up task dependencies"
- Two buttons: "Yes, set up dependencies" (primary) / "No, skip this" (ghost → jump to Step 5)

### Step 4 — Dependency Timeline

**Only shown if user said "Yes" in Step 3.**

- Headline: "DRAG TO ORDER. OVERLAP IF THEY RUN TOGETHER."
- Subtitle: "Tasks at the top start first. Drag edges to overlap."

**Visual:**
- Vertical list of colored horizontal bars (one per enabled task type)
- Bars are labeled with the task type name
- Default order is pre-populated from industry research dependency data
- **Drag to reorder:** Grab the bar body to move it up/down in sequence
- **Drag to overlap:** Grab the right edge of a bar to extend it rightward, overlapping with the bar below. This sets the `overlap_percentage` (0% = must finish first, 100% = full overlap / run simultaneously)
- Visual feedback: overlapping zone shown as a blended/striped area between the two bar colors
- Percentage label appears on the overlap zone (e.g., "20% overlap")

**Data mapping:**
- Bar order → sequence of `TaskTypeDependency` entries
- Each bar depends on the one above it (unless reordered to be first)
- Overlap drag → `overlap_percentage` value on the dependency

**"Looks good" button** → Step 5

### Step 5 — Review & Create

- Headline: "READY TO GO"
- Summary card showing:
  - Count of task types being created
  - Color dots with names in a compact list
  - Dependency chain visualization (if set up) — small version of the timeline
  - Template count total
- Single "Create All" button (primary, full-width)
- "Back" link to revisit previous steps

**On submit:**
- Batch-create all task types via `useCreateTaskType` mutations
- Batch-create all task templates via `useCreateTaskTemplate` mutations
- Update task type dependencies via `useUpdateTaskType` mutations
- If `company.industries` was changed in Step 1, update company via `useUpdateCompany`
- Show success state with a subtle animation
- Auto-transition to the normal task types management view after 2 seconds

---

## 3. Nudge System

**Trigger:** User has completed onboarding (`has_completed_onboarding = true`) but has zero task types (excluding deleted) after N days.

**Implementation:** Check in the dashboard layout or a global nudge provider:
```
const { data: taskTypes } = useTaskTypes();
const activeTypes = taskTypes?.filter(t => !t.deletedAt) ?? [];
const showNudge = activeTypes.length === 0 && user.hasCompletedOnboarding;
```

**Nudge banner:**
- Appears at top of the Task Types settings tab (above the empty state)
- Also appears as a subtle banner in the dashboard (dismissible)
- Copy: "Set up your task types. It takes 30 seconds and makes scheduling 10x easier."
- CTA: "Run Setup" → navigates to `/settings?tab=task-types`
- Dismissible (stores dismissal in localStorage)

---

## 4. Industry Presets

All 65 industries with researched task types, templates, dependency order, estimated hours, and cross-trade tags. Research sourced from BLS, trade-specific publications, and contractor resources.

### Tag System

Tags enable cross-industry deduplication and intelligent merging for multi-trade companies. A task type tagged `inspection` in Roofing is the same conceptual task as `inspection` in Electrical — when both industries are selected, only one "Inspection" type is created.

**Universal tags** (appear in 5+ industries):
- `inspection`, `cleanup`, `site-prep`, `installation`, `finishing`, `assessment`, `demolition`, `repair`, `testing`

**Trade-family tags:**
- Construction: `rough-in`, `trim-out`, `framing`, `forming`, `curing`, `grouting`
- MEP: `commissioning`, `equipment-set`, `electrical`, `plumbing`
- Service: `treatment`, `monitoring`, `follow-up`, `emergency`
- Design: `design`, `permitting`, `documentation`, `coordination`

### Presets by Industry

Each preset includes: task types in dependency order, typical hours, key sub-task templates, and tags.

#### Construction Trades

**Roofing**
1. Site Setup (2-3h) — tags: `site-prep`
2. Tear-Off (4-8h) — tags: `demolition`
3. Deck Inspection (1-2h) — tags: `inspection`
4. Deck Repair (2-4h) — tags: `repair`
5. Underlayment (2-4h) — tags: `installation`
6. Installation (8-16h) — tags: `installation`
7. Final Inspection (1-2h) — tags: `inspection`
8. Cleanup (1-2h) — tags: `cleanup`

**Electrical**
1. Site Assessment (2-4h) — tags: `assessment`
2. Rough-In (16-40h) — tags: `rough-in`
3. Rough Inspection (1-2h) — tags: `inspection`
4. Trim-Out (8-24h) — tags: `trim-out`
5. Panel Termination (2-4h) — tags: `electrical`
6. Testing & Startup (2-4h) — tags: `testing`
7. Final Inspection (1-2h) — tags: `inspection`
8. Punch List (1-4h) — tags: `finishing`

**Plumbing**
1. Underground Rough-In (8-16h) — tags: `rough-in`
2. Top-Out (12-24h) — tags: `rough-in`
3. Rough Inspection (1-2h) — tags: `inspection`
4. Trim-Out (8-16h) — tags: `trim-out`
5. Testing & Startup (2-4h) — tags: `testing`
6. Final Inspection (1-2h) — tags: `inspection`

**HVAC**
1. Load Calculation (2-4h) — tags: `assessment`
2. Rough-In (16-40h) — tags: `rough-in`
3. Rough Inspection (1-2h) — tags: `inspection`
4. Equipment Set (4-8h) — tags: `equipment-set`
5. Trim-Out (4-8h) — tags: `trim-out`
6. Startup & Commissioning (2-4h) — tags: `commissioning`, `testing`
7. Final Inspection (1-2h) — tags: `inspection`

**Painting**
1. Surface Prep (4-8h) — tags: `site-prep`
2. Priming (4-8h) — tags: `installation`
3. Paint Application (8-16h) — tags: `installation`
4. Trim & Detail (4-8h) — tags: `finishing`
5. Touch-Up (2-4h) — tags: `finishing`
6. Cleanup (1-2h) — tags: `cleanup`

**General Contracting**
1. Pre-Construction (8-16h) — tags: `assessment`, `permitting`
2. Site Prep (4-16h) — tags: `site-prep`
3. Foundation (16-40h) — tags: `forming`
4. Framing (40-120h) — tags: `framing`
5. Trade Coordination (4-8h recurring) — tags: `coordination`
6. Inspections (2-4h recurring) — tags: `inspection`
7. Finishes (16-40h) — tags: `finishing`
8. Punch List & Closeout (4-16h) — tags: `finishing`, `cleanup`

**Carpentry**
1. Layout & Marking (2-4h) — tags: `assessment`
2. Floor Framing (8-24h) — tags: `framing`
3. Wall Framing (16-40h) — tags: `framing`
4. Roof Framing (12-32h) — tags: `framing`
5. Sheathing & Drying In (8-16h) — tags: `installation`
6. Finish Carpentry (16-40h) — tags: `finishing`
7. Punch List (2-8h) — tags: `finishing`

**Concrete Finishing**
1. Site Prep (4-8h) — tags: `site-prep`
2. Forming (4-12h) — tags: `forming`
3. Rebar & Mesh (4-8h) — tags: `installation`
4. Pour (2-6h) — tags: `installation`
5. Finishing (4-8h) — tags: `finishing`
6. Curing & Protection (1-2h) — tags: `curing`
7. Cleanup (1-2h) — tags: `cleanup`

**Demolition**
1. Survey & Planning (4-8h) — tags: `assessment`
2. Abatement (8-40h) — tags: `demolition`
3. Utility Disconnect (2-8h) — tags: `demolition`
4. Soft Strip (8-24h) — tags: `demolition`
5. Structural Demo (8-40h) — tags: `demolition`
6. Debris Removal (4-16h) — tags: `cleanup`
7. Site Clearance (4-8h) — tags: `cleanup`, `site-prep`

**Drywall**
1. Site Prep (1-2h) — tags: `site-prep`
2. Board Hanging (4-16h) — tags: `installation`
3. Taping (2-6h) — tags: `finishing`
4. Mudding (3-8h) — tags: `finishing`
5. Sanding (2-4h) — tags: `finishing`
6. Priming (2-4h) — tags: `finishing`
7. Punch & Inspection (1-2h) — tags: `inspection`

**Flooring**
1. Site Assessment (1-2h) — tags: `assessment`
2. Demo & Removal (2-6h) — tags: `demolition`
3. Subfloor Prep (2-8h) — tags: `site-prep`
4. Installation (4-16h) — tags: `installation`
5. Trim & Transitions (2-4h) — tags: `finishing`
6. Cleanup & Walkthrough (1-2h) — tags: `cleanup`, `inspection`

**Insulation**
1. Site Survey (1-2h) — tags: `assessment`
2. Old Removal (2-6h) — tags: `demolition`
3. Air Sealing (2-4h) — tags: `installation`
4. Installation (3-8h) — tags: `installation`
5. Vapor Barrier (1-3h) — tags: `installation`
6. Inspection & Testing (1-2h) — tags: `inspection`, `testing`

**Fencing**
1. Survey & Layout (1-3h) — tags: `assessment`
2. Utility Marking (0h wait) — tags: `coordination`
3. Site Prep (1-3h) — tags: `site-prep`
4. Post Setting (4-8h) — tags: `installation`
5. Rail & Panel Install (4-8h) — tags: `installation`
6. Gate Installation (2-4h) — tags: `installation`
7. Finishing (1-3h) — tags: `finishing`

**Landscaping**
1. Site Analysis (2-4h) — tags: `assessment`
2. Demolition & Clearing (4-16h) — tags: `demolition`
3. Grading & Drainage (4-16h) — tags: `site-prep`
4. Irrigation Install (4-12h) — tags: `installation`, `plumbing`
5. Hardscape (8-40h) — tags: `installation`
6. Softscape & Planting (4-16h) — tags: `installation`
7. Lighting & Features (2-8h) — tags: `electrical`
8. Cleanup & Walkthrough (2-4h) — tags: `cleanup`, `inspection`

**Deck Construction**
1. Design & Permits (2-4h) — tags: `assessment`, `permitting`
2. Site Prep (2-4h) — tags: `site-prep`
3. Footings & Foundation (4-8h) — tags: `forming`
4. Framing (6-16h) — tags: `framing`
5. Decking (4-12h) — tags: `installation`
6. Railings & Stairs (4-12h) — tags: `installation`
7. Finishing (2-6h) — tags: `finishing`
8. Inspection (1-2h) — tags: `inspection`

**Deck Surfacing**
1. Inspection (1-2h) — tags: `assessment`
2. Structural Repair (2-8h) — tags: `repair`
3. Board Removal (2-6h) — tags: `demolition`
4. New Surface Install (4-12h) — tags: `installation`
5. Cleaning & Prep (2-4h) — tags: `site-prep`
6. Sealing & Finishing (2-4h) — tags: `finishing`
7. Final Walkthrough (0.5-1h) — tags: `inspection`

**Siding**
1. Site Assessment (1-2h) — tags: `assessment`
2. Old Siding Removal (4-16h) — tags: `demolition`
3. Wall Repair & Prep (2-8h) — tags: `repair`
4. Flashing & Trim (2-6h) — tags: `installation`
5. Siding Installation (8-24h) — tags: `installation`
6. Caulking & Sealing (1-3h) — tags: `finishing`
7. Detail & Finishing (2-4h) — tags: `finishing`
8. Cleanup & Inspection (1-2h) — tags: `cleanup`, `inspection`

**Masonry**
1. Site Prep (2-4h) — tags: `site-prep`
2. Layout & Markup (1-3h) — tags: `assessment`
3. Scaffolding Setup (2-4h) — tags: `site-prep`
4. Block Laying (8-40h) — tags: `installation`
5. Grouting & Fill (4-8h) — tags: `grouting`
6. Pointing & Joints (3-8h) — tags: `finishing`
7. Curing & Protection (2-4h) — tags: `curing`
8. Cleanup & Inspection (2-4h) — tags: `cleanup`, `inspection`

**Bricklaying**
1. Site Prep (2-4h) — tags: `site-prep`
2. Layout & Markup (1-3h) — tags: `assessment`
3. Scaffolding Setup (2-4h) — tags: `site-prep`
4. Brick Laying (8-40h) — tags: `installation`
5. Pointing & Jointing (3-8h) — tags: `finishing`
6. Curing (2-4h) — tags: `curing`
7. Cleanup & Punch List (2-4h) — tags: `cleanup`, `inspection`

**Tile Setting**
1. Surface Prep (2-6h) — tags: `site-prep`
2. Waterproofing (2-4h) — tags: `installation`
3. Layout & Dry Fit (1-3h) — tags: `assessment`
4. Tile Setting (4-16h) — tags: `installation`
5. Grouting (2-6h) — tags: `grouting`
6. Sealing & Finish (1-3h) — tags: `finishing`
7. Cleanup & Inspection (1-2h) — tags: `cleanup`, `inspection`

**Stonework**
1. Site Prep (2-4h) — tags: `site-prep`
2. Surface Prep (2-6h) — tags: `site-prep`
3. Stone Selection & Layout (2-4h) — tags: `assessment`
4. Stone Setting (8-40h) — tags: `installation`
5. Pointing & Grouting (3-8h) — tags: `grouting`, `finishing`
6. Sealing & Curing (2-4h) — tags: `curing`, `finishing`
7. Cleanup & Inspection (2-3h) — tags: `cleanup`, `inspection`

**Excavation**
1. Survey & Staking (2-4h) — tags: `assessment`
2. Clearing & Grubbing (4-16h) — tags: `demolition`
3. Rough Grading (4-16h) — tags: `site-prep`
4. Trenching (4-24h) — tags: `installation`
5. Foundation Excavation (4-16h) — tags: `installation`
6. Backfill & Compaction (4-16h) — tags: `installation`
7. Finish Grading (4-8h) — tags: `finishing`
8. Final Inspection (1-3h) — tags: `inspection`

**Paving**
1. Demolition (4-16h) — tags: `demolition`
2. Grading & Drainage (4-8h) — tags: `site-prep`
3. Base Installation (4-8h) — tags: `installation`
4. Binder Course (3-6h) — tags: `installation`
5. Surface Paving (4-12h) — tags: `installation`
6. Compaction & Curing (2-4h) — tags: `curing`
7. Striping & Markings (2-6h) — tags: `finishing`
8. Final Inspection (1-2h) — tags: `inspection`

**Waterproofing**
1. Excavation & Expose (4-16h) — tags: `demolition`
2. Surface Cleaning (2-4h) — tags: `site-prep`
3. Repairs & Parging (2-8h) — tags: `repair`
4. Membrane Application (4-12h) — tags: `installation`
5. Drainage Install (3-8h) — tags: `installation`, `plumbing`
6. Flood Testing (2-4h) — tags: `testing`
7. Backfill & Grade (4-8h) — tags: `finishing`
8. Final Inspection (1-2h) — tags: `inspection`

**Windows**
1. Measurement & Order (1-2h) — tags: `assessment`
2. Interior Prep (1-3h) — tags: `site-prep`
3. Removal (2-6h) — tags: `demolition`
4. Opening Prep (2-4h) — tags: `repair`
5. Window Install (3-8h) — tags: `installation`
6. Sealing & Trim (3-6h) — tags: `finishing`
7. Final Inspection (1-2h) — tags: `inspection`

**Solar Installation**
1. Site Assessment (2-4h) — tags: `assessment`
2. Permitting (1-2h active) — tags: `permitting`
3. Roof Prep (2-4h) — tags: `site-prep`
4. Racking & Mounting (3-6h) — tags: `installation`
5. Panel Install (3-6h) — tags: `installation`
6. Electrical Work (3-6h) — tags: `electrical`
7. System Testing (1-2h) — tags: `testing`
8. Inspection & Commission (1-2h) — tags: `inspection`, `commissioning`

#### Specialty Trades

**Glazing**
1. Field Measure (2-4h) — tags: `assessment`
2. Shop Fabrication (4-8h) — tags: `installation`
3. Frame Install (4-8h) — tags: `installation`
4. Glass Setting (3-6h) — tags: `installation`
5. Sealing & Caulk (2-4h) — tags: `finishing`
6. Waterproofing (2-4h) — tags: `installation`
7. Punch & Inspect (1-3h) — tags: `inspection`

**Sheet Metal**
1. Detailing & Layout (2-4h) — tags: `assessment`
2. Shop Fabrication (4-8h) — tags: `installation`
3. Hanger Install (2-4h) — tags: `installation`
4. Duct Install (4-8h) — tags: `installation`
5. Sealing & Insulate (2-4h) — tags: `finishing`
6. TAB Prep (1-3h) — tags: `commissioning`
7. Final Inspection (1-2h) — tags: `inspection`

**Metal Fabrication**
1. Engineering Review (2-4h) — tags: `assessment`
2. Material Prep (1-3h) — tags: `site-prep`
3. Cutting (2-6h) — tags: `installation`
4. Forming & Bending (2-6h) — tags: `installation`
5. Welding & Assembly (4-8h) — tags: `installation`
6. Finishing (2-6h) — tags: `finishing`
7. Quality Control (1-3h) — tags: `inspection`
8. Pack & Ship (1-2h) — tags: `cleanup`

**Welding**
1. WPS Review (1-2h) — tags: `assessment`
2. Joint Prep (2-4h) — tags: `site-prep`
3. Welding (4-8h) — tags: `installation`
4. Post-Weld Treat (1-4h) — tags: `curing`
5. Visual Inspection (1-2h) — tags: `inspection`
6. NDT Testing (2-6h) — tags: `testing`
7. Repair & Rework (2-4h) — tags: `repair`
8. Coating & Finish (1-3h) — tags: `finishing`

**Scaffolding**
1. Site Survey (1-2h) — tags: `assessment`
2. Scaffold Design (2-4h) — tags: `assessment`
3. Base Setup (1-3h) — tags: `site-prep`
4. Erection (4-12h) — tags: `installation`
5. Tie-In & Brace (1-3h) — tags: `installation`
6. Safety Inspection (1-2h) — tags: `inspection`
7. Modification (2-4h) — tags: `installation`
8. Dismantle (3-8h) — tags: `demolition`

**Rebar**
1. Drawing Review (1-3h) — tags: `assessment`
2. Material Staging (1-3h) — tags: `site-prep`
3. Cutting & Bending (2-6h) — tags: `installation`
4. Placement (4-8h) — tags: `installation`
5. Tying (3-6h) — tags: `installation`
6. Pre-Pour Inspect (1-2h) — tags: `inspection`
7. Pour Support (2-4h) — tags: `coordination`

**Crane Operation**
1. Lift Planning (2-4h) — tags: `assessment`
2. Site Assessment (1-3h) — tags: `assessment`
3. Mobilization (2-8h) — tags: `site-prep`
4. Crane Setup (2-6h) — tags: `installation`
5. Rigging (1-3h) — tags: `installation`
6. Lifting Ops (2-8h) — tags: `installation`
7. Demobilization (2-6h) — tags: `cleanup`

**Millwrighting**
1. Pre-Install Plan (2-4h) — tags: `assessment`
2. Receiving & Stage (2-4h) — tags: `site-prep`
3. Rigging & Setting (2-8h) — tags: `installation`
4. Leveling & Grout (3-6h) — tags: `grouting`
5. Alignment (2-6h) — tags: `installation`
6. Mechanical Hookup (2-4h) — tags: `installation`
7. Testing & Commish (2-4h) — tags: `commissioning`, `testing`
8. Punch & Handover (1-2h) — tags: `inspection`

**Surveying**
1. Control Setup (2-4h) — tags: `assessment`
2. Topo Survey (3-6h) — tags: `assessment`
3. Boundary Survey (3-6h) — tags: `assessment`
4. Construction Stake (2-6h) — tags: `installation`
5. Foundation Layout (2-4h) — tags: `installation`
6. Progress Check (1-3h) — tags: `inspection`
7. As-Built Survey (2-4h) — tags: `inspection`

#### Exterior / Site Trades

**Gutter Installation**
1. Site Inspection (1-2h) — tags: `assessment`
2. Old Gutter Removal (1-3h) — tags: `demolition`
3. Fascia Repair (1-4h) — tags: `repair`
4. Measurement & Layout (1-2h) — tags: `assessment`
5. Gutter Fabrication (1-3h) — tags: `installation`
6. Gutter Installation (2-6h) — tags: `installation`
7. Downspout Install (1-2h) — tags: `installation`
8. Final Inspection (0.5-1h) — tags: `inspection`

**Garage Doors**
1. Site Assessment (1-2h) — tags: `assessment`
2. Old Door Removal (1-3h) — tags: `demolition`
3. Frame Prep (1-2h) — tags: `site-prep`
4. Track Installation (1-2h) — tags: `installation`
5. Panel & Hardware (2-4h) — tags: `installation`
6. Spring Setup (1-2h) — tags: `installation`
7. Opener Install (1-2h) — tags: `electrical`
8. Testing & Handoff (0.5-1h) — tags: `testing`, `inspection`

**Septic Services**
1. Site Evaluation (2-4h) — tags: `assessment`
2. Design & Permitting (4-16h) — tags: `permitting`
3. Excavation (4-8h) — tags: `demolition`
4. Tank Installation (3-6h) — tags: `installation`
5. Drain Field Build (4-8h) — tags: `installation`
6. Final Inspection (1-3h) — tags: `inspection`
7. Backfill & Grading (2-4h) — tags: `finishing`

**Irrigation**
1. Site Survey (1-3h) — tags: `assessment`
2. System Design (2-4h) — tags: `assessment`
3. Trenching (2-6h) — tags: `site-prep`
4. Pipe & Valve Install (3-6h) — tags: `installation`, `plumbing`
5. Head Installation (2-4h) — tags: `installation`
6. Controller Setup (1-2h) — tags: `electrical`
7. System Testing (1-2h) — tags: `testing`
8. Backfill & Cleanup (1-3h) — tags: `cleanup`

**Pool Services**
1. Site Assessment (2-4h) — tags: `assessment`
2. Excavation (4-8h) — tags: `demolition`
3. Steel & Plumbing (6-12h) — tags: `installation`, `plumbing`
4. Shell Application (4-8h) — tags: `installation`
5. Tile & Coping (4-8h) — tags: `finishing`
6. Equipment Set (4-6h) — tags: `equipment-set`, `electrical`
7. Plaster & Fill (4-8h) — tags: `finishing`
8. Final Startup (2-4h) — tags: `commissioning`, `inspection`

**Chimney Services**
1. Chimney Inspection (1-2h) — tags: `assessment`
2. Area Protection (0.5-1h) — tags: `site-prep`
3. Chimney Sweep (1-3h) — tags: `cleanup`
4. Masonry Repair (2-6h) — tags: `repair`
5. Liner Work (3-6h) — tags: `installation`
6. Cap & Flashing (1-3h) — tags: `installation`
7. Final Inspection (0.5-1h) — tags: `inspection`

**Ceiling Installations**
1. Site Measure (1-2h) — tags: `assessment`
2. Prep & Demo (2-6h) — tags: `demolition`
3. Framing / Grid (3-8h) — tags: `framing`
4. Panel / Board Set (3-8h) — tags: `installation`
5. Finishing (3-8h) — tags: `finishing`
6. Fixture Install (1-3h) — tags: `electrical`
7. Final Inspection (0.5-1h) — tags: `inspection`

**Cabinetry**
1. Field Measure (1-3h) — tags: `assessment`
2. Design & Order (4-8h) — tags: `assessment`
3. Site Prep (2-6h) — tags: `demolition`, `site-prep`
4. Base Cabinet Set (3-6h) — tags: `installation`
5. Upper Cabinet Set (3-6h) — tags: `installation`
6. Trim & Hardware (2-4h) — tags: `finishing`
7. Door & Drawer Adjust (1-3h) — tags: `finishing`
8. Final Punch (0.5-1h) — tags: `inspection`

**Railings**
1. Site Measure (1-2h) — tags: `assessment`
2. Design & Material (2-4h) — tags: `assessment`
3. Fabrication (4-16h) — tags: `installation`
4. Surface Prep (1-3h) — tags: `site-prep`
5. Post & Rail Set (2-6h) — tags: `installation`
6. Baluster / Infill (2-6h) — tags: `installation`
7. Finishing (1-4h) — tags: `finishing`
8. Final Inspection (0.5-1h) — tags: `inspection`

#### Service Trades

**Lawn Care**
1. Mowing & Edging (0.5-2h) — tags: `installation`
2. Fertilization (0.5-1.5h) — tags: `treatment`
3. Weed Control (0.5-1.5h) — tags: `treatment`
4. Aeration (1-3h) — tags: `installation`
5. Dethatching (1-3h) — tags: `cleanup`
6. Overseeding (1-2h) — tags: `installation`
7. Leaf/Debris Cleanup (1-3h) — tags: `cleanup`

**Pest Control**
1. Site Inspection (0.5h) — tags: `assessment`
2. Exclusion Work (1h) — tags: `installation`
3. Bait Placement (0.5h) — tags: `treatment`
4. Chemical Treatment (1h) — tags: `treatment`
5. Monitoring Setup (0.25h) — tags: `monitoring`
6. Follow-Up Visit (0.5h) — tags: `follow-up`
7. Final Walkthrough (0.25h) — tags: `inspection`

**Power Washing**
1. Site Assessment (0.25h) — tags: `assessment`
2. Area Prep (0.5h) — tags: `site-prep`
3. Detergent Application (0.5h) — tags: `treatment`
4. Pressure Washing (2h) — tags: `installation`
5. Rinse & Detail (0.5h) — tags: `finishing`
6. Site Restoration (0.25h) — tags: `cleanup`

**Window Cleaning**
1. Walk-Through (0.25h) — tags: `assessment`
2. Safety Setup (0.5h) — tags: `site-prep`
3. Scrape & Scrub (0.75h) — tags: `installation`
4. Squeegee Clean (1h) — tags: `installation`
5. Screen Cleaning (0.5h) — tags: `cleanup`
6. Sill & Track Detail (0.25h) — tags: `finishing`
7. Final Inspection (0.25h) — tags: `inspection`

**House Cleaning**
1. Client Walkthrough (0.25h) — tags: `assessment`
2. Kitchen Clean (1h) — tags: `installation`
3. Bathroom Clean (0.75h) — tags: `installation`
4. Bedroom Clean (0.5h) — tags: `installation`
5. Living Area Clean (0.5h) — tags: `installation`
6. Detail Work (0.5h) — tags: `finishing`
7. Quality Check (0.25h) — tags: `inspection`

**Carpet Cleaning**
1. Pre-Inspection (0.25h) — tags: `assessment`
2. Furniture Moving (0.25h) — tags: `site-prep`
3. Pre-Vacuum (0.25h) — tags: `site-prep`
4. Pre-Treatment (0.5h) — tags: `treatment`
5. Agitation (0.25h) — tags: `treatment`
6. Hot Water Extraction (1h) — tags: `installation`
7. Post-Spot Treatment (0.25h) — tags: `treatment`
8. Groom & Dry (0.25h) — tags: `cleanup`

**Junk Removal**
1. On-Site Estimate (0.25h) — tags: `assessment`
2. Item Sorting (0.5h) — tags: `assessment`
3. Disassembly (0.5h) — tags: `demolition`
4. Loading (1h) — tags: `installation`
5. Site Cleanup (0.25h) — tags: `cleanup`
6. Disposal & Recycling (1h) — tags: `cleanup`

**Moving Services**
1. Pre-Move Survey (0.5h) — tags: `assessment`
2. Packing (3h) — tags: `installation`
3. Loading (2h) — tags: `installation`
4. Transportation (1.5h) — tags: `installation`
5. Unloading (1.5h) — tags: `installation`
6. Reassembly & Setup (1h) — tags: `finishing`
7. Final Walk-Through (0.25h) — tags: `inspection`

**Snow Removal**
1. Storm Monitoring (0.25h) — tags: `monitoring`
2. Pre-Treatment (0.25h) — tags: `treatment`
3. Plowing (0.5h) — tags: `installation`
4. Walkway Clearing (0.5h) — tags: `installation`
5. Salt & De-Ice (0.25h) — tags: `treatment`
6. Return Visit (0.5h) — tags: `follow-up`

**Locksmith**
1. Service Assessment (0.25h) — tags: `assessment`
2. Lock Rekeying (0.5h) — tags: `installation`
3. Lock Replacement (0.75h) — tags: `installation`
4. Smart Lock Install (1.25h) — tags: `installation`, `electrical`
5. Emergency Lockout (0.5h) — tags: `emergency`
6. Security Upgrade (1h) — tags: `installation`

#### Professional Services

**Handyman Services**
1. Site Assessment (0.5-1h) — tags: `assessment`
2. Material Procurement (1-2h) — tags: `site-prep`
3. Surface Prep (0.5-2h) — tags: `site-prep`
4. Rough Repair (1-4h) — tags: `repair`
5. Installation (1-6h) — tags: `installation`
6. Finishing (1-3h) — tags: `finishing`
7. Cleanup (0.5-1h) — tags: `cleanup`
8. Walkthrough (0.25-0.5h) — tags: `inspection`

**Renovations**
1. Site Assessment (2-8h) — tags: `assessment`
2. Design & Planning (8-40h) — tags: `assessment`, `permitting`
3. Permitting (2-8h) — tags: `permitting`
4. Demolition (4-40h) — tags: `demolition`
5. Rough-In (8-80h) — tags: `rough-in`
6. Finishing (8-60h) — tags: `finishing`
7. Final Install (4-24h) — tags: `installation`
8. Punch List (2-8h) — tags: `finishing`, `inspection`

**Architecture**
1. Pre-Design (8-40h) — tags: `assessment`
2. Schematic Design (20-80h) — tags: `assessment`
3. Design Development (40-120h) — tags: `installation`
4. Construction Docs (60-200h) — tags: `documentation`
5. Bidding (8-24h) — tags: `coordination`
6. Permit Review (4-16h) — tags: `permitting`
7. Construction Admin (20-160h) — tags: `coordination`, `inspection`
8. Closeout (4-16h) — tags: `inspection`

**Consulting**
1. Discovery (4-16h) — tags: `assessment`
2. Analysis (8-40h) — tags: `assessment`
3. Strategy (8-24h) — tags: `assessment`
4. Presentation (4-12h) — tags: `documentation`
5. Implementation (16-80h) — tags: `installation`
6. Review (4-16h) — tags: `inspection`
7. Handoff (2-8h) — tags: `inspection`

**Auto Detailing**
1. Vehicle Assessment (0.25-0.5h) — tags: `assessment`
2. Exterior Wash (0.5-1h) — tags: `site-prep`
3. Decontamination (0.5-1h) — tags: `treatment`
4. Paint Correction (2-8h) — tags: `installation`
5. Protection (1-3h) — tags: `finishing`
6. Interior Detail (1-4h) — tags: `installation`
7. Final Inspection (0.25-0.5h) — tags: `inspection`

**Tree Services**
1. Site Assessment (0.5-2h) — tags: `assessment`
2. Crew Setup (0.5-1h) — tags: `site-prep`
3. Pruning/Trimming (1-6h) — tags: `installation`
4. Tree Removal (2-8h) — tags: `demolition`
5. Stump Grinding (0.5-2h) — tags: `demolition`
6. Debris Management (1-4h) — tags: `cleanup`
7. Site Restoration (0.5-2h) — tags: `cleanup`

**Vinyl Deck Membranes**
1. Site Assessment (1-2h) — tags: `assessment`
2. Substrate Prep (2-8h) — tags: `site-prep`
3. Surface Prep (1-4h) — tags: `site-prep`
4. Layout & Cutting (0.5-2h) — tags: `assessment`
5. Adhesive & Install (2-6h) — tags: `installation`
6. Seam Welding (1-3h) — tags: `installation`
7. Finishing (0.5-2h) — tags: `finishing`
8. Final Inspection (0.5-1h) — tags: `inspection`

**Other (Generic)**
1. Assessment (1-4h) — tags: `assessment`
2. Planning (1-4h) — tags: `assessment`
3. Site Prep (1-4h) — tags: `site-prep`
4. Execution (2-16h) — tags: `installation`
5. Quality Check (0.5-2h) — tags: `inspection`
6. Cleanup (0.5-2h) — tags: `cleanup`

---

## 5. Curated Color Palette

**Pending:** Color research from real paint company swatches (Farrow & Ball, Benjamin Moore, Sherwin-Williams, Japanese traditional colors) is being compiled. All colors will be:

- Desaturated/pastel — consistent with OPS dark interface
- Visible against #0A0A0A background
- Distinguishable as 12px dots
- Named (from real paint collections)
- Organized into 5 families for auto-assignment logic

### Auto-Assignment Logic

Colors are assigned to task types based on their tags:

| Task Category (by tag) | Color Family |
|------------------------|-------------|
| `assessment`, `permitting`, `documentation` | Neutral/Warm Gray family |
| `site-prep`, `demolition`, `repair` | Warm tones (muted terracotta, sand, clay) |
| `rough-in`, `framing`, `installation` | Cool tones (muted blue, slate, teal) |
| `finishing`, `grouting`, `curing` | Green/Sage family |
| `inspection`, `testing`, `commissioning`, `cleanup` | Purple/Lavender family |

This creates natural color grouping where similar work phases share similar hues — exactly as the user described for crew-based color affinity.

---

## 6. Data Model

No schema changes required. The wizard creates standard `TaskType` and `TaskTemplate` records using existing APIs. The `TaskTypeDependency` structure (`depends_on_task_type_id` + `overlap_percentage`) already supports everything the dependency timeline needs.

### New: Industry Presets Data File

A new TypeScript file stores all preset data:
```
src/lib/data/industry-presets.ts
```

Exports:
- `INDUSTRY_PRESETS: Record<string, IndustryPreset>` — keyed by industry name (matching the 65 from onboarding)
- `CURATED_COLORS: CuratedColor[]` — the palette
- `COLOR_FAMILIES: Record<string, string[]>` — tag-to-color-family mapping
- `mergePresets(industries: string[]): MergedPreset` — deduplicates by tag for multi-industry companies

---

## 7. Component Architecture

### New Files
- `src/components/settings/setup-wizards-tab.tsx` — Setup hub with wizard cards
- `src/components/settings/task-types-wizard.tsx` — Main wizard container (step management)
- `src/components/settings/wizard/industry-step.tsx` — Step 1
- `src/components/settings/wizard/task-types-step.tsx` — Step 2
- `src/components/settings/wizard/dependencies-gate-step.tsx` — Step 3
- `src/components/settings/wizard/dependency-timeline-step.tsx` — Step 4
- `src/components/settings/wizard/review-step.tsx` — Step 5
- `src/components/settings/wizard/color-picker-popover.tsx` — Curated palette picker
- `src/components/settings/wizard/dependency-bar.tsx` — Draggable timeline bar
- `src/lib/data/industry-presets.ts` — All preset data

### Modified Files
- `src/app/(dashboard)/settings/page.tsx` — Add `setup` group to `BASE_GROUP_DEFS`
- `src/components/settings/task-types-tab.tsx` — Add wizard empty-state takeover
- `src/i18n/dictionaries/en/settings.json` — New translation keys
- `src/i18n/dictionaries/es/settings.json` — Spanish translations

---

## 8. Copy Guidelines

All user-facing copy must follow the OPS Copywriter voice:
- **Headlines:** Mohave, ALL CAPS, 5-10 words, truck-radio test
- **Body:** Kosugi, plain language, 8th grade reading level
- **Tone:** 60% Jocko (discipline, no filler) / 20% Springsteen (working-class dignity) / 20% Musk (first-principles clarity)
- **Never:** Corporate jargon, tech-speak, passive voice, exclamation points, hedging language

### Draft Copy for Each Step

**Step 1 (industries known):**
- Headline: "YOUR TRADE, YOUR TASKS"
- Body: "You told us you work in {industries}. We put together a setup based on that."

**Step 1 (industries unknown):**
- Headline: "WHAT DO YOU DO?"
- Body: "Tell us your trade. We'll handle the rest."

**Step 2:**
- Headline: "HERE'S WHAT WE'D SET UP"
- Body: "Toggle off what you don't need. Tap a color to change it."

**Step 3:**
- Headline: "ONE MORE THING"
- Body: "Do any of these tasks need to finish before the next one starts?"
- Subtitle: "Set up task dependencies"

**Step 4:**
- Headline: "DRAG TO ORDER. OVERLAP IF THEY RUN TOGETHER."
- Body: "Tasks at the top start first. Drag edges to show overlap."

**Step 5:**
- Headline: "READY TO GO"
- Body: "{count} task types. {templateCount} sub-tasks. Set up in {elapsed} seconds."

**Nudge banner:**
- "Set up your task types. 30 seconds. Makes scheduling 10x easier."

---

## 9. Animation Notes

Use `elite-animations` skill (Framer Motion tier) for:
- Step transitions (horizontal slide with `AnimatePresence`)
- Task type cards toggle animation (scale + opacity spring)
- Dependency bar drag feedback (spring physics on `useMotionValue`)
- Overlap zone reveal animation (width expand with spring)
- Success state (subtle confetti or checkmark scale-in)
- Color picker popover (scale-in from dot origin)

All animations: 60fps target, GPU-composited (`transform` + `opacity`), reduced-motion fallbacks.
