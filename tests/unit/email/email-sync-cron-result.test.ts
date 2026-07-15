import { describe, expect, it } from "vitest";

import { buildEmailSyncCronResult } from "@/lib/email/email-sync-cron-result";

describe("buildEmailSyncCronResult", () => {
  const connection = {
    id: "connection-1",
    email: "crew@example.com",
    provider: "gmail",
  };

  it("surfaces fail-closed sync errors returned without a thrown exception", () => {
    expect(
      buildEmailSyncCronResult(connection, {
        activitiesCreated: 0,
        newLeads: 0,
        errors: [
          "Gmail history recovery exceeded 10 pages",
          "Cursor unchanged",
        ],
      })
    ).toEqual({
      connectionId: "connection-1",
      email: "crew@example.com",
      provider: "gmail",
      activitiesCreated: 0,
      newLeads: 0,
      errors: ["Gmail history recovery exceeded 10 pages", "Cursor unchanged"],
    });
  });

  it("omits the errors field for a clean sync", () => {
    expect(
      buildEmailSyncCronResult(connection, {
        activitiesCreated: 3,
        newLeads: 1,
        errors: [],
      })
    ).toEqual({
      connectionId: "connection-1",
      email: "crew@example.com",
      provider: "gmail",
      activitiesCreated: 3,
      newLeads: 1,
    });
  });
});
