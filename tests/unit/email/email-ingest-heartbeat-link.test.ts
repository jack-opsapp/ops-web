import { describe, expect, it } from "vitest";
import { buildReconnectDeepLink } from "@/app/api/cron/email-ingest-heartbeat/route";

describe("email ingest heartbeat reconnect link", () => {
  it("binds the alert URL to the failed connection and expected mailbox", () => {
    const result = buildReconnectDeepLink({
      appUrl: "https://ops.test",
      provider: "gmail",
      companyId: "company-1",
      userId: "user-1",
      type: "company",
      connectionId: "connection-1",
      expectedEmail: "crew@example.com",
    });

    const url = new URL(result);
    expect(url.pathname).toBe("/reconnect-inbox");
    expect(Object.fromEntries(url.searchParams.entries())).toEqual({
      companyId: "company-1",
      userId: "user-1",
      type: "company",
      provider: "gmail",
      connectionId: "connection-1",
      expectedEmail: "crew@example.com",
    });
  });
});
