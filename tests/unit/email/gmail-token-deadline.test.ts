import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getServiceRoleClientMock } = vi.hoisted(() => ({
  getServiceRoleClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: getServiceRoleClientMock,
}));

import { getValidGmailToken } from "@/lib/api/services/gmail-token";

const expiredConnection = {
  id: "connection-1",
  company_id: "company-1",
  access_token: "expired-token",
  refresh_token: "refresh-token",
  expires_at: "2026-07-21T07:00:00.000Z",
};

describe("Gmail token read deadline", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-21T08:00:00.000Z"));
    getServiceRoleClientMock.mockReturnValue({});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("bounds both OAuth response headers and the response body without retrying", async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull: () => new Promise<void>(() => undefined),
          }),
          { status: 200 }
        )
    );
    vi.stubGlobal("fetch", fetchMock);

    const tokenPromise = getValidGmailToken(expiredConnection, {
      deadlineAt: Date.now() + 20,
      context: "Gmail scan job",
    });
    const rejection = expect(tokenPromise).rejects.toThrow(
      "read deadline exceeded"
    );

    await vi.advanceTimersByTimeAsync(21);
    await rejection;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "POST" });
  });

  it("uses a still-valid token without contacting OAuth", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getValidGmailToken({
        ...expiredConnection,
        access_token: "valid-token",
        expires_at: "2026-07-21T10:00:00.000Z",
      })
    ).resolves.toBe("valid-token");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
