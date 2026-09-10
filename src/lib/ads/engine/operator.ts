import type { EngineOperator } from "./worker";

/**
 * The operator who receives the engine's rail notifications: the PMF operator
 * (design spec §7). Trimmed, because the production values have carried
 * trailing whitespace before and an untrimmed company id fails the
 * notifications canonical-id check silently.
 */
export function getAdsOperator(env: Record<string, string | undefined>): EngineOperator | null {
  const userId = env.PMF_OPERATOR_USER_ID?.trim();
  const companyId = env.PMF_OPERATOR_COMPANY_ID?.trim();
  return userId && companyId ? { userId, companyId } : null;
}
