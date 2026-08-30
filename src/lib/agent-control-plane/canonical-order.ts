/**
 * Canonical order for machine-owned agent-control-plane identifiers.
 *
 * JavaScript relational comparison and PostgreSQL `COLLATE "C"` agree for
 * the bounded ASCII identifiers used by OAuth scopes and proof vectors.
 * `localeCompare` is intentionally excluded: punctuation ordering varies by
 * locale and can reverse `catalog.read` and `catalog_costs.read`.
 */
export function compareAgentMachineStrings(
  left: string,
  right: string
): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function canonicalizeAgentMachineStringSet(
  values: readonly string[]
): readonly string[] {
  return Object.freeze([...new Set(values)].sort(compareAgentMachineStrings));
}
