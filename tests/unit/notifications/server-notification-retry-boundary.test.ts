import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import {
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
