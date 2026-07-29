import { normalizeAddress } from "@/lib/utils/name-normalization";

export type PropertyAddressKind = "civic" | "rural" | "parcel";

export interface PropertyAddressIdentity {
  kind: PropertyAddressKind;
  base: string;
  unit: string | null;
  normalized: string;
}

const STREET_IDENTITY_TOKENS = new Set([
  "avenue",
  "boulevard",
  "circle",
  "court",
  "crescent",
  "drive",
  "highway",
  "lane",
  "parkway",
  "place",
  "road",
  "square",
  "street",
  "terrace",
  "trail",
  "way",
]);

const LEADING_UNIT_RE =
  /^\s*(?:apartment|suite|unit|ste|apt|#)\s*\.?\s*#?\s*([a-z0-9]+(?:[-/][a-z0-9]+)*)\s*[,;:-]?\s*(.+)$/i;
const LEADING_HYPHENATED_UNIT_RE = /^\s*([a-z0-9]+)\s*-\s*(\d+[a-z]?)\s+(.+)$/i;
const TRAILING_UNIT_RE =
  /(?:^|[,\s]+)(?:apartment|suite|unit|ste|apt|#)\s*\.?\s*#?\s*([a-z0-9]+(?:[-/][a-z0-9]+)*)\b.*$/i;
const PO_BOX_ONLY_RE = /^\s*(?:p\.?\s*o\.?\s+box|post office box)\b/i;
const CIVIC_ADDRESS_RE = /^\d{1,6}[a-z]?\s+(?=\S*[a-z])\S+/i;
const RURAL_ROUTE_RE =
  /^(?:(?:rr|rural route)\s*\d+\b.*\b(?:site|box|lot)\s*[a-z0-9-]+|(?:site|box)\s*[a-z0-9-]+\b.*\b(?:rr|rural route)\s*\d+)\b/i;
const LOT_PROPERTY_RE =
  /^lot\s+[a-z0-9-]+\b.*\b(?:concession|block|plan)\s+[a-z0-9-]+\b/i;
const PARCEL_RE = /^(?:parcel|pid)\s+[a-z0-9][a-z0-9-]{4,}\b/i;

function splitUnit(value: string): { property: string; unit: string | null } {
  const leadingUnit = value.match(LEADING_UNIT_RE);
  if (leadingUnit) {
    return {
      property: leadingUnit[2],
      unit: leadingUnit[1].toLowerCase(),
    };
  }

  const hyphenatedUnit = value.match(LEADING_HYPHENATED_UNIT_RE);
  if (hyphenatedUnit) {
    return {
      property: `${hyphenatedUnit[2]} ${hyphenatedUnit[3]}`,
      unit: hyphenatedUnit[1].toLowerCase(),
    };
  }

  const trailingUnit = value.match(TRAILING_UNIT_RE);
  if (trailingUnit && trailingUnit.index != null) {
    return {
      property: value.slice(0, trailingUnit.index).trim(),
      unit: trailingUnit[1].toLowerCase(),
    };
  }

  return { property: value, unit: null };
}

function civicStreetIdentity(canonical: string): string | null {
  const tokens = canonical.split(" ");
  if (tokens[1] === "highway" && /^[a-z0-9-]+$/i.test(tokens[2] ?? "")) {
    return tokens.slice(0, 3).join(" ");
  }
  if (
    ["range", "township"].includes(tokens[1] ?? "") &&
    tokens[2] === "road" &&
    /^[a-z0-9-]+$/i.test(tokens[3] ?? "")
  ) {
    return tokens.slice(0, 4).join(" ");
  }
  const streetTypeIndex = tokens.findIndex((token, index) => {
    if (!STREET_IDENTITY_TOKENS.has(token)) return false;
    if (
      token === "road" &&
      ["range", "township"].includes(tokens[index - 1] ?? "")
    ) {
      return false;
    }
    return true;
  });
  return streetTypeIndex >= 2
    ? tokens.slice(0, streetTypeIndex + 1).join(" ")
    : null;
}

/**
 * The sole address-identity qualification boundary.
 *
 * Locality and regional values remain valid contextual metadata, but return no
 * identity here. Only a civic/street, explicit rural-property, or explicit
 * parcel form can participate in matching, deduplication, or relationship
 * decisions.
 */
export function parsePropertyAddressIdentity(
  value: string | null | undefined
): PropertyAddressIdentity | null {
  const raw = value?.trim() ?? "";
  if (!raw || PO_BOX_ONLY_RE.test(raw)) return null;

  const { property, unit } = splitUnit(raw);
  const canonical = normalizeAddress(property);
  if (!canonical || canonical.length < 5) return null;

  let kind: PropertyAddressKind;
  let base = canonical;
  if (CIVIC_ADDRESS_RE.test(canonical)) {
    kind = "civic";
    const civicBase = civicStreetIdentity(canonical);
    if (!civicBase) return null;
    base = civicBase;
  } else if (
    RURAL_ROUTE_RE.test(canonical) ||
    LOT_PROPERTY_RE.test(canonical)
  ) {
    kind = "rural";
  } else if (PARCEL_RE.test(canonical)) {
    kind = "parcel";
  } else {
    return null;
  }

  return {
    kind,
    base,
    unit,
    normalized: unit ? `${base} unit ${unit}` : base,
  };
}

export function normalizePropertyAddressIdentity(
  value: string | null | undefined,
  options: { includeUnit?: boolean } = {}
): string | null {
  const identity = parsePropertyAddressIdentity(value);
  if (!identity) return null;
  return options.includeUnit === false ? identity.base : identity.normalized;
}
