/**
 * Build the authenticated inbox reconnect confirmation link used by provider
 * health notifications.
 */
export function buildReconnectDeepLink(opts: {
  appUrl: string;
  provider: "gmail" | "microsoft365";
  companyId: string;
  userId: string;
  type: "company" | "individual";
  connectionId: string;
  expectedEmail: string;
}): string {
  const params = new URLSearchParams({
    companyId: opts.companyId,
    userId: opts.userId,
    type: opts.type,
    provider: opts.provider,
    connectionId: opts.connectionId,
    expectedEmail: opts.expectedEmail,
  });
  return `${opts.appUrl}/reconnect-inbox?${params.toString()}`;
}
