import { autoAssignColors } from "./curated-colors";

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
  "Roofing": {
    industry: "Roofing",
    taskTypes: [
      {
        name: "Site Setup",
        tags: ["site-prep"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 3,
        templates: [
          { title: "Property protection", estimatedHours: 0.5 },
          { title: "Safety equipment setup", estimatedHours: 0.5 },
          { title: "Dumpster placement", estimatedHours: 0.5 },
          { title: "Material staging", estimatedHours: 1 },
        ],
      },
      {
        name: "Tear-Off",
        tags: ["demolition"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 8,
        templates: [
          { title: "Strip shingles", estimatedHours: 3 },
          { title: "Remove underlayment", estimatedHours: 1.5 },
          { title: "Pull old flashing", estimatedHours: 1 },
          { title: "Dispose debris", estimatedHours: 1.5 },
        ],
      },
      {
        name: "Deck Inspection",
        tags: ["inspection"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
        templates: [
          { title: "Inspect sheathing for rot", estimatedHours: 0.5 },
          { title: "Check structural integrity", estimatedHours: 0.5 },
          { title: "Mark areas needing repair", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Deck Repair",
        tags: ["repair"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
        templates: [
          { title: "Replace damaged sheathing", estimatedHours: 1.5 },
          { title: "Re-nail loose boards", estimatedHours: 1 },
          { title: "Sister damaged rafters", estimatedHours: 1.5 },
        ],
      },
      {
        name: "Underlayment",
        tags: ["installation"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
        templates: [
          { title: "Install ice & water shield", estimatedHours: 1.5 },
          { title: "Roll out synthetic underlayment", estimatedHours: 1.5 },
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
          { title: "Install starter strip", estimatedHours: 1 },
          { title: "Lay field shingles", estimatedHours: 6 },
          { title: "Install ridge cap", estimatedHours: 1.5 },
          { title: "Install flashing", estimatedHours: 2 },
          { title: "Install pipe boots", estimatedHours: 1 },
        ],
      },
      {
        name: "Final Inspection",
        tags: ["inspection"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
        templates: [
          { title: "Walkthrough with client", estimatedHours: 0.5 },
          { title: "Photograph completed work", estimatedHours: 0.5 },
          { title: "Code compliance check", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Cleanup",
        tags: ["cleanup"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
        templates: [
          { title: "Magnetic nail sweep", estimatedHours: 0.5 },
          { title: "Remove tarps", estimatedHours: 0.25 },
          { title: "Debris haul-off", estimatedHours: 0.75 },
          { title: "Gutter cleaning", estimatedHours: 0.5 },
        ],
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
        templates: [
          { title: "Review blueprints", estimatedHours: 1 },
          { title: "Load calculation", estimatedHours: 1 },
          { title: "Panel capacity check", estimatedHours: 1 },
        ],
      },
      {
        name: "Rough-In",
        tags: ["rough-in"],
        estimatedHoursMin: 16,
        estimatedHoursMax: 40,
        templates: [
          { title: "Run conduit", estimatedHours: 8 },
          { title: "Pull wire", estimatedHours: 8 },
          { title: "Install boxes", estimatedHours: 4 },
          { title: "Label circuits", estimatedHours: 2 },
        ],
      },
      {
        name: "Rough Inspection",
        tags: ["inspection"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
        templates: [
          { title: "Code compliance check", estimatedHours: 0.5 },
          { title: "Box fill verification", estimatedHours: 0.5 },
          { title: "Grounding check", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Trim-Out",
        tags: ["trim-out"],
        estimatedHoursMin: 8,
        estimatedHoursMax: 24,
        templates: [
          { title: "Install devices", estimatedHours: 6 },
          { title: "Mount fixtures", estimatedHours: 6 },
          { title: "Install cover plates", estimatedHours: 2 },
        ],
      },
      {
        name: "Panel Termination",
        tags: ["electrical"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
        templates: [
          { title: "Land wires", estimatedHours: 1.5 },
          { title: "Label breakers", estimatedHours: 0.5 },
          { title: "Torque connections", estimatedHours: 1 },
        ],
      },
      {
        name: "Testing & Startup",
        tags: ["testing"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
        templates: [
          { title: "Circuit testing", estimatedHours: 1 },
          { title: "GFCI/AFCI verify", estimatedHours: 1 },
          { title: "Voltage checks", estimatedHours: 1 },
        ],
      },
      {
        name: "Final Inspection",
        tags: ["inspection"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
        templates: [
          { title: "Code walkthrough", estimatedHours: 0.5 },
          { title: "Documentation review", estimatedHours: 0.5 },
          { title: "Client handoff", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Punch List",
        tags: ["finishing"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 4,
        templates: [
          { title: "Fix deficiencies", estimatedHours: 1.5 },
          { title: "Touch-up", estimatedHours: 0.5 },
          { title: "Final adjustments", estimatedHours: 0.5 },
        ],
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
        templates: [
          { title: "Trench & lay pipe", estimatedHours: 6 },
          { title: "Install cleanouts", estimatedHours: 2 },
          { title: "Backfill", estimatedHours: 3 },
        ],
      },
      {
        name: "Top-Out",
        tags: ["rough-in"],
        estimatedHoursMin: 12,
        estimatedHoursMax: 24,
        templates: [
          { title: "Run supply lines", estimatedHours: 6 },
          { title: "Install DWV", estimatedHours: 8 },
          { title: "Stub out fixtures", estimatedHours: 4 },
        ],
      },
      {
        name: "Rough Inspection",
        tags: ["inspection"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
        templates: [
          { title: "Pressure test", estimatedHours: 0.5 },
          { title: "Visual check", estimatedHours: 0.5 },
          { title: "Code verify", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Trim-Out",
        tags: ["trim-out"],
        estimatedHoursMin: 8,
        estimatedHoursMax: 16,
        templates: [
          { title: "Set fixtures", estimatedHours: 6 },
          { title: "Connect supply", estimatedHours: 4 },
          { title: "Install trim", estimatedHours: 3 },
        ],
      },
      {
        name: "Testing & Startup",
        tags: ["testing"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
        templates: [
          { title: "Flow test", estimatedHours: 1 },
          { title: "Leak check", estimatedHours: 1 },
          { title: "Water heater startup", estimatedHours: 1 },
        ],
      },
      {
        name: "Final Inspection",
        tags: ["inspection"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
        templates: [
          { title: "Final code check", estimatedHours: 0.5 },
          { title: "Client walkthrough", estimatedHours: 0.5 },
          { title: "Documentation", estimatedHours: 0.5 },
        ],
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
        templates: [
          { title: "Manual J calc", estimatedHours: 1.5 },
          { title: "Equipment sizing", estimatedHours: 1 },
          { title: "Duct design review", estimatedHours: 1 },
        ],
      },
      {
        name: "Rough-In",
        tags: ["rough-in"],
        estimatedHoursMin: 16,
        estimatedHoursMax: 40,
        templates: [
          { title: "Install ductwork", estimatedHours: 12 },
          { title: "Run refrigerant lines", estimatedHours: 6 },
          { title: "Set plenums", estimatedHours: 4 },
        ],
      },
      {
        name: "Rough Inspection",
        tags: ["inspection"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
        templates: [
          { title: "Duct sealing check", estimatedHours: 0.5 },
          { title: "Code compliance", estimatedHours: 0.5 },
          { title: "Clearance verify", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Equipment Set",
        tags: ["equipment-set"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 8,
        templates: [
          { title: "Set condenser", estimatedHours: 2 },
          { title: "Install air handler", estimatedHours: 3 },
          { title: "Mount thermostat", estimatedHours: 1 },
        ],
      },
      {
        name: "Trim-Out",
        tags: ["trim-out"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 8,
        templates: [
          { title: "Install registers", estimatedHours: 2 },
          { title: "Connect controls", estimatedHours: 2 },
          { title: "Insulate lines", estimatedHours: 2 },
        ],
      },
      {
        name: "Startup & Commissioning",
        tags: ["commissioning", "testing"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
        templates: [
          { title: "Charge system", estimatedHours: 1 },
          { title: "Airflow balance", estimatedHours: 1 },
          { title: "Performance verify", estimatedHours: 1 },
        ],
      },
      {
        name: "Final Inspection",
        tags: ["inspection"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
        templates: [
          { title: "Code walkthrough", estimatedHours: 0.5 },
          { title: "Performance documentation", estimatedHours: 0.5 },
          { title: "Client orientation", estimatedHours: 0.5 },
        ],
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
        templates: [
          { title: "Scrape & sand", estimatedHours: 2 },
          { title: "Fill holes & cracks", estimatedHours: 1.5 },
          { title: "Tape & mask", estimatedHours: 1.5 },
          { title: "Drop cloths", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Priming",
        tags: ["installation"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 8,
        templates: [
          { title: "Spot prime", estimatedHours: 1.5 },
          { title: "Full coat primer", estimatedHours: 3 },
          { title: "Stain block", estimatedHours: 1 },
        ],
      },
      {
        name: "Paint Application",
        tags: ["installation"],
        estimatedHoursMin: 8,
        estimatedHoursMax: 16,
        templates: [
          { title: "Cut in edges", estimatedHours: 4 },
          { title: "Roll walls", estimatedHours: 6 },
          { title: "Brush detail areas", estimatedHours: 2 },
        ],
      },
      {
        name: "Trim & Detail",
        tags: ["finishing"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 8,
        templates: [
          { title: "Paint trim", estimatedHours: 3 },
          { title: "Paint doors", estimatedHours: 2 },
          { title: "Window detail", estimatedHours: 2 },
        ],
      },
      {
        name: "Touch-Up",
        tags: ["finishing"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
        templates: [
          { title: "Inspect for misses", estimatedHours: 0.5 },
          { title: "Touch-up spots", estimatedHours: 1.5 },
          { title: "Final detail", estimatedHours: 1 },
        ],
      },
      {
        name: "Cleanup",
        tags: ["cleanup"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
        templates: [
          { title: "Remove tape & plastic", estimatedHours: 0.5 },
          { title: "Clean brushes & equipment", estimatedHours: 0.5 },
          { title: "Final walkthrough", estimatedHours: 0.5 },
        ],
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
        templates: [
          { title: "Review plans", estimatedHours: 4 },
          { title: "Submit permits", estimatedHours: 4 },
          { title: "Schedule subs", estimatedHours: 4 },
        ],
      },
      {
        name: "Site Prep",
        tags: ["site-prep"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 16,
        templates: [
          { title: "Clear site", estimatedHours: 4 },
          { title: "Grade lot", estimatedHours: 4 },
          { title: "Set up fencing", estimatedHours: 2 },
        ],
      },
      {
        name: "Foundation",
        tags: ["forming"],
        estimatedHoursMin: 16,
        estimatedHoursMax: 40,
        templates: [
          { title: "Excavate footings", estimatedHours: 8 },
          { title: "Set forms", estimatedHours: 8 },
          { title: "Pour concrete", estimatedHours: 8 },
        ],
      },
      {
        name: "Framing",
        tags: ["framing"],
        estimatedHoursMin: 40,
        estimatedHoursMax: 120,
        templates: [
          { title: "Floor framing", estimatedHours: 16 },
          { title: "Wall framing", estimatedHours: 24 },
          { title: "Roof framing", estimatedHours: 24 },
          { title: "Sheathing", estimatedHours: 16 },
        ],
      },
      {
        name: "Trade Coordination",
        tags: ["coordination"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 8,
        templates: [
          { title: "Schedule trades", estimatedHours: 2 },
          { title: "Site meetings", estimatedHours: 2 },
          { title: "Progress updates", estimatedHours: 2 },
        ],
      },
      {
        name: "Inspections",
        tags: ["inspection"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
        templates: [
          { title: "Framing inspection", estimatedHours: 1 },
          { title: "Mechanical inspection", estimatedHours: 1 },
          { title: "Final inspection", estimatedHours: 1 },
        ],
      },
      {
        name: "Finishes",
        tags: ["finishing"],
        estimatedHoursMin: 16,
        estimatedHoursMax: 40,
        templates: [
          { title: "Drywall & paint", estimatedHours: 12 },
          { title: "Flooring", estimatedHours: 8 },
          { title: "Trim work", estimatedHours: 6 },
          { title: "Hardware", estimatedHours: 2 },
        ],
      },
      {
        name: "Punch List & Closeout",
        tags: ["finishing", "cleanup"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 16,
        templates: [
          { title: "Walk list", estimatedHours: 2 },
          { title: "Fix deficiencies", estimatedHours: 4 },
          { title: "Final clean", estimatedHours: 2 },
          { title: "Handover docs", estimatedHours: 2 },
        ],
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
        templates: [
          { title: "Check plans", estimatedHours: 1 },
          { title: "Mark layout lines", estimatedHours: 1 },
          { title: "Verify dimensions", estimatedHours: 1 },
        ],
      },
      {
        name: "Floor Framing",
        tags: ["framing"],
        estimatedHoursMin: 8,
        estimatedHoursMax: 24,
        templates: [
          { title: "Set sills", estimatedHours: 3 },
          { title: "Install joists", estimatedHours: 6 },
          { title: "Lay subfloor", estimatedHours: 4 },
        ],
      },
      {
        name: "Wall Framing",
        tags: ["framing"],
        estimatedHoursMin: 16,
        estimatedHoursMax: 40,
        templates: [
          { title: "Build walls", estimatedHours: 12 },
          { title: "Plumb & brace", estimatedHours: 4 },
          { title: "Install headers", estimatedHours: 4 },
        ],
      },
      {
        name: "Roof Framing",
        tags: ["framing"],
        estimatedHoursMin: 12,
        estimatedHoursMax: 32,
        templates: [
          { title: "Set ridge", estimatedHours: 3 },
          { title: "Install rafters", estimatedHours: 8 },
          { title: "Sheathing", estimatedHours: 6 },
        ],
      },
      {
        name: "Sheathing & Drying In",
        tags: ["installation"],
        estimatedHoursMin: 8,
        estimatedHoursMax: 16,
        templates: [
          { title: "Wall sheathing", estimatedHours: 4 },
          { title: "Roof sheathing", estimatedHours: 4 },
          { title: "House wrap", estimatedHours: 3 },
        ],
      },
      {
        name: "Finish Carpentry",
        tags: ["finishing"],
        estimatedHoursMin: 16,
        estimatedHoursMax: 40,
        templates: [
          { title: "Install trim", estimatedHours: 8 },
          { title: "Set doors", estimatedHours: 6 },
          { title: "Install cabinets", estimatedHours: 8 },
          { title: "Stair finish", estimatedHours: 6 },
        ],
      },
      {
        name: "Punch List",
        tags: ["finishing"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 8,
        templates: [
          { title: "Fix gaps", estimatedHours: 2 },
          { title: "Touch-up", estimatedHours: 1.5 },
          { title: "Final adjustments", estimatedHours: 1.5 },
        ],
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
        templates: [
          { title: "Grade & compact", estimatedHours: 3 },
          { title: "Set stakes", estimatedHours: 1 },
          { title: "Vapor barrier", estimatedHours: 1.5 },
        ],
      },
      {
        name: "Forming",
        tags: ["forming"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 12,
        templates: [
          { title: "Set forms", estimatedHours: 4 },
          { title: "Brace forms", estimatedHours: 2 },
          { title: "Check level", estimatedHours: 1 },
        ],
      },
      {
        name: "Rebar & Mesh",
        tags: ["installation"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 8,
        templates: [
          { title: "Cut & bend rebar", estimatedHours: 2 },
          { title: "Tie rebar", estimatedHours: 3 },
          { title: "Place mesh", estimatedHours: 2 },
        ],
      },
      {
        name: "Pour",
        tags: ["installation"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 6,
        templates: [
          { title: "Place concrete", estimatedHours: 2 },
          { title: "Screed", estimatedHours: 1 },
          { title: "Vibrate", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Finishing",
        tags: ["finishing"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 8,
        templates: [
          { title: "Bull float", estimatedHours: 1 },
          { title: "Trowel finish", estimatedHours: 2.5 },
          { title: "Broom finish", estimatedHours: 1 },
          { title: "Edge & joint", estimatedHours: 1.5 },
        ],
      },
      {
        name: "Curing & Protection",
        tags: ["curing"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
        templates: [
          { title: "Apply curing compound", estimatedHours: 0.5 },
          { title: "Cover with plastic", estimatedHours: 0.5 },
          { title: "Post barriers", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Cleanup",
        tags: ["cleanup"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
        templates: [
          { title: "Strip forms", estimatedHours: 0.5 },
          { title: "Grade around slab", estimatedHours: 0.5 },
          { title: "Remove debris", estimatedHours: 0.5 },
        ],
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
        templates: [
          { title: "Structural survey", estimatedHours: 2 },
          { title: "Hazmat assessment", estimatedHours: 2 },
          { title: "Demo plan", estimatedHours: 2 },
        ],
      },
      {
        name: "Abatement",
        tags: ["demolition"],
        estimatedHoursMin: 8,
        estimatedHoursMax: 40,
        templates: [
          { title: "Asbestos removal", estimatedHours: 12 },
          { title: "Lead paint encapsulation", estimatedHours: 8 },
          { title: "Mold remediation", estimatedHours: 8 },
        ],
      },
      {
        name: "Utility Disconnect",
        tags: ["demolition"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 8,
        templates: [
          { title: "Coordinate shutoffs", estimatedHours: 2 },
          { title: "Cap utilities", estimatedHours: 2 },
          { title: "Verify dead", estimatedHours: 1 },
        ],
      },
      {
        name: "Soft Strip",
        tags: ["demolition"],
        estimatedHoursMin: 8,
        estimatedHoursMax: 24,
        templates: [
          { title: "Remove fixtures", estimatedHours: 4 },
          { title: "Strip finishes", estimatedHours: 6 },
          { title: "Salvage materials", estimatedHours: 4 },
        ],
      },
      {
        name: "Structural Demo",
        tags: ["demolition"],
        estimatedHoursMin: 8,
        estimatedHoursMax: 40,
        templates: [
          { title: "Wall removal", estimatedHours: 8 },
          { title: "Floor removal", estimatedHours: 8 },
          { title: "Roof removal", estimatedHours: 8 },
        ],
      },
      {
        name: "Debris Removal",
        tags: ["cleanup"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 16,
        templates: [
          { title: "Load dumpsters", estimatedHours: 4 },
          { title: "Sort recyclables", estimatedHours: 2 },
          { title: "Haul off", estimatedHours: 4 },
        ],
      },
      {
        name: "Site Clearance",
        tags: ["cleanup", "site-prep"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 8,
        templates: [
          { title: "Final sweep", estimatedHours: 2 },
          { title: "Grade site", estimatedHours: 3 },
          { title: "Remove fencing", estimatedHours: 1.5 },
        ],
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
        templates: [
          { title: "Protect floors", estimatedHours: 0.5 },
          { title: "Stage materials", estimatedHours: 0.5 },
          { title: "Check framing", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Board Hanging",
        tags: ["installation"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 16,
        templates: [
          { title: "Hang ceilings", estimatedHours: 4 },
          { title: "Hang walls", estimatedHours: 6 },
          { title: "Cut openings", estimatedHours: 2 },
        ],
      },
      {
        name: "Taping",
        tags: ["finishing"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 6,
        templates: [
          { title: "Apply tape", estimatedHours: 1.5 },
          { title: "First coat", estimatedHours: 2 },
          { title: "Embed tape", estimatedHours: 1.5 },
        ],
      },
      {
        name: "Mudding",
        tags: ["finishing"],
        estimatedHoursMin: 3,
        estimatedHoursMax: 8,
        templates: [
          { title: "Second coat", estimatedHours: 2.5 },
          { title: "Third coat", estimatedHours: 2 },
          { title: "Skim coat", estimatedHours: 2 },
        ],
      },
      {
        name: "Sanding",
        tags: ["finishing"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
        templates: [
          { title: "Sand joints", estimatedHours: 1.5 },
          { title: "Check with light", estimatedHours: 0.5 },
          { title: "Touch-up", estimatedHours: 1 },
        ],
      },
      {
        name: "Priming",
        tags: ["finishing"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
        templates: [
          { title: "Spot prime", estimatedHours: 1 },
          { title: "Full prime coat", estimatedHours: 2 },
        ],
      },
      {
        name: "Punch & Inspection",
        tags: ["inspection"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
        templates: [
          { title: "Check for flaws", estimatedHours: 0.5 },
          { title: "Fix defects", estimatedHours: 0.5 },
          { title: "Final walk", estimatedHours: 0.5 },
        ],
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
        templates: [
          { title: "Moisture test", estimatedHours: 0.5 },
          { title: "Subfloor check", estimatedHours: 0.5 },
          { title: "Measure rooms", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Demo & Removal",
        tags: ["demolition"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 6,
        templates: [
          { title: "Remove old flooring", estimatedHours: 2 },
          { title: "Pull tack strips", estimatedHours: 1 },
          { title: "Scrape adhesive", estimatedHours: 1.5 },
        ],
      },
      {
        name: "Subfloor Prep",
        tags: ["site-prep"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 8,
        templates: [
          { title: "Level subfloor", estimatedHours: 2.5 },
          { title: "Patch holes", estimatedHours: 1.5 },
          { title: "Install underlayment", estimatedHours: 2 },
        ],
      },
      {
        name: "Installation",
        tags: ["installation"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 16,
        templates: [
          { title: "Layout pattern", estimatedHours: 1 },
          { title: "Install flooring", estimatedHours: 8 },
          { title: "Cut transitions", estimatedHours: 2 },
        ],
      },
      {
        name: "Trim & Transitions",
        tags: ["finishing"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
        templates: [
          { title: "Install baseboards", estimatedHours: 1.5 },
          { title: "Set transitions", estimatedHours: 1 },
          { title: "Shoe molding", estimatedHours: 1 },
        ],
      },
      {
        name: "Cleanup & Walkthrough",
        tags: ["cleanup", "inspection"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
        templates: [
          { title: "Vacuum & mop", estimatedHours: 0.5 },
          { title: "Client walkthrough", estimatedHours: 0.5 },
          { title: "Touch-up", estimatedHours: 0.5 },
        ],
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
        templates: [
          { title: "Thermal scan", estimatedHours: 0.5 },
          { title: "Measure areas", estimatedHours: 0.5 },
          { title: "Identify gaps", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Old Removal",
        tags: ["demolition"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 6,
        templates: [
          { title: "Remove old insulation", estimatedHours: 2 },
          { title: "Bag & dispose", estimatedHours: 1.5 },
          { title: "Clean surfaces", estimatedHours: 1 },
        ],
      },
      {
        name: "Air Sealing",
        tags: ["installation"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
        templates: [
          { title: "Seal penetrations", estimatedHours: 1 },
          { title: "Caulk gaps", estimatedHours: 1 },
          { title: "Foam cracks", estimatedHours: 1 },
        ],
      },
      {
        name: "Installation",
        tags: ["installation"],
        estimatedHoursMin: 3,
        estimatedHoursMax: 8,
        templates: [
          { title: "Install batts", estimatedHours: 3 },
          { title: "Blow-in fill", estimatedHours: 2.5 },
          { title: "Seal seams", estimatedHours: 1 },
        ],
      },
      {
        name: "Vapor Barrier",
        tags: ["installation"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
        templates: [
          { title: "Cut & fit barrier", estimatedHours: 1 },
          { title: "Seal overlaps", estimatedHours: 0.5 },
          { title: "Tape seams", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Inspection & Testing",
        tags: ["inspection", "testing"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
        templates: [
          { title: "Thermal verify", estimatedHours: 0.5 },
          { title: "Blower door test", estimatedHours: 0.5 },
          { title: "Photo documentation", estimatedHours: 0.5 },
        ],
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
        templates: [
          { title: "Property line verify", estimatedHours: 0.5 },
          { title: "Mark post locations", estimatedHours: 0.5 },
          { title: "Check utilities", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Utility Marking",
        tags: ["coordination"],
        estimatedHoursMin: 0,
        estimatedHoursMax: 0,
        templates: [
          { title: "Call 811", estimatedHours: null },
          { title: "Wait for marks", estimatedHours: null },
          { title: "Verify clearance", estimatedHours: null },
        ],
      },
      {
        name: "Site Prep",
        tags: ["site-prep"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
        templates: [
          { title: "Clear line", estimatedHours: 1 },
          { title: "Grade if needed", estimatedHours: 0.5 },
          { title: "Stage materials", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Post Setting",
        tags: ["installation"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 8,
        templates: [
          { title: "Dig holes", estimatedHours: 2 },
          { title: "Set posts", estimatedHours: 1.5 },
          { title: "Plumb & brace", estimatedHours: 1 },
          { title: "Pour concrete", estimatedHours: 1.5 },
        ],
      },
      {
        name: "Rail & Panel Install",
        tags: ["installation"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 8,
        templates: [
          { title: "Install rails", estimatedHours: 2 },
          { title: "Attach panels", estimatedHours: 3 },
          { title: "Level & align", estimatedHours: 1.5 },
        ],
      },
      {
        name: "Gate Installation",
        tags: ["installation"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
        templates: [
          { title: "Set gate posts", estimatedHours: 1 },
          { title: "Hang gate", estimatedHours: 1 },
          { title: "Install hardware", estimatedHours: 1 },
        ],
      },
      {
        name: "Finishing",
        tags: ["finishing"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
        templates: [
          { title: "Cap posts", estimatedHours: 0.5 },
          { title: "Touch-up", estimatedHours: 0.5 },
          { title: "Final adjustment", estimatedHours: 0.5 },
        ],
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
        templates: [
          { title: "Survey existing conditions", estimatedHours: 1.5 },
          { title: "Soil test", estimatedHours: 0.5 },
          { title: "Measure areas", estimatedHours: 1 },
        ],
      },
      {
        name: "Demolition & Clearing",
        tags: ["demolition"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 16,
        templates: [
          { title: "Remove old plants", estimatedHours: 4 },
          { title: "Clear debris", estimatedHours: 3 },
          { title: "Strip sod", estimatedHours: 3 },
        ],
      },
      {
        name: "Grading & Drainage",
        tags: ["site-prep"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 16,
        templates: [
          { title: "Rough grade", estimatedHours: 4 },
          { title: "Install drainage", estimatedHours: 4 },
          { title: "Fine grade", estimatedHours: 3 },
        ],
      },
      {
        name: "Irrigation Install",
        tags: ["installation", "plumbing"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 12,
        templates: [
          { title: "Trench lines", estimatedHours: 3 },
          { title: "Install heads", estimatedHours: 3 },
          { title: "Connect controller", estimatedHours: 2 },
        ],
      },
      {
        name: "Hardscape",
        tags: ["installation"],
        estimatedHoursMin: 8,
        estimatedHoursMax: 40,
        templates: [
          { title: "Set pavers", estimatedHours: 12 },
          { title: "Build walls", estimatedHours: 10 },
          { title: "Install edging", estimatedHours: 4 },
        ],
      },
      {
        name: "Softscape & Planting",
        tags: ["installation"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 16,
        templates: [
          { title: "Amend soil", estimatedHours: 2 },
          { title: "Plant trees & shrubs", estimatedHours: 4 },
          { title: "Lay sod", estimatedHours: 4 },
          { title: "Mulch", estimatedHours: 2 },
        ],
      },
      {
        name: "Lighting & Features",
        tags: ["electrical"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 8,
        templates: [
          { title: "Run wire", estimatedHours: 2 },
          { title: "Install fixtures", estimatedHours: 2 },
          { title: "Set timer", estimatedHours: 1 },
        ],
      },
      {
        name: "Cleanup & Walkthrough",
        tags: ["cleanup", "inspection"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
        templates: [
          { title: "Final cleanup", estimatedHours: 1 },
          { title: "Client walkthrough", estimatedHours: 1 },
          { title: "Care instructions", estimatedHours: 0.5 },
        ],
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
        templates: [
          { title: "Draw plans", estimatedHours: 1.5 },
          { title: "Submit permit", estimatedHours: 1 },
          { title: "Material takeoff", estimatedHours: 1 },
        ],
      },
      {
        name: "Site Prep",
        tags: ["site-prep"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
        templates: [
          { title: "Clear area", estimatedHours: 1 },
          { title: "Mark layout", estimatedHours: 0.5 },
          { title: "Level ground", estimatedHours: 1.5 },
        ],
      },
      {
        name: "Footings & Foundation",
        tags: ["forming"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 8,
        templates: [
          { title: "Dig footings", estimatedHours: 2 },
          { title: "Set forms", estimatedHours: 2 },
          { title: "Pour piers", estimatedHours: 2 },
        ],
      },
      {
        name: "Framing",
        tags: ["framing"],
        estimatedHoursMin: 6,
        estimatedHoursMax: 16,
        templates: [
          { title: "Set posts", estimatedHours: 2 },
          { title: "Install beams", estimatedHours: 3 },
          { title: "Install joists", estimatedHours: 4 },
          { title: "Block & brace", estimatedHours: 2 },
        ],
      },
      {
        name: "Decking",
        tags: ["installation"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 12,
        templates: [
          { title: "Lay boards", estimatedHours: 4 },
          { title: "Set spacing", estimatedHours: 1 },
          { title: "Cut curves", estimatedHours: 1.5 },
          { title: "Fasten", estimatedHours: 2 },
        ],
      },
      {
        name: "Railings & Stairs",
        tags: ["installation"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 12,
        templates: [
          { title: "Set posts", estimatedHours: 2 },
          { title: "Install rails", estimatedHours: 2 },
          { title: "Build stairs", estimatedHours: 3 },
          { title: "Set balusters", estimatedHours: 2 },
        ],
      },
      {
        name: "Finishing",
        tags: ["finishing"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 6,
        templates: [
          { title: "Sand surfaces", estimatedHours: 1.5 },
          { title: "Apply finish", estimatedHours: 2 },
          { title: "Touch-up", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Inspection",
        tags: ["inspection"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
        templates: [
          { title: "Code check", estimatedHours: 0.5 },
          { title: "Load test", estimatedHours: 0.5 },
          { title: "Client walkthrough", estimatedHours: 0.5 },
        ],
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
        templates: [
          { title: "Check framing", estimatedHours: 0.5 },
          { title: "Assess condition", estimatedHours: 0.5 },
          { title: "Note repairs needed", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Structural Repair",
        tags: ["repair"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 8,
        templates: [
          { title: "Replace joists", estimatedHours: 3 },
          { title: "Reinforce beams", estimatedHours: 2 },
          { title: "Fix connections", estimatedHours: 1.5 },
        ],
      },
      {
        name: "Board Removal",
        tags: ["demolition"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 6,
        templates: [
          { title: "Remove old boards", estimatedHours: 2 },
          { title: "Pull fasteners", estimatedHours: 1 },
          { title: "Clean frame", estimatedHours: 1 },
        ],
      },
      {
        name: "New Surface Install",
        tags: ["installation"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 12,
        templates: [
          { title: "Lay new boards", estimatedHours: 5 },
          { title: "Set spacing", estimatedHours: 1 },
          { title: "Fasten down", estimatedHours: 3 },
        ],
      },
      {
        name: "Cleaning & Prep",
        tags: ["site-prep"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
        templates: [
          { title: "Clean surface", estimatedHours: 1 },
          { title: "Sand if needed", estimatedHours: 1 },
          { title: "Prep for finish", estimatedHours: 1 },
        ],
      },
      {
        name: "Sealing & Finishing",
        tags: ["finishing"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
        templates: [
          { title: "Apply sealant", estimatedHours: 1.5 },
          { title: "Touch-up edges", estimatedHours: 0.5 },
          { title: "Clean excess", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Final Walkthrough",
        tags: ["inspection"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 1,
        templates: [
          { title: "Check quality", estimatedHours: 0.25 },
          { title: "Client review", estimatedHours: 0.25 },
          { title: "Maintenance tips", estimatedHours: 0.25 },
        ],
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
        templates: [
          { title: "Inspect walls", estimatedHours: 0.5 },
          { title: "Measure surfaces", estimatedHours: 0.5 },
          { title: "Note damage", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Old Siding Removal",
        tags: ["demolition"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 16,
        templates: [
          { title: "Strip siding", estimatedHours: 6 },
          { title: "Remove trim", estimatedHours: 2 },
          { title: "Pull nails", estimatedHours: 2 },
        ],
      },
      {
        name: "Wall Repair & Prep",
        tags: ["repair"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 8,
        templates: [
          { title: "Replace sheathing", estimatedHours: 3 },
          { title: "Patch holes", estimatedHours: 1.5 },
          { title: "Install housewrap", estimatedHours: 2 },
        ],
      },
      {
        name: "Flashing & Trim",
        tags: ["installation"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 6,
        templates: [
          { title: "Install flashing", estimatedHours: 1.5 },
          { title: "Set J-channel", estimatedHours: 1.5 },
          { title: "Corner trim", estimatedHours: 1.5 },
        ],
      },
      {
        name: "Siding Installation",
        tags: ["installation"],
        estimatedHoursMin: 8,
        estimatedHoursMax: 24,
        templates: [
          { title: "Start first course", estimatedHours: 2 },
          { title: "Run field", estimatedHours: 10 },
          { title: "Cut openings", estimatedHours: 4 },
        ],
      },
      {
        name: "Caulking & Sealing",
        tags: ["finishing"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
        templates: [
          { title: "Caulk joints", estimatedHours: 1 },
          { title: "Seal penetrations", estimatedHours: 0.5 },
          { title: "Touch-up", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Detail & Finishing",
        tags: ["finishing"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
        templates: [
          { title: "Install soffits", estimatedHours: 1.5 },
          { title: "Install fascia", estimatedHours: 1 },
          { title: "Final trim", estimatedHours: 1 },
        ],
      },
      {
        name: "Cleanup & Inspection",
        tags: ["cleanup", "inspection"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
        templates: [
          { title: "Remove debris", estimatedHours: 0.5 },
          { title: "Client walkthrough", estimatedHours: 0.5 },
          { title: "Touch-up", estimatedHours: 0.5 },
        ],
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
        templates: [
          { title: "Set up staging", estimatedHours: 1 },
          { title: "Protect surfaces", estimatedHours: 0.5 },
          { title: "Stage materials", estimatedHours: 1 },
        ],
      },
      {
        name: "Layout & Markup",
        tags: ["assessment"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
        templates: [
          { title: "Check plans", estimatedHours: 0.5 },
          { title: "Dry lay pattern", estimatedHours: 1 },
          { title: "Mark courses", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Scaffolding Setup",
        tags: ["site-prep"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
        templates: [
          { title: "Erect scaffold", estimatedHours: 1.5 },
          { title: "Set planks", estimatedHours: 0.5 },
          { title: "Safety check", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Block Laying",
        tags: ["installation"],
        estimatedHoursMin: 8,
        estimatedHoursMax: 40,
        templates: [
          { title: "Mix mortar", estimatedHours: 3 },
          { title: "Set blocks", estimatedHours: 16 },
          { title: "Check level & plumb", estimatedHours: 3 },
        ],
      },
      {
        name: "Grouting & Fill",
        tags: ["grouting"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 8,
        templates: [
          { title: "Fill cells", estimatedHours: 3 },
          { title: "Consolidate grout", estimatedHours: 2 },
          { title: "Clean excess", estimatedHours: 1 },
        ],
      },
      {
        name: "Pointing & Joints",
        tags: ["finishing"],
        estimatedHoursMin: 3,
        estimatedHoursMax: 8,
        templates: [
          { title: "Tool joints", estimatedHours: 3 },
          { title: "Strike mortar", estimatedHours: 2 },
          { title: "Brush clean", estimatedHours: 1 },
        ],
      },
      {
        name: "Curing & Protection",
        tags: ["curing"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
        templates: [
          { title: "Cover work", estimatedHours: 1 },
          { title: "Mist cure", estimatedHours: 1 },
          { title: "Protect from weather", estimatedHours: 1 },
        ],
      },
      {
        name: "Cleanup & Inspection",
        tags: ["cleanup", "inspection"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
        templates: [
          { title: "Remove scaffold", estimatedHours: 1.5 },
          { title: "Clean site", estimatedHours: 1 },
          { title: "Client walkthrough", estimatedHours: 0.5 },
        ],
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
        templates: [
          { title: "Set up workspace", estimatedHours: 1 },
          { title: "Protect surroundings", estimatedHours: 0.5 },
          { title: "Stage bricks", estimatedHours: 1 },
        ],
      },
      {
        name: "Layout & Markup",
        tags: ["assessment"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
        templates: [
          { title: "Check plans", estimatedHours: 0.5 },
          { title: "Dry lay first course", estimatedHours: 1 },
          { title: "Mark lines", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Scaffolding Setup",
        tags: ["site-prep"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
        templates: [
          { title: "Erect scaffold", estimatedHours: 1.5 },
          { title: "Safety inspection", estimatedHours: 0.5 },
          { title: "Plank setup", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Brick Laying",
        tags: ["installation"],
        estimatedHoursMin: 8,
        estimatedHoursMax: 40,
        templates: [
          { title: "Mix mortar", estimatedHours: 3 },
          { title: "Lay bricks", estimatedHours: 16 },
          { title: "Check level & plumb", estimatedHours: 3 },
          { title: "Cut bricks", estimatedHours: 4 },
        ],
      },
      {
        name: "Pointing & Jointing",
        tags: ["finishing"],
        estimatedHoursMin: 3,
        estimatedHoursMax: 8,
        templates: [
          { title: "Tool joints", estimatedHours: 3 },
          { title: "Brush clean", estimatedHours: 1 },
          { title: "Check alignment", estimatedHours: 1 },
        ],
      },
      {
        name: "Curing",
        tags: ["curing"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
        templates: [
          { title: "Cover work", estimatedHours: 1 },
          { title: "Mist cure", estimatedHours: 1 },
          { title: "Monitor weather", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Cleanup & Punch List",
        tags: ["cleanup", "inspection"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
        templates: [
          { title: "Remove scaffold", estimatedHours: 1.5 },
          { title: "Clean surfaces", estimatedHours: 1 },
          { title: "Fix defects", estimatedHours: 1 },
        ],
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
        templates: [
          { title: "Level substrate", estimatedHours: 2 },
          { title: "Apply backer board", estimatedHours: 2 },
          { title: "Waterproof membrane", estimatedHours: 1 },
        ],
      },
      {
        name: "Waterproofing",
        tags: ["installation"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
        templates: [
          { title: "Apply waterproof coating", estimatedHours: 1.5 },
          { title: "Seal corners", estimatedHours: 0.5 },
          { title: "Test flood", estimatedHours: 1 },
        ],
      },
      {
        name: "Layout & Dry Fit",
        tags: ["assessment"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
        templates: [
          { title: "Snap lines", estimatedHours: 0.5 },
          { title: "Dry lay pattern", estimatedHours: 1 },
          { title: "Plan cuts", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Tile Setting",
        tags: ["installation"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 16,
        templates: [
          { title: "Mix thinset", estimatedHours: 1 },
          { title: "Set tiles", estimatedHours: 6 },
          { title: "Insert spacers", estimatedHours: 1 },
          { title: "Cut tiles", estimatedHours: 3 },
        ],
      },
      {
        name: "Grouting",
        tags: ["grouting"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 6,
        templates: [
          { title: "Mix grout", estimatedHours: 0.5 },
          { title: "Apply grout", estimatedHours: 2 },
          { title: "Clean excess", estimatedHours: 1 },
          { title: "Shape joints", estimatedHours: 1 },
        ],
      },
      {
        name: "Sealing & Finish",
        tags: ["finishing"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
        templates: [
          { title: "Apply sealer", estimatedHours: 1 },
          { title: "Polish surface", estimatedHours: 0.5 },
          { title: "Install trim", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Cleanup & Inspection",
        tags: ["cleanup", "inspection"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
        templates: [
          { title: "Final clean", estimatedHours: 0.5 },
          { title: "Check grout lines", estimatedHours: 0.5 },
          { title: "Client walkthrough", estimatedHours: 0.5 },
        ],
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
        templates: [
          { title: "Protect area", estimatedHours: 1 },
          { title: "Stage stone", estimatedHours: 1 },
          { title: "Set up work zone", estimatedHours: 1 },
        ],
      },
      {
        name: "Surface Prep",
        tags: ["site-prep"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 6,
        templates: [
          { title: "Clean substrate", estimatedHours: 1 },
          { title: "Apply bonding agent", estimatedHours: 1 },
          { title: "Level surface", estimatedHours: 2 },
        ],
      },
      {
        name: "Stone Selection & Layout",
        tags: ["assessment"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
        templates: [
          { title: "Sort stones", estimatedHours: 1 },
          { title: "Plan pattern", estimatedHours: 1 },
          { title: "Dry fit", estimatedHours: 1 },
        ],
      },
      {
        name: "Stone Setting",
        tags: ["installation"],
        estimatedHoursMin: 8,
        estimatedHoursMax: 40,
        templates: [
          { title: "Mix mortar", estimatedHours: 1 },
          { title: "Set stones", estimatedHours: 4 },
          { title: "Check level", estimatedHours: 1 },
          { title: "Cut stones", estimatedHours: 2 },
        ],
      },
      {
        name: "Pointing & Grouting",
        tags: ["grouting", "finishing"],
        estimatedHoursMin: 3,
        estimatedHoursMax: 8,
        templates: [
          { title: "Fill joints", estimatedHours: 2 },
          { title: "Tool grout", estimatedHours: 1 },
          { title: "Clean excess", estimatedHours: 1 },
        ],
      },
      {
        name: "Sealing & Curing",
        tags: ["curing", "finishing"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
        templates: [
          { title: "Apply sealer", estimatedHours: 1 },
          { title: "Buff surface", estimatedHours: 1 },
          { title: "Cover to cure", estimatedHours: 1 },
        ],
      },
      {
        name: "Cleanup & Inspection",
        tags: ["cleanup", "inspection"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 3,
        templates: [
          { title: "Remove debris", estimatedHours: 1 },
          { title: "Client walkthrough", estimatedHours: 0.5 },
          { title: "Touch-up", estimatedHours: 0.5 },
        ],
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
        templates: [
          { title: "GPS survey", estimatedHours: 1 },
          { title: "Set grade stakes", estimatedHours: 1 },
          { title: "Mark boundaries", estimatedHours: 1 },
        ],
      },
      {
        name: "Clearing & Grubbing",
        tags: ["demolition"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 16,
        templates: [
          { title: "Remove trees", estimatedHours: 4 },
          { title: "Clear brush", estimatedHours: 4 },
          { title: "Grub stumps", estimatedHours: 4 },
        ],
      },
      {
        name: "Rough Grading",
        tags: ["site-prep"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 16,
        templates: [
          { title: "Cut & fill", estimatedHours: 4 },
          { title: "Grade to plan", estimatedHours: 4 },
          { title: "Compaction test", estimatedHours: 2 },
        ],
      },
      {
        name: "Trenching",
        tags: ["installation"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 24,
        templates: [
          { title: "Dig trenches", estimatedHours: 4 },
          { title: "Set bedding", estimatedHours: 2 },
          { title: "Backfill", estimatedHours: 2 },
        ],
      },
      {
        name: "Foundation Excavation",
        tags: ["installation"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 16,
        templates: [
          { title: "Dig foundation", estimatedHours: 4 },
          { title: "Shape walls", estimatedHours: 2 },
          { title: "Dewater", estimatedHours: 2 },
        ],
      },
      {
        name: "Backfill & Compaction",
        tags: ["installation"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 16,
        templates: [
          { title: "Place fill", estimatedHours: 4 },
          { title: "Compact layers", estimatedHours: 4 },
          { title: "Test density", estimatedHours: 2 },
        ],
      },
      {
        name: "Finish Grading",
        tags: ["finishing"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 8,
        templates: [
          { title: "Fine grade", estimatedHours: 2 },
          { title: "Seed & straw", estimatedHours: 2 },
          { title: "Install erosion control", estimatedHours: 2 },
        ],
      },
      {
        name: "Final Inspection",
        tags: ["inspection"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
        templates: [
          { title: "Check elevations", estimatedHours: 1 },
          { title: "Photo documentation", estimatedHours: 0.5 },
          { title: "Sign-off", estimatedHours: 0.5 },
        ],
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
        templates: [
          { title: "Saw cut edges", estimatedHours: 2 },
          { title: "Remove old pavement", estimatedHours: 4 },
          { title: "Haul debris", estimatedHours: 2 },
        ],
      },
      {
        name: "Grading & Drainage",
        tags: ["site-prep"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 8,
        templates: [
          { title: "Grade sub-base", estimatedHours: 2 },
          { title: "Install drains", estimatedHours: 2 },
          { title: "Compact", estimatedHours: 2 },
        ],
      },
      {
        name: "Base Installation",
        tags: ["installation"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 8,
        templates: [
          { title: "Spread aggregate", estimatedHours: 2 },
          { title: "Grade base", estimatedHours: 2 },
          { title: "Compact layers", estimatedHours: 2 },
        ],
      },
      {
        name: "Binder Course",
        tags: ["installation"],
        estimatedHoursMin: 3,
        estimatedHoursMax: 6,
        templates: [
          { title: "Apply tack coat", estimatedHours: 1 },
          { title: "Lay binder", estimatedHours: 2 },
          { title: "Roll & compact", estimatedHours: 1 },
        ],
      },
      {
        name: "Surface Paving",
        tags: ["installation"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 12,
        templates: [
          { title: "Spread asphalt", estimatedHours: 3 },
          { title: "Screed surface", estimatedHours: 2 },
          { title: "Roll finish", estimatedHours: 2 },
        ],
      },
      {
        name: "Compaction & Curing",
        tags: ["curing"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
        templates: [
          { title: "Final rolling", estimatedHours: 1 },
          { title: "Cool-down", estimatedHours: 1 },
          { title: "Traffic barriers", estimatedHours: 1 },
        ],
      },
      {
        name: "Striping & Markings",
        tags: ["finishing"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 6,
        templates: [
          { title: "Layout lines", estimatedHours: 1 },
          { title: "Apply paint", estimatedHours: 2 },
          { title: "Install signs", estimatedHours: 1 },
        ],
      },
      {
        name: "Final Inspection",
        tags: ["inspection"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
        templates: [
          { title: "Check grade", estimatedHours: 0.5 },
          { title: "Verify drainage", estimatedHours: 0.5 },
          { title: "Client walkthrough", estimatedHours: 0.5 },
        ],
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
        templates: [
          { title: "Dig to footing", estimatedHours: 4 },
          { title: "Shore walls", estimatedHours: 2 },
          { title: "Dewater", estimatedHours: 2 },
        ],
      },
      {
        name: "Surface Cleaning",
        tags: ["site-prep"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
        templates: [
          { title: "Power wash", estimatedHours: 1 },
          { title: "Remove old coating", estimatedHours: 1 },
          { title: "Dry surface", estimatedHours: 1 },
        ],
      },
      {
        name: "Repairs & Parging",
        tags: ["repair"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 8,
        templates: [
          { title: "Patch cracks", estimatedHours: 2 },
          { title: "Apply parging", estimatedHours: 2 },
          { title: "Smooth surface", estimatedHours: 1 },
        ],
      },
      {
        name: "Membrane Application",
        tags: ["installation"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 12,
        templates: [
          { title: "Apply primer", estimatedHours: 1 },
          { title: "Roll membrane", estimatedHours: 3 },
          { title: "Seal seams", estimatedHours: 2 },
        ],
      },
      {
        name: "Drainage Install",
        tags: ["installation", "plumbing"],
        estimatedHoursMin: 3,
        estimatedHoursMax: 8,
        templates: [
          { title: "Set drain board", estimatedHours: 2 },
          { title: "Install weeping tile", estimatedHours: 2 },
          { title: "Connect to sump", estimatedHours: 1 },
        ],
      },
      {
        name: "Flood Testing",
        tags: ["testing"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
        templates: [
          { title: "Block drains", estimatedHours: 0.5 },
          { title: "Fill to level", estimatedHours: 1 },
          { title: "Monitor leaks", estimatedHours: 1.5 },
        ],
      },
      {
        name: "Backfill & Grade",
        tags: ["finishing"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 8,
        templates: [
          { title: "Place clean fill", estimatedHours: 2 },
          { title: "Compact layers", estimatedHours: 2 },
          { title: "Final grade", estimatedHours: 2 },
        ],
      },
      {
        name: "Final Inspection",
        tags: ["inspection"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
        templates: [
          { title: "Check membrane", estimatedHours: 0.5 },
          { title: "Verify drainage", estimatedHours: 0.5 },
          { title: "Documentation", estimatedHours: 0.5 },
        ],
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
        templates: [
          { title: "Measure openings", estimatedHours: 0.5 },
          { title: "Verify specifications", estimatedHours: 0.5 },
          { title: "Confirm order", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Interior Prep",
        tags: ["site-prep"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
        templates: [
          { title: "Protect floors", estimatedHours: 0.5 },
          { title: "Remove blinds", estimatedHours: 0.5 },
          { title: "Clear furniture", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Removal",
        tags: ["demolition"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 6,
        templates: [
          { title: "Remove sash", estimatedHours: 1 },
          { title: "Pull frame", estimatedHours: 1 },
          { title: "Clean opening", estimatedHours: 1 },
        ],
      },
      {
        name: "Opening Prep",
        tags: ["repair"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
        templates: [
          { title: "Check level", estimatedHours: 0.5 },
          { title: "Repair sill", estimatedHours: 1 },
          { title: "Flash opening", estimatedHours: 1 },
        ],
      },
      {
        name: "Window Install",
        tags: ["installation"],
        estimatedHoursMin: 3,
        estimatedHoursMax: 8,
        templates: [
          { title: "Set window", estimatedHours: 1 },
          { title: "Shim & level", estimatedHours: 1 },
          { title: "Fasten", estimatedHours: 1 },
          { title: "Insulate gap", estimatedHours: 1 },
        ],
      },
      {
        name: "Sealing & Trim",
        tags: ["finishing"],
        estimatedHoursMin: 3,
        estimatedHoursMax: 6,
        templates: [
          { title: "Apply sealant", estimatedHours: 1 },
          { title: "Install trim", estimatedHours: 2 },
          { title: "Caulk exterior", estimatedHours: 1 },
        ],
      },
      {
        name: "Final Inspection",
        tags: ["inspection"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
        templates: [
          { title: "Operation check", estimatedHours: 0.5 },
          { title: "Seal verify", estimatedHours: 0.5 },
          { title: "Client walkthrough", estimatedHours: 0.5 },
        ],
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
        templates: [
          { title: "Roof inspection", estimatedHours: 1 },
          { title: "Shade analysis", estimatedHours: 1 },
          { title: "Electrical review", estimatedHours: 1 },
        ],
      },
      {
        name: "Permitting",
        tags: ["permitting"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
        templates: [
          { title: "Submit plans", estimatedHours: 0.5 },
          { title: "Utility interconnection", estimatedHours: 0.5 },
          { title: "HOA review", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Roof Prep",
        tags: ["site-prep"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
        templates: [
          { title: "Mark layout", estimatedHours: 1 },
          { title: "Install flashing", estimatedHours: 1 },
          { title: "Seal penetrations", estimatedHours: 1 },
        ],
      },
      {
        name: "Racking & Mounting",
        tags: ["installation"],
        estimatedHoursMin: 3,
        estimatedHoursMax: 6,
        templates: [
          { title: "Install rails", estimatedHours: 2 },
          { title: "Set mounts", estimatedHours: 1 },
          { title: "Level & align", estimatedHours: 1 },
        ],
      },
      {
        name: "Panel Install",
        tags: ["installation"],
        estimatedHoursMin: 3,
        estimatedHoursMax: 6,
        templates: [
          { title: "Place panels", estimatedHours: 2 },
          { title: "Wire modules", estimatedHours: 1 },
          { title: "Secure clips", estimatedHours: 1 },
        ],
      },
      {
        name: "Electrical Work",
        tags: ["electrical"],
        estimatedHoursMin: 3,
        estimatedHoursMax: 6,
        templates: [
          { title: "Run conduit", estimatedHours: 1 },
          { title: "Install inverter", estimatedHours: 1 },
          { title: "Connect to panel", estimatedHours: 1 },
        ],
      },
      {
        name: "System Testing",
        tags: ["testing"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
        templates: [
          { title: "Voltage check", estimatedHours: 0.5 },
          { title: "Performance test", estimatedHours: 0.5 },
          { title: "Monitor setup", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Inspection & Commission",
        tags: ["inspection", "commissioning"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
        templates: [
          { title: "Code inspection", estimatedHours: 0.5 },
          { title: "Utility approval", estimatedHours: 0.5 },
          { title: "System handoff", estimatedHours: 0.5 },
        ],
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
        templates: [
          { title: "Measure openings", estimatedHours: 1 },
          { title: "Template curves", estimatedHours: 1 },
          { title: "Note conditions", estimatedHours: 1 },
        ],
      },
      {
        name: "Shop Fabrication",
        tags: ["installation"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 8,
        templates: [
          { title: "Cut glass", estimatedHours: 2 },
          { title: "Build frames", estimatedHours: 2 },
          { title: "Assemble units", estimatedHours: 2 },
        ],
      },
      {
        name: "Frame Install",
        tags: ["installation"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 8,
        templates: [
          { title: "Set frames", estimatedHours: 2 },
          { title: "Shim & level", estimatedHours: 2 },
          { title: "Anchor", estimatedHours: 2 },
        ],
      },
      {
        name: "Glass Setting",
        tags: ["installation"],
        estimatedHoursMin: 3,
        estimatedHoursMax: 6,
        templates: [
          { title: "Set glass", estimatedHours: 2 },
          { title: "Install glazing tape", estimatedHours: 1 },
          { title: "Apply stops", estimatedHours: 1 },
        ],
      },
      {
        name: "Sealing & Caulk",
        tags: ["finishing"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
        templates: [
          { title: "Apply sealant", estimatedHours: 1 },
          { title: "Tool joints", estimatedHours: 1 },
          { title: "Clean glass", estimatedHours: 1 },
        ],
      },
      {
        name: "Waterproofing",
        tags: ["installation"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
        templates: [
          { title: "Flash heads", estimatedHours: 1 },
          { title: "Seal sills", estimatedHours: 1 },
          { title: "Test with water", estimatedHours: 1 },
        ],
      },
      {
        name: "Punch & Inspect",
        tags: ["inspection"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
        templates: [
          { title: "Check seals", estimatedHours: 0.5 },
          { title: "Operation test", estimatedHours: 0.5 },
          { title: "Final clean", estimatedHours: 0.5 },
        ],
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
        templates: [
          { title: "Review drawings", estimatedHours: 1 },
          { title: "Calculate fittings", estimatedHours: 1 },
          { title: "Create cut list", estimatedHours: 1 },
        ],
      },
      {
        name: "Shop Fabrication",
        tags: ["installation"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 8,
        templates: [
          { title: "Cut sheet", estimatedHours: 2 },
          { title: "Form duct", estimatedHours: 2 },
          { title: "Assemble fittings", estimatedHours: 2 },
        ],
      },
      {
        name: "Hanger Install",
        tags: ["installation"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
        templates: [
          { title: "Layout hangers", estimatedHours: 1 },
          { title: "Install rod", estimatedHours: 1 },
          { title: "Set trapeze", estimatedHours: 1 },
        ],
      },
      {
        name: "Duct Install",
        tags: ["installation"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 8,
        templates: [
          { title: "Hang main duct", estimatedHours: 3 },
          { title: "Connect branches", estimatedHours: 2 },
          { title: "Seal joints", estimatedHours: 1 },
        ],
      },
      {
        name: "Sealing & Insulate",
        tags: ["finishing"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
        templates: [
          { title: "Apply mastic", estimatedHours: 1 },
          { title: "Wrap insulation", estimatedHours: 1 },
          { title: "Vapor seal", estimatedHours: 1 },
        ],
      },
      {
        name: "TAB Prep",
        tags: ["commissioning"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
        templates: [
          { title: "Install dampers", estimatedHours: 1 },
          { title: "Mark test points", estimatedHours: 0.5 },
          { title: "Pre-balance", estimatedHours: 1 },
        ],
      },
      {
        name: "Final Inspection",
        tags: ["inspection"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
        templates: [
          { title: "Leak check", estimatedHours: 0.5 },
          { title: "Insulation verify", estimatedHours: 0.5 },
          { title: "Documentation", estimatedHours: 0.5 },
        ],
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
        templates: [
          { title: "Review specs", estimatedHours: 1 },
          { title: "Check tolerances", estimatedHours: 1 },
          { title: "Material list", estimatedHours: 1 },
        ],
      },
      {
        name: "Material Prep",
        tags: ["site-prep"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
        templates: [
          { title: "Stage material", estimatedHours: 0.5 },
          { title: "Mark cut lines", estimatedHours: 0.5 },
          { title: "Set up jigs", estimatedHours: 1 },
        ],
      },
      {
        name: "Cutting",
        tags: ["installation"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 6,
        templates: [
          { title: "Saw cut", estimatedHours: 2 },
          { title: "Plasma cut", estimatedHours: 2 },
          { title: "Deburr edges", estimatedHours: 1 },
        ],
      },
      {
        name: "Forming & Bending",
        tags: ["installation"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 6,
        templates: [
          { title: "Set brake", estimatedHours: 1 },
          { title: "Form pieces", estimatedHours: 2 },
          { title: "Check angles", estimatedHours: 1 },
        ],
      },
      {
        name: "Welding & Assembly",
        tags: ["installation"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 8,
        templates: [
          { title: "Fit-up", estimatedHours: 1 },
          { title: "Tack weld", estimatedHours: 1 },
          { title: "Final weld", estimatedHours: 2 },
          { title: "Grind", estimatedHours: 1 },
        ],
      },
      {
        name: "Finishing",
        tags: ["finishing"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 6,
        templates: [
          { title: "Sand & grind", estimatedHours: 2 },
          { title: "Apply coating", estimatedHours: 1 },
          { title: "Quality check", estimatedHours: 1 },
        ],
      },
      {
        name: "Quality Control",
        tags: ["inspection"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
        templates: [
          { title: "Dimensional check", estimatedHours: 1 },
          { title: "Weld inspection", estimatedHours: 0.5 },
          { title: "Test fit", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Pack & Ship",
        tags: ["cleanup"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
        templates: [
          { title: "Wrap pieces", estimatedHours: 0.5 },
          { title: "Load truck", estimatedHours: 0.5 },
          { title: "Document shipment", estimatedHours: 0.5 },
        ],
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
        templates: [
          { title: "Review procedure", estimatedHours: 0.5 },
          { title: "Check certifications", estimatedHours: 0.5 },
          { title: "Material verify", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Joint Prep",
        tags: ["site-prep"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
        templates: [
          { title: "Bevel edges", estimatedHours: 1 },
          { title: "Clean surfaces", estimatedHours: 1 },
          { title: "Fit-up", estimatedHours: 1 },
        ],
      },
      {
        name: "Welding",
        tags: ["installation"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 8,
        templates: [
          { title: "Root pass", estimatedHours: 1 },
          { title: "Fill passes", estimatedHours: 2 },
          { title: "Cap pass", estimatedHours: 1 },
          { title: "Inter-pass clean", estimatedHours: 1 },
        ],
      },
      {
        name: "Post-Weld Treat",
        tags: ["curing"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 4,
        templates: [
          { title: "Stress relieve", estimatedHours: 1 },
          { title: "Cool down", estimatedHours: 1 },
          { title: "Remove spatter", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Visual Inspection",
        tags: ["inspection"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
        templates: [
          { title: "Check profile", estimatedHours: 0.5 },
          { title: "Measure size", estimatedHours: 0.5 },
          { title: "Document defects", estimatedHours: 0.5 },
        ],
      },
      {
        name: "NDT Testing",
        tags: ["testing"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 6,
        templates: [
          { title: "UT scan", estimatedHours: 2 },
          { title: "MT inspection", estimatedHours: 1 },
          { title: "RT if required", estimatedHours: 2 },
        ],
      },
      {
        name: "Repair & Rework",
        tags: ["repair"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
        templates: [
          { title: "Grind out defects", estimatedHours: 1 },
          { title: "Re-weld", estimatedHours: 1 },
          { title: "Re-inspect", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Coating & Finish",
        tags: ["finishing"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
        templates: [
          { title: "Blast clean", estimatedHours: 1 },
          { title: "Apply primer", estimatedHours: 0.5 },
          { title: "Top coat", estimatedHours: 0.5 },
        ],
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
        templates: [
          { title: "Check access", estimatedHours: 0.5 },
          { title: "Note obstructions", estimatedHours: 0.5 },
          { title: "Measure heights", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Scaffold Design",
        tags: ["assessment"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
        templates: [
          { title: "Draw plan", estimatedHours: 1 },
          { title: "Calculate loads", estimatedHours: 1 },
          { title: "Select components", estimatedHours: 1 },
        ],
      },
      {
        name: "Base Setup",
        tags: ["site-prep"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
        templates: [
          { title: "Level ground", estimatedHours: 0.5 },
          { title: "Set base plates", estimatedHours: 0.5 },
          { title: "Install mud sills", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Erection",
        tags: ["installation"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 12,
        templates: [
          { title: "Assemble frames", estimatedHours: 4 },
          { title: "Install braces", estimatedHours: 2 },
          { title: "Set platforms", estimatedHours: 2 },
        ],
      },
      {
        name: "Tie-In & Brace",
        tags: ["installation"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
        templates: [
          { title: "Install ties", estimatedHours: 1 },
          { title: "Add bracing", estimatedHours: 0.5 },
          { title: "Check plumb", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Safety Inspection",
        tags: ["inspection"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
        templates: [
          { title: "Check connections", estimatedHours: 0.5 },
          { title: "Verify guardrails", estimatedHours: 0.5 },
          { title: "Tag scaffold", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Modification",
        tags: ["installation"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
        templates: [
          { title: "Adjust height", estimatedHours: 1 },
          { title: "Add platforms", estimatedHours: 1 },
          { title: "Relocate sections", estimatedHours: 1 },
        ],
      },
      {
        name: "Dismantle",
        tags: ["demolition"],
        estimatedHoursMin: 3,
        estimatedHoursMax: 8,
        templates: [
          { title: "Remove platforms", estimatedHours: 2 },
          { title: "Lower frames", estimatedHours: 2 },
          { title: "Sort & load", estimatedHours: 2 },
        ],
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
        templates: [
          { title: "Check drawings", estimatedHours: 1 },
          { title: "Calculate quantities", estimatedHours: 0.5 },
          { title: "Note callouts", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Material Staging",
        tags: ["site-prep"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
        templates: [
          { title: "Sort bars", estimatedHours: 0.5 },
          { title: "Stage by size", estimatedHours: 0.5 },
          { title: "Organize accessories", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Cutting & Bending",
        tags: ["installation"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 6,
        templates: [
          { title: "Cut to length", estimatedHours: 2 },
          { title: "Bend shapes", estimatedHours: 2 },
          { title: "Bundle sets", estimatedHours: 1 },
        ],
      },
      {
        name: "Placement",
        tags: ["installation"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 8,
        templates: [
          { title: "Set chairs", estimatedHours: 1 },
          { title: "Place bars", estimatedHours: 3 },
          { title: "Position layers", estimatedHours: 2 },
        ],
      },
      {
        name: "Tying",
        tags: ["installation"],
        estimatedHoursMin: 3,
        estimatedHoursMax: 6,
        templates: [
          { title: "Tie intersections", estimatedHours: 2 },
          { title: "Secure chairs", estimatedHours: 1 },
          { title: "Check spacing", estimatedHours: 1 },
        ],
      },
      {
        name: "Pre-Pour Inspect",
        tags: ["inspection"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
        templates: [
          { title: "Verify placement", estimatedHours: 0.5 },
          { title: "Check cover", estimatedHours: 0.5 },
          { title: "Photo document", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Pour Support",
        tags: ["coordination"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
        templates: [
          { title: "Stand by for pour", estimatedHours: 1 },
          { title: "Adjust if needed", estimatedHours: 1 },
          { title: "Monitor placement", estimatedHours: 1 },
        ],
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
        templates: [
          { title: "Calculate loads", estimatedHours: 1 },
          { title: "Plan rigging", estimatedHours: 1 },
          { title: "Review site", estimatedHours: 1 },
        ],
      },
      {
        name: "Site Assessment",
        tags: ["assessment"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
        templates: [
          { title: "Check ground conditions", estimatedHours: 0.5 },
          { title: "Identify hazards", estimatedHours: 0.5 },
          { title: "Mark swing radius", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Mobilization",
        tags: ["site-prep"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 8,
        templates: [
          { title: "Transport crane", estimatedHours: 3 },
          { title: "Set up mats", estimatedHours: 1 },
          { title: "Position crane", estimatedHours: 1 },
        ],
      },
      {
        name: "Crane Setup",
        tags: ["installation"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 6,
        templates: [
          { title: "Extend outriggers", estimatedHours: 1 },
          { title: "Level crane", estimatedHours: 1 },
          { title: "Install boom", estimatedHours: 2 },
        ],
      },
      {
        name: "Rigging",
        tags: ["installation"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
        templates: [
          { title: "Attach rigging", estimatedHours: 0.5 },
          { title: "Check connections", estimatedHours: 0.5 },
          { title: "Test lift", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Lifting Ops",
        tags: ["installation"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 8,
        templates: [
          { title: "Signal coordination", estimatedHours: 1 },
          { title: "Execute lifts", estimatedHours: 4 },
          { title: "Monitor loads", estimatedHours: 1 },
        ],
      },
      {
        name: "Demobilization",
        tags: ["cleanup"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 6,
        templates: [
          { title: "Disassemble boom", estimatedHours: 2 },
          { title: "Retract outriggers", estimatedHours: 1 },
          { title: "Load for transport", estimatedHours: 2 },
        ],
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
        templates: [
          { title: "Review manuals", estimatedHours: 1 },
          { title: "Check foundation", estimatedHours: 1 },
          { title: "Plan rigging", estimatedHours: 1 },
        ],
      },
      {
        name: "Receiving & Stage",
        tags: ["site-prep"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
        templates: [
          { title: "Inspect shipment", estimatedHours: 1 },
          { title: "Unload", estimatedHours: 1 },
          { title: "Stage at location", estimatedHours: 1 },
        ],
      },
      {
        name: "Rigging & Setting",
        tags: ["installation"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 8,
        templates: [
          { title: "Attach rigging", estimatedHours: 1 },
          { title: "Lift equipment", estimatedHours: 2 },
          { title: "Set on foundation", estimatedHours: 2 },
        ],
      },
      {
        name: "Leveling & Grout",
        tags: ["grouting"],
        estimatedHoursMin: 3,
        estimatedHoursMax: 6,
        templates: [
          { title: "Level machine", estimatedHours: 1 },
          { title: "Pour grout", estimatedHours: 2 },
          { title: "Wait for cure", estimatedHours: 2 },
        ],
      },
      {
        name: "Alignment",
        tags: ["installation"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 6,
        templates: [
          { title: "Laser align", estimatedHours: 2 },
          { title: "Shim adjust", estimatedHours: 1 },
          { title: "Verify tolerance", estimatedHours: 1 },
        ],
      },
      {
        name: "Mechanical Hookup",
        tags: ["installation"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
        templates: [
          { title: "Connect piping", estimatedHours: 1 },
          { title: "Install couplings", estimatedHours: 1 },
          { title: "Set guards", estimatedHours: 1 },
        ],
      },
      {
        name: "Testing & Commish",
        tags: ["commissioning", "testing"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
        templates: [
          { title: "Run uncoupled", estimatedHours: 1 },
          { title: "Load test", estimatedHours: 1 },
          { title: "Vibration check", estimatedHours: 1 },
        ],
      },
      {
        name: "Punch & Handover",
        tags: ["inspection"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
        templates: [
          { title: "Check list", estimatedHours: 0.5 },
          { title: "Training", estimatedHours: 0.5 },
          { title: "Documentation", estimatedHours: 0.5 },
        ],
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
        templates: [
          { title: "Set control points", estimatedHours: 1 },
          { title: "Calibrate instruments", estimatedHours: 1 },
          { title: "Verify benchmarks", estimatedHours: 1 },
        ],
      },
      {
        name: "Topo Survey",
        tags: ["assessment"],
        estimatedHoursMin: 3,
        estimatedHoursMax: 6,
        templates: [
          { title: "Shoot points", estimatedHours: 2 },
          { title: "Record features", estimatedHours: 1 },
          { title: "Note elevations", estimatedHours: 1 },
        ],
      },
      {
        name: "Boundary Survey",
        tags: ["assessment"],
        estimatedHoursMin: 3,
        estimatedHoursMax: 6,
        templates: [
          { title: "Research deeds", estimatedHours: 1 },
          { title: "Locate monuments", estimatedHours: 2 },
          { title: "Set corners", estimatedHours: 1 },
        ],
      },
      {
        name: "Construction Stake",
        tags: ["installation"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 6,
        templates: [
          { title: "Set offset stakes", estimatedHours: 2 },
          { title: "Mark grades", estimatedHours: 1 },
          { title: "Install hubs", estimatedHours: 1 },
        ],
      },
      {
        name: "Foundation Layout",
        tags: ["installation"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
        templates: [
          { title: "Set corners", estimatedHours: 1 },
          { title: "Check square", estimatedHours: 1 },
          { title: "Mark elevations", estimatedHours: 1 },
        ],
      },
      {
        name: "Progress Check",
        tags: ["inspection"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
        templates: [
          { title: "Verify grades", estimatedHours: 0.5 },
          { title: "Check alignment", estimatedHours: 0.5 },
          { title: "Report deviations", estimatedHours: 0.5 },
        ],
      },
      {
        name: "As-Built Survey",
        tags: ["inspection"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
        templates: [
          { title: "Measure as-built", estimatedHours: 1 },
          { title: "Record changes", estimatedHours: 1 },
          { title: "Submit drawings", estimatedHours: 1 },
        ],
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
        templates: [
          { title: "Check fascia", estimatedHours: 0.5 },
          { title: "Measure runs", estimatedHours: 0.5 },
          { title: "Note downspout locations", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Old Gutter Removal",
        tags: ["demolition"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
        templates: [
          { title: "Remove gutters", estimatedHours: 1 },
          { title: "Pull hangers", estimatedHours: 0.5 },
          { title: "Clean fascia", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Fascia Repair",
        tags: ["repair"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 4,
        templates: [
          { title: "Replace rot", estimatedHours: 1 },
          { title: "Paint fascia", estimatedHours: 1 },
          { title: "Install drip edge", estimatedHours: 1 },
        ],
      },
      {
        name: "Measurement & Layout",
        tags: ["assessment"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
        templates: [
          { title: "Snap chalk lines", estimatedHours: 0.5 },
          { title: "Mark slope", estimatedHours: 0.5 },
          { title: "Plan outlets", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Gutter Fabrication",
        tags: ["installation"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
        templates: [
          { title: "Form gutters", estimatedHours: 1 },
          { title: "Cut miters", estimatedHours: 0.5 },
          { title: "Seal joints", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Gutter Installation",
        tags: ["installation"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 6,
        templates: [
          { title: "Install hangers", estimatedHours: 1 },
          { title: "Mount gutters", estimatedHours: 2 },
          { title: "Check pitch", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Downspout Install",
        tags: ["installation"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
        templates: [
          { title: "Attach elbows", estimatedHours: 0.5 },
          { title: "Secure downspouts", estimatedHours: 0.5 },
          { title: "Add extensions", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Final Inspection",
        tags: ["inspection"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 1,
        templates: [
          { title: "Flow test", estimatedHours: 0.5 },
          { title: "Check hangers", estimatedHours: 0.25 },
          { title: "Client review", estimatedHours: 0.25 },
        ],
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
        templates: [
          { title: "Measure opening", estimatedHours: 0.5 },
          { title: "Check structure", estimatedHours: 0.5 },
          { title: "Review options", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Old Door Removal",
        tags: ["demolition"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
        templates: [
          { title: "Disconnect opener", estimatedHours: 0.5 },
          { title: "Remove panels", estimatedHours: 1 },
          { title: "Pull tracks", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Frame Prep",
        tags: ["site-prep"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
        templates: [
          { title: "Check level", estimatedHours: 0.5 },
          { title: "Repair jambs", estimatedHours: 0.5 },
          { title: "Install weatherseal", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Track Installation",
        tags: ["installation"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
        templates: [
          { title: "Mount vertical tracks", estimatedHours: 0.5 },
          { title: "Install horizontal", estimatedHours: 0.5 },
          { title: "Level & plumb", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Panel & Hardware",
        tags: ["installation"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
        templates: [
          { title: "Set panels", estimatedHours: 1 },
          { title: "Install rollers", estimatedHours: 0.5 },
          { title: "Attach hinges", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Spring Setup",
        tags: ["installation"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
        templates: [
          { title: "Install springs", estimatedHours: 0.5 },
          { title: "Set tension", estimatedHours: 0.5 },
          { title: "Safety cables", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Opener Install",
        tags: ["electrical"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
        templates: [
          { title: "Mount opener", estimatedHours: 0.5 },
          { title: "Run wiring", estimatedHours: 0.5 },
          { title: "Program remotes", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Testing & Handoff",
        tags: ["testing", "inspection"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 1,
        templates: [
          { title: "Balance test", estimatedHours: 0.25 },
          { title: "Safety reverse check", estimatedHours: 0.25 },
          { title: "Client demo", estimatedHours: 0.25 },
        ],
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
        templates: [
          { title: "Perc test", estimatedHours: 1 },
          { title: "Soil analysis", estimatedHours: 1 },
          { title: "System sizing", estimatedHours: 1 },
        ],
      },
      {
        name: "Design & Permitting",
        tags: ["permitting"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 16,
        templates: [
          { title: "Draft design", estimatedHours: 2 },
          { title: "Submit permit", estimatedHours: 1 },
          { title: "Health dept review", estimatedHours: 1 },
        ],
      },
      {
        name: "Excavation",
        tags: ["demolition"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 8,
        templates: [
          { title: "Dig tank hole", estimatedHours: 2 },
          { title: "Trench drain field", estimatedHours: 2 },
          { title: "Remove spoils", estimatedHours: 2 },
        ],
      },
      {
        name: "Tank Installation",
        tags: ["installation"],
        estimatedHoursMin: 3,
        estimatedHoursMax: 6,
        templates: [
          { title: "Set tank", estimatedHours: 2 },
          { title: "Connect inlet/outlet", estimatedHours: 1 },
          { title: "Backfill around tank", estimatedHours: 1 },
        ],
      },
      {
        name: "Drain Field Build",
        tags: ["installation"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 8,
        templates: [
          { title: "Lay stone", estimatedHours: 2 },
          { title: "Install pipe", estimatedHours: 2 },
          { title: "Cover field", estimatedHours: 2 },
        ],
      },
      {
        name: "Final Inspection",
        tags: ["inspection"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
        templates: [
          { title: "Health dept inspection", estimatedHours: 1 },
          { title: "Flow test", estimatedHours: 0.5 },
          { title: "Documentation", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Backfill & Grading",
        tags: ["finishing"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
        templates: [
          { title: "Backfill trenches", estimatedHours: 1 },
          { title: "Grade surface", estimatedHours: 1 },
          { title: "Seed & straw", estimatedHours: 1 },
        ],
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
        templates: [
          { title: "Map zones", estimatedHours: 0.5 },
          { title: "Measure water pressure", estimatedHours: 0.5 },
          { title: "Identify coverage", estimatedHours: 0.5 },
        ],
      },
      {
        name: "System Design",
        tags: ["assessment"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
        templates: [
          { title: "Design layout", estimatedHours: 1 },
          { title: "Select components", estimatedHours: 0.5 },
          { title: "Calculate flow", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Trenching",
        tags: ["site-prep"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 6,
        templates: [
          { title: "Mark lines", estimatedHours: 0.5 },
          { title: "Trench routes", estimatedHours: 2 },
          { title: "Stage pipe", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Pipe & Valve Install",
        tags: ["installation", "plumbing"],
        estimatedHoursMin: 3,
        estimatedHoursMax: 6,
        templates: [
          { title: "Lay mainline", estimatedHours: 1 },
          { title: "Install valves", estimatedHours: 1 },
          { title: "Connect laterals", estimatedHours: 1 },
        ],
      },
      {
        name: "Head Installation",
        tags: ["installation"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
        templates: [
          { title: "Set heads", estimatedHours: 1 },
          { title: "Adjust coverage", estimatedHours: 0.5 },
          { title: "Install drip zones", estimatedHours: 1 },
        ],
      },
      {
        name: "Controller Setup",
        tags: ["electrical"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
        templates: [
          { title: "Mount controller", estimatedHours: 0.5 },
          { title: "Wire valves", estimatedHours: 0.5 },
          { title: "Program zones", estimatedHours: 0.5 },
        ],
      },
      {
        name: "System Testing",
        tags: ["testing"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
        templates: [
          { title: "Run each zone", estimatedHours: 0.5 },
          { title: "Check coverage", estimatedHours: 0.5 },
          { title: "Adjust heads", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Backfill & Cleanup",
        tags: ["cleanup"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
        templates: [
          { title: "Backfill trenches", estimatedHours: 1 },
          { title: "Repair turf", estimatedHours: 0.5 },
          { title: "Final cleanup", estimatedHours: 0.5 },
        ],
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
        templates: [
          { title: "Soil test", estimatedHours: 1 },
          { title: "Design review", estimatedHours: 1 },
          { title: "Utility locate", estimatedHours: 1 },
        ],
      },
      {
        name: "Excavation",
        tags: ["demolition"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 8,
        templates: [
          { title: "Dig pool", estimatedHours: 4 },
          { title: "Shape walls", estimatedHours: 2 },
          { title: "Haul spoils", estimatedHours: 2 },
        ],
      },
      {
        name: "Steel & Plumbing",
        tags: ["installation", "plumbing"],
        estimatedHoursMin: 6,
        estimatedHoursMax: 12,
        templates: [
          { title: "Set rebar cage", estimatedHours: 3 },
          { title: "Run plumbing", estimatedHours: 3 },
          { title: "Install drains", estimatedHours: 2 },
        ],
      },
      {
        name: "Shell Application",
        tags: ["installation"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 8,
        templates: [
          { title: "Spray gunite", estimatedHours: 3 },
          { title: "Shape shell", estimatedHours: 2 },
          { title: "Initial cure", estimatedHours: 2 },
        ],
      },
      {
        name: "Tile & Coping",
        tags: ["finishing"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 8,
        templates: [
          { title: "Set tile line", estimatedHours: 2 },
          { title: "Install coping", estimatedHours: 2 },
          { title: "Grout & seal", estimatedHours: 2 },
        ],
      },
      {
        name: "Equipment Set",
        tags: ["equipment-set", "electrical"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 6,
        templates: [
          { title: "Install pump", estimatedHours: 1 },
          { title: "Set filter", estimatedHours: 1 },
          { title: "Wire controls", estimatedHours: 2 },
        ],
      },
      {
        name: "Plaster & Fill",
        tags: ["finishing"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 8,
        templates: [
          { title: "Apply plaster", estimatedHours: 3 },
          { title: "Fill pool", estimatedHours: 2 },
          { title: "Chemical balance", estimatedHours: 1 },
        ],
      },
      {
        name: "Final Startup",
        tags: ["commissioning", "inspection"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
        templates: [
          { title: "Run equipment", estimatedHours: 1 },
          { title: "Check systems", estimatedHours: 1 },
          { title: "Client orientation", estimatedHours: 1 },
        ],
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
        templates: [
          { title: "Camera inspection", estimatedHours: 0.5 },
          { title: "Check structure", estimatedHours: 0.5 },
          { title: "Document findings", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Area Protection",
        tags: ["site-prep"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 1,
        templates: [
          { title: "Lay drop cloths", estimatedHours: 0.25 },
          { title: "Seal fireplace", estimatedHours: 0.25 },
          { title: "Cover furniture", estimatedHours: 0.25 },
        ],
      },
      {
        name: "Chimney Sweep",
        tags: ["cleanup"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
        templates: [
          { title: "Brush flue", estimatedHours: 1 },
          { title: "Vacuum debris", estimatedHours: 0.5 },
          { title: "Clean firebox", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Masonry Repair",
        tags: ["repair"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 6,
        templates: [
          { title: "Tuckpoint joints", estimatedHours: 2 },
          { title: "Patch cracks", estimatedHours: 1 },
          { title: "Seal crown", estimatedHours: 1 },
        ],
      },
      {
        name: "Liner Work",
        tags: ["installation"],
        estimatedHoursMin: 3,
        estimatedHoursMax: 6,
        templates: [
          { title: "Remove old liner", estimatedHours: 1 },
          { title: "Install new liner", estimatedHours: 2 },
          { title: "Connect to appliance", estimatedHours: 1 },
        ],
      },
      {
        name: "Cap & Flashing",
        tags: ["installation"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
        templates: [
          { title: "Install cap", estimatedHours: 0.5 },
          { title: "Flash base", estimatedHours: 1 },
          { title: "Seal joints", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Final Inspection",
        tags: ["inspection"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 1,
        templates: [
          { title: "Smoke test", estimatedHours: 0.25 },
          { title: "Check draw", estimatedHours: 0.25 },
          { title: "Client review", estimatedHours: 0.25 },
        ],
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
        templates: [
          { title: "Measure room", estimatedHours: 0.5 },
          { title: "Note obstructions", estimatedHours: 0.5 },
          { title: "Plan layout", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Prep & Demo",
        tags: ["demolition"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 6,
        templates: [
          { title: "Remove old ceiling", estimatedHours: 2 },
          { title: "Clear debris", estimatedHours: 1 },
          { title: "Protect floors", estimatedHours: 1 },
        ],
      },
      {
        name: "Framing / Grid",
        tags: ["framing"],
        estimatedHoursMin: 3,
        estimatedHoursMax: 8,
        templates: [
          { title: "Install main runners", estimatedHours: 3 },
          { title: "Set cross tees", estimatedHours: 2 },
          { title: "Level grid", estimatedHours: 1 },
        ],
      },
      {
        name: "Panel / Board Set",
        tags: ["installation"],
        estimatedHoursMin: 3,
        estimatedHoursMax: 8,
        templates: [
          { title: "Cut panels", estimatedHours: 2 },
          { title: "Set in grid", estimatedHours: 3 },
          { title: "Fit edges", estimatedHours: 1 },
        ],
      },
      {
        name: "Finishing",
        tags: ["finishing"],
        estimatedHoursMin: 3,
        estimatedHoursMax: 8,
        templates: [
          { title: "Install trim", estimatedHours: 3 },
          { title: "Caulk edges", estimatedHours: 2 },
          { title: "Touch-up", estimatedHours: 1 },
        ],
      },
      {
        name: "Fixture Install",
        tags: ["electrical"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
        templates: [
          { title: "Cut openings", estimatedHours: 0.5 },
          { title: "Mount fixtures", estimatedHours: 1 },
          { title: "Wire connections", estimatedHours: 1 },
        ],
      },
      {
        name: "Final Inspection",
        tags: ["inspection"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 1,
        templates: [
          { title: "Check level", estimatedHours: 0.25 },
          { title: "Verify fixtures", estimatedHours: 0.25 },
          { title: "Client walkthrough", estimatedHours: 0.25 },
        ],
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
        templates: [
          { title: "Measure walls", estimatedHours: 1 },
          { title: "Check level & plumb", estimatedHours: 0.5 },
          { title: "Note utilities", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Design & Order",
        tags: ["assessment"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 8,
        templates: [
          { title: "Design layout", estimatedHours: 3 },
          { title: "Confirm selections", estimatedHours: 1 },
          { title: "Place order", estimatedHours: 1 },
        ],
      },
      {
        name: "Site Prep",
        tags: ["demolition", "site-prep"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 6,
        templates: [
          { title: "Remove old cabinets", estimatedHours: 2 },
          { title: "Patch walls", estimatedHours: 1 },
          { title: "Mark layout", estimatedHours: 1 },
        ],
      },
      {
        name: "Base Cabinet Set",
        tags: ["installation"],
        estimatedHoursMin: 3,
        estimatedHoursMax: 6,
        templates: [
          { title: "Level & shim", estimatedHours: 1 },
          { title: "Fasten to wall", estimatedHours: 2 },
          { title: "Join cabinets", estimatedHours: 1 },
        ],
      },
      {
        name: "Upper Cabinet Set",
        tags: ["installation"],
        estimatedHoursMin: 3,
        estimatedHoursMax: 6,
        templates: [
          { title: "Mark height", estimatedHours: 0.5 },
          { title: "Install ledger", estimatedHours: 0.5 },
          { title: "Hang & fasten", estimatedHours: 3 },
        ],
      },
      {
        name: "Trim & Hardware",
        tags: ["finishing"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
        templates: [
          { title: "Install molding", estimatedHours: 1 },
          { title: "Mount pulls", estimatedHours: 1 },
          { title: "Filler strips", estimatedHours: 1 },
        ],
      },
      {
        name: "Door & Drawer Adjust",
        tags: ["finishing"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
        templates: [
          { title: "Adjust hinges", estimatedHours: 0.5 },
          { title: "Align doors", estimatedHours: 0.5 },
          { title: "Level drawers", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Final Punch",
        tags: ["inspection"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 1,
        templates: [
          { title: "Check alignment", estimatedHours: 0.25 },
          { title: "Touch-up", estimatedHours: 0.25 },
          { title: "Client walkthrough", estimatedHours: 0.25 },
        ],
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
        templates: [
          { title: "Measure runs", estimatedHours: 0.5 },
          { title: "Check code requirements", estimatedHours: 0.5 },
          { title: "Note conditions", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Design & Material",
        tags: ["assessment"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 4,
        templates: [
          { title: "Select style", estimatedHours: 1 },
          { title: "Order materials", estimatedHours: 1 },
          { title: "Confirm specs", estimatedHours: 1 },
        ],
      },
      {
        name: "Fabrication",
        tags: ["installation"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 16,
        templates: [
          { title: "Cut components", estimatedHours: 4 },
          { title: "Weld assemblies", estimatedHours: 6 },
          { title: "Grind & prep", estimatedHours: 2 },
        ],
      },
      {
        name: "Surface Prep",
        tags: ["site-prep"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
        templates: [
          { title: "Mark post locations", estimatedHours: 0.5 },
          { title: "Drill anchor holes", estimatedHours: 1 },
          { title: "Clean surfaces", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Post & Rail Set",
        tags: ["installation"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 6,
        templates: [
          { title: "Set posts", estimatedHours: 2 },
          { title: "Install rails", estimatedHours: 2 },
          { title: "Check level", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Baluster / Infill",
        tags: ["installation"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 6,
        templates: [
          { title: "Space balusters", estimatedHours: 1 },
          { title: "Secure to rails", estimatedHours: 2 },
          { title: "Check spacing", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Finishing",
        tags: ["finishing"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 4,
        templates: [
          { title: "Sand surfaces", estimatedHours: 1 },
          { title: "Apply finish", estimatedHours: 1.5 },
          { title: "Touch-up welds", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Final Inspection",
        tags: ["inspection"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 1,
        templates: [
          { title: "Code check", estimatedHours: 0.25 },
          { title: "Strength test", estimatedHours: 0.25 },
          { title: "Client walkthrough", estimatedHours: 0.25 },
        ],
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
        templates: [
          { title: "Mow lawn", estimatedHours: 1 },
          { title: "Edge walks", estimatedHours: 0.25 },
          { title: "Trim obstacles", estimatedHours: 0.25 },
        ],
      },
      {
        name: "Fertilization",
        tags: ["treatment"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 1.5,
        templates: [
          { title: "Soil test review", estimatedHours: 0.25 },
          { title: "Apply fertilizer", estimatedHours: 0.5 },
          { title: "Water in", estimatedHours: 0.25 },
        ],
      },
      {
        name: "Weed Control",
        tags: ["treatment"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 1.5,
        templates: [
          { title: "Spot spray", estimatedHours: 0.5 },
          { title: "Broadcast treatment", estimatedHours: 0.5 },
          { title: "Hand pull beds", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Aeration",
        tags: ["installation"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
        templates: [
          { title: "Core aerate", estimatedHours: 1 },
          { title: "Clean plugs", estimatedHours: 0.5 },
          { title: "Water after", estimatedHours: 0.25 },
        ],
      },
      {
        name: "Dethatching",
        tags: ["cleanup"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
        templates: [
          { title: "Power rake", estimatedHours: 1 },
          { title: "Collect thatch", estimatedHours: 0.5 },
          { title: "Bag & haul", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Overseeding",
        tags: ["installation"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
        templates: [
          { title: "Spread seed", estimatedHours: 0.5 },
          { title: "Rake in", estimatedHours: 0.25 },
          { title: "Apply starter", estimatedHours: 0.25 },
        ],
      },
      {
        name: "Leaf/Debris Cleanup",
        tags: ["cleanup"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
        templates: [
          { title: "Blow leaves", estimatedHours: 1 },
          { title: "Rake beds", estimatedHours: 0.5 },
          { title: "Bag & haul", estimatedHours: 0.5 },
        ],
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
        templates: [
          { title: "Identify pest", estimatedHours: 0.15 },
          { title: "Check entry points", estimatedHours: 0.15 },
          { title: "Document findings", estimatedHours: 0.15 },
        ],
      },
      {
        name: "Exclusion Work",
        tags: ["installation"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 1,
        templates: [
          { title: "Seal gaps", estimatedHours: 0.25 },
          { title: "Install screens", estimatedHours: 0.25 },
          { title: "Block entry", estimatedHours: 0.25 },
        ],
      },
      {
        name: "Bait Placement",
        tags: ["treatment"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 0.5,
        templates: [
          { title: "Set bait stations", estimatedHours: 0.15 },
          { title: "Position traps", estimatedHours: 0.15 },
          { title: "Mark locations", estimatedHours: 0.1 },
        ],
      },
      {
        name: "Chemical Treatment",
        tags: ["treatment"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 1,
        templates: [
          { title: "Mix chemicals", estimatedHours: 0.25 },
          { title: "Apply treatment", estimatedHours: 0.5 },
          { title: "Post warnings", estimatedHours: 0.15 },
        ],
      },
      {
        name: "Monitoring Setup",
        tags: ["monitoring"],
        estimatedHoursMin: 0.25,
        estimatedHoursMax: 0.25,
        templates: [
          { title: "Place monitors", estimatedHours: 0.1 },
          { title: "Record baseline", estimatedHours: 0.1 },
          { title: "Schedule check", estimatedHours: 0.05 },
        ],
      },
      {
        name: "Follow-Up Visit",
        tags: ["follow-up"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 0.5,
        templates: [
          { title: "Check stations", estimatedHours: 0.15 },
          { title: "Assess effectiveness", estimatedHours: 0.15 },
          { title: "Adjust plan", estimatedHours: 0.15 },
        ],
      },
      {
        name: "Final Walkthrough",
        tags: ["inspection"],
        estimatedHoursMin: 0.25,
        estimatedHoursMax: 0.25,
        templates: [
          { title: "Review results", estimatedHours: 0.1 },
          { title: "Client education", estimatedHours: 0.1 },
          { title: "Schedule next", estimatedHours: 0.05 },
        ],
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
        templates: [
          { title: "Check surfaces", estimatedHours: 0.1 },
          { title: "Note stains", estimatedHours: 0.1 },
          { title: "Plan approach", estimatedHours: 0.05 },
        ],
      },
      {
        name: "Area Prep",
        tags: ["site-prep"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 0.5,
        templates: [
          { title: "Cover plants", estimatedHours: 0.15 },
          { title: "Move furniture", estimatedHours: 0.15 },
          { title: "Tape openings", estimatedHours: 0.1 },
        ],
      },
      {
        name: "Detergent Application",
        tags: ["treatment"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 0.5,
        templates: [
          { title: "Mix solution", estimatedHours: 0.1 },
          { title: "Apply detergent", estimatedHours: 0.25 },
          { title: "Dwell time", estimatedHours: 0.15 },
        ],
      },
      {
        name: "Pressure Washing",
        tags: ["installation"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 2,
        templates: [
          { title: "Wash surfaces", estimatedHours: 1 },
          { title: "Adjust pressure", estimatedHours: 0.5 },
          { title: "Work top down", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Rinse & Detail",
        tags: ["finishing"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 0.5,
        templates: [
          { title: "Final rinse", estimatedHours: 0.2 },
          { title: "Detail edges", estimatedHours: 0.15 },
          { title: "Check spots", estimatedHours: 0.1 },
        ],
      },
      {
        name: "Site Restoration",
        tags: ["cleanup"],
        estimatedHoursMin: 0.25,
        estimatedHoursMax: 0.25,
        templates: [
          { title: "Uncover plants", estimatedHours: 0.1 },
          { title: "Replace furniture", estimatedHours: 0.1 },
          { title: "Final walkthrough", estimatedHours: 0.05 },
        ],
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
        templates: [
          { title: "Count windows", estimatedHours: 0.1 },
          { title: "Note access issues", estimatedHours: 0.1 },
          { title: "Plan route", estimatedHours: 0.05 },
        ],
      },
      {
        name: "Safety Setup",
        tags: ["site-prep"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 0.5,
        templates: [
          { title: "Set up ladder", estimatedHours: 0.2 },
          { title: "Lay drop cloths", estimatedHours: 0.15 },
          { title: "Check equipment", estimatedHours: 0.1 },
        ],
      },
      {
        name: "Scrape & Scrub",
        tags: ["installation"],
        estimatedHoursMin: 0.75,
        estimatedHoursMax: 0.75,
        templates: [
          { title: "Scrape paint spots", estimatedHours: 0.25 },
          { title: "Scrub frames", estimatedHours: 0.25 },
          { title: "Remove buildup", estimatedHours: 0.25 },
        ],
      },
      {
        name: "Squeegee Clean",
        tags: ["installation"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 1,
        templates: [
          { title: "Apply solution", estimatedHours: 0.25 },
          { title: "Squeegee glass", estimatedHours: 0.5 },
          { title: "Detail edges", estimatedHours: 0.25 },
        ],
      },
      {
        name: "Screen Cleaning",
        tags: ["cleanup"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 0.5,
        templates: [
          { title: "Remove screens", estimatedHours: 0.15 },
          { title: "Wash & rinse", estimatedHours: 0.2 },
          { title: "Reinstall", estimatedHours: 0.15 },
        ],
      },
      {
        name: "Sill & Track Detail",
        tags: ["finishing"],
        estimatedHoursMin: 0.25,
        estimatedHoursMax: 0.25,
        templates: [
          { title: "Vacuum tracks", estimatedHours: 0.1 },
          { title: "Wipe sills", estimatedHours: 0.1 },
          { title: "Clean hardware", estimatedHours: 0.05 },
        ],
      },
      {
        name: "Final Inspection",
        tags: ["inspection"],
        estimatedHoursMin: 0.25,
        estimatedHoursMax: 0.25,
        templates: [
          { title: "Check streaks", estimatedHours: 0.1 },
          { title: "Touch-up spots", estimatedHours: 0.1 },
          { title: "Client sign-off", estimatedHours: 0.05 },
        ],
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
        templates: [
          { title: "Discuss priorities", estimatedHours: 0.1 },
          { title: "Note special items", estimatedHours: 0.1 },
          { title: "Plan route", estimatedHours: 0.05 },
        ],
      },
      {
        name: "Kitchen Clean",
        tags: ["installation"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 1,
        templates: [
          { title: "Clean counters", estimatedHours: 0.25 },
          { title: "Scrub appliances", estimatedHours: 0.5 },
          { title: "Mop floors", estimatedHours: 0.25 },
        ],
      },
      {
        name: "Bathroom Clean",
        tags: ["installation"],
        estimatedHoursMin: 0.75,
        estimatedHoursMax: 0.75,
        templates: [
          { title: "Scrub shower", estimatedHours: 0.25 },
          { title: "Clean toilet", estimatedHours: 0.25 },
          { title: "Polish fixtures", estimatedHours: 0.25 },
        ],
      },
      {
        name: "Bedroom Clean",
        tags: ["installation"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 0.5,
        templates: [
          { title: "Dust surfaces", estimatedHours: 0.15 },
          { title: "Vacuum floors", estimatedHours: 0.15 },
          { title: "Make beds", estimatedHours: 0.15 },
        ],
      },
      {
        name: "Living Area Clean",
        tags: ["installation"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 0.5,
        templates: [
          { title: "Dust & polish", estimatedHours: 0.15 },
          { title: "Vacuum & mop", estimatedHours: 0.2 },
          { title: "Clean windows", estimatedHours: 0.15 },
        ],
      },
      {
        name: "Detail Work",
        tags: ["finishing"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 0.5,
        templates: [
          { title: "Clean baseboards", estimatedHours: 0.15 },
          { title: "Polish hardware", estimatedHours: 0.15 },
          { title: "Spot clean walls", estimatedHours: 0.15 },
        ],
      },
      {
        name: "Quality Check",
        tags: ["inspection"],
        estimatedHoursMin: 0.25,
        estimatedHoursMax: 0.25,
        templates: [
          { title: "Walk through rooms", estimatedHours: 0.1 },
          { title: "Check missed spots", estimatedHours: 0.1 },
          { title: "Client review", estimatedHours: 0.05 },
        ],
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
        templates: [
          { title: "Check fiber type", estimatedHours: 0.1 },
          { title: "Note stains", estimatedHours: 0.1 },
          { title: "Test colorfastness", estimatedHours: 0.05 },
        ],
      },
      {
        name: "Furniture Moving",
        tags: ["site-prep"],
        estimatedHoursMin: 0.25,
        estimatedHoursMax: 0.25,
        templates: [
          { title: "Move light furniture", estimatedHours: 0.1 },
          { title: "Place protectors", estimatedHours: 0.1 },
          { title: "Clear path", estimatedHours: 0.05 },
        ],
      },
      {
        name: "Pre-Vacuum",
        tags: ["site-prep"],
        estimatedHoursMin: 0.25,
        estimatedHoursMax: 0.25,
        templates: [
          { title: "Vacuum carpet", estimatedHours: 0.1 },
          { title: "Edge corners", estimatedHours: 0.1 },
          { title: "Check for debris", estimatedHours: 0.05 },
        ],
      },
      {
        name: "Pre-Treatment",
        tags: ["treatment"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 0.5,
        templates: [
          { title: "Spray pre-treat", estimatedHours: 0.15 },
          { title: "Spot treat stains", estimatedHours: 0.2 },
          { title: "Dwell time", estimatedHours: 0.15 },
        ],
      },
      {
        name: "Agitation",
        tags: ["treatment"],
        estimatedHoursMin: 0.25,
        estimatedHoursMax: 0.25,
        templates: [
          { title: "Brush carpet", estimatedHours: 0.1 },
          { title: "Work in solution", estimatedHours: 0.1 },
          { title: "Loosen soil", estimatedHours: 0.05 },
        ],
      },
      {
        name: "Hot Water Extraction",
        tags: ["installation"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 1,
        templates: [
          { title: "Extract carpet", estimatedHours: 0.5 },
          { title: "Rinse pass", estimatedHours: 0.3 },
          { title: "Check edges", estimatedHours: 0.2 },
        ],
      },
      {
        name: "Post-Spot Treatment",
        tags: ["treatment"],
        estimatedHoursMin: 0.25,
        estimatedHoursMax: 0.25,
        templates: [
          { title: "Treat remaining spots", estimatedHours: 0.1 },
          { title: "Apply protector", estimatedHours: 0.1 },
          { title: "Groom fibers", estimatedHours: 0.05 },
        ],
      },
      {
        name: "Groom & Dry",
        tags: ["cleanup"],
        estimatedHoursMin: 0.25,
        estimatedHoursMax: 0.25,
        templates: [
          { title: "Rake carpet", estimatedHours: 0.1 },
          { title: "Set fans", estimatedHours: 0.1 },
          { title: "Replace furniture", estimatedHours: 0.05 },
        ],
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
        templates: [
          { title: "Survey items", estimatedHours: 0.1 },
          { title: "Estimate volume", estimatedHours: 0.1 },
          { title: "Quote price", estimatedHours: 0.05 },
        ],
      },
      {
        name: "Item Sorting",
        tags: ["assessment"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 0.5,
        templates: [
          { title: "Sort recyclables", estimatedHours: 0.15 },
          { title: "Identify donations", estimatedHours: 0.15 },
          { title: "Flag hazardous", estimatedHours: 0.1 },
        ],
      },
      {
        name: "Disassembly",
        tags: ["demolition"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 0.5,
        templates: [
          { title: "Break down furniture", estimatedHours: 0.2 },
          { title: "Disconnect appliances", estimatedHours: 0.15 },
          { title: "Remove fixtures", estimatedHours: 0.15 },
        ],
      },
      {
        name: "Loading",
        tags: ["installation"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 1,
        templates: [
          { title: "Load truck", estimatedHours: 0.5 },
          { title: "Protect from damage", estimatedHours: 0.25 },
          { title: "Secure load", estimatedHours: 0.25 },
        ],
      },
      {
        name: "Site Cleanup",
        tags: ["cleanup"],
        estimatedHoursMin: 0.25,
        estimatedHoursMax: 0.25,
        templates: [
          { title: "Sweep area", estimatedHours: 0.1 },
          { title: "Wipe surfaces", estimatedHours: 0.1 },
          { title: "Final check", estimatedHours: 0.05 },
        ],
      },
      {
        name: "Disposal & Recycling",
        tags: ["cleanup"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 1,
        templates: [
          { title: "Drop recyclables", estimatedHours: 0.3 },
          { title: "Donate items", estimatedHours: 0.3 },
          { title: "Dispose remainder", estimatedHours: 0.3 },
        ],
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
        templates: [
          { title: "Inventory items", estimatedHours: 0.2 },
          { title: "Plan loading order", estimatedHours: 0.15 },
          { title: "Note fragiles", estimatedHours: 0.15 },
        ],
      },
      {
        name: "Packing",
        tags: ["installation"],
        estimatedHoursMin: 3,
        estimatedHoursMax: 3,
        templates: [
          { title: "Pack boxes", estimatedHours: 1.5 },
          { title: "Wrap furniture", estimatedHours: 1 },
          { title: "Label rooms", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Loading",
        tags: ["installation"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 2,
        templates: [
          { title: "Load truck", estimatedHours: 1 },
          { title: "Secure items", estimatedHours: 0.5 },
          { title: "Protect walls", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Transportation",
        tags: ["installation"],
        estimatedHoursMin: 1.5,
        estimatedHoursMax: 1.5,
        templates: [
          { title: "Drive route", estimatedHours: 1 },
          { title: "Monitor load", estimatedHours: 0.25 },
          { title: "Update client", estimatedHours: 0.25 },
        ],
      },
      {
        name: "Unloading",
        tags: ["installation"],
        estimatedHoursMin: 1.5,
        estimatedHoursMax: 1.5,
        templates: [
          { title: "Unload truck", estimatedHours: 0.75 },
          { title: "Place in rooms", estimatedHours: 0.5 },
          { title: "Protect floors", estimatedHours: 0.25 },
        ],
      },
      {
        name: "Reassembly & Setup",
        tags: ["finishing"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 1,
        templates: [
          { title: "Assemble furniture", estimatedHours: 0.5 },
          { title: "Connect appliances", estimatedHours: 0.25 },
          { title: "Arrange rooms", estimatedHours: 0.25 },
        ],
      },
      {
        name: "Final Walk-Through",
        tags: ["inspection"],
        estimatedHoursMin: 0.25,
        estimatedHoursMax: 0.25,
        templates: [
          { title: "Check for damage", estimatedHours: 0.1 },
          { title: "Verify placement", estimatedHours: 0.1 },
          { title: "Client sign-off", estimatedHours: 0.05 },
        ],
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
        templates: [
          { title: "Check forecast", estimatedHours: 0.1 },
          { title: "Plan deployment", estimatedHours: 0.1 },
          { title: "Alert crew", estimatedHours: 0.05 },
        ],
      },
      {
        name: "Pre-Treatment",
        tags: ["treatment"],
        estimatedHoursMin: 0.25,
        estimatedHoursMax: 0.25,
        templates: [
          { title: "Apply brine", estimatedHours: 0.1 },
          { title: "Treat walkways", estimatedHours: 0.1 },
          { title: "Hit problem areas", estimatedHours: 0.05 },
        ],
      },
      {
        name: "Plowing",
        tags: ["installation"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 0.5,
        templates: [
          { title: "Plow lots", estimatedHours: 0.2 },
          { title: "Stack snow", estimatedHours: 0.15 },
          { title: "Clear access", estimatedHours: 0.15 },
        ],
      },
      {
        name: "Walkway Clearing",
        tags: ["installation"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 0.5,
        templates: [
          { title: "Shovel walks", estimatedHours: 0.2 },
          { title: "Clear entries", estimatedHours: 0.15 },
          { title: "De-ice steps", estimatedHours: 0.15 },
        ],
      },
      {
        name: "Salt & De-Ice",
        tags: ["treatment"],
        estimatedHoursMin: 0.25,
        estimatedHoursMax: 0.25,
        templates: [
          { title: "Spread salt", estimatedHours: 0.1 },
          { title: "Treat ice patches", estimatedHours: 0.1 },
          { title: "Check drainage", estimatedHours: 0.05 },
        ],
      },
      {
        name: "Return Visit",
        tags: ["follow-up"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 0.5,
        templates: [
          { title: "Re-plow drifts", estimatedHours: 0.2 },
          { title: "Re-treat walks", estimatedHours: 0.15 },
          { title: "Check conditions", estimatedHours: 0.15 },
        ],
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
        templates: [
          { title: "Identify lock type", estimatedHours: 0.1 },
          { title: "Assess security", estimatedHours: 0.1 },
          { title: "Discuss needs", estimatedHours: 0.05 },
        ],
      },
      {
        name: "Lock Rekeying",
        tags: ["installation"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 0.5,
        templates: [
          { title: "Remove cylinder", estimatedHours: 0.15 },
          { title: "Rekey pins", estimatedHours: 0.2 },
          { title: "Test operation", estimatedHours: 0.15 },
        ],
      },
      {
        name: "Lock Replacement",
        tags: ["installation"],
        estimatedHoursMin: 0.75,
        estimatedHoursMax: 0.75,
        templates: [
          { title: "Remove old lock", estimatedHours: 0.2 },
          { title: "Install new", estimatedHours: 0.3 },
          { title: "Test & adjust", estimatedHours: 0.2 },
        ],
      },
      {
        name: "Smart Lock Install",
        tags: ["installation", "electrical"],
        estimatedHoursMin: 1.25,
        estimatedHoursMax: 1.25,
        templates: [
          { title: "Install lock", estimatedHours: 0.5 },
          { title: "Connect app", estimatedHours: 0.4 },
          { title: "Program codes", estimatedHours: 0.35 },
        ],
      },
      {
        name: "Emergency Lockout",
        tags: ["emergency"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 0.5,
        templates: [
          { title: "Pick lock", estimatedHours: 0.2 },
          { title: "Gain entry", estimatedHours: 0.15 },
          { title: "Verify ID", estimatedHours: 0.1 },
        ],
      },
      {
        name: "Security Upgrade",
        tags: ["installation"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 1,
        templates: [
          { title: "Install deadbolt", estimatedHours: 0.4 },
          { title: "Add reinforcement", estimatedHours: 0.3 },
          { title: "Test security", estimatedHours: 0.25 },
        ],
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
        templates: [
          { title: "Walk property", estimatedHours: 0.25 },
          { title: "List repairs", estimatedHours: 0.25 },
          { title: "Prioritize work", estimatedHours: 0.25 },
        ],
      },
      {
        name: "Material Procurement",
        tags: ["site-prep"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 2,
        templates: [
          { title: "List materials", estimatedHours: 0.5 },
          { title: "Purchase supplies", estimatedHours: 1 },
          { title: "Stage at site", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Surface Prep",
        tags: ["site-prep"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 2,
        templates: [
          { title: "Protect areas", estimatedHours: 0.5 },
          { title: "Remove fixtures", estimatedHours: 0.5 },
          { title: "Clean surfaces", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Rough Repair",
        tags: ["repair"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 4,
        templates: [
          { title: "Fix structural", estimatedHours: 1.5 },
          { title: "Repair drywall", estimatedHours: 1 },
          { title: "Patch & fill", estimatedHours: 1 },
        ],
      },
      {
        name: "Installation",
        tags: ["installation"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 6,
        templates: [
          { title: "Install fixtures", estimatedHours: 2 },
          { title: "Mount hardware", estimatedHours: 1.5 },
          { title: "Connect plumbing", estimatedHours: 1.5 },
        ],
      },
      {
        name: "Finishing",
        tags: ["finishing"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
        templates: [
          { title: "Caulk & seal", estimatedHours: 1 },
          { title: "Paint touch-up", estimatedHours: 1 },
          { title: "Clean up", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Cleanup",
        tags: ["cleanup"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 1,
        templates: [
          { title: "Remove debris", estimatedHours: 0.25 },
          { title: "Clean work area", estimatedHours: 0.25 },
          { title: "Pack tools", estimatedHours: 0.25 },
        ],
      },
      {
        name: "Walkthrough",
        tags: ["inspection"],
        estimatedHoursMin: 0.25,
        estimatedHoursMax: 0.5,
        templates: [
          { title: "Review work", estimatedHours: 0.15 },
          { title: "Test function", estimatedHours: 0.15 },
          { title: "Client sign-off", estimatedHours: 0.1 },
        ],
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
        templates: [
          { title: "Document existing", estimatedHours: 3 },
          { title: "Photo survey", estimatedHours: 2 },
          { title: "Identify issues", estimatedHours: 2 },
        ],
      },
      {
        name: "Design & Planning",
        tags: ["assessment", "permitting"],
        estimatedHoursMin: 8,
        estimatedHoursMax: 40,
        templates: [
          { title: "Draw plans", estimatedHours: 16 },
          { title: "Select finishes", estimatedHours: 8 },
          { title: "Budget review", estimatedHours: 4 },
        ],
      },
      {
        name: "Permitting",
        tags: ["permitting"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 8,
        templates: [
          { title: "Submit applications", estimatedHours: 2 },
          { title: "Address comments", estimatedHours: 2 },
          { title: "Obtain permits", estimatedHours: 1 },
        ],
      },
      {
        name: "Demolition",
        tags: ["demolition"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 40,
        templates: [
          { title: "Strip finishes", estimatedHours: 12 },
          { title: "Remove walls", estimatedHours: 12 },
          { title: "Haul debris", estimatedHours: 8 },
        ],
      },
      {
        name: "Rough-In",
        tags: ["rough-in"],
        estimatedHoursMin: 8,
        estimatedHoursMax: 80,
        templates: [
          { title: "Frame walls", estimatedHours: 24 },
          { title: "Run mechanical", estimatedHours: 24 },
          { title: "Install windows", estimatedHours: 16 },
        ],
      },
      {
        name: "Finishing",
        tags: ["finishing"],
        estimatedHoursMin: 8,
        estimatedHoursMax: 60,
        templates: [
          { title: "Drywall & paint", estimatedHours: 16 },
          { title: "Flooring", estimatedHours: 12 },
          { title: "Tile work", estimatedHours: 12 },
          { title: "Trim", estimatedHours: 8 },
        ],
      },
      {
        name: "Final Install",
        tags: ["installation"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 24,
        templates: [
          { title: "Set fixtures", estimatedHours: 8 },
          { title: "Install appliances", estimatedHours: 6 },
          { title: "Mount hardware", estimatedHours: 4 },
        ],
      },
      {
        name: "Punch List",
        tags: ["finishing", "inspection"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 8,
        templates: [
          { title: "Walk list", estimatedHours: 2 },
          { title: "Fix deficiencies", estimatedHours: 3 },
          { title: "Final clean", estimatedHours: 2 },
        ],
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
        templates: [
          { title: "Client interview", estimatedHours: 8 },
          { title: "Site visit", estimatedHours: 8 },
          { title: "Research codes", estimatedHours: 8 },
        ],
      },
      {
        name: "Schematic Design",
        tags: ["assessment"],
        estimatedHoursMin: 20,
        estimatedHoursMax: 80,
        templates: [
          { title: "Concept sketches", estimatedHours: 24 },
          { title: "Floor plans", estimatedHours: 24 },
          { title: "Client review", estimatedHours: 8 },
        ],
      },
      {
        name: "Design Development",
        tags: ["installation"],
        estimatedHoursMin: 40,
        estimatedHoursMax: 120,
        templates: [
          { title: "Detail plans", estimatedHours: 40 },
          { title: "Select materials", estimatedHours: 20 },
          { title: "Coordinate MEP", estimatedHours: 20 },
        ],
      },
      {
        name: "Construction Docs",
        tags: ["documentation"],
        estimatedHoursMin: 60,
        estimatedHoursMax: 200,
        templates: [
          { title: "Draw details", estimatedHours: 60 },
          { title: "Write specs", estimatedHours: 40 },
          { title: "Coordinate sheets", estimatedHours: 30 },
        ],
      },
      {
        name: "Bidding",
        tags: ["coordination"],
        estimatedHoursMin: 8,
        estimatedHoursMax: 24,
        templates: [
          { title: "Issue bid set", estimatedHours: 4 },
          { title: "Answer questions", estimatedHours: 8 },
          { title: "Review bids", estimatedHours: 8 },
        ],
      },
      {
        name: "Permit Review",
        tags: ["permitting"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 16,
        templates: [
          { title: "Submit drawings", estimatedHours: 4 },
          { title: "Address comments", estimatedHours: 6 },
          { title: "Obtain approval", estimatedHours: 2 },
        ],
      },
      {
        name: "Construction Admin",
        tags: ["coordination", "inspection"],
        estimatedHoursMin: 20,
        estimatedHoursMax: 160,
        templates: [
          { title: "Review submittals", estimatedHours: 40 },
          { title: "Site visits", estimatedHours: 40 },
          { title: "Issue RFIs", estimatedHours: 24 },
        ],
      },
      {
        name: "Closeout",
        tags: ["inspection"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 16,
        templates: [
          { title: "Final inspection", estimatedHours: 4 },
          { title: "Compile close-out", estimatedHours: 4 },
          { title: "Certificate of occupancy", estimatedHours: 2 },
        ],
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
        templates: [
          { title: "Stakeholder interviews", estimatedHours: 6 },
          { title: "Current state review", estimatedHours: 4 },
          { title: "Define scope", estimatedHours: 4 },
        ],
      },
      {
        name: "Analysis",
        tags: ["assessment"],
        estimatedHoursMin: 8,
        estimatedHoursMax: 40,
        templates: [
          { title: "Data collection", estimatedHours: 12 },
          { title: "Process mapping", estimatedHours: 12 },
          { title: "Gap analysis", estimatedHours: 8 },
        ],
      },
      {
        name: "Strategy",
        tags: ["assessment"],
        estimatedHoursMin: 8,
        estimatedHoursMax: 24,
        templates: [
          { title: "Develop recommendations", estimatedHours: 8 },
          { title: "Build roadmap", estimatedHours: 6 },
          { title: "Risk assessment", estimatedHours: 4 },
        ],
      },
      {
        name: "Presentation",
        tags: ["documentation"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 12,
        templates: [
          { title: "Build deck", estimatedHours: 4 },
          { title: "Rehearse delivery", estimatedHours: 2 },
          { title: "Present findings", estimatedHours: 2 },
        ],
      },
      {
        name: "Implementation",
        tags: ["installation"],
        estimatedHoursMin: 16,
        estimatedHoursMax: 80,
        templates: [
          { title: "Execute plan", estimatedHours: 32 },
          { title: "Track milestones", estimatedHours: 8 },
          { title: "Manage changes", estimatedHours: 8 },
        ],
      },
      {
        name: "Review",
        tags: ["inspection"],
        estimatedHoursMin: 4,
        estimatedHoursMax: 16,
        templates: [
          { title: "Measure outcomes", estimatedHours: 4 },
          { title: "Compare to goals", estimatedHours: 4 },
          { title: "Document learnings", estimatedHours: 4 },
        ],
      },
      {
        name: "Handoff",
        tags: ["inspection"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 8,
        templates: [
          { title: "Transfer knowledge", estimatedHours: 3 },
          { title: "Train team", estimatedHours: 3 },
          { title: "Final documentation", estimatedHours: 2 },
        ],
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
        templates: [
          { title: "Inspect paint", estimatedHours: 0.15 },
          { title: "Note scratches", estimatedHours: 0.1 },
          { title: "Check interior", estimatedHours: 0.15 },
        ],
      },
      {
        name: "Exterior Wash",
        tags: ["site-prep"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 1,
        templates: [
          { title: "Pre-rinse", estimatedHours: 0.1 },
          { title: "Foam wash", estimatedHours: 0.2 },
          { title: "Hand wash", estimatedHours: 0.2 },
          { title: "Dry", estimatedHours: 0.15 },
        ],
      },
      {
        name: "Decontamination",
        tags: ["treatment"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 1,
        templates: [
          { title: "Clay bar", estimatedHours: 0.3 },
          { title: "Iron remover", estimatedHours: 0.2 },
          { title: "Tar removal", estimatedHours: 0.2 },
        ],
      },
      {
        name: "Paint Correction",
        tags: ["installation"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 8,
        templates: [
          { title: "Compound cut", estimatedHours: 3 },
          { title: "Polish refine", estimatedHours: 2 },
          { title: "Inspect under light", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Protection",
        tags: ["finishing"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
        templates: [
          { title: "Apply ceramic coat", estimatedHours: 1 },
          { title: "Cure coating", estimatedHours: 0.5 },
          { title: "Final buff", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Interior Detail",
        tags: ["installation"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 4,
        templates: [
          { title: "Vacuum & extract", estimatedHours: 1 },
          { title: "Clean leather", estimatedHours: 1 },
          { title: "Dress plastics", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Final Inspection",
        tags: ["inspection"],
        estimatedHoursMin: 0.25,
        estimatedHoursMax: 0.5,
        templates: [
          { title: "Final wipe", estimatedHours: 0.1 },
          { title: "Check under light", estimatedHours: 0.15 },
          { title: "Client walkthrough", estimatedHours: 0.1 },
        ],
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
        templates: [
          { title: "Evaluate tree health", estimatedHours: 0.5 },
          { title: "Check hazards", estimatedHours: 0.5 },
          { title: "Plan approach", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Crew Setup",
        tags: ["site-prep"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 1,
        templates: [
          { title: "Set drop zone", estimatedHours: 0.25 },
          { title: "Position chipper", estimatedHours: 0.25 },
          { title: "Safety briefing", estimatedHours: 0.15 },
        ],
      },
      {
        name: "Pruning/Trimming",
        tags: ["installation"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 6,
        templates: [
          { title: "Climb & position", estimatedHours: 1 },
          { title: "Cut deadwood", estimatedHours: 2 },
          { title: "Shape canopy", estimatedHours: 2 },
        ],
      },
      {
        name: "Tree Removal",
        tags: ["demolition"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 8,
        templates: [
          { title: "Section tree", estimatedHours: 3 },
          { title: "Lower limbs", estimatedHours: 2 },
          { title: "Fell trunk", estimatedHours: 2 },
        ],
      },
      {
        name: "Stump Grinding",
        tags: ["demolition"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 2,
        templates: [
          { title: "Grind stump", estimatedHours: 1 },
          { title: "Clear chips", estimatedHours: 0.25 },
          { title: "Fill hole", estimatedHours: 0.25 },
        ],
      },
      {
        name: "Debris Management",
        tags: ["cleanup"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 4,
        templates: [
          { title: "Chip branches", estimatedHours: 1.5 },
          { title: "Stack logs", estimatedHours: 1 },
          { title: "Load truck", estimatedHours: 1 },
        ],
      },
      {
        name: "Site Restoration",
        tags: ["cleanup"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 2,
        templates: [
          { title: "Rake area", estimatedHours: 0.5 },
          { title: "Fill holes", estimatedHours: 0.5 },
          { title: "Seed & mulch", estimatedHours: 0.5 },
        ],
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
        templates: [
          { title: "Check substrate", estimatedHours: 0.5 },
          { title: "Measure area", estimatedHours: 0.5 },
          { title: "Note conditions", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Substrate Prep",
        tags: ["site-prep"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 8,
        templates: [
          { title: "Replace damaged plywood", estimatedHours: 3 },
          { title: "Install slope", estimatedHours: 2 },
          { title: "Sand surface", estimatedHours: 1 },
        ],
      },
      {
        name: "Surface Prep",
        tags: ["site-prep"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 4,
        templates: [
          { title: "Clean surface", estimatedHours: 1 },
          { title: "Apply primer", estimatedHours: 1 },
          { title: "Mask edges", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Layout & Cutting",
        tags: ["assessment"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 2,
        templates: [
          { title: "Plan seam locations", estimatedHours: 0.5 },
          { title: "Measure & cut sheets", estimatedHours: 0.75 },
          { title: "Dry fit", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Adhesive & Install",
        tags: ["installation"],
        estimatedHoursMin: 2,
        estimatedHoursMax: 6,
        templates: [
          { title: "Apply adhesive", estimatedHours: 2 },
          { title: "Lay vinyl", estimatedHours: 2 },
          { title: "Roll flat", estimatedHours: 1 },
        ],
      },
      {
        name: "Seam Welding",
        tags: ["installation"],
        estimatedHoursMin: 1,
        estimatedHoursMax: 3,
        templates: [
          { title: "Heat weld seams", estimatedHours: 1.5 },
          { title: "Check bond", estimatedHours: 0.5 },
          { title: "Trim excess", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Finishing",
        tags: ["finishing"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 2,
        templates: [
          { title: "Install drip edge", estimatedHours: 0.5 },
          { title: "Caulk perimeter", estimatedHours: 0.5 },
          { title: "Detail corners", estimatedHours: 0.5 },
        ],
      },
      {
        name: "Final Inspection",
        tags: ["inspection"],
        estimatedHoursMin: 0.5,
        estimatedHoursMax: 1,
        templates: [
          { title: "Water test", estimatedHours: 0.25 },
          { title: "Check seams", estimatedHours: 0.25 },
          { title: "Client walkthrough", estimatedHours: 0.25 },
        ],
      },
    ],
  },
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
 * Deduplicates task types by matching primary tag — e.g., "Inspection" in Roofing
 * and "Final Inspection" in Electrical both have the `inspection` tag,
 * so only one is kept (the first one encountered).
 *
 * Auto-assigns colors from the curated palette.
 */
export function mergePresets(industries: string[]): MergedPreset {
  const seen = new Map<string, MergedTaskType>();
  const ordered: MergedTaskType[] = [];

  for (const industry of industries) {
    const preset = INDUSTRY_PRESETS[industry] ?? INDUSTRY_PRESETS["Other"];
    for (const tt of preset.taskTypes) {
      const key = tt.tags[0] ?? tt.name.toLowerCase();
      if (seen.has(key)) {
        seen.get(key)!.sourceIndustries.push(industry);
      } else {
        const merged: MergedTaskType = {
          ...tt,
          color: "",
          sourceIndustries: [industry],
        };
        seen.set(key, merged);
        ordered.push(merged);
      }
    }
  }

  const colored = autoAssignColors(ordered);
  for (let i = 0; i < ordered.length; i++) {
    ordered[i].color = colored[i].color;
  }

  return { taskTypes: ordered };
}
