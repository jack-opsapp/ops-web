export function getEditorialOperator(env: Record<string, string | undefined>) {
  const userId = env.SOCIAL_OPERATOR_USER_ID?.trim();
  const companyId = env.SOCIAL_OPERATOR_COMPANY_ID?.trim();
  if (userId || companyId)
    return userId && companyId ? { userId, companyId } : null;
  const fallbackUserId = env.PMF_OPERATOR_USER_ID?.trim();
  const fallbackCompanyId = env.PMF_OPERATOR_COMPANY_ID?.trim();
  return fallbackUserId && fallbackCompanyId
    ? { userId: fallbackUserId, companyId: fallbackCompanyId }
    : null;
}
