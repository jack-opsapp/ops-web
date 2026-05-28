export type ProviderEmailIdFailureReason =
  | "blank_provider_thread_id"
  | "blank_provider_message_id";

export interface ProviderEmailIdValidationInput {
  boundary: string;
  providerThreadId: string | null | undefined;
  providerMessageId?: string | null | undefined;
  requireMessageId: boolean;
}

export type ProviderEmailIdValidationResult =
  | {
      ok: true;
      boundary: string;
      providerThreadId: string;
      providerMessageId: string | null;
      reasons: [];
    }
  | {
      ok: false;
      boundary: string;
      providerThreadId: string | null;
      providerMessageId: string | null;
      reasons: ProviderEmailIdFailureReason[];
    };

export class InvalidProviderEmailIdentifiersError extends Error {
  readonly code = "invalid_provider_email_identifiers" as const;

  constructor(readonly validation: Extract<ProviderEmailIdValidationResult, { ok: false }>) {
    super(
      `Invalid provider email identifiers at ${validation.boundary}: ${validation.reasons.join(", ")}`
    );
    this.name = "InvalidProviderEmailIdentifiersError";
  }
}

export function normalizeProviderEmailId(
  value: string | null | undefined
): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function validateProviderEmailIds(
  input: ProviderEmailIdValidationInput
): ProviderEmailIdValidationResult {
  const providerThreadId = normalizeProviderEmailId(input.providerThreadId);
  const providerMessageId = normalizeProviderEmailId(input.providerMessageId);
  const reasons: ProviderEmailIdFailureReason[] = [];

  if (!providerThreadId) reasons.push("blank_provider_thread_id");
  if (input.requireMessageId && !providerMessageId) {
    reasons.push("blank_provider_message_id");
  }

  if (reasons.length > 0) {
    return {
      ok: false,
      boundary: input.boundary,
      providerThreadId,
      providerMessageId,
      reasons,
    };
  }

  return {
    ok: true,
    boundary: input.boundary,
    providerThreadId: providerThreadId!,
    providerMessageId,
    reasons: [],
  };
}

export function assertValidProviderEmailIds(
  input: ProviderEmailIdValidationInput
): Extract<ProviderEmailIdValidationResult, { ok: true }> {
  const validation = validateProviderEmailIds(input);
  if (!validation.ok) {
    throw new InvalidProviderEmailIdentifiersError(validation);
  }
  return validation;
}

export function logInvalidProviderEmailIds(
  validation: Extract<ProviderEmailIdValidationResult, { ok: false }>,
  metadata: Record<string, unknown> = {}
): void {
  console.warn("[provider-email-ids] rejected email lifecycle write", {
    boundary: validation.boundary,
    reasons: validation.reasons,
    providerThreadId: validation.providerThreadId,
    providerMessageId: validation.providerMessageId,
    ...metadata,
  });
}
