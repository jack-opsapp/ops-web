export interface EstimateDraftValidationLine {
  isTaxable: boolean;
  isOptional: boolean;
  isSelected: boolean;
  missingRequiredOptions: string[];
}

export type EstimateDraftBlocker =
  | "missing_required_options"
  | "missing_default_tax_rate";

export function getEstimateDraftBlocker(
  lines: EstimateDraftValidationLine[],
  defaultTaxRate: { id: string; rate: number } | null,
): EstimateDraftBlocker | null {
  const selected = lines.filter(
    (line) => !line.isOptional || line.isSelected,
  );
  if (selected.some((line) => line.missingRequiredOptions.length > 0)) {
    return "missing_required_options";
  }
  if (selected.some((line) => line.isTaxable) && !defaultTaxRate) {
    return "missing_default_tax_rate";
  }
  return null;
}
