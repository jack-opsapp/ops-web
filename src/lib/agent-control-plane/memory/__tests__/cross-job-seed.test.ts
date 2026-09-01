import { describe, expect, it } from "vitest";

import { buildCrossJobSeed } from "../cross-job-seed";

const CURRENT_JOB_ID = "00000000-0000-4000-8000-000000000201";
const CURRENT_CONVERSATION_ID = "00000000-0000-4000-8000-000000000210";
const COMPANY_ID = "00000000-0000-4000-8000-000000000220";
const OTHER_COMPANY_ID = "00000000-0000-4000-8000-000000000221";
const CUSTOMER_ID = "00000000-0000-4000-8000-000000000211";
const OTHER_CUSTOMER_ID = "00000000-0000-4000-8000-000000000212";

describe("minimal cross-job seed", () => {
  it("returns only actor-visible continuity metadata and one controlled marker", () => {
    const seed = buildCrossJobSeed({
      current_job: {
        kind: "project",
        id: CURRENT_JOB_ID,
        company_id: COMPANY_ID,
        conversation_id: CURRENT_CONVERSATION_ID,
        resolved_customer_id: CUSTOMER_ID,
      },
      actor_visible_jobs: [
        {
          job: {
            kind: "project",
            id: CURRENT_JOB_ID,
            company_id: COMPANY_ID,
            conversation_id: CURRENT_CONVERSATION_ID,
            resolved_customer_id: CUSTOMER_ID,
          },
          lifecycle: "active",
          visible_date: "2026-08-10",
          status: "scheduled",
          continuity_evidence: null,
        },
        {
          job: {
            kind: "opportunity",
            id: "00000000-0000-4000-8000-000000000202",
            company_id: COMPANY_ID,
            conversation_id: "00000000-0000-4000-8000-000000000213",
            resolved_customer_id: CUSTOMER_ID,
          },
          lifecycle: "completed",
          visible_date: "2026-01-15",
          status: "completed",
          continuity_evidence: {
            source_type: "job_conversation",
            source_entity_id: "00000000-0000-4000-8000-000000000213",
          },
        },
        {
          job: {
            kind: "project",
            id: "00000000-0000-4000-8000-000000000203",
            company_id: COMPANY_ID,
            conversation_id: "00000000-0000-4000-8000-000000000214",
            resolved_customer_id: CUSTOMER_ID,
          },
          lifecycle: "active",
          visible_date: "2026-07-20",
          status: "in_progress",
          continuity_evidence: {
            source_type: "job_conversation",
            source_entity_id: "00000000-0000-4000-8000-000000000214",
          },
        },
      ],
    });

    expect(seed).toEqual({
      customer_has_prior_ops_jobs: true,
      visible_prior_job_count: 2,
      latest_visible_prior_job: {
        date: "2026-07-20",
        status: "in_progress",
      },
      relationship_continuity: {
        marker: "returning_customer",
        evidence_id: "job_conversation:00000000-0000-4000-8000-000000000214",
      },
    });
  });

  it("cannot serialize prior summaries, correspondence, disputes, pricing, or preferences", () => {
    const secret = "RAW-PRIOR-JOB-CONTENT-MUST-NOT-COPY";

    expect(() =>
      buildCrossJobSeed({
        current_job: {
          kind: "project",
          id: CURRENT_JOB_ID,
          company_id: COMPANY_ID,
          conversation_id: CURRENT_CONVERSATION_ID,
          resolved_customer_id: CUSTOMER_ID,
        },
        actor_visible_jobs: [
          {
            job: {
              kind: "project",
              id: "00000000-0000-4000-8000-000000000204",
              company_id: COMPANY_ID,
              conversation_id: "00000000-0000-4000-8000-000000000215",
              resolved_customer_id: CUSTOMER_ID,
            },
            lifecycle: "completed",
            visible_date: "2025-08-10",
            status: "completed",
            continuity_evidence: null,
            summary: secret,
          },
        ],
      } as never)
    ).toThrow();
  });

  it("excludes visible jobs for another resolved customer", () => {
    expect(
      buildCrossJobSeed({
        current_job: {
          kind: "project",
          id: CURRENT_JOB_ID,
          company_id: COMPANY_ID,
          conversation_id: CURRENT_CONVERSATION_ID,
          resolved_customer_id: CUSTOMER_ID,
        },
        actor_visible_jobs: [
          {
            job: {
              kind: "project",
              id: "00000000-0000-4000-8000-000000000205",
              company_id: COMPANY_ID,
              conversation_id: "00000000-0000-4000-8000-000000000216",
              resolved_customer_id: OTHER_CUSTOMER_ID,
            },
            lifecycle: "completed",
            visible_date: "2026-07-20",
            status: "completed",
            continuity_evidence: {
              source_type: "job_conversation",
              source_entity_id: "00000000-0000-4000-8000-000000000216",
            },
          },
        ],
      })
    ).toEqual({
      customer_has_prior_ops_jobs: false,
      visible_prior_job_count: 0,
      latest_visible_prior_job: null,
      relationship_continuity: null,
    });
  });

  it("does not count the opportunity-to-project conversion as another job", () => {
    expect(
      buildCrossJobSeed({
        current_job: {
          kind: "project",
          id: CURRENT_JOB_ID,
          company_id: COMPANY_ID,
          conversation_id: CURRENT_CONVERSATION_ID,
          resolved_customer_id: CUSTOMER_ID,
        },
        actor_visible_jobs: [
          {
            job: {
              kind: "opportunity",
              id: "00000000-0000-4000-8000-000000000206",
              company_id: COMPANY_ID,
              conversation_id: CURRENT_CONVERSATION_ID,
              resolved_customer_id: CUSTOMER_ID,
            },
            lifecycle: "completed",
            visible_date: "2026-07-20",
            status: "converted",
            continuity_evidence: {
              source_type: "job_conversation",
              source_entity_id: CURRENT_CONVERSATION_ID,
            },
          },
        ],
      })
    ).toMatchObject({
      customer_has_prior_ops_jobs: false,
      visible_prior_job_count: 0,
    });
  });

  it("counts conversion-linked duplicate rows as one canonical prior job", () => {
    const priorConversationId = "00000000-0000-4000-8000-000000000217";

    expect(
      buildCrossJobSeed({
        current_job: {
          kind: "project",
          id: CURRENT_JOB_ID,
          company_id: COMPANY_ID,
          conversation_id: CURRENT_CONVERSATION_ID,
          resolved_customer_id: CUSTOMER_ID,
        },
        actor_visible_jobs: [
          {
            job: {
              kind: "opportunity",
              id: "00000000-0000-4000-8000-000000000207",
              company_id: COMPANY_ID,
              conversation_id: priorConversationId,
              resolved_customer_id: CUSTOMER_ID,
            },
            lifecycle: "completed",
            visible_date: "2026-06-15",
            status: "converted",
            continuity_evidence: {
              source_type: "job_conversation",
              source_entity_id: priorConversationId,
            },
          },
          {
            job: {
              kind: "project",
              id: "00000000-0000-4000-8000-000000000208",
              company_id: COMPANY_ID,
              conversation_id: priorConversationId,
              resolved_customer_id: CUSTOMER_ID,
            },
            lifecycle: "active",
            visible_date: "2026-07-20",
            status: "in_progress",
            continuity_evidence: null,
          },
        ],
      })
    ).toEqual({
      customer_has_prior_ops_jobs: true,
      visible_prior_job_count: 1,
      latest_visible_prior_job: {
        date: "2026-07-20",
        status: "in_progress",
      },
      relationship_continuity: {
        marker: "returning_customer",
        evidence_id: `job_conversation:${priorConversationId}`,
      },
    });
  });

  it("rejects a cross-company row instead of allowing it into the seed", () => {
    expect(() =>
      buildCrossJobSeed({
        current_job: {
          kind: "project",
          id: CURRENT_JOB_ID,
          company_id: COMPANY_ID,
          conversation_id: CURRENT_CONVERSATION_ID,
          resolved_customer_id: CUSTOMER_ID,
        },
        actor_visible_jobs: [
          {
            job: {
              kind: "project",
              id: "00000000-0000-4000-8000-000000000209",
              company_id: OTHER_COMPANY_ID,
              conversation_id: "00000000-0000-4000-8000-000000000218",
              resolved_customer_id: CUSTOMER_ID,
            },
            lifecycle: "completed",
            visible_date: "2026-07-20",
            status: "completed",
            continuity_evidence: null,
          },
        ],
      })
    ).toThrow();
  });

  it("rejects status text that is outside the controlled lifecycle vocabulary", () => {
    const secret = "RAW-STATUS-SECRET-MUST-NOT-COPY";

    expect(() =>
      buildCrossJobSeed({
        current_job: {
          kind: "project",
          id: CURRENT_JOB_ID,
          company_id: COMPANY_ID,
          conversation_id: CURRENT_CONVERSATION_ID,
          resolved_customer_id: CUSTOMER_ID,
        },
        actor_visible_jobs: [
          {
            job: {
              kind: "project",
              id: "00000000-0000-4000-8000-000000000209",
              company_id: COMPANY_ID,
              conversation_id: "00000000-0000-4000-8000-000000000218",
              resolved_customer_id: CUSTOMER_ID,
            },
            lifecycle: "completed",
            visible_date: "2026-07-20",
            status: secret,
            continuity_evidence: null,
          },
        ],
      })
    ).toThrow();
  });

  it("rejects continuity evidence that can carry arbitrary text", () => {
    const secret = "RAW-EVIDENCE-SECRET-MUST-NOT-COPY";

    expect(() =>
      buildCrossJobSeed({
        current_job: {
          kind: "project",
          id: CURRENT_JOB_ID,
          company_id: COMPANY_ID,
          conversation_id: CURRENT_CONVERSATION_ID,
          resolved_customer_id: CUSTOMER_ID,
        },
        actor_visible_jobs: [
          {
            job: {
              kind: "project",
              id: "00000000-0000-4000-8000-000000000209",
              company_id: COMPANY_ID,
              conversation_id: "00000000-0000-4000-8000-000000000218",
              resolved_customer_id: CUSTOMER_ID,
            },
            lifecycle: "completed",
            visible_date: "2026-07-20",
            status: "completed",
            continuity_evidence: {
              source_type: "job_conversation",
              source_entity_id: "00000000-0000-4000-8000-000000000218",
              excerpt: secret,
            },
          },
        ],
      } as never)
    ).toThrow();
  });

  it("rejects continuity evidence for a different logical job", () => {
    expect(() =>
      buildCrossJobSeed({
        current_job: {
          kind: "project",
          id: CURRENT_JOB_ID,
          company_id: COMPANY_ID,
          conversation_id: CURRENT_CONVERSATION_ID,
          resolved_customer_id: CUSTOMER_ID,
        },
        actor_visible_jobs: [
          {
            job: {
              kind: "project",
              id: "00000000-0000-4000-8000-000000000209",
              company_id: COMPANY_ID,
              conversation_id: "00000000-0000-4000-8000-000000000218",
              resolved_customer_id: CUSTOMER_ID,
            },
            lifecycle: "completed",
            visible_date: "2026-07-20",
            status: "completed",
            continuity_evidence: {
              source_type: "job_conversation",
              source_entity_id: "00000000-0000-4000-8000-000000000219",
            },
          },
        ],
      })
    ).toThrow();
  });

  it("returns an explicit empty seed when no other visible job exists", () => {
    expect(
      buildCrossJobSeed({
        current_job: {
          kind: "project",
          id: CURRENT_JOB_ID,
          company_id: COMPANY_ID,
          conversation_id: CURRENT_CONVERSATION_ID,
          resolved_customer_id: CUSTOMER_ID,
        },
        actor_visible_jobs: [],
      })
    ).toEqual({
      customer_has_prior_ops_jobs: false,
      visible_prior_job_count: 0,
      latest_visible_prior_job: null,
      relationship_continuity: null,
    });
  });
});
