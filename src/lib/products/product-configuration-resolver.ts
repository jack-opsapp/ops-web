export interface ConfigurableProduct {
  id: string;
  name: string;
  basePrice: number;
  minimumCharge: number | null;
  isTaxable: boolean;
  showInStorefront: boolean;
  taskTypeId: string | null;
  unitCost: number | null;
  pricingUnit: string;
}

export interface ProductConfigurationOption {
  id: string;
  name: string;
  kind: string;
  required: boolean;
  defaultValue: string | null;
  sortOrder: number;
}

export interface ProductConfigurationValue {
  id: string;
  optionId: string;
  value: string;
  sortOrder: number;
}

export interface ProductConfigurationModifier {
  optionId: string;
  optionValueId: string;
  kind: string;
  amount: number;
}

export interface ResolveProductConfigurationInput {
  product: ConfigurableProduct;
  options: ProductConfigurationOption[];
  values: ProductConfigurationValue[];
  modifiers: ProductConfigurationModifier[];
  configuredOptions: Record<string, string>;
  quantity: number;
  discountPercent?: number;
}

export interface ResolvedProductConfiguration {
  unitPrice: number;
  extendedBeforeMinimum: number;
  lineTotalBeforeTax: number;
  configuredOptions: Record<string, string>;
  resolvedOptionsLabel: string;
  missingRequiredOptions: string[];
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-CA");
}

function money(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function resolveProductConfiguration(
  input: ResolveProductConfigurationInput,
): ResolvedProductConfiguration {
  const valuesByOption = new Map<string, ProductConfigurationValue[]>();
  for (const value of input.values) {
    const current = valuesByOption.get(value.optionId) ?? [];
    current.push(value);
    valuesByOption.set(value.optionId, current);
  }
  for (const values of valuesByOption.values()) {
    values.sort(
      (a, b) => a.sortOrder - b.sortOrder || a.value.localeCompare(b.value),
    );
  }

  const configuredOptions: Record<string, string> = {};
  const selectedValues = new Map<string, ProductConfigurationValue>();
  const missingRequiredOptions: string[] = [];
  const labels: string[] = [];
  const sortedOptions = [...input.options].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
  );

  for (const option of sortedOptions) {
    const available = valuesByOption.get(option.id) ?? [];
    const requested = input.configuredOptions[option.id] ?? option.defaultValue;
    const selected =
      requested == null
        ? undefined
        : available.find(
            (value) =>
              value.id === requested ||
              normalize(value.value) === normalize(requested),
          );

    if (!selected) {
      if (option.required) missingRequiredOptions.push(option.id);
      continue;
    }

    configuredOptions[option.id] = selected.id;
    selectedValues.set(option.id, selected);
    labels.push(`${option.name}: ${selected.value}`);
  }

  let unitPrice = input.product.basePrice;
  for (const modifier of input.modifiers) {
    const selected = selectedValues.get(modifier.optionId);
    if (!selected || selected.id !== modifier.optionValueId) continue;
    switch (modifier.kind) {
      case "set_price":
        unitPrice = modifier.amount;
        break;
      case "add_flat":
        unitPrice += modifier.amount;
        break;
      case "add_percent":
        unitPrice *= 1 + modifier.amount / 100;
        break;
      case "multiply":
        unitPrice *= modifier.amount;
        break;
      default:
        throw new Error(`Unsupported product pricing modifier: ${modifier.kind}`);
    }
  }
  unitPrice = money(unitPrice);

  const quantity = Math.max(0, input.quantity);
  const discountPercent = Math.min(
    100,
    Math.max(0, input.discountPercent ?? 0),
  );
  const extendedBeforeMinimum = money(
    unitPrice * quantity * (1 - discountPercent / 100),
  );
  const lineTotalBeforeTax = money(
    Math.max(input.product.minimumCharge ?? 0, extendedBeforeMinimum),
  );

  return {
    unitPrice,
    extendedBeforeMinimum,
    lineTotalBeforeTax,
    configuredOptions,
    resolvedOptionsLabel: labels.join(" · "),
    missingRequiredOptions,
  };
}
