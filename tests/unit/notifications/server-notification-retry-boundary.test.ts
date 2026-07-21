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
  it("does not let unrelated notification types opt into data-review durability", async () => {
    const db = { from: vi.fn(), rpc: vi.fn() } as unknown as SupabaseClient;

    await expect(
      createTrustedNotifications(
        {
          companyId: "33333333-3333-4333-8333-333333333333",
          recipientUserIds: ["22222222-2222-4222-8222-222222222222"],
          type: "ai_provider_quota",
          title: "OPENAI CREDITS LOW",
          body: "Add credits.",
          dedupeKey: "platform-provider:openai:quota",
          durableDedupe: true,
        },
        db
      )
    ).rejects.toThrow("Unsupported durable notification identity");
    expect(db.from).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("reconciles a durable notification even after read state removes it from open dedupe", async () => {
    const notificationQueries: Array<Record<string, unknown>> = [];
    const rpc = vi.fn();
    const db = {
      from: (table: string) => {
        if (table === "users") {
          return queryResult({
            data: [{ id: "22222222-2222-4222-8222-222222222222" }],
            error: null,
          });
        }

        const filters: Record<string, unknown> = {};
        const builder: Record<string, unknown> = {};
        builder.select = () => builder;
        builder.eq = (column: string, value: unknown) => {
          filters[column] = value;
          return builder;
        };
        builder.limit = () => builder;
        builder.maybeSingle = async () => {
          notificationQueries.push({ ...filters });
          return {
            data: { id: "11111111-1111-4111-8111-111111111111" },
            error: null,
          };
        };
        return builder;
      },
      rpc,
    } as unknown as SupabaseClient;

    await expect(
      createTrustedNotifications(
        {
          companyId: "33333333-3333-4333-8333-333333333333",
          recipientUserIds: ["22222222-2222-4222-8222-222222222222"],
          type: "data_review_resolved",
          title: "LINK RESOLVED",
          body: "Thread aligned.",
          dedupeKey:
            "data_review_resolution:v1:link:44444444-4444-4444-8444-444444444444:thread:split:55555555-5555-4555-8555-555555555555",
          durableDedupe: true,
        },
        db
      )
    ).resolves.toEqual({
      attempted: 1,
      errors: 0,
      createdRecipientIds: [],
      createdNotifications: [],
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(notificationQueries).toEqual([
      {
        user_id: "22222222-2222-4222-8222-222222222222",
        company_id: "33333333-3333-4333-8333-333333333333",
        type: "data_review_resolved",
        dedupe_key:
          "data_review_resolution:v1:link:44444444-4444-4444-8444-444444444444:thread:split:55555555-5555-4555-8555-555555555555",
      },
    ]);
  });

  it("reconciles a durable notification that wins the insert race and is immediately read", async () => {
    let notificationLookup = 0;
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "notification insert could not be reconciled" },
    });
    const db = {
      from: (table: string) => {
        if (table === "users") {
          return queryResult({
            data: [{ id: "22222222-2222-4222-8222-222222222222" }],
            error: null,
          });
        }

        const builder: Record<string, unknown> = {};
        for (const method of ["select", "eq", "limit"]) {
          builder[method] = () => builder;
        }
        builder.maybeSingle = async () => {
          notificationLookup += 1;
          return {
            data:
              notificationLookup === 1
                ? null
                : { id: "11111111-1111-4111-8111-111111111111" },
            error: null,
          };
        };
        return builder;
      },
      rpc,
    } as unknown as SupabaseClient;

    await expect(
      createTrustedNotifications(
        {
          companyId: "33333333-3333-4333-8333-333333333333",
          recipientUserIds: ["22222222-2222-4222-8222-222222222222"],
          type: "data_review_resolved",
          title: "QUARANTINED",
          body: "Thread quarantined.",
          dedupeKey:
            "data_review_resolution:v1:quarantine:44444444-4444-4444-8444-444444444444:thread:split",
          durableDedupe: true,
        },
        db
      )
    ).resolves.toEqual({
      attempted: 1,
      errors: 0,
      createdRecipientIds: [],
      createdNotifications: [],
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(notificationLookup).toBe(2);
  });

  it("returns the durable identity only when the identity RPC creates the row", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          created: true,
          incident_version: 1,
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
            incident_version: 1,
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
