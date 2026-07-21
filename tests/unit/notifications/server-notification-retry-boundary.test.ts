import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  createTrustedNotifications,
  filterActiveCompanyRecipients,
  resolveNotificationPreferences,
} from "@/lib/notifications/server-notification-service";

function queryResult(result: {
  data: unknown;
  error: { message: string } | null;
}) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "in", "eq"]) {
    builder[method] = () => builder;
  }
  builder.is = async () => result;
  builder.then = (
    resolve: (value: typeof result) => unknown,
    reject: (reason: unknown) => unknown
  ) => Promise.resolve(result).then(resolve, reject);
  return builder;
}

describe("notification retry boundary", () => {
  it("returns the durable identity only when the identity RPC creates the row", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          created: true,
          notification_id: "11111111-1111-4111-8111-111111111111",
        },
      ],
      error: null,
    });
    const db = {
      from: () =>
        queryResult({
          data: [{ id: "22222222-2222-4222-8222-222222222222" }],
          error: null,
        }),
      rpc,
    } as unknown as SupabaseClient;

    await expect(
      createTrustedNotifications(
        {
          companyId: "33333333-3333-4333-8333-333333333333",
          recipientUserIds: ["22222222-2222-4222-8222-222222222222"],
          type: "ai_provider_quota",
          title: "OPENAI CREDITS EXHAUSTED",
          body: "OpenAI calls stopped. Add credits now.",
          persistent: true,
          dedupeKey:
            "platform-provider:openai:insufficient-quota:OPENAI_API_KEY",
        },
        db
      )
    ).resolves.toEqual({
      attempted: 1,
      errors: 0,
      createdRecipientIds: ["22222222-2222-4222-8222-222222222222"],
      createdNotifications: [
        {
          notificationId: "11111111-1111-4111-8111-111111111111",
          recipientUserId: "22222222-2222-4222-8222-222222222222",
        },
      ],
    });
    expect(rpc).toHaveBeenCalledWith(
      "create_notification_if_new_with_identity",
      expect.objectContaining({
        p_company_id: "33333333-3333-4333-8333-333333333333",
        p_user_id: "22222222-2222-4222-8222-222222222222",
      })
    );
  });

  it("does not expose a durable identity when the RPC reports an error", async () => {
    const db = {
      from: () =>
        queryResult({
          data: [{ id: "22222222-2222-4222-8222-222222222222" }],
          error: null,
        }),
      rpc: vi.fn().mockResolvedValue({
        data: [
          {
            created: true,
            notification_id: "11111111-1111-4111-8111-111111111111",
          },
        ],
        error: { message: "write failed" },
      }),
    } as unknown as SupabaseClient;

    await expect(
      createTrustedNotifications(
        {
          companyId: "33333333-3333-4333-8333-333333333333",
          recipientUserIds: ["22222222-2222-4222-8222-222222222222"],
          type: "ai_provider_quota",
          title: "OPENAI CREDITS EXHAUSTED",
          body: "OpenAI calls stopped. Add credits now.",
          persistent: true,
          dedupeKey:
            "platform-provider:openai:insufficient-quota:OPENAI_API_KEY",
        },
        db
      )
    ).resolves.toEqual({
      attempted: 1,
      errors: 1,
      createdRecipientIds: [],
      createdNotifications: [],
    });
  });

  it("throws when active-recipient resolution fails", async () => {
    const db = {
      from: () =>
        queryResult({
          data: null,
          error: { message: "recipient lookup unavailable" },
        }),
    } as unknown as SupabaseClient;

    await expect(
      filterActiveCompanyRecipients({
        companyId: "company-1",
        recipientUserIds: ["user-1"],
        db,
      })
    ).rejects.toThrow(
      "Active notification recipient lookup failed: recipient lookup unavailable"
    );
  });

  it("throws when preference resolution fails after recipient validation", async () => {
    let query = 0;
    const db = {
      from: () => {
        query += 1;
        return queryResult(
          query === 1
            ? { data: [{ id: "user-1" }], error: null }
            : {
                data: null,
                error: { message: "preference lookup unavailable" },
              }
        );
      },
    } as unknown as SupabaseClient;

    await expect(
      resolveNotificationPreferences({
        companyId: "company-1",
        recipientUserIds: ["user-1"],
        preferenceKey: "project_updates",
        db,
      })
    ).rejects.toThrow(
      "Notification preference lookup failed: preference lookup unavailable"
    );
  });

  it("keeps the in-app rail when external notification channels are disabled", async () => {
    let query = 0;
    const db = {
      from: () => {
        query += 1;
        return queryResult(
          query === 1
            ? { data: [{ id: "user-1" }], error: null }
            : {
                data: [
                  {
                    user_id: "user-1",
                    push_enabled: false,
                    email_enabled: false,
                    channel_preferences: {
                      project_updates: { push: false, email: false },
                    },
                  },
                ],
                error: null,
              }
        );
      },
    } as unknown as SupabaseClient;

    await expect(
      resolveNotificationPreferences({
        companyId: "company-1",
        recipientUserIds: ["user-1"],
        preferenceKey: "project_updates",
        db,
      })
    ).resolves.toEqual({
      inAppRecipientIds: ["user-1"],
      pushRecipientIds: [],
      emailRecipientIds: [],
    });
  });
});
