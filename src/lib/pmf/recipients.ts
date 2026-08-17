export interface PmfRecipients {
  sms: string;
  email: string;
  operatorUserId: string;
  operatorCompanyId: string;
}

export interface PmfOperatorIdentity {
  operatorUserId: string;
  operatorCompanyId: string;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizedEnvironmentValue(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

/**
 * Optional operator identity for server alert paths. Deployment secret editors
 * commonly preserve a final newline, so normalization must happen before any
 * value can become a tenant key.
 */
export function getOptionalPmfOperatorIdentity(): PmfOperatorIdentity | null {
  const operatorUserId = getOptionalPmfOperatorUserId();
  const operatorCompanyId = normalizedEnvironmentValue(
    "PMF_OPERATOR_COMPANY_ID"
  );
  if (!operatorUserId || !operatorCompanyId) return null;
  if (!UUID_PATTERN.test(operatorCompanyId)) {
    throw new Error("PMF_OPERATOR_COMPANY_ID must be a UUID");
  }
  return { operatorUserId, operatorCompanyId };
}

/** Validated pause/audit actor identity, independent of rail tenant config. */
export function getOptionalPmfOperatorUserId(): string | null {
  const operatorUserId = normalizedEnvironmentValue("PMF_OPERATOR_USER_ID");
  if (!operatorUserId) return null;
  if (!UUID_PATTERN.test(operatorUserId)) {
    throw new Error("PMF_OPERATOR_USER_ID must be a UUID");
  }
  return operatorUserId;
}

export function getPmfRecipients(): PmfRecipients {
  const sms = normalizedEnvironmentValue("PMF_NOTIFICATION_SMS");
  const email = normalizedEnvironmentValue("PMF_NOTIFICATION_EMAIL");
  const identity = getOptionalPmfOperatorIdentity();
  if (!sms || !email || !identity) {
    throw new Error("PMF recipients env vars missing");
  }
  return { sms, email, ...identity };
}
