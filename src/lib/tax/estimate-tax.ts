export interface TaxableEstimateLine {
  lineTotalBeforeTax: number;
  isTaxable: boolean;
  isOptional: boolean;
  isSelected: boolean;
}

export interface EstimateDraftTotals {
  subtotal: number;
  taxableSubtotal: number;
  taxAmount: number;
  total: number;
}

export function normalizeStoredTaxRate(rate: number): number {
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
    throw new Error(
      "Tax rates must be stored as a decimal between 0 and 1.",
    );
  }
  return rate;
}

function money(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateEstimateDraftTotals(
  lines: TaxableEstimateLine[],
  taxRate: number,
): EstimateDraftTotals {
  const normalizedRate = normalizeStoredTaxRate(taxRate);
  const selected = lines.filter(
    (line) => !line.isOptional || line.isSelected,
  );
  const subtotal = money(
    selected.reduce((sum, line) => sum + line.lineTotalBeforeTax, 0),
  );
  const taxableSubtotal = money(
    selected
      .filter((line) => line.isTaxable)
      .reduce((sum, line) => sum + line.lineTotalBeforeTax, 0),
  );
  const taxAmount = money(taxableSubtotal * normalizedRate);
  return {
    subtotal,
    taxableSubtotal,
    taxAmount,
    total: money(subtotal + taxAmount),
  };
}
