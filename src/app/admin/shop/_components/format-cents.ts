/** Format cents as dollar string: 1299 → "$12.99" */
export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Format cents as raw decimal string for input values: 1299 → "12.99" */
export function centsToDecimal(cents: number): string {
  return (cents / 100).toFixed(2);
}
