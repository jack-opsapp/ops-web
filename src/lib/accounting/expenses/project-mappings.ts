/** Sage Business Cloud Accounting v3.1 transaction dimensions usable on journals. */
export function sageExpenseProjectEligible(
  category: Record<string, unknown>,
  parent: Record<string, unknown>
): boolean {
  const reference = category.analysis_type as { id?: unknown } | null;
  const level = parent.analysis_type_level as { identifier?: unknown } | null;
  return (
    typeof category.id === "string" &&
    Boolean(category.id.trim()) &&
    typeof parent.id === "string" &&
    Boolean(parent.id.trim()) &&
    reference?.id === parent.id &&
    level?.identifier === "TRANSACTION" &&
    Array.isArray(parent.active_areas) &&
    parent.active_areas.includes("JOURNALS")
  );
}
