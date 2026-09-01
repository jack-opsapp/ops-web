import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  checkPermissionById: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/app/api/agent/_lib/auth", async () => {
  const { NextResponse: Response } = await import("next/server");
  return {
    authenticateRequest: mocks.authenticateRequest,
    isErrorResponse: (value: unknown) => value instanceof Response,
  };
});

vi.mock("@/lib/supabase/check-permission", () => ({
  checkPermissionById: mocks.checkPermissionById,
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({ rpc: mocks.rpc }),
}));

import { GET, POST, PUT } from "@/app/api/mcp/routines/day-closeout/route";

const ACTOR_ID = "dc000000-0000-4000-8000-000000000011";
const COMPANY_ID = "dc000000-0000-4000-8000-000000000001";
const GRANT_ID = "dc000000-0000-4000-8000-000000000031";
const CLIENT_ID = "dc000000-0000-4000-8000-000000000021";
const ENDPOINT = "https://app.opsapp.co/api/mcp/routines/day-closeout";

const AUTHENTICATED = {
  id: ACTOR_ID,
  companyId: COMPANY_ID,
  role: "owner",
  isManager: true,
  firstName: "Jackson",
  lastName: "Sweet",
};

const ROW = {
  grant_id: GRANT_ID,
  client_id: CLIENT_ID,
  client_name: "Claude",
  enabled: false,
  local_time: "20:00",
  timezone: "America/Vancouver",
  next_run_at: null,
  last_run_at: null,
  last_success_at: null,
  last_failure_code: null,
  schedule_revision: 0,
};

function getRequest(): NextRequest {
  return new NextRequest(ENDPOINT, { method: "GET" });
}

function putRequest(
  body: unknown,
  contentType = "application/json"
): NextRequest {
  return new NextRequest(ENDPOINT, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticateRequest.mockResolvedValue(AUTHENTICATED);
  mocks.checkPermissionById.mockResolvedValue(true);
  mocks.rpc.mockImplementation(
    async (name: string, args: Record<string, unknown>) => {
      if (name === "list_agent_day_closeout_routine_configs_as_system") {
        return { data: [ROW], error: null };
      }
      if (name === "upsert_agent_day_closeout_routine_config_as_system") {
        return {
          data: [
            {
              ...ROW,
              enabled: args.p_enabled,
              local_time: args.p_local_time,
              next_run_at: "2026-09-01T04:15:00.000Z",
              schedule_revision: 1,
            },
          ],
          error: null,
        };
      }
      return { data: null, error: { code: "XX000" } };
    }
  );
});

describe("GET /api/mcp/routines/day-closeout", () => {
  it("returns the current actor's eligible routine state without caching", async () => {
    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      routines: [
        {
          grantId: GRANT_ID,
          clientId: CLIENT_ID,
          clientName: "Claude",
          enabled: false,
          localTime: "20:00",
          timezone: "America/Vancouver",
          nextRunAt: null,
          lastRunAt: null,
          lastSuccessAt: null,
          lastFailureCode: null,
          scheduleRevision: 0,
        },
      ],
    });
    expect(mocks.checkPermissionById).toHaveBeenCalledWith(
      ACTOR_ID,
      "settings.integrations",
      "all"
    );
    expect(mocks.rpc).toHaveBeenCalledWith(
      "list_agent_day_closeout_routine_configs_as_system",
      { p_actor_user_id: ACTOR_ID, p_company_id: COMPANY_ID }
    );
  });

  it("fails before storage when the session or granular permission is absent", async () => {
    mocks.authenticateRequest.mockResolvedValueOnce(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    );
    expect((await GET(getRequest())).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();

    mocks.authenticateRequest.mockResolvedValueOnce(AUTHENTICATED);
    mocks.checkPermissionById.mockResolvedValueOnce(false);
    expect((await GET(getRequest())).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("PUT /api/mcp/routines/day-closeout", () => {
  it("authenticates before parsing so unauthenticated callers learn no body contract", async () => {
    mocks.authenticateRequest.mockResolvedValueOnce(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    );

    const response = await PUT(putRequest("{", "text/plain"));

    expect(response.status).toBe(401);
    expect(mocks.checkPermissionById).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("binds the update to the session actor and one exact grant", async () => {
    const response = await PUT(
      putRequest({ grantId: GRANT_ID, enabled: true, localTime: "21:15" })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      routine: {
        grantId: GRANT_ID,
        enabled: true,
        localTime: "21:15",
        timezone: "America/Vancouver",
        scheduleRevision: 1,
      },
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "upsert_agent_day_closeout_routine_config_as_system",
      {
        p_actor_user_id: ACTOR_ID,
        p_company_id: COMPANY_ID,
        p_oauth_grant_id: GRANT_ID,
        p_enabled: true,
        p_local_time: "21:15",
      }
    );
  });

  it.each([
    [
      "wrong media type",
      { grantId: GRANT_ID, enabled: true, localTime: "20:00" },
      "text/plain",
    ],
    ["malformed JSON", "{", "application/json"],
    [
      "unknown field",
      {
        grantId: GRANT_ID,
        enabled: true,
        localTime: "20:00",
        actorId: ACTOR_ID,
      },
      "application/json",
    ],
    [
      "invalid grant",
      { grantId: "not-a-grant", enabled: true, localTime: "20:00" },
      "application/json",
    ],
    [
      "invalid time",
      { grantId: GRANT_ID, enabled: true, localTime: "24:00" },
      "application/json",
    ],
  ])("rejects %s without touching storage", async (_label, body, type) => {
    const response = await PUT(putRequest(body, type));
    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("maps a database authority race to 403 without exposing its message", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "42501", message: "sensitive policy details" },
    });

    const response = await PUT(
      putRequest({ grantId: GRANT_ID, enabled: true, localTime: "20:00" })
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "forbidden" });
  });
});

describe("unsupported methods", () => {
  it("returns 405 with the exact Allow contract", async () => {
    const response = await POST();
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("GET, PUT");
  });
});
