const LEAD_SUMMARY_CURSOR_PREFIX = "lead-summary:v1:";
const CURSOR_ID_MAX_LENGTH = 128;

export interface LeadSummaryRefreshCursor {
  companyId: string;
  afterOpportunityId: string | null;
}

function validCursorId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= CURSOR_ID_MAX_LENGTH &&
    value === value.trim()
  );
}

export function decodeLeadSummaryRefreshCursor(
  raw: unknown
): LeadSummaryRefreshCursor | null {
  if (raw === null) return null;
  if (
    typeof raw !== "string" ||
    !raw.startsWith(LEAD_SUMMARY_CURSOR_PREFIX)
  ) {
    throw new Error("lead summary refresh cursor is invalid");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(LEAD_SUMMARY_CURSOR_PREFIX.length));
  } catch (cause) {
    throw new Error("lead summary refresh cursor is invalid", { cause });
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("lead summary refresh cursor is invalid");
  }

  const record = parsed as Record<string, unknown>;
  if (
    !validCursorId(record.companyId) ||
    !(
      record.afterOpportunityId === null ||
      validCursorId(record.afterOpportunityId)
    )
  ) {
    throw new Error("lead summary refresh cursor is invalid");
  }

  return {
    companyId: record.companyId,
    afterOpportunityId: record.afterOpportunityId,
  };
}

export function encodeLeadSummaryRefreshCursor(
  cursor: LeadSummaryRefreshCursor
): string {
  if (
    !validCursorId(cursor.companyId) ||
    !(
      cursor.afterOpportunityId === null ||
      validCursorId(cursor.afterOpportunityId)
    )
  ) {
    throw new Error("lead summary refresh cursor is invalid");
  }

  return `${LEAD_SUMMARY_CURSOR_PREFIX}${JSON.stringify(cursor)}`;
}
