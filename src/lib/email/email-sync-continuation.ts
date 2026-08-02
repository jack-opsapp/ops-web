const EMAIL_SYNC_CONTINUATION_V1_PREFIX = "ops-email-sync:v1:";
const GMAIL_INCREMENTAL_CURSOR_V1_PREFIX = "gmail:v1:";
export const EMAIL_SYNC_CONTINUATION_MAX_PENDING_LEAD_SUMMARIES = 500;
const EMAIL_SYNC_CONTINUATION_MAX_PROVIDER_TOKEN_BYTES = 256 * 1024;
const EMAIL_SYNC_CONTINUATION_MAX_BYTES = 320 * 1024;
const EMAIL_SYNC_CONTINUATION_MAX_OPPORTUNITY_ID_BYTES = 128;

export interface EmailSyncContinuation {
  providerToken: string;
  pendingLeadSummaryOpportunityIds: string[];
}

export class EmailSyncContinuationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(`[email-sync-continuation] ${message}`, options);
    this.name = "EmailSyncContinuationError";
  }
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function normalizedProviderToken(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new EmailSyncContinuationError("providerToken is required");
  }
  if (value !== value.trim()) {
    throw new EmailSyncContinuationError(
      "providerToken must not contain surrounding whitespace"
    );
  }
  if (byteLength(value) > EMAIL_SYNC_CONTINUATION_MAX_PROVIDER_TOKEN_BYTES) {
    throw new EmailSyncContinuationError(
      `providerToken exceeds ${EMAIL_SYNC_CONTINUATION_MAX_PROVIDER_TOKEN_BYTES} bytes`
    );
  }
  return value;
}

function normalizedPendingOpportunityIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new EmailSyncContinuationError(
      "pendingLeadSummaryOpportunityIds must be an array"
    );
  }
  if (value.length > EMAIL_SYNC_CONTINUATION_MAX_PENDING_LEAD_SUMMARIES) {
    throw new EmailSyncContinuationError(
      `pendingLeadSummaryOpportunityIds exceeds ${EMAIL_SYNC_CONTINUATION_MAX_PENDING_LEAD_SUMMARIES}`
    );
  }

  const normalized = value.map((candidate, index) => {
    if (typeof candidate !== "string" || !candidate.trim()) {
      throw new EmailSyncContinuationError(
        `pendingLeadSummaryOpportunityIds[${index}] is invalid`
      );
    }
    if (candidate !== candidate.trim()) {
      throw new EmailSyncContinuationError(
        `pendingLeadSummaryOpportunityIds[${index}] must not contain surrounding whitespace`
      );
    }
    if (
      byteLength(candidate) > EMAIL_SYNC_CONTINUATION_MAX_OPPORTUNITY_ID_BYTES
    ) {
      throw new EmailSyncContinuationError(
        `pendingLeadSummaryOpportunityIds[${index}] exceeds ${EMAIL_SYNC_CONTINUATION_MAX_OPPORTUNITY_ID_BYTES} bytes`
      );
    }
    return candidate;
  });
  if (new Set(normalized).size !== normalized.length) {
    throw new EmailSyncContinuationError(
      "pendingLeadSummaryOpportunityIds contains duplicates"
    );
  }
  return normalized;
}

export function decodeEmailSyncContinuation(
  syncToken: string
): EmailSyncContinuation {
  if (!syncToken.startsWith(EMAIL_SYNC_CONTINUATION_V1_PREFIX)) {
    return {
      providerToken: syncToken,
      pendingLeadSummaryOpportunityIds: [],
    };
  }
  if (byteLength(syncToken) > EMAIL_SYNC_CONTINUATION_MAX_BYTES) {
    throw new EmailSyncContinuationError(
      `encoded continuation exceeds ${EMAIL_SYNC_CONTINUATION_MAX_BYTES} bytes`
    );
  }

  try {
    const parsed = JSON.parse(
      syncToken.slice(EMAIL_SYNC_CONTINUATION_V1_PREFIX.length)
    ) as {
      providerToken?: unknown;
      pendingLeadSummaryOpportunityIds?: unknown;
    };
    return {
      providerToken: normalizedProviderToken(parsed.providerToken),
      pendingLeadSummaryOpportunityIds: normalizedPendingOpportunityIds(
        parsed.pendingLeadSummaryOpportunityIds
      ),
    };
  } catch (error) {
    if (error instanceof EmailSyncContinuationError) throw error;
    throw new EmailSyncContinuationError(
      error instanceof Error
        ? `invalid JSON: ${error.message}`
        : "invalid JSON",
      { cause: error }
    );
  }
}

export function encodeEmailSyncContinuation(input: {
  providerToken: string;
  pendingLeadSummaryOpportunityIds: string[];
}): string {
  const providerToken = normalizedProviderToken(input.providerToken);
  const pendingLeadSummaryOpportunityIds = normalizedPendingOpportunityIds(
    input.pendingLeadSummaryOpportunityIds
  );
  if (pendingLeadSummaryOpportunityIds.length === 0) return providerToken;

  const encoded = `${EMAIL_SYNC_CONTINUATION_V1_PREFIX}${JSON.stringify({
    providerToken,
    pendingLeadSummaryOpportunityIds,
  })}`;
  if (byteLength(encoded) > EMAIL_SYNC_CONTINUATION_MAX_BYTES) {
    throw new EmailSyncContinuationError(
      `encoded continuation exceeds ${EMAIL_SYNC_CONTINUATION_MAX_BYTES} bytes`
    );
  }
  return encoded;
}

/**
 * True while a persisted mailbox cursor still represents bounded work rather
 * than a provider high-water mark. OPS wrappers exist only while derived lead
 * summaries remain, and Gmail emits its structured cursor only while provider
 * pages or discovered messages remain. Other provider tokens are terminal.
 *
 * Malformed OPS wrappers fail closed through decodeEmailSyncContinuation so a
 * scheduler never mistakes an unreadable checkpoint for completion.
 */
export function isEmailSyncContinuationPending(
  syncToken: string | null
): boolean {
  if (!syncToken) return false;
  const continuation = decodeEmailSyncContinuation(syncToken);
  return (
    continuation.pendingLeadSummaryOpportunityIds.length > 0 ||
    continuation.providerToken.startsWith(GMAIL_INCREMENTAL_CURSOR_V1_PREFIX)
  );
}
