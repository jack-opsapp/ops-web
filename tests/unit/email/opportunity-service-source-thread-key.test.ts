import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireSupabaseMock } = vi.hoisted(() => ({
  requireSupabaseMock: vi.fn(),
}));

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: requireSupabaseMock,
  parseDate: (value: unknown) => (value ? new Date(String(value)) : null),
  parseDateRequired: (value: unknown) => new Date(String(value)),
}));

import { OpportunityService } from "@/lib/api/services/opportunity-service";
import {
  ActivityType,
  OpportunitySource,
  OpportunityStage,
  type CreateOpportunity,
} from "@/lib/types/pipeline";

function createPayload(
  overrides: Partial<CreateOpportunity> = {}
): CreateOpportunity {
  return {
    companyId: "company-1",
    clientId: "client-1",
    title: "Sandra Dunford — Estimate",
    description: null,
    contactName: "Sandra Dunford",
    contactEmail: "sandra@example.com",
    contactPhone: null,
    stage: OpportunityStage.NewLead,
    source: OpportunitySource.Email,
    priority: null,
    estimatedValue: null,
    actualValue: null,
    winProbability: 20,
    expectedCloseDate: null,
    actualCloseDate: null,
    projectId: null,
    lostReason: null,
    lostNotes: null,
    quoteDeliveryMethod: null,
    address: null,
    latitude: null,
    longitude: null,
    tags: ["email-import", "pipeline-wizard"],
    ...overrides,
  };
}

function makeCreateSupabase(result: {
  data: Record<string, unknown> | null;
  error: { code?: string; message: string } | null;
}) {
  const insertedRows: Array<Record<string, unknown>> = [];
  const query = {
    insert(row: Record<string, unknown>) {
      insertedRows.push(row);
      return query;
    },
    select() {
      return query;
    },
    async single() {
      return result;
    },
  };
  return {
    insertedRows,
    client: {
      from: vi.fn(() => query),
    },
  };
}

describe("OpportunityService source-thread-key creation", () => {
  beforeEach(() => {
    requireSupabaseMock.mockReset();
  });

  it("writes the logical source key in the initial opportunity insert", async () => {
    const fake = makeCreateSupabase({
      data: {
        id: "opp-1",
        company_id: "company-1",
        client_id: "client-1",
        title: "Sandra Dunford — Estimate",
        stage: "new_lead",
        source: "email",
        source_thread_key: "contact-form-message:msg-1",
        stage_entered_at: "2026-07-13T00:00:00.000Z",
        created_at: "2026-07-13T00:00:00.000Z",
        updated_at: "2026-07-13T00:00:00.000Z",
      },
      error: null,
    });
    requireSupabaseMock.mockReturnValue(fake.client);

    await OpportunityService.createOpportunity(
      createPayload({
        sourceThreadKey: "contact-form-message:msg-1",
      })
    );

    expect(fake.insertedRows).toEqual([
      expect.objectContaining({
        company_id: "company-1",
        source_thread_key: "contact-form-message:msg-1",
      }),
    ]);
  });

  it("preserves PostgreSQL 23505 so the importer can recover the exact winner", async () => {
    const fake = makeCreateSupabase({
      data: null,
      error: {
        code: "23505",
        message:
          "duplicate key value violates unique constraint opportunities_company_source_thread_key_key",
      },
    });
    requireSupabaseMock.mockReturnValue(fake.client);

    await expect(
      OpportunityService.createOpportunity(
        createPayload({ sourceThreadKey: "contact-form-message:msg-1" })
      )
    ).rejects.toMatchObject({
      code: "23505",
    });
  });

  it("persists the mailbox connection on a synthetic email activity", async () => {
    const fake = makeCreateSupabase({
      data: {
        id: "activity-1",
        company_id: "company-1",
        opportunity_id: "opp-1",
        client_id: "client-1",
        estimate_id: null,
        invoice_id: null,
        project_id: null,
        site_visit_id: null,
        type: "email",
        subject: "Imported correspondence",
        content: null,
        outcome: null,
        direction: "inbound",
        duration_minutes: null,
        attachments: [],
        email_connection_id: "connection-1",
        email_thread_id: "thread-1",
        email_message_id: "import:email:gmail:connection-1:thread:thread-1:0",
        is_read: true,
        from_email: "customer@example.com",
        to_emails: ["operator@example.com"],
        created_by: null,
        created_at: "2026-07-13T00:00:00.000Z",
      },
      error: null,
    });
    requireSupabaseMock.mockReturnValue(fake.client);

    await OpportunityService.createActivity({
      companyId: "company-1",
      opportunityId: "opp-1",
      clientId: "client-1",
      estimateId: null,
      invoiceId: null,
      type: ActivityType.Email,
      subject: "Imported correspondence",
      content: null,
      outcome: null,
      direction: "inbound",
      durationMinutes: null,
      emailConnectionId: "connection-1",
      emailThreadId: "thread-1",
      emailMessageId: "import:email:gmail:connection-1:thread:thread-1:0",
      isRead: true,
      fromEmail: "customer@example.com",
      toEmails: ["operator@example.com"],
      occurredAt: new Date("2026-07-13T00:00:00.000Z"),
      createdBy: null,
    });

    expect(fake.insertedRows).toEqual([
      expect.objectContaining({
        company_id: "company-1",
        email_connection_id: "connection-1",
        email_thread_id: "thread-1",
        created_at: "2026-07-13T00:00:00.000Z",
      }),
    ]);
  });
});
