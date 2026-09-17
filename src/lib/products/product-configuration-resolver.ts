/**
 * One configured option on a signed line snapshot (`line_items.configured_options`).
 * select → the chosen `product_option_values.id`; integer → a JSON number;
 * boolean → a JSON boolean. Matches the iOS writer and the demand resolver.
 */
export type ConfiguredOptionValue = string | number | boolean;

export type ConfiguredOptions = Record<string, ConfiguredOptionValue>;

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
  /**
   * Requested values keyed by option id. Accepts a stored snapshot as-is, so
   * legacy string forms ("3", "true") resolve to their typed values.
   */
  configuredOptions: Readonly<Record<string, unknown>>;
  quantity: number;
  discountPercent?: number;
}

export interface ResolvedProductConfiguration {
  unitPrice: number;
  extendedBeforeMinimum: number;
  lineTotalBeforeTax: number;
  configuredOptions: ConfiguredOptions;
  resolvedOptionsLabel: string;
  missingRequiredOptions: string[];
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-CA");
}

const INTEGER_TEXT = /^\s*-?\d+\s*$/;
const BOOLEAN_TEXT = /^\s*(true|false)\s*$/i;

/** A whole count from a JSON number or an integer string; anything else is unset. */
export function parseIntegerOptionValue(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) ? value : null;
  }
  if (typeof value === "string" && INTEGER_TEXT.test(value)) {
    const count = Number(value.trim());
    return Number.isSafeInteger(count) ? count : null;
  }
  return null;
}

/** A flag from a JSON boolean or "true" / "false" (any case); anything else is unset. */
export function parseBooleanOptionValue(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const match = BOOLEAN_TEXT.exec(value);
    if (match) return match[1].toLowerCase() === "true";
  }
  return null;
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

  const configuredOptions: ConfiguredOptions = {};
  const selectedValues = new Map<string, ProductConfigurationValue>();
  const missingRequiredOptions: string[] = [];
  const labels: string[] = [];
  const sortedOptions = [...input.options].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
  );

  for (const option of sortedOptions) {
    // An explicit value always wins, and an explicit invalid value never falls
    // back to anything. A select or boolean with nothing on the line takes the
    // catalog default. An integer count never does: a count is the job's
    // geometry (end posts, corners), the recipe books material per unit of it,
    // and acceptance refuses a blank one — so a blank count stays blank and
    // the estimator is asked for it, whatever default the catalog carries.
    const explicit = Object.prototype.hasOwnProperty.call(
      input.configuredOptions,
      option.id,
    )
      ? input.configuredOptions[option.id]
      : undefined;
    const requested: unknown =
      option.kind === "integer" ? explicit : (explicit ?? option.defaultValue);

    switch (option.kind) {
      case "select": {
        const available = valuesByOption.get(option.id) ?? [];
        const selected =
          typeof requested === "string"
            ? available.find(
                (value) =>
                  value.id === requested ||
                  normalize(value.value) === normalize(requested),
              )
            : undefined;
        if (!selected) break;
        configuredOptions[option.id] = selected.id;
        selectedValues.set(option.id, selected);
        labels.push(`${option.name}: ${selected.value}`);
        continue;
      }
      case "integer": {
        const count = parseIntegerOptionValue(requested);
        if (count === null) break;
        configuredOptions[option.id] = count;
        labels.push(`${option.name}: ${count}`);
        continue;
      }
      case "boolean": {
        const flag = parseBooleanOptionValue(requested);
        if (flag === null) break;
        configuredOptions[option.id] = flag;
        labels.push(`${option.name}: ${flag ? "Yes" : "No"}`);
        continue;
      }
    }

    if (option.required) missingRequiredOptions.push(option.id);
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
