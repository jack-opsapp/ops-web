import { describe, expect, it } from "vitest";

import {
  parseP2LegacyCorrespondenceAttention,
  parseP2LegacyLeadAttention,
  parseP2LegacyScheduleAttention,
  P2LegacyAttentionProjectionError,
} from "../legacy-attention-projections";
import {
  P2_LEGACY_ATTENTION_PROJECTIONS,
  P2_LEGACY_ATTENTION_PROJECTION_NAMES,
} from "../private-projection-contracts";

const OPERATIONAL_FENCE = {
  source_domain: "operations",
  source_type: "operational_read_revision",
  source_id: "private.agent_operational_read_revisions",
  version: "revision:8",
} as const;
const HISTORY_FENCE = {
  source_domain: "operations",
  source_type: "job_history_read_revision",
  source_id: "private.agent_job_history_revisions",
  version: "revision:9",
} as const;
const READ_AT = "2026-08-23T07:00:00.000Z";
const EARLIER_ATTENTION_AT = "2026-08-23T06:00:00.000Z";

function attentionEnvelope(
  projectionRevision: string,
  sourceVersions: readonly unknown[],
  cards: readonly unknown[]
) {
  return {
    projection_revision: projectionRevision,
    read_at: READ_AT,
    source_versions: sourceVersions,
    source_inspected_count: cards.length,
    returned_count: cards.length,
    has_more: false,
    cards,
  };
}

function leadCard(jobId: string, attentionAt: string) {
  return {
    card_kind: "lead",
    job_ref: { kind: "opportunity", id: jobId },
    title: "Hunter deck",
    reason_code: "follow_up_due",
    attention_at: attentionAt,
  };
}

function correspondenceCard(threadRef: string, attentionAt: string) {
  return {
    card_kind: "correspondence",
    thread_ref: threadRef,
    job_ref: {
      kind: "opportunity",
      id: "11111111-1111-4111-8111-111111111111",
    },
    subject: "Deck dimensions",
    latest_snippet: "Can you confirm the back railing?",
    reason_code: "unresolved_commitment",
    attention_at: attentionAt,
    unread_count: 1,
  };
}

function scheduleCard(taskRef: string, attentionAt: string) {
  return {
    card_kind: "schedule",
    task_ref: taskRef,
    job_ref: {
      kind: "project",
      id: "44444444-4444-4444-8444-444444444444",
    },
    title: "Install railing",
    reason_code: "confirmation_required",
    attention_at: attentionAt,
    ends_at: null,
    confirmation_state: "unconfirmed",
  };
}

describe("private P2 legacy attention contracts", () => {
  it("freezes exact helper names, signatures, bounds, revisions, and outer-RPC-only ACL posture", () => {
    expect(P2_LEGACY_ATTENTION_PROJECTION_NAMES).toEqual([
      "private.agent_p2_legacy_correspondence_attention_v1",
      "private.agent_p2_legacy_lead_attention_v1",
      "private.agent_p2_legacy_schedule_attention_v1",
    ]);
    for (const projection of Object.values(P2_LEGACY_ATTENTION_PROJECTIONS)) {
      expect(projection).toMatchObject({
        maximumCards: 25,
        fetchLimit: 26,
        sourceInspectionLimit: 501,
        executableRoles: ["postgres"],
        caller: "service_role_outer_rpc_only",
      });
      expect(projection.signature).toMatch(/^private\.[a-z0-9_]+\(.+\)$/);
      expect(Object.isFrozen(projection)).toBe(true);
    }
    expect(P2_LEGACY_ATTENTION_PROJECTIONS.lead.revisionFamilies).toEqual([
      "legacy_operational",
    ]);
    expect(
      P2_LEGACY_ATTENTION_PROJECTIONS.correspondence.revisionFamilies
    ).toEqual(["legacy_job_history", "legacy_operational"]);
    expect(P2_LEGACY_ATTENTION_PROJECTIONS.schedule.revisionFamilies).toEqual([
      "legacy_operational",
    ]);
  });

  it("strict-parses and freezes bounded lead, correspondence, and schedule cards", () => {
    const lead = parseP2LegacyLeadAttention({
      projection_revision: "agent-p2-legacy-lead-attention:v1",
      read_at: READ_AT,
      source_versions: [OPERATIONAL_FENCE],
      source_inspected_count: 1,
      returned_count: 1,
      has_more: false,
      cards: [
        {
          card_kind: "lead",
          job_ref: {
            kind: "opportunity",
            id: "11111111-1111-4111-8111-111111111111",
          },
          title: "Hunter deck",
          reason_code: "follow_up_due",
          attention_at: READ_AT,
        },
      ],
    });
    const correspondence = parseP2LegacyCorrespondenceAttention({
      projection_revision: "agent-p2-legacy-correspondence-attention:v1",
      read_at: READ_AT,
      source_versions: [HISTORY_FENCE, OPERATIONAL_FENCE],
      source_inspected_count: 1,
      returned_count: 1,
      has_more: false,
      cards: [
        {
          card_kind: "correspondence",
          thread_ref: "22222222-2222-4222-8222-222222222222",
          job_ref: {
            kind: "opportunity",
            id: "11111111-1111-4111-8111-111111111111",
          },
          subject: "Deck dimensions",
          latest_snippet: "Can you confirm the back railing?",
          reason_code: "unresolved_commitment",
          attention_at: READ_AT,
          unread_count: 1,
        },
      ],
    });
    const schedule = parseP2LegacyScheduleAttention({
      projection_revision: "agent-p2-legacy-schedule-attention:v1",
      read_at: READ_AT,
      source_versions: [OPERATIONAL_FENCE],
      source_inspected_count: 1,
      returned_count: 1,
      has_more: false,
      cards: [
        {
          card_kind: "schedule",
          task_ref: "33333333-3333-4333-8333-333333333333",
          job_ref: {
            kind: "project",
            id: "44444444-4444-4444-8444-444444444444",
          },
          title: "Install railing",
          reason_code: "confirmation_required",
          attention_at: READ_AT,
          ends_at: null,
          confirmation_state: "unconfirmed",
        },
      ],
    });

    expect(lead.source_revisions).toEqual([
      { domain: "legacy_operational", source_revision: 8 },
    ]);
    expect(correspondence.source_revisions).toEqual([
      { domain: "legacy_job_history", source_revision: 9 },
      { domain: "legacy_operational", source_revision: 8 },
    ]);
    expect(schedule.cards[0]?.task_ref).toBe(
      "33333333-3333-4333-8333-333333333333"
    );
    expect(Object.isFrozen(correspondence.cards[0])).toBe(true);
  });

  it("rejects count drift, excess cards, unexpected revision families, and unsafe private fields", () => {
    const base = {
      projection_revision: "agent-p2-legacy-lead-attention:v1",
      read_at: READ_AT,
      source_versions: [OPERATIONAL_FENCE],
      source_inspected_count: 1,
      returned_count: 0,
      has_more: false,
      cards: [
        {
          card_kind: "lead",
          job_ref: {
            kind: "opportunity",
            id: "11111111-1111-4111-8111-111111111111",
          },
          title: "Hunter deck",
          reason_code: "follow_up_due",
          attention_at: READ_AT,
        },
      ],
    };
    expect(() => parseP2LegacyLeadAttention(base)).toThrow(
      P2LegacyAttentionProjectionError
    );
    expect(() =>
      parseP2LegacyLeadAttention({
        ...base,
        returned_count: 1,
        source_versions: [HISTORY_FENCE],
      })
    ).toThrow(P2LegacyAttentionProjectionError);
    expect(() =>
      parseP2LegacyLeadAttention({
        ...base,
        returned_count: 1,
        cards: [{ ...base.cards[0], provider_id: "gmail-secret" }],
      })
    ).toThrow(P2LegacyAttentionProjectionError);
    expect(() =>
      parseP2LegacyLeadAttention({
        ...base,
        source_inspected_count: 2,
        returned_count: 1,
        has_more: false,
      })
    ).toThrow(P2LegacyAttentionProjectionError);
    expect(() =>
      parseP2LegacyLeadAttention({
        ...base,
        returned_count: 1,
        source_versions: [OPERATIONAL_FENCE, OPERATIONAL_FENCE],
      })
    ).toThrow(P2LegacyAttentionProjectionError);
    expect(() =>
      parseP2LegacyLeadAttention({
        ...base,
        returned_count: 26,
        source_inspected_count: 26,
        has_more: true,
        cards: Array.from({ length: 26 }, (_, index) => ({
          ...base.cards[0],
          job_ref: {
            kind: "opportunity",
            id: `${String(index).padStart(8, "0")}-1111-4111-8111-111111111111`,
          },
        })),
      })
    ).toThrow(P2LegacyAttentionProjectionError);
  });

  it("requires the SQL-emitted nullable schedule ends_at key", () => {
    expect(() =>
      parseP2LegacyScheduleAttention(
        attentionEnvelope(
          "agent-p2-legacy-schedule-attention:v1",
          [OPERATIONAL_FENCE],
          [
            {
              card_kind: "schedule",
              task_ref: "33333333-3333-4333-8333-333333333333",
              job_ref: {
                kind: "project",
                id: "44444444-4444-4444-8444-444444444444",
              },
              title: "Install railing",
              reason_code: "confirmation_required",
              attention_at: READ_AT,
              confirmation_state: "unconfirmed",
            },
          ]
        )
      )
    ).toThrow(P2LegacyAttentionProjectionError);
  });

  it("rejects duplicate primary refs in every legacy attention family", () => {
    const leadRef = "11111111-1111-4111-8111-111111111111";
    expect(() =>
      parseP2LegacyLeadAttention(
        attentionEnvelope(
          "agent-p2-legacy-lead-attention:v1",
          [OPERATIONAL_FENCE],
          [leadCard(leadRef, EARLIER_ATTENTION_AT), leadCard(leadRef, READ_AT)]
        )
      )
    ).toThrow(P2LegacyAttentionProjectionError);

    const threadRef = "22222222-2222-4222-8222-222222222222";
    expect(() =>
      parseP2LegacyCorrespondenceAttention(
        attentionEnvelope(
          "agent-p2-legacy-correspondence-attention:v1",
          [HISTORY_FENCE, OPERATIONAL_FENCE],
          [
            correspondenceCard(threadRef, EARLIER_ATTENTION_AT),
            correspondenceCard(threadRef, READ_AT),
          ]
        )
      )
    ).toThrow(P2LegacyAttentionProjectionError);

    const taskRef = "33333333-3333-4333-8333-333333333333";
    expect(() =>
      parseP2LegacyScheduleAttention(
        attentionEnvelope(
          "agent-p2-legacy-schedule-attention:v1",
          [OPERATIONAL_FENCE],
          [
            scheduleCard(taskRef, EARLIER_ATTENTION_AT),
            scheduleCard(taskRef, READ_AT),
          ]
        )
      )
    ).toThrow(P2LegacyAttentionProjectionError);
  });

  it("rejects noncanonical attention timestamp order in every legacy attention family", () => {
    expect(() =>
      parseP2LegacyLeadAttention(
        attentionEnvelope(
          "agent-p2-legacy-lead-attention:v1",
          [OPERATIONAL_FENCE],
          [
            leadCard("11111111-1111-4111-8111-111111111111", READ_AT),
            leadCard(
              "55555555-5555-4555-8555-555555555555",
              EARLIER_ATTENTION_AT
            ),
          ]
        )
      )
    ).toThrow(P2LegacyAttentionProjectionError);
    expect(() =>
      parseP2LegacyCorrespondenceAttention(
        attentionEnvelope(
          "agent-p2-legacy-correspondence-attention:v1",
          [HISTORY_FENCE, OPERATIONAL_FENCE],
          [
            correspondenceCard("22222222-2222-4222-8222-222222222222", READ_AT),
            correspondenceCard(
              "66666666-6666-4666-8666-666666666666",
              EARLIER_ATTENTION_AT
            ),
          ]
        )
      )
    ).toThrow(P2LegacyAttentionProjectionError);
    expect(() =>
      parseP2LegacyScheduleAttention(
        attentionEnvelope(
          "agent-p2-legacy-schedule-attention:v1",
          [OPERATIONAL_FENCE],
          [
            scheduleCard("33333333-3333-4333-8333-333333333333", READ_AT),
            scheduleCard(
              "77777777-7777-4777-8777-777777777777",
              EARLIER_ATTENTION_AT
            ),
          ]
        )
      )
    ).toThrow(P2LegacyAttentionProjectionError);
  });

  it("rejects noncanonical primary-ref order when attention timestamps tie", () => {
    expect(() =>
      parseP2LegacyLeadAttention(
        attentionEnvelope(
          "agent-p2-legacy-lead-attention:v1",
          [OPERATIONAL_FENCE],
          [
            leadCard("55555555-5555-4555-8555-555555555555", READ_AT),
            leadCard("11111111-1111-4111-8111-111111111111", READ_AT),
          ]
        )
      )
    ).toThrow(P2LegacyAttentionProjectionError);
    expect(() =>
      parseP2LegacyCorrespondenceAttention(
        attentionEnvelope(
          "agent-p2-legacy-correspondence-attention:v1",
          [HISTORY_FENCE, OPERATIONAL_FENCE],
          [
            correspondenceCard("66666666-6666-4666-8666-666666666666", READ_AT),
            correspondenceCard("22222222-2222-4222-8222-222222222222", READ_AT),
          ]
        )
      )
    ).toThrow(P2LegacyAttentionProjectionError);
    expect(() =>
      parseP2LegacyScheduleAttention(
        attentionEnvelope(
          "agent-p2-legacy-schedule-attention:v1",
          [OPERATIONAL_FENCE],
          [
            scheduleCard("77777777-7777-4777-8777-777777777777", READ_AT),
            scheduleCard("33333333-3333-4333-8333-333333333333", READ_AT),
          ]
        )
      )
    ).toThrow(P2LegacyAttentionProjectionError);
  });

  it("accepts the SQL canonical timestamp and primary-ref ordering", () => {
    const lead = parseP2LegacyLeadAttention(
      attentionEnvelope(
        "agent-p2-legacy-lead-attention:v1",
        [OPERATIONAL_FENCE],
        [
          leadCard(
            "11111111-1111-4111-8111-111111111111",
            EARLIER_ATTENTION_AT
          ),
          leadCard("55555555-5555-4555-8555-555555555555", READ_AT),
        ]
      )
    );
    const correspondence = parseP2LegacyCorrespondenceAttention(
      attentionEnvelope(
        "agent-p2-legacy-correspondence-attention:v1",
        [HISTORY_FENCE, OPERATIONAL_FENCE],
        [
          correspondenceCard("22222222-2222-4222-8222-222222222222", READ_AT),
          correspondenceCard("66666666-6666-4666-8666-666666666666", READ_AT),
        ]
      )
    );
    const schedule = parseP2LegacyScheduleAttention(
      attentionEnvelope(
        "agent-p2-legacy-schedule-attention:v1",
        [OPERATIONAL_FENCE],
        [
          scheduleCard(
            "33333333-3333-4333-8333-333333333333",
            EARLIER_ATTENTION_AT
          ),
          scheduleCard("77777777-7777-4777-8777-777777777777", READ_AT),
        ]
      )
    );

    expect(lead.returned_count).toBe(2);
    expect(correspondence.returned_count).toBe(2);
    expect(schedule.returned_count).toBe(2);
  });
});
