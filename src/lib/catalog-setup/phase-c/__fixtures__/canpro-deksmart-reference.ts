export const DEKSMART_ULTRA_COLORS = [
  "Cobblestone",
  "Pebblestone",
  "Antique Beige",
  "Dove Grey",
  "Venetian Taupe",
  "Sahara Beige",
  "Slate Grey",
  "River Rock",
  "Sienna",
  "Carrera",
  "Mojave",
  "Malibu",
  "Royal Oak",
  "Silver Maple",
  "Hansberry",
  "Heritage",
  "Driftwood",
  "Boardwalk",
  "Shorewood",
] as const;

export const DEKSMART_SMOOTHBACK_COLORS = [
  "Antique Beige",
  "Dove Grey",
] as const;

export interface DeksmartCost {
  standard: number;
  condo: number | null;
  currency: "CAD";
}

export interface DeksmartMaterialReference {
  key: string;
  name: string;
  supplierSku: string | null;
  purchaseUnit: "sqft" | "pail" | "length";
  cost: DeksmartCost;
  package: {
    quantity: number;
    unit: "sqft" | "L" | "ft";
  };
  coverageSqft?: number;
  color?: "Grey";
}

export const DEKSMART_MEMBRANES = {
  ultra68: {
    key: "deksmart-ultra-68",
    name: "DekSmart Ultra 68mil membrane",
    supplierSku: null,
    thicknessMil: 68,
    backing: "Fuzzyback",
    rollWidthInches: 72,
    rollLengthFeet: 75,
    rollCoverageSqft: 450,
    colors: DEKSMART_ULTRA_COLORS,
    cost: { standard: 2.82, condo: 2.62, currency: "CAD" },
  },
  smoothback60: {
    key: "deksmart-smoothback-60",
    name: "DekSmart Smoothback 60mil membrane",
    supplierSku: null,
    thicknessMil: 60,
    backing: "Slickback",
    rollWidthInches: 72,
    rollLengthFeet: 75,
    rollCoverageSqft: 450,
    colors: DEKSMART_SMOOTHBACK_COLORS,
    cost: { standard: 3.18, condo: 2.98, currency: "CAD" },
  },
} as const;

export const DEKSMART_SYSTEM_MATERIALS = {
  summerContact: {
    key: "vg2510",
    name: "DekSmart 2510 Contact",
    supplierSku: "VG2510",
    purchaseUnit: "pail",
    cost: { standard: 219, condo: 204, currency: "CAD" },
    package: { quantity: 19, unit: "L" },
    coverageSqft: 400,
  },
  winterContact: {
    key: "vg15023",
    name: "Silaprene Winter Contact",
    supplierSku: "VG15023",
    purchaseUnit: "pail",
    cost: { standard: 228, condo: 213, currency: "CAD" },
    package: { quantity: 19, unit: "L" },
    coverageSqft: 400,
  },
  latex: {
    key: "vg4500",
    name: "DekSmart 4500 Latex",
    supplierSku: "VG4500",
    purchaseUnit: "pail",
    cost: { standard: 193, condo: 178, currency: "CAD" },
    package: { quantity: 19, unit: "L" },
    coverageSqft: 450,
  },
  galvanizedDrip: {
    key: "vdf15",
    name: "30ga galvanized drip flashing",
    supplierSku: "VDF15",
    purchaseUnit: "length",
    cost: { standard: 0.96, condo: null, currency: "CAD" },
    package: { quantity: 8, unit: "ft" },
  },
  pvcDripGrey: {
    key: "vdfg",
    name: "Grey PVC-coated drip flashing",
    supplierSku: "VDFG",
    purchaseUnit: "length",
    cost: { standard: 3.44, condo: 3.14, currency: "CAD" },
    package: { quantity: 8, unit: "ft" },
    color: "Grey",
  },
  angle: {
    key: "vdf05",
    name: '30ga galvanized angle flashing, 1½" x 2½", no kick',
    supplierSku: "VDF05",
    purchaseUnit: "length",
    cost: { standard: 0.88, condo: null, currency: "CAD" },
    package: { quantity: 8, unit: "ft" },
  },
  vinylClipGrey: {
    key: "vinyl-clip-grey",
    name: "Grey Vinyl Clip",
    supplierSku: null,
    purchaseUnit: "length",
    cost: { standard: 0.39, condo: null, currency: "CAD" },
    package: { quantity: 10, unit: "ft" },
    color: "Grey",
  },
} as const satisfies Record<string, DeksmartMaterialReference>;
