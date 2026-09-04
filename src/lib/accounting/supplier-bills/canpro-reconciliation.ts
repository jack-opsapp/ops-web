import { proportionalSharedChargeAllocations } from "./intake-contracts";

export interface CanproRateFinding {
  checkKey: "rate_compliance";
  outcome: "pending" | "clear" | "exception";
  observedValue: string;
  policyLimit: string | null;
  rule: "canpro-fin-001" | null;
}

type RateRule = {
  pattern: RegExp;
  units: readonly string[];
  ceiling: string;
};

const RATE_RULES: readonly RateRule[] = [
  {
    pattern: /\bfuzzy\b.*\bvinyl\b|\bvinyl\b.*\bfuzzy\b/i,
    units: ["SQFT", "SF"],
    ceiling: "2.00",
  },
  {
    pattern: /\b(?:slick|smooth)\b.*\bvinyl\b|\bvinyl\b.*\b(?:slick|smooth)\b/i,
    units: ["SQFT", "SF"],
    ceiling: "2.25",
  },
  {
    pattern: /\b(?:diverter|scupper)\b/i,
    units: ["EA", "EACH"],
    ceiling: "25.00",
  },
  { pattern: /\bdrain\b/i, units: ["EA", "EACH"], ceiling: "15.00" },
];

function cents(value: string): bigint {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) {
    throw new Error("Money must be a positive two-decimal string.");
  }
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * BigInt(100) + BigInt((fraction + "00").slice(0, 2));
}

export function evaluateCanproRate(input: {
  documentKind: "material" | "subcontractor" | "employee";
  description: string;
  unitOfMeasure: string;
  unitPrice: string;
}): CanproRateFinding {
  const unit = input.unitOfMeasure.trim().toUpperCase();
  const rule =
    input.documentKind === "subcontractor"
      ? RATE_RULES.find(
          (candidate) =>
            candidate.pattern.test(input.description) &&
            candidate.units.includes(unit)
        )
      : undefined;
  const observedValue = `CAD ${input.unitPrice} / ${unit}`;
  if (!rule) {
    return {
      checkKey: "rate_compliance",
      outcome: "pending",
      observedValue,
      policyLimit: null,
      rule: null,
    };
  }
  return {
    checkKey: "rate_compliance",
    outcome:
      cents(input.unitPrice) <= cents(rule.ceiling) ? "clear" : "exception",
    observedValue,
    policyLimit: `CAD ${rule.ceiling} / ${unit}`,
    rule: "canpro-fin-001",
  };
}

export function evaluateQuantityVariance(
  orderedQuantity: string | null,
  invoicedQuantity: string
) {
  if (orderedQuantity === null) {
    return {
      checkKey: "quantity_scope" as const,
      outcome: "pending" as const,
      orderedQuantity,
      invoicedQuantity,
      variance: null,
    };
  }
  const ordered = Number(orderedQuantity);
  const invoiced = Number(invoicedQuantity);
  if (!Number.isFinite(ordered) || !Number.isFinite(invoiced)) {
    throw new Error("Quantities must be numeric.");
  }
  const decimals = Math.max(
    2,
    orderedQuantity.split(".")[1]?.length ?? 0,
    invoicedQuantity.split(".")[1]?.length ?? 0
  );
  const variance = Math.abs(invoiced - ordered).toFixed(decimals);
  return {
    checkKey: "quantity_scope" as const,
    outcome: ordered === invoiced ? ("clear" as const) : ("exception" as const),
    orderedQuantity,
    invoicedQuantity,
    variance,
  };
}

export function findDuplicateCandidates(
  current: {
    normalizedSupplierName: string;
    normalizedInvoiceNumber: string;
    sourceSha256: string;
  },
  candidates: readonly {
    id: string;
    normalizedSupplierName: string;
    normalizedInvoiceNumber: string;
    sourceSha256: string;
  }[]
) {
  const matches: Array<{
    id: string;
    reason: "source_document" | "supplier_invoice";
  }> = [];
  for (const candidate of candidates) {
    if (candidate.sourceSha256 === current.sourceSha256) {
      matches.push({ id: candidate.id, reason: "source_document" });
      continue;
    }
    if (
      candidate.normalizedSupplierName === current.normalizedSupplierName &&
      candidate.normalizedInvoiceNumber === current.normalizedInvoiceNumber
    ) {
      matches.push({ id: candidate.id, reason: "supplier_invoice" });
    }
  }
  return matches;
}

export function isSharedSupplierCharge(description: string): boolean {
  return /\b(?:freight|shipping|adhesive|glue|hazmat|fuel\s+surcharge)\b/i.test(
    description
  );
}

export function suggestSharedChargeAllocations(
  sharedLineTotal: string,
  materialWeights: readonly { projectId: string; materialSubtotal: string }[]
) {
  return proportionalSharedChargeAllocations(sharedLineTotal, materialWeights);
}
