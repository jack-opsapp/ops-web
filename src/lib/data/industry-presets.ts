import { autoAssignColors } from "./curated-colors";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PresetTaskType {
  name: string;
  tags: string[];
  estimatedHoursMin: number;
  estimatedHoursMax: number;
}

export interface IndustryPreset {
  industry: string;
  taskTypes: PresetTaskType[]; // In dependency order (index 0 = first)
}

export interface MergedTaskType extends PresetTaskType {
  color: string;
  sourceIndustries: string[];
  alsoIn: string[];
}

export interface IndustryGroup {
  industry: string;
  taskTypes: MergedTaskType[];
}

export interface MergedPreset {
  groups: IndustryGroup[];
}

// ─── Preset Data ──────────────────────────────────────────────────────────────

export const INDUSTRY_PRESETS: Record<string, IndustryPreset> = {
  "Roofing": {
    industry: "Roofing",
    taskTypes: [
      {
        name: "Site Setup",
        tags: ["site-prep"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 3,
      },
      {
        name: "Tear-Off",
        tags: ["demolition"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 8,
      },
      {
        name: "Deck Inspection",
        tags: ["inspection"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
      },
      {
        name: "Deck Repair",
        tags: ["repair"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
      {
        name: "Underlayment",
        tags: ["installation"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
      {
        name: "Installation",
        tags: ["installation"],
        estimatedHoursMin: 8,
        estimatedHoursMax: 16,
      },
      {
        name: "Final Inspection",
        tags: ["inspection"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
      },
      {
        name: "Cleanup",
        tags: ["cleanup"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
      },
    ],
  },
  "Electrical": {
    industry: "Electrical",
    taskTypes: [
      {
        name: "Site Assessment",
        tags: ["assessment"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
      {
        name: "Rough-In",
        tags: ["rough-in"],
        estimatedHoursMin: 16,
        estimatedHoursMax: 40,
      },
      {
        name: "Rough Inspection",
        tags: ["inspection"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
      },
      {
        name: "Trim-Out",
        tags: ["trim-out"],
        estimatedHoursMin: 8,
        estimatedHoursMax: 24,
      },
      {
        name: "Panel Termination",
        tags: ["electrical"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
      {
        name: "Testing & Startup",
        tags: ["testing"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
      {
        name: "Final Inspection",
        tags: ["inspection"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
      },
      {
        name: "Punch List",
        tags: ["finishing"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 4,
      },
    ],
  },
  "Plumbing": {
    industry: "Plumbing",
    taskTypes: [
      {
        name: "Underground Rough-In",
        tags: ["rough-in"],
        estimatedHoursMin: 8,
        estimatedHoursMax: 16,
      },
      {
        name: "Top-Out",
        tags: ["rough-in"],
        estimatedHoursMin: 12,
        estimatedHoursMax: 24,
      },
      {
        name: "Rough Inspection",
        tags: ["inspection"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
      },
      {
        name: "Trim-Out",
        tags: ["trim-out"],
        estimatedHoursMin: 8,
        estimatedHoursMax: 16,
      },
      {
        name: "Testing & Startup",
        tags: ["testing"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
      {
        name: "Final Inspection",
        tags: ["inspection"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
      },
    ],
  },
  "HVAC": {
    industry: "HVAC",
    taskTypes: [
      {
        name: "Load Calculation",
        tags: ["assessment"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
      {
        name: "Rough-In",
        tags: ["rough-in"],
        estimatedHoursMin: 16,
        estimatedHoursMax: 40,
      },
      {
        name: "Rough Inspection",
        tags: ["inspection"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
      },
      {
        name: "Equipment Set",
        tags: ["equipment-set"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 8,
      },
      {
        name: "Trim-Out",
        tags: ["trim-out"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 8,
      },
      {
        name: "Startup & Commissioning",
        tags: ["commissioning", "testing"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
      {
        name: "Final Inspection",
        tags: ["inspection"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
      },
    ],
  },
  "Painting": {
    industry: "Painting",
    taskTypes: [
      {
        name: "Surface Prep",
        tags: ["site-prep"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 8,
      },
      {
        name: "Priming",
        tags: ["installation"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 8,
      },
      {
        name: "Paint Application",
        tags: ["installation"],
        estimatedHoursMin: 8,
        estimatedHoursMax: 16,
      },
      {
        name: "Trim & Detail",
        tags: ["finishing"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 8,
      },
      {
        name: "Touch-Up",
        tags: ["finishing"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
      {
        name: "Cleanup",
        tags: ["cleanup"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
      },
    ],
  },
  "General Contracting": {
    industry: "General Contracting",
    taskTypes: [
      {
        name: "Pre-Construction",
        tags: ["assessment", "permitting"],
        estimatedHoursMin: 8,
        estimatedHoursMax: 16,
      },
      {
        name: "Site Prep",
        tags: ["site-prep"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 16,
      },
      {
        name: "Foundation",
        tags: ["forming"],
        estimatedHoursMin: 16,
        estimatedHoursMax: 40,
      },
      {
        name: "Framing",
        tags: ["framing"],
        estimatedHoursMin: 40,
        estimatedHoursMax: 120,
      },
      {
        name: "Trade Coordination",
        tags: ["coordination"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 8,
      },
      {
        name: "Inspections",
        tags: ["inspection"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
      {
        name: "Finishes",
        tags: ["finishing"],
        estimatedHoursMin: 16,
        estimatedHoursMax: 40,
      },
      {
        name: "Punch List & Closeout",
        tags: ["finishing", "cleanup"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 16,
      },
    ],
  },
  "Carpentry": {
    industry: "Carpentry",
    taskTypes: [
      {
        name: "Layout & Marking",
        tags: ["assessment"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
      {
        name: "Floor Framing",
        tags: ["framing"],
        estimatedHoursMin: 8,
        estimatedHoursMax: 24,
      },
      {
        name: "Wall Framing",
        tags: ["framing"],
        estimatedHoursMin: 16,
        estimatedHoursMax: 40,
      },
      {
        name: "Roof Framing",
        tags: ["framing"],
        estimatedHoursMin: 12,
        estimatedHoursMax: 32,
      },
      {
        name: "Sheathing & Drying In",
        tags: ["installation"],
        estimatedHoursMin: 8,
        estimatedHoursMax: 16,
      },
      {
        name: "Finish Carpentry",
        tags: ["finishing"],
        estimatedHoursMin: 16,
        estimatedHoursMax: 40,
      },
      {
        name: "Punch List",
        tags: ["finishing"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 8,
      },
    ],
  },
  "Concrete Finishing": {
    industry: "Concrete Finishing",
    taskTypes: [
      {
        name: "Site Prep",
        tags: ["site-prep"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 8,
      },
      {
        name: "Forming",
        tags: ["forming"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 12,
      },
      {
        name: "Rebar & Mesh",
        tags: ["installation"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 8,
      },
      {
        name: "Pour",
        tags: ["installation"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 6,
      },
      {
        name: "Finishing",
        tags: ["finishing"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 8,
      },
      {
        name: "Curing & Protection",
        tags: ["curing"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
      },
      {
        name: "Cleanup",
        tags: ["cleanup"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
      },
    ],
  },
  "Demolition": {
    industry: "Demolition",
    taskTypes: [
      {
        name: "Survey & Planning",
        tags: ["assessment"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 8,
      },
      {
        name: "Abatement",
        tags: ["demolition"],
        estimatedHoursMin: 8,
        estimatedHoursMax: 40,
      },
      {
        name: "Utility Disconnect",
        tags: ["demolition"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 8,
      },
      {
        name: "Soft Strip",
        tags: ["demolition"],
        estimatedHoursMin: 8,
        estimatedHoursMax: 24,
      },
      {
        name: "Structural Demo",
        tags: ["demolition"],
        estimatedHoursMin: 8,
        estimatedHoursMax: 40,
      },
      {
        name: "Debris Removal",
        tags: ["cleanup"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 16,
      },
      {
        name: "Site Clearance",
        tags: ["cleanup", "site-prep"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 8,
      },
    ],
  },
  "Drywall": {
    industry: "Drywall",
    taskTypes: [
      {
        name: "Site Prep",
        tags: ["site-prep"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
      },
      {
        name: "Board Hanging",
        tags: ["installation"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 16,
      },
      {
        name: "Taping",
        tags: ["finishing"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 6,
      },
      {
        name: "Mudding",
        tags: ["finishing"],
        estimatedHoursMin: 3,
        estimatedHoursMax: 8,
      },
      {
        name: "Sanding",
        tags: ["finishing"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
      {
        name: "Priming",
        tags: ["finishing"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
      {
        name: "Punch & Inspection",
        tags: ["inspection"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
      },
    ],
  },
  "Flooring": {
    industry: "Flooring",
    taskTypes: [
      {
        name: "Site Assessment",
        tags: ["assessment"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
      },
      {
        name: "Demo & Removal",
        tags: ["demolition"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 6,
      },
      {
        name: "Subfloor Prep",
        tags: ["site-prep"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 8,
      },
      {
        name: "Installation",
        tags: ["installation"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 16,
      },
      {
        name: "Trim & Transitions",
        tags: ["finishing"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
      {
        name: "Cleanup & Walkthrough",
        tags: ["cleanup", "inspection"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
      },
    ],
  },
  "Insulation": {
    industry: "Insulation",
    taskTypes: [
      {
        name: "Site Survey",
        tags: ["assessment"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
      },
      {
        name: "Old Removal",
        tags: ["demolition"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 6,
      },
      {
        name: "Air Sealing",
        tags: ["installation"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
      {
        name: "Installation",
        tags: ["installation"],
        estimatedHoursMin: 3,
        estimatedHoursMax: 8,
      },
      {
        name: "Vapor Barrier",
        tags: ["installation"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
      },
      {
        name: "Inspection & Testing",
        tags: ["inspection", "testing"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
      },
    ],
  },
  "Fencing": {
    industry: "Fencing",
    taskTypes: [
      {
        name: "Survey & Layout",
        tags: ["assessment"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
      },
      {
        name: "Utility Marking",
        tags: ["coordination"],
        estimatedHoursMin: 0,
        estimatedHoursMax: 0,
      },
      {
        name: "Site Prep",
        tags: ["site-prep"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
      },
      {
        name: "Post Setting",
        tags: ["installation"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 8,
      },
      {
        name: "Rail & Panel Install",
        tags: ["installation"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 8,
      },
      {
        name: "Gate Installation",
        tags: ["installation"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
      {
        name: "Finishing",
        tags: ["finishing"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
      },
    ],
  },
  "Landscaping": {
    industry: "Landscaping",
    taskTypes: [
      {
        name: "Site Analysis",
        tags: ["assessment"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
      {
        name: "Demolition & Clearing",
        tags: ["demolition"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 16,
      },
      {
        name: "Grading & Drainage",
        tags: ["site-prep"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 16,
      },
      {
        name: "Irrigation Install",
        tags: ["installation", "plumbing"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 12,
      },
      {
        name: "Hardscape",
        tags: ["installation"],
        estimatedHoursMin: 8,
        estimatedHoursMax: 40,
      },
      {
        name: "Softscape & Planting",
        tags: ["installation"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 16,
      },
      {
        name: "Lighting & Features",
        tags: ["electrical"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 8,
      },
      {
        name: "Cleanup & Walkthrough",
        tags: ["cleanup", "inspection"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
    ],
  },
  "Deck Construction": {
    industry: "Deck Construction",
    taskTypes: [
      {
        name: "Design & Permits",
        tags: ["assessment", "permitting"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
      {
        name: "Site Prep",
        tags: ["site-prep"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
      {
        name: "Footings & Foundation",
        tags: ["forming"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 8,
      },
      {
        name: "Framing",
        tags: ["framing"],
        estimatedHoursMin: 6,
        estimatedHoursMax: 16,
      },
      {
        name: "Decking",
        tags: ["installation"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 12,
      },
      {
        name: "Railings & Stairs",
        tags: ["installation"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 12,
      },
      {
        name: "Finishing",
        tags: ["finishing"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 6,
      },
      {
        name: "Inspection",
        tags: ["inspection"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
      },
    ],
  },
  "Deck Surfacing": {
    industry: "Deck Surfacing",
    taskTypes: [
      {
        name: "Inspection",
        tags: ["assessment"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
      },
      {
        name: "Structural Repair",
        tags: ["repair"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 8,
      },
      {
        name: "Board Removal",
        tags: ["demolition"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 6,
      },
      {
        name: "New Surface Install",
        tags: ["installation"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 12,
      },
      {
        name: "Cleaning & Prep",
        tags: ["site-prep"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
      {
        name: "Sealing & Finishing",
        tags: ["finishing"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
      {
        name: "Final Walkthrough",
        tags: ["inspection"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 1,
      },
    ],
  },
  "Siding": {
    industry: "Siding",
    taskTypes: [
      {
        name: "Site Assessment",
        tags: ["assessment"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
      },
      {
        name: "Old Siding Removal",
        tags: ["demolition"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 16,
      },
      {
        name: "Wall Repair & Prep",
        tags: ["repair"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 8,
      },
      {
        name: "Flashing & Trim",
        tags: ["installation"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 6,
      },
      {
        name: "Siding Installation",
        tags: ["installation"],
        estimatedHoursMin: 8,
        estimatedHoursMax: 24,
      },
      {
        name: "Caulking & Sealing",
        tags: ["finishing"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
      },
      {
        name: "Detail & Finishing",
        tags: ["finishing"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
      {
        name: "Cleanup & Inspection",
        tags: ["cleanup", "inspection"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
      },
    ],
  },
  "Masonry": {
    industry: "Masonry",
    taskTypes: [
      {
        name: "Site Prep",
        tags: ["site-prep"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
      {
        name: "Layout & Markup",
        tags: ["assessment"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
      },
      {
        name: "Scaffolding Setup",
        tags: ["site-prep"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
      {
        name: "Block Laying",
        tags: ["installation"],
        estimatedHoursMin: 8,
        estimatedHoursMax: 40,
      },
      {
        name: "Grouting & Fill",
        tags: ["grouting"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 8,
      },
      {
        name: "Pointing & Joints",
        tags: ["finishing"],
        estimatedHoursMin: 3,
        estimatedHoursMax: 8,
      },
      {
        name: "Curing & Protection",
        tags: ["curing"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
      {
        name: "Cleanup & Inspection",
        tags: ["cleanup", "inspection"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
    ],
  },
  "Bricklaying": {
    industry: "Bricklaying",
    taskTypes: [
      {
        name: "Site Prep",
        tags: ["site-prep"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
      {
        name: "Layout & Markup",
        tags: ["assessment"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
      },
      {
        name: "Scaffolding Setup",
        tags: ["site-prep"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
      {
        name: "Brick Laying",
        tags: ["installation"],
        estimatedHoursMin: 8,
        estimatedHoursMax: 40,
      },
      {
        name: "Pointing & Jointing",
        tags: ["finishing"],
        estimatedHoursMin: 3,
        estimatedHoursMax: 8,
      },
      {
        name: "Curing",
        tags: ["curing"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
      {
        name: "Cleanup & Punch List",
        tags: ["cleanup", "inspection"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
    ],
  },
  "Tile Setting": {
    industry: "Tile Setting",
    taskTypes: [
      {
        name: "Surface Prep",
        tags: ["site-prep"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 6,
      },
      {
        name: "Waterproofing",
        tags: ["installation"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
      {
        name: "Layout & Dry Fit",
        tags: ["assessment"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
      },
      {
        name: "Tile Setting",
        tags: ["installation"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 16,
      },
      {
        name: "Grouting",
        tags: ["grouting"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 6,
      },
      {
        name: "Sealing & Finish",
        tags: ["finishing"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
      },
      {
        name: "Cleanup & Inspection",
        tags: ["cleanup", "inspection"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
      },
    ],
  },
  "Stonework": {
    industry: "Stonework",
    taskTypes: [
      {
        name: "Site Prep",
        tags: ["site-prep"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
      {
        name: "Surface Prep",
        tags: ["site-prep"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 6,
      },
      {
        name: "Stone Selection & Layout",
        tags: ["assessment"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
      {
        name: "Stone Setting",
        tags: ["installation"],
        estimatedHoursMin: 8,
        estimatedHoursMax: 40,
      },
      {
        name: "Pointing & Grouting",
        tags: ["grouting", "finishing"],
        estimatedHoursMin: 3,
        estimatedHoursMax: 8,
      },
      {
        name: "Sealing & Curing",
        tags: ["curing", "finishing"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
      {
        name: "Cleanup & Inspection",
        tags: ["cleanup", "inspection"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 3,
      },
    ],
  },
  "Excavation": {
    industry: "Excavation",
    taskTypes: [
      {
        name: "Survey & Staking",
        tags: ["assessment"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
      {
        name: "Clearing & Grubbing",
        tags: ["demolition"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 16,
      },
      {
        name: "Rough Grading",
        tags: ["site-prep"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 16,
      },
      {
        name: "Trenching",
        tags: ["installation"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 24,
      },
      {
        name: "Foundation Excavation",
        tags: ["installation"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 16,
      },
      {
        name: "Backfill & Compaction",
        tags: ["installation"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 16,
      },
      {
        name: "Finish Grading",
        tags: ["finishing"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 8,
      },
      {
        name: "Final Inspection",
        tags: ["inspection"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
      },
    ],
  },
  "Paving": {
    industry: "Paving",
    taskTypes: [
      {
        name: "Demolition",
        tags: ["demolition"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 16,
      },
      {
        name: "Grading & Drainage",
        tags: ["site-prep"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 8,
      },
      {
        name: "Base Installation",
        tags: ["installation"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 8,
      },
      {
        name: "Binder Course",
        tags: ["installation"],
        estimatedHoursMin: 3,
        estimatedHoursMax: 6,
      },
      {
        name: "Surface Paving",
        tags: ["installation"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 12,
      },
      {
        name: "Compaction & Curing",
        tags: ["curing"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
      {
        name: "Striping & Markings",
        tags: ["finishing"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 6,
      },
      {
        name: "Final Inspection",
        tags: ["inspection"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
      },
    ],
  },
  "Waterproofing": {
    industry: "Waterproofing",
    taskTypes: [
      {
        name: "Excavation & Expose",
        tags: ["demolition"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 16,
      },
      {
        name: "Surface Cleaning",
        tags: ["site-prep"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
      {
        name: "Repairs & Parging",
        tags: ["repair"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 8,
      },
      {
        name: "Membrane Application",
        tags: ["installation"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 12,
      },
      {
        name: "Drainage Install",
        tags: ["installation", "plumbing"],
        estimatedHoursMin: 3,
        estimatedHoursMax: 8,
      },
      {
        name: "Flood Testing",
        tags: ["testing"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
      {
        name: "Backfill & Grade",
        tags: ["finishing"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 8,
      },
      {
        name: "Final Inspection",
        tags: ["inspection"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
      },
    ],
  },
  "Windows": {
    industry: "Windows",
    taskTypes: [
      {
        name: "Measurement & Order",
        tags: ["assessment"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
      },
      {
        name: "Interior Prep",
        tags: ["site-prep"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
      },
      {
        name: "Removal",
        tags: ["demolition"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 6,
      },
      {
        name: "Opening Prep",
        tags: ["repair"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
      {
        name: "Window Install",
        tags: ["installation"],
        estimatedHoursMin: 3,
        estimatedHoursMax: 8,
      },
      {
        name: "Sealing & Trim",
        tags: ["finishing"],
        estimatedHoursMin: 3,
        estimatedHoursMax: 6,
      },
      {
        name: "Final Inspection",
        tags: ["inspection"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
      },
    ],
  },
  "Solar Installation": {
    industry: "Solar Installation",
    taskTypes: [
      {
        name: "Site Assessment",
        tags: ["assessment"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
      {
        name: "Permitting",
        tags: ["permitting"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
      },
      {
        name: "Roof Prep",
        tags: ["site-prep"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
      {
        name: "Racking & Mounting",
        tags: ["installation"],
        estimatedHoursMin: 3,
        estimatedHoursMax: 6,
      },
      {
        name: "Panel Install",
        tags: ["installation"],
        estimatedHoursMin: 3,
        estimatedHoursMax: 6,
      },
      {
        name: "Electrical Work",
        tags: ["electrical"],
        estimatedHoursMin: 3,
        estimatedHoursMax: 6,
      },
      {
        name: "System Testing",
        tags: ["testing"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
      },
      {
        name: "Inspection & Commission",
        tags: ["inspection", "commissioning"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
      },
    ],
  },
  "Glazing": {
    industry: "Glazing",
    taskTypes: [
      {
        name: "Field Measure",
        tags: ["assessment"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
      {
        name: "Shop Fabrication",
        tags: ["installation"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 8,
      },
      {
        name: "Frame Install",
        tags: ["installation"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 8,
      },
      {
        name: "Glass Setting",
        tags: ["installation"],
        estimatedHoursMin: 3,
        estimatedHoursMax: 6,
      },
      {
        name: "Sealing & Caulk",
        tags: ["finishing"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
      {
        name: "Waterproofing",
        tags: ["installation"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
      {
        name: "Punch & Inspect",
        tags: ["inspection"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
      },
    ],
  },
  "Sheet Metal": {
    industry: "Sheet Metal",
    taskTypes: [
      {
        name: "Detailing & Layout",
        tags: ["assessment"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
      {
        name: "Shop Fabrication",
        tags: ["installation"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 8,
      },
      {
        name: "Hanger Install",
        tags: ["installation"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
      {
        name: "Duct Install",
        tags: ["installation"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 8,
      },
      {
        name: "Sealing & Insulate",
        tags: ["finishing"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
      {
        name: "TAB Prep",
        tags: ["commissioning"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
      },
      {
        name: "Final Inspection",
        tags: ["inspection"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
      },
    ],
  },
  "Metal Fabrication": {
    industry: "Metal Fabrication",
    taskTypes: [
      {
        name: "Engineering Review",
        tags: ["assessment"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
      {
        name: "Material Prep",
        tags: ["site-prep"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
      },
      {
        name: "Cutting",
        tags: ["installation"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 6,
      },
      {
        name: "Forming & Bending",
        tags: ["installation"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 6,
      },
      {
        name: "Welding & Assembly",
        tags: ["installation"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 8,
      },
      {
        name: "Finishing",
        tags: ["finishing"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 6,
      },
      {
        name: "Quality Control",
        tags: ["inspection"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
      },
      {
        name: "Pack & Ship",
        tags: ["cleanup"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
      },
    ],
  },
  "Welding": {
    industry: "Welding",
    taskTypes: [
      {
        name: "WPS Review",
        tags: ["assessment"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
      },
      {
        name: "Joint Prep",
        tags: ["site-prep"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
      {
        name: "Welding",
        tags: ["installation"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 8,
      },
      {
        name: "Post-Weld Treat",
        tags: ["curing"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 4,
      },
      {
        name: "Visual Inspection",
        tags: ["inspection"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
      },
      {
        name: "NDT Testing",
        tags: ["testing"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 6,
      },
      {
        name: "Repair & Rework",
        tags: ["repair"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
      {
        name: "Coating & Finish",
        tags: ["finishing"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
      },
    ],
  },
  "Scaffolding": {
    industry: "Scaffolding",
    taskTypes: [
      {
        name: "Site Survey",
        tags: ["assessment"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
      },
      {
        name: "Scaffold Design",
        tags: ["assessment"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
      {
        name: "Base Setup",
        tags: ["site-prep"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
      },
      {
        name: "Erection",
        tags: ["installation"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 12,
      },
      {
        name: "Tie-In & Brace",
        tags: ["installation"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
      },
      {
        name: "Safety Inspection",
        tags: ["inspection"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
      },
      {
        name: "Modification",
        tags: ["installation"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
      {
        name: "Dismantle",
        tags: ["demolition"],
        estimatedHoursMin: 3,
        estimatedHoursMax: 8,
      },
    ],
  },
  "Rebar": {
    industry: "Rebar",
    taskTypes: [
      {
        name: "Drawing Review",
        tags: ["assessment"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
      },
      {
        name: "Material Staging",
        tags: ["site-prep"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
      },
      {
        name: "Cutting & Bending",
        tags: ["installation"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 6,
      },
      {
        name: "Placement",
        tags: ["installation"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 8,
      },
      {
        name: "Tying",
        tags: ["installation"],
        estimatedHoursMin: 3,
        estimatedHoursMax: 6,
      },
      {
        name: "Pre-Pour Inspect",
        tags: ["inspection"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
      },
      {
        name: "Pour Support",
        tags: ["coordination"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
    ],
  },
  "Crane Operation": {
    industry: "Crane Operation",
    taskTypes: [
      {
        name: "Lift Planning",
        tags: ["assessment"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
      {
        name: "Site Assessment",
        tags: ["assessment"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
      },
      {
        name: "Mobilization",
        tags: ["site-prep"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 8,
      },
      {
        name: "Crane Setup",
        tags: ["installation"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 6,
      },
      {
        name: "Rigging",
        tags: ["installation"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
      },
      {
        name: "Lifting Ops",
        tags: ["installation"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 8,
      },
      {
        name: "Demobilization",
        tags: ["cleanup"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 6,
      },
    ],
  },
  "Millwrighting": {
    industry: "Millwrighting",
    taskTypes: [
      {
        name: "Pre-Install Plan",
        tags: ["assessment"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
      {
        name: "Receiving & Stage",
        tags: ["site-prep"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
      {
        name: "Rigging & Setting",
        tags: ["installation"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 8,
      },
      {
        name: "Leveling & Grout",
        tags: ["grouting"],
        estimatedHoursMin: 3,
        estimatedHoursMax: 6,
      },
      {
        name: "Alignment",
        tags: ["installation"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 6,
      },
      {
        name: "Mechanical Hookup",
        tags: ["installation"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
      {
        name: "Testing & Commish",
        tags: ["commissioning", "testing"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
      {
        name: "Punch & Handover",
        tags: ["inspection"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
      },
    ],
  },
  "Surveying": {
    industry: "Surveying",
    taskTypes: [
      {
        name: "Control Setup",
        tags: ["assessment"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
      {
        name: "Topo Survey",
        tags: ["assessment"],
        estimatedHoursMin: 3,
        estimatedHoursMax: 6,
      },
      {
        name: "Boundary Survey",
        tags: ["assessment"],
        estimatedHoursMin: 3,
        estimatedHoursMax: 6,
      },
      {
        name: "Construction Stake",
        tags: ["installation"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 6,
      },
      {
        name: "Foundation Layout",
        tags: ["installation"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
      {
        name: "Progress Check",
        tags: ["inspection"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
      },
      {
        name: "As-Built Survey",
        tags: ["inspection"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
    ],
  },
  "Gutter Installation": {
    industry: "Gutter Installation",
    taskTypes: [
      {
        name: "Site Inspection",
        tags: ["assessment"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
      },
      {
        name: "Old Gutter Removal",
        tags: ["demolition"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
      },
      {
        name: "Fascia Repair",
        tags: ["repair"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 4,
      },
      {
        name: "Measurement & Layout",
        tags: ["assessment"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
      },
      {
        name: "Gutter Fabrication",
        tags: ["installation"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
      },
      {
        name: "Gutter Installation",
        tags: ["installation"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 6,
      },
      {
        name: "Downspout Install",
        tags: ["installation"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
      },
      {
        name: "Final Inspection",
        tags: ["inspection"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 1,
      },
    ],
  },
  "Garage Doors": {
    industry: "Garage Doors",
    taskTypes: [
      {
        name: "Site Assessment",
        tags: ["assessment"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
      },
      {
        name: "Old Door Removal",
        tags: ["demolition"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
      },
      {
        name: "Frame Prep",
        tags: ["site-prep"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
      },
      {
        name: "Track Installation",
        tags: ["installation"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
      },
      {
        name: "Panel & Hardware",
        tags: ["installation"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
      {
        name: "Spring Setup",
        tags: ["installation"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
      },
      {
        name: "Opener Install",
        tags: ["electrical"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
      },
      {
        name: "Testing & Handoff",
        tags: ["testing", "inspection"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 1,
      },
    ],
  },
  "Septic Services": {
    industry: "Septic Services",
    taskTypes: [
      {
        name: "Site Evaluation",
        tags: ["assessment"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
      {
        name: "Design & Permitting",
        tags: ["permitting"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 16,
      },
      {
        name: "Excavation",
        tags: ["demolition"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 8,
      },
      {
        name: "Tank Installation",
        tags: ["installation"],
        estimatedHoursMin: 3,
        estimatedHoursMax: 6,
      },
      {
        name: "Drain Field Build",
        tags: ["installation"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 8,
      },
      {
        name: "Final Inspection",
        tags: ["inspection"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
      },
      {
        name: "Backfill & Grading",
        tags: ["finishing"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
    ],
  },
  "Irrigation": {
    industry: "Irrigation",
    taskTypes: [
      {
        name: "Site Survey",
        tags: ["assessment"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
      },
      {
        name: "System Design",
        tags: ["assessment"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
      {
        name: "Trenching",
        tags: ["site-prep"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 6,
      },
      {
        name: "Pipe & Valve Install",
        tags: ["installation", "plumbing"],
        estimatedHoursMin: 3,
        estimatedHoursMax: 6,
      },
      {
        name: "Head Installation",
        tags: ["installation"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
      {
        name: "Controller Setup",
        tags: ["electrical"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
      },
      {
        name: "System Testing",
        tags: ["testing"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
      },
      {
        name: "Backfill & Cleanup",
        tags: ["cleanup"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
      },
    ],
  },
  "Pool Services": {
    industry: "Pool Services",
    taskTypes: [
      {
        name: "Site Assessment",
        tags: ["assessment"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
      {
        name: "Excavation",
        tags: ["demolition"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 8,
      },
      {
        name: "Steel & Plumbing",
        tags: ["installation", "plumbing"],
        estimatedHoursMin: 6,
        estimatedHoursMax: 12,
      },
      {
        name: "Shell Application",
        tags: ["installation"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 8,
      },
      {
        name: "Tile & Coping",
        tags: ["finishing"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 8,
      },
      {
        name: "Equipment Set",
        tags: ["equipment-set", "electrical"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 6,
      },
      {
        name: "Plaster & Fill",
        tags: ["finishing"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 8,
      },
      {
        name: "Final Startup",
        tags: ["commissioning", "inspection"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
    ],
  },
  "Chimney Services": {
    industry: "Chimney Services",
    taskTypes: [
      {
        name: "Chimney Inspection",
        tags: ["assessment"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
      },
      {
        name: "Area Protection",
        tags: ["site-prep"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 1,
      },
      {
        name: "Chimney Sweep",
        tags: ["cleanup"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
      },
      {
        name: "Masonry Repair",
        tags: ["repair"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 6,
      },
      {
        name: "Liner Work",
        tags: ["installation"],
        estimatedHoursMin: 3,
        estimatedHoursMax: 6,
      },
      {
        name: "Cap & Flashing",
        tags: ["installation"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
      },
      {
        name: "Final Inspection",
        tags: ["inspection"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 1,
      },
    ],
  },
  "Ceiling Installations": {
    industry: "Ceiling Installations",
    taskTypes: [
      {
        name: "Site Measure",
        tags: ["assessment"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
      },
      {
        name: "Prep & Demo",
        tags: ["demolition"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 6,
      },
      {
        name: "Framing / Grid",
        tags: ["framing"],
        estimatedHoursMin: 3,
        estimatedHoursMax: 8,
      },
      {
        name: "Panel / Board Set",
        tags: ["installation"],
        estimatedHoursMin: 3,
        estimatedHoursMax: 8,
      },
      {
        name: "Finishing",
        tags: ["finishing"],
        estimatedHoursMin: 3,
        estimatedHoursMax: 8,
      },
      {
        name: "Fixture Install",
        tags: ["electrical"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
      },
      {
        name: "Final Inspection",
        tags: ["inspection"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 1,
      },
    ],
  },
  "Cabinetry": {
    industry: "Cabinetry",
    taskTypes: [
      {
        name: "Field Measure",
        tags: ["assessment"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
      },
      {
        name: "Design & Order",
        tags: ["assessment"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 8,
      },
      {
        name: "Site Prep",
        tags: ["demolition", "site-prep"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 6,
      },
      {
        name: "Base Cabinet Set",
        tags: ["installation"],
        estimatedHoursMin: 3,
        estimatedHoursMax: 6,
      },
      {
        name: "Upper Cabinet Set",
        tags: ["installation"],
        estimatedHoursMin: 3,
        estimatedHoursMax: 6,
      },
      {
        name: "Trim & Hardware",
        tags: ["finishing"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
      {
        name: "Door & Drawer Adjust",
        tags: ["finishing"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
      },
      {
        name: "Final Punch",
        tags: ["inspection"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 1,
      },
    ],
  },
  "Railings": {
    industry: "Railings",
    taskTypes: [
      {
        name: "Site Measure",
        tags: ["assessment"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
      },
      {
        name: "Design & Material",
        tags: ["assessment"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
      },
      {
        name: "Fabrication",
        tags: ["installation"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 16,
      },
      {
        name: "Surface Prep",
        tags: ["site-prep"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
      },
      {
        name: "Post & Rail Set",
        tags: ["installation"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 6,
      },
      {
        name: "Baluster / Infill",
        tags: ["installation"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 6,
      },
      {
        name: "Finishing",
        tags: ["finishing"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 4,
      },
      {
        name: "Final Inspection",
        tags: ["inspection"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 1,
      },
    ],
  },
  "Lawn Care": {
    industry: "Lawn Care",
    taskTypes: [
      {
        name: "Mowing & Edging",
        tags: ["installation"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 2,
      },
      {
        name: "Fertilization",
        tags: ["treatment"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 1.5,
      },
      {
        name: "Weed Control",
        tags: ["treatment"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 1.5,
      },
      {
        name: "Aeration",
        tags: ["installation"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
      },
      {
        name: "Dethatching",
        tags: ["cleanup"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
      },
      {
        name: "Overseeding",
        tags: ["installation"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
      },
      {
        name: "Leaf/Debris Cleanup",
        tags: ["cleanup"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
      },
    ],
  },
  "Pest Control": {
    industry: "Pest Control",
    taskTypes: [
      {
        name: "Site Inspection",
        tags: ["assessment"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 0.5,
      },
      {
        name: "Exclusion Work",
        tags: ["installation"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 1,
      },
      {
        name: "Bait Placement",
        tags: ["treatment"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 0.5,
      },
      {
        name: "Chemical Treatment",
        tags: ["treatment"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 1,
      },
      {
        name: "Monitoring Setup",
        tags: ["monitoring"],
        estimatedHoursMin: 0.25,
        estimatedHoursMax: 0.25,
      },
      {
        name: "Follow-Up Visit",
        tags: ["follow-up"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 0.5,
      },
      {
        name: "Final Walkthrough",
        tags: ["inspection"],
        estimatedHoursMin: 0.25,
        estimatedHoursMax: 0.25,
      },
    ],
  },
  "Power Washing": {
    industry: "Power Washing",
    taskTypes: [
      {
        name: "Site Assessment",
        tags: ["assessment"],
        estimatedHoursMin: 0.25,
        estimatedHoursMax: 0.25,
      },
      {
        name: "Area Prep",
        tags: ["site-prep"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 0.5,
      },
      {
        name: "Detergent Application",
        tags: ["treatment"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 0.5,
      },
      {
        name: "Pressure Washing",
        tags: ["installation"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 2,
      },
      {
        name: "Rinse & Detail",
        tags: ["finishing"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 0.5,
      },
      {
        name: "Site Restoration",
        tags: ["cleanup"],
        estimatedHoursMin: 0.25,
        estimatedHoursMax: 0.25,
      },
    ],
  },
  "Window Cleaning": {
    industry: "Window Cleaning",
    taskTypes: [
      {
        name: "Walk-Through",
        tags: ["assessment"],
        estimatedHoursMin: 0.25,
        estimatedHoursMax: 0.25,
      },
      {
        name: "Safety Setup",
        tags: ["site-prep"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 0.5,
      },
      {
        name: "Scrape & Scrub",
        tags: ["installation"],
        estimatedHoursMin: 0.75,
        estimatedHoursMax: 0.75,
      },
      {
        name: "Squeegee Clean",
        tags: ["installation"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 1,
      },
      {
        name: "Screen Cleaning",
        tags: ["cleanup"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 0.5,
      },
      {
        name: "Sill & Track Detail",
        tags: ["finishing"],
        estimatedHoursMin: 0.25,
        estimatedHoursMax: 0.25,
      },
      {
        name: "Final Inspection",
        tags: ["inspection"],
        estimatedHoursMin: 0.25,
        estimatedHoursMax: 0.25,
      },
    ],
  },
  "House Cleaning": {
    industry: "House Cleaning",
    taskTypes: [
      {
        name: "Client Walkthrough",
        tags: ["assessment"],
        estimatedHoursMin: 0.25,
        estimatedHoursMax: 0.25,
      },
      {
        name: "Kitchen Clean",
        tags: ["installation"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 1,
      },
      {
        name: "Bathroom Clean",
        tags: ["installation"],
        estimatedHoursMin: 0.75,
        estimatedHoursMax: 0.75,
      },
      {
        name: "Bedroom Clean",
        tags: ["installation"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 0.5,
      },
      {
        name: "Living Area Clean",
        tags: ["installation"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 0.5,
      },
      {
        name: "Detail Work",
        tags: ["finishing"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 0.5,
      },
      {
        name: "Quality Check",
        tags: ["inspection"],
        estimatedHoursMin: 0.25,
        estimatedHoursMax: 0.25,
      },
    ],
  },
  "Carpet Cleaning": {
    industry: "Carpet Cleaning",
    taskTypes: [
      {
        name: "Pre-Inspection",
        tags: ["assessment"],
        estimatedHoursMin: 0.25,
        estimatedHoursMax: 0.25,
      },
      {
        name: "Furniture Moving",
        tags: ["site-prep"],
        estimatedHoursMin: 0.25,
        estimatedHoursMax: 0.25,
      },
      {
        name: "Pre-Vacuum",
        tags: ["site-prep"],
        estimatedHoursMin: 0.25,
        estimatedHoursMax: 0.25,
      },
      {
        name: "Pre-Treatment",
        tags: ["treatment"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 0.5,
      },
      {
        name: "Agitation",
        tags: ["treatment"],
        estimatedHoursMin: 0.25,
        estimatedHoursMax: 0.25,
      },
      {
        name: "Hot Water Extraction",
        tags: ["installation"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 1,
      },
      {
        name: "Post-Spot Treatment",
        tags: ["treatment"],
        estimatedHoursMin: 0.25,
        estimatedHoursMax: 0.25,
      },
      {
        name: "Groom & Dry",
        tags: ["cleanup"],
        estimatedHoursMin: 0.25,
        estimatedHoursMax: 0.25,
      },
    ],
  },
  "Junk Removal": {
    industry: "Junk Removal",
    taskTypes: [
      {
        name: "On-Site Estimate",
        tags: ["assessment"],
        estimatedHoursMin: 0.25,
        estimatedHoursMax: 0.25,
      },
      {
        name: "Item Sorting",
        tags: ["assessment"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 0.5,
      },
      {
        name: "Disassembly",
        tags: ["demolition"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 0.5,
      },
      {
        name: "Loading",
        tags: ["installation"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 1,
      },
      {
        name: "Site Cleanup",
        tags: ["cleanup"],
        estimatedHoursMin: 0.25,
        estimatedHoursMax: 0.25,
      },
      {
        name: "Disposal & Recycling",
        tags: ["cleanup"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 1,
      },
    ],
  },
  "Moving Services": {
    industry: "Moving Services",
    taskTypes: [
      {
        name: "Pre-Move Survey",
        tags: ["assessment"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 0.5,
      },
      {
        name: "Packing",
        tags: ["installation"],
        estimatedHoursMin: 3,
        estimatedHoursMax: 3,
      },
      {
        name: "Loading",
        tags: ["installation"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 2,
      },
      {
        name: "Transportation",
        tags: ["installation"],
        estimatedHoursMin: 1.5,
        estimatedHoursMax: 1.5,
      },
      {
        name: "Unloading",
        tags: ["installation"],
        estimatedHoursMin: 1.5,
        estimatedHoursMax: 1.5,
      },
      {
        name: "Reassembly & Setup",
        tags: ["finishing"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 1,
      },
      {
        name: "Final Walk-Through",
        tags: ["inspection"],
        estimatedHoursMin: 0.25,
        estimatedHoursMax: 0.25,
      },
    ],
  },
  "Snow Removal": {
    industry: "Snow Removal",
    taskTypes: [
      {
        name: "Storm Monitoring",
        tags: ["monitoring"],
        estimatedHoursMin: 0.25,
        estimatedHoursMax: 0.25,
      },
      {
        name: "Pre-Treatment",
        tags: ["treatment"],
        estimatedHoursMin: 0.25,
        estimatedHoursMax: 0.25,
      },
      {
        name: "Plowing",
        tags: ["installation"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 0.5,
      },
      {
        name: "Walkway Clearing",
        tags: ["installation"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 0.5,
      },
      {
        name: "Salt & De-Ice",
        tags: ["treatment"],
        estimatedHoursMin: 0.25,
        estimatedHoursMax: 0.25,
      },
      {
        name: "Return Visit",
        tags: ["follow-up"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 0.5,
      },
    ],
  },
  "Locksmith": {
    industry: "Locksmith",
    taskTypes: [
      {
        name: "Service Assessment",
        tags: ["assessment"],
        estimatedHoursMin: 0.25,
        estimatedHoursMax: 0.25,
      },
      {
        name: "Lock Rekeying",
        tags: ["installation"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 0.5,
      },
      {
        name: "Lock Replacement",
        tags: ["installation"],
        estimatedHoursMin: 0.75,
        estimatedHoursMax: 0.75,
      },
      {
        name: "Smart Lock Install",
        tags: ["installation", "electrical"],
        estimatedHoursMin: 1.25,
        estimatedHoursMax: 1.25,
      },
      {
        name: "Emergency Lockout",
        tags: ["emergency"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 0.5,
      },
      {
        name: "Security Upgrade",
        tags: ["installation"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 1,
      },
    ],
  },
  "Handyman Services": {
    industry: "Handyman Services",
    taskTypes: [
      {
        name: "Site Assessment",
        tags: ["assessment"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 1,
      },
      {
        name: "Material Procurement",
        tags: ["site-prep"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
      },
      {
        name: "Surface Prep",
        tags: ["site-prep"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 2,
      },
      {
        name: "Rough Repair",
        tags: ["repair"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 4,
      },
      {
        name: "Installation",
        tags: ["installation"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 6,
      },
      {
        name: "Finishing",
        tags: ["finishing"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
      },
      {
        name: "Cleanup",
        tags: ["cleanup"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 1,
      },
      {
        name: "Walkthrough",
        tags: ["inspection"],
        estimatedHoursMin: 0.25,
        estimatedHoursMax: 0.5,
      },
    ],
  },
  "Renovations": {
    industry: "Renovations",
    taskTypes: [
      {
        name: "Site Assessment",
        tags: ["assessment"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 8,
      },
      {
        name: "Design & Planning",
        tags: ["assessment", "permitting"],
        estimatedHoursMin: 8,
        estimatedHoursMax: 40,
      },
      {
        name: "Permitting",
        tags: ["permitting"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 8,
      },
      {
        name: "Demolition",
        tags: ["demolition"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 40,
      },
      {
        name: "Rough-In",
        tags: ["rough-in"],
        estimatedHoursMin: 8,
        estimatedHoursMax: 80,
      },
      {
        name: "Finishing",
        tags: ["finishing"],
        estimatedHoursMin: 8,
        estimatedHoursMax: 60,
      },
      {
        name: "Final Install",
        tags: ["installation"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 24,
      },
      {
        name: "Punch List",
        tags: ["finishing", "inspection"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 8,
      },
    ],
  },
  "Architecture": {
    industry: "Architecture",
    taskTypes: [
      {
        name: "Pre-Design",
        tags: ["assessment"],
        estimatedHoursMin: 8,
        estimatedHoursMax: 40,
      },
      {
        name: "Schematic Design",
        tags: ["assessment"],
        estimatedHoursMin: 20,
        estimatedHoursMax: 80,
      },
      {
        name: "Design Development",
        tags: ["installation"],
        estimatedHoursMin: 40,
        estimatedHoursMax: 120,
      },
      {
        name: "Construction Docs",
        tags: ["documentation"],
        estimatedHoursMin: 60,
        estimatedHoursMax: 200,
      },
      {
        name: "Bidding",
        tags: ["coordination"],
        estimatedHoursMin: 8,
        estimatedHoursMax: 24,
      },
      {
        name: "Permit Review",
        tags: ["permitting"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 16,
      },
      {
        name: "Construction Admin",
        tags: ["coordination", "inspection"],
        estimatedHoursMin: 20,
        estimatedHoursMax: 160,
      },
      {
        name: "Closeout",
        tags: ["inspection"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 16,
      },
    ],
  },
  "Consulting": {
    industry: "Consulting",
    taskTypes: [
      {
        name: "Discovery",
        tags: ["assessment"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 16,
      },
      {
        name: "Analysis",
        tags: ["assessment"],
        estimatedHoursMin: 8,
        estimatedHoursMax: 40,
      },
      {
        name: "Strategy",
        tags: ["assessment"],
        estimatedHoursMin: 8,
        estimatedHoursMax: 24,
      },
      {
        name: "Presentation",
        tags: ["documentation"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 12,
      },
      {
        name: "Implementation",
        tags: ["installation"],
        estimatedHoursMin: 16,
        estimatedHoursMax: 80,
      },
      {
        name: "Review",
        tags: ["inspection"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 16,
      },
      {
        name: "Handoff",
        tags: ["inspection"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 8,
      },
    ],
  },
  "Auto Detailing": {
    industry: "Auto Detailing",
    taskTypes: [
      {
        name: "Vehicle Assessment",
        tags: ["assessment"],
        estimatedHoursMin: 0.25,
        estimatedHoursMax: 0.5,
      },
      {
        name: "Exterior Wash",
        tags: ["site-prep"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 1,
      },
      {
        name: "Decontamination",
        tags: ["treatment"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 1,
      },
      {
        name: "Paint Correction",
        tags: ["installation"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 8,
      },
      {
        name: "Protection",
        tags: ["finishing"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
      },
      {
        name: "Interior Detail",
        tags: ["installation"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 4,
      },
      {
        name: "Final Inspection",
        tags: ["inspection"],
        estimatedHoursMin: 0.25,
        estimatedHoursMax: 0.5,
      },
    ],
  },
  "Tree Services": {
    industry: "Tree Services",
    taskTypes: [
      {
        name: "Site Assessment",
        tags: ["assessment"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 2,
      },
      {
        name: "Crew Setup",
        tags: ["site-prep"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 1,
      },
      {
        name: "Pruning/Trimming",
        tags: ["installation"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 6,
      },
      {
        name: "Tree Removal",
        tags: ["demolition"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 8,
      },
      {
        name: "Stump Grinding",
        tags: ["demolition"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 2,
      },
      {
        name: "Debris Management",
        tags: ["cleanup"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 4,
      },
      {
        name: "Site Restoration",
        tags: ["cleanup"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 2,
      },
    ],
  },
  "Vinyl Deck Membranes": {
    industry: "Vinyl Deck Membranes",
    taskTypes: [
      {
        name: "Site Assessment",
        tags: ["assessment"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
      },
      {
        name: "Substrate Prep",
        tags: ["site-prep"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 8,
      },
      {
        name: "Surface Prep",
        tags: ["site-prep"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 4,
      },
      {
        name: "Layout & Cutting",
        tags: ["assessment"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 2,
      },
      {
        name: "Adhesive & Install",
        tags: ["installation"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 6,
      },
      {
        name: "Seam Welding",
        tags: ["installation"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
      },
      {
        name: "Finishing",
        tags: ["finishing"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 2,
      },
      {
        name: "Final Inspection",
        tags: ["inspection"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 1,
      },
    ],
  },
  "Other": {
    industry: "Other",
    taskTypes: [
      { name: "Assessment", tags: ["assessment"], estimatedHoursMin: 1, estimatedHoursMax: 4 },
      { name: "Planning", tags: ["assessment"], estimatedHoursMin: 1, estimatedHoursMax: 4 },
      { name: "Site Prep", tags: ["site-prep"], estimatedHoursMin: 1, estimatedHoursMax: 4 },
      { name: "Execution", tags: ["installation"], estimatedHoursMin: 2, estimatedHoursMax: 16 },
      { name: "Quality Check", tags: ["inspection"], estimatedHoursMin: 0.5, estimatedHoursMax: 2 },
      { name: "Cleanup", tags: ["cleanup"], estimatedHoursMin: 0.5, estimatedHoursMax: 2 },
    ],
  },
};

// ─── Merge Logic ──────────────────────────────────────────────────────────────

/**
 * Merge presets for multiple industries.
 * Groups task types by industry. Deduplicates by exact name (case-insensitive) —
 * the first industry to claim a name keeps it; later industries are noted in alsoIn.
 * Auto-assigns colors from the curated palette.
 */
export function mergePresets(industries: string[]): MergedPreset {
  // Dedup by exact name (case-insensitive). First industry keeps it;
  // subsequent industries are recorded in alsoIn.
  const seen = new Map<string, MergedTaskType>();
  const groups: IndustryGroup[] = [];

  for (const industry of industries) {
    const preset = INDUSTRY_PRESETS[industry] ?? INDUSTRY_PRESETS["Other"];
    const groupTaskTypes: MergedTaskType[] = [];

    for (const tt of preset.taskTypes) {
      const key = tt.name.toLowerCase();

      if (seen.has(key)) {
        // Exact name already claimed by an earlier industry
        seen.get(key)!.alsoIn.push(industry);
      } else {
        const merged: MergedTaskType = {
          ...tt,
          color: "",
          sourceIndustries: [industry],
          alsoIn: [],
        };
        groupTaskTypes.push(merged);
        seen.set(key, merged);
      }
    }

    if (groupTaskTypes.length > 0) {
      groups.push({ industry, taskTypes: groupTaskTypes });
    }
  }

  // Auto-assign colors across all task types
  const allTaskTypes = groups.flatMap((g) => g.taskTypes);
  const colored = autoAssignColors(allTaskTypes);
  let colorIdx = 0;
  for (const group of groups) {
    for (const tt of group.taskTypes) {
      tt.color = colored[colorIdx].color;
      colorIdx++;
    }
  }

  return { groups };
}
