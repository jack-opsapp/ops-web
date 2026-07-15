import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  featureEnabledMock,
  getSubscriptionInfoMock,
  recordDraftOutcomeMock,
  requireSupabaseMock,
} = vi.hoisted(() => ({
  featureEnabledMock: vi.fn(),
  getSubscriptionInfoMock: vi.fn(),
  recordDraftOutcomeMock: vi.fn(),
  requireSupabaseMock: vi.fn(),
}));

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: requireSupabaseMock,
}));

vi.mock("@/lib/api/services/admin-feature-override-service", () => ({
  AdminFeatureOverrideService: {
    isAIFeatureEnabled: featureEnabledMock,
  },
}));

vi.mock("@/lib/api/services/ai-draft-service", () => ({
  AIDraftService: {
    generateDraft: vi.fn(),
    recordDraftOutcome: recordDraftOutcomeMock,
  },
}));

vi.mock("@/lib/subscription", () => ({
  getSubscriptionInfo: getSubscriptionInfoMock,
}));

vi.mock("@/lib/utils/app-url", () => ({
  getAppUrl: () => "https://ops.test",
}));

import { AutoSendService } from "@/lib/api/services/auto-send-service";

type Row = Record<string, unknown>;

function makeSupabase() {
  const updates: Array<{ table: string; values: Row }> = [];
  const pending = {
    id: "pending-1",
    company_id: "company-1",
    connection_id: "connection-1",
    opportunity_id: "opportunity-1",
    thread_id: "thread-1",
    in_reply_to: "message-1",
    to_emails: ["customer@example.com"],
    cc_emails: [],
    subject: "Estimate",
    draft_text: "Here is your estimate.",
    draft_history_id: "draft-history-1",
    scheduled_send_at: "2026-07-14T18:00:00.000Z",
    status: "pending",
    created_at: "2026-07-14T17:00:00.000Z",
    sent_at: null,
    cancelled_at: null,
    error: null,
    retry_count: 0,
  };

  function from(table: string) {
    let action: "select" | "update" = "select";
    let selected = "";
    let updateValues: Row = {};

    const resolve = () => {
      if (action === "update") {
        return { data: null, error: null };
      }

      if (table === "pending_auto_sends") {
        return { data: [pending], error: null };
      }

      if (table === "companies") {
        return {
          data: {
            subscription_plan: "business",
            subscription_status: "active",
            trial_end_date: null,
            seated_employee_ids: [],
            admin_ids: [],
            max_seats: 10,
          },
          error: null,
        };
      }

      if (table === "email_connections" && selected === "user_id") {
        return { data: { user_id: "user-1" }, error: null };
      }

      if (table === "email_connections") {
        return {
          data: {
            auto_send_settings: {
              enabled: true,
              business_hours_start: "08:00",
              business_hours_end: "18:00",
              timezone: "America/Vancouver",
              delay_min_minutes: 30,
              delay_max_minutes: 60,
            },
          },
          error: null,
        };
      }

      return { data: null, error: null };
    };

    const query = {
      select(columns: string) {
        selected = columns;
        return query;
      },
      update(values: Row) {
        action = "update";
        updateValues = values;
        updates.push({ table, values });
        return query;
      },
      eq() {
        return query;
      },
      lte() {
        return query;
      },
      order() {
        return query;
      },
      async limit() {
        return resolve();
      },
      async single() {
        return resolve();
      },
      then<TResult1 = unknown, TResult2 = never>(
        onfulfilled?:
          | ((value: unknown) => TResult1 | PromiseLike<TResult1>)
          | null,
        onrejected?:
          | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
          | null
      ) {
        void updateValues;
        return Promise.resolve(resolve()).then(onfulfilled, onrejected);
      },
    };

    return query;
  }

  return { client: { from }, updates };
}

describe("AutoSendService draft-outcome ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    featureEnabledMock.mockResolvedValue(true);
    getSubscriptionInfoMock.mockReturnValue({ isActive: true });
    recordDraftOutcomeMock.mockResolvedValue(undefined);
  });

  it("delegates the draft outcome to the send route and never records it a second time", async () => {
    const supabase = makeSupabase();
    requireSupabaseMock.mockReturnValue(supabase.client);
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => ({
        ok: true,
        json: async () => ({}),
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await AutoSendService.processPendingSends();

    expect(result).toEqual({ sent: 1, failed: 0, errors: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const request = fetchMock.mock.calls[0]?.[1];
    if (!request) throw new Error("Expected auto-send request options");
    const payload = JSON.parse(request.body as string) as Row;
    expect(payload).toMatchObject({
      draftHistoryId: "draft-history-1",
      body: "Here is your estimate.",
      threadId: "thread-1",
    });
    expect(recordDraftOutcomeMock).not.toHaveBeenCalled();
    expect(supabase.updates).toContainEqual({
      table: "pending_auto_sends",
      values: expect.objectContaining({ status: "sent" }),
    });
  });
});
