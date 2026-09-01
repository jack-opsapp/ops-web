const sourceVersion = {
  source_domain: "pipeline",
  source_type: "opportunity",
  source_id: "opportunity:lead/2026-08-07:001",
  version: "updated_at:2026-08-07T19:58:30.000Z",
} as const;

const evidenceRef = {
  evidence_id: "evidence:gmail/message<18f-example>",
  source_domain: "correspondence",
  source_type: "email_message",
  source_id: "gmail/message<18f-example>",
  version: "sha256:d7f6317f9f34",
  occurred_at: "2026-08-07T19:58:12.456Z",
  relationship: "supports",
  excerpt: "Please schedule the work for Tuesday morning.",
  locator: "ops://evidence/evidence:gmail%2Fmessage%3C18f-example%3E",
  trust: "delivered_correspondence",
} as const;

export const v1SuccessResultFixture = Object.freeze({
  contract_version: "2026-08-07.v1",
  request_id: "request:phase-c/2026-08-07/001",
  generated_at: "2026-08-07T20:00:00.000Z",
  company_id: "company:canpro/primary",
  actor: {
    user_id: "operator:jackson@example.test",
    permission_snapshot_revision: "permissions:2026-08-07/42",
  },
  freshness: {
    read_at: "2026-08-07T19:59:59.500Z",
    source_versions: [sourceVersion],
    stale_after: null,
    memory_version: 7,
    turn_high_watermark_id: "turn:gmail/message<18f-example>",
  },
  data: {
    conversation_id: "conversation:job/2026-08-07/001",
    job_refs: [
      {
        kind: "opportunity",
        id: "opportunity:lead/2026-08-07:001",
      },
      {
        kind: "project",
        id: "project:converted/2026-08-07:001",
      },
    ],
    schedule: {
      utc: "2026-08-11T15:30:00.000Z",
      local: "2026-08-11T08:30:00",
      timezone: "America/Vancouver",
    },
    budget: {
      amount_minor: 125050,
      currency: "CAD",
    },
  },
  evidence: [evidenceRef],
  warnings: [
    {
      code: "PARTICIPANT_UNRESOLVED",
      message: "One copied recipient has not been linked to an OPS contact.",
    },
  ],
});

export const v1CursorPageFixture = Object.freeze({
  next_cursor: "cursor:scheduled_at=2026-08-11T15:30:00Z&id=job/001",
  has_more: true,
});

export const v1EvidenceResultFixture = Object.freeze({
  contract_version: "2026-08-07.v1",
  request_id: "request:evidence/2026-08-07/001",
  generated_at: "2026-08-07T20:00:01.000Z",
  company_id: "company:canpro/primary",
  actor: {
    user_id: "operator:jackson@example.test",
    permission_snapshot_revision: "permissions:2026-08-07/42",
  },
  freshness: {
    read_at: "2026-08-07T20:00:00.750Z",
    source_versions: [
      {
        source_domain: evidenceRef.source_domain,
        source_type: evidenceRef.source_type,
        source_id: evidenceRef.source_id,
        version: evidenceRef.version,
      },
    ],
    stale_after: "2026-08-07T20:05:00.750Z",
  },
  data: evidenceRef,
  evidence: [evidenceRef],
  warnings: [],
});

export const v1ErrorResultFixture = Object.freeze({
  contract_version: "2026-08-07.v1",
  request_id: "request:phase-c/2026-08-07/002",
  code: "STALE_CONTEXT",
  message: "Conversation memory is not current through the triggering turn.",
  retryable: true,
  details: {
    current_source_versions: [sourceVersion],
    current_memory_version: 7,
    current_turn_high_watermark_id: "turn:gmail/message<18e-previous>",
  },
});
