import { afterEach, describe, expect, it } from "vitest";
import { OpportunityService } from "@/lib/api/services/opportunity-service";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { ActivityType } from "@/lib/types/pipeline";

interface SupabaseDoubleState {
  insertedActivities: Array<Record<string, unknown>>;
}

function makeSupabaseDouble(state: SupabaseDoubleState) {
  class Query {
    private payload: Record<string, unknown> | null = null;

    constructor(private readonly table: string) {}

    insert(payload: Record<string, unknown>) {
      this.payload = payload;
      if (this.table === "activities") state.insertedActivities.push(payload);
      return this;
    }

    select() {
      return this;
    }

    async single() {
      if (this.table === "activities") {
        return {
          data: {
            id: `activity-${state.insertedActivities.length}`,
            created_at: "2026-05-26T12:00:00.000Z",
            ...this.payload,
          },
          error: null,
        };
      }

      return { data: null, error: null };
    }
  }

  return {
    from(table: string) {
      return new Query(table);
    },
  };
}

describe("OpportunityService.createActivity provider id exceptions", () => {
  afterEach(() => {
    setSupabaseOverride(null);
  });

  it("keeps manual activity writes independent from provider email ids", async () => {
    const state: SupabaseDoubleState = { insertedActivities: [] };
    setSupabaseOverride(makeSupabaseDouble(state) as never);

    await OpportunityService.createActivity({
      companyId: "company-1",
      opportunityId: "opp-1",
      clientId: "client-1",
      estimateId: null,
      invoiceId: null,
      projectId: null,
      siteVisitId: null,
      type: ActivityType.Note,
      subject: "Manual site note",
      content: "Gate code confirmed by customer.",
      outcome: null,
      direction: null,
      durationMinutes: null,
      emailThreadId: null,
      emailMessageId: null,
      isRead: true,
      fromEmail: null,
      createdBy: "user-1",
    });

    expect(state.insertedActivities).toHaveLength(1);
    expect(state.insertedActivities[0]).toMatchObject({
      type: "note",
      email_thread_id: null,
      email_message_id: null,
    });
  });

  it("rejects email activities without exact mailbox, message, and thread identity", async () => {
    const state: SupabaseDoubleState = { insertedActivities: [] };
    setSupabaseOverride(makeSupabaseDouble(state) as never);

    await expect(
      OpportunityService.createActivity({
        companyId: "company-1",
        opportunityId: "opp-1",
        clientId: "client-1",
        estimateId: null,
        invoiceId: null,
        projectId: null,
        siteVisitId: null,
        type: ActivityType.Email,
        subject: "Imported from email pipeline",
        content: "Pipeline import: Kara Beach — stage: new_lead",
        outcome: null,
        direction: "inbound",
        durationMinutes: null,
        emailThreadId: "thread-import-1",
        emailMessageId: null,
        isRead: true,
        fromEmail: "kara.beach@example.com",
        createdBy: null,
      })
    ).rejects.toThrow("exact mailbox, provider message, and provider thread");

    expect(state.insertedActivities).toHaveLength(0);
  });
});
