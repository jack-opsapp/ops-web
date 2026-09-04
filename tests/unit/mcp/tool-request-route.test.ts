import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { McpToolRequestNotification } from "@/lib/agent-control-plane/mcp/tool-request/intake";

const SUBMISSION_ID = "11111111-1111-4111-8111-111111111111";
const BODY = Object.freeze({
  submissionId: SUBMISSION_ID,
  email: "builder@example.com",
  details:
    "Let the MCP server compare an active estimate with the last similar job.",
  website: "",
});

const mocks = vi.hoisted(() => ({
  submit: vi.fn(),
  rpc: vi.fn(),
  store: {},
  normalizeEmail: vi.fn(),
  sendMcpToolRequest: vi.fn(),
  after: vi.fn(),
  intakeConfig: null as null | {
    scheduleNotification(notification: McpToolRequestNotification): void;
  },
}));

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: mocks.after };
});

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({ rpc: mocks.rpc }),
}));

vi.mock("@/lib/agent-control-plane/mcp/tool-request/intake", () => ({
  createSupabaseMcpToolRequestStore: () => mocks.store,
  createMcpToolRequestIntake: (config: {
    scheduleNotification(notification: McpToolRequestNotification): void;
  }) => {
    mocks.intakeConfig = config;
    return { submit: mocks.submit };
  },
  normalizeMcpToolRequestEmail: mocks.normalizeEmail,
}));

vi.mock("@/lib/email/sendgrid", () => ({
  sendMcpToolRequest: mocks.sendMcpToolRequest,
}));

import { POST } from "@/app/api/developers/mcp/tool-requests/route";

function request(
  options: {
    body?: string;
    contentType?: string;
    origin?: string | null;
    ip?: string | null;
  } = {}
) {
  const headers: Record<string, string> = {
    "content-type": options.contentType ?? "application/json; charset=utf-8",
  };
  if (options.origin !== null) {
    headers.origin = options.origin ?? "https://app.opsapp.co";
  }
  if (options.ip !== null) {
    headers["x-vercel-forwarded-for"] = options.ip ?? "203.0.113.8";
  }
  return new NextRequest(
    "https://app.opsapp.co/api/developers/mcp/tool-requests",
    {
      method: "POST",
      headers,
      body: options.body ?? JSON.stringify(BODY),
    }
  );
}

async function json(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

describe("POST /api/developers/mcp/tool-requests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv(
      "EXTERNAL_API_NETWORK_HMAC_KEYS",
      JSON.stringify({
        activeKid: "1",
        keys: { "1": Buffer.alloc(32, 7).toString("base64url") },
      })
    );
    mocks.rpc.mockResolvedValue({
      data: { allowed: true, remaining: 29, retry_after_seconds: 0 },
      error: null,
    });
    mocks.normalizeEmail.mockImplementation((body: { email: string }) =>
      body.email.trim().toLowerCase()
    );
    mocks.submit.mockResolvedValue({
      submissionId: SUBMISSION_ID,
      created: true,
      replayed: false,
      suppressed: false,
    });
    mocks.sendMcpToolRequest.mockResolvedValue(undefined);
    mocks.after.mockImplementation(() => undefined);
    mocks.intakeConfig = null;
  });

  it("applies one coarse network prelimit and passes distinct HMAC identities to atomic intake", async () => {
    const response = await POST(request());

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(json(response)).resolves.toEqual({
      ok: true,
      submissionId: SUBMISSION_ID,
      replayed: false,
    });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc.mock.calls[0]?.[0]).toBe(
      "consume_external_api_rate_limits_as_system"
    );
    const limiterArgs = mocks.rpc.mock.calls[0]?.[1] as {
      p_checks: Array<{ scope: string; identity: string }>;
    };
    expect(limiterArgs.p_checks).toHaveLength(2);
    const networkIdentity = limiterArgs.p_checks[0]?.identity;
    expect(networkIdentity).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(limiterArgs)).not.toContain("203.0.113.8");
    expect(JSON.stringify(limiterArgs)).not.toContain("builder@example.com");

    expect(mocks.submit).toHaveBeenCalledWith(BODY, {
      networkIdentity,
      emailIdentity: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    });
    const identities = mocks.submit.mock.calls[0]?.[1] as {
      networkIdentity: string;
      emailIdentity: string;
    };
    expect(identities.networkIdentity).not.toBe(identities.emailIdentity);
    expect(identities.networkIdentity).not.toBe("203.0.113.8");
    expect(identities.emailIdentity).not.toBe("builder@example.com");
  });

  it("uses one IPv6 /64 identity for both coarse and atomic limits", async () => {
    const first = await POST(request({ ip: "2001:db8:abcd:12::1" }));
    const rotated = await POST(
      request({ ip: "2001:0db8:abcd:0012:ffff:eeee:dddd:cccc" })
    );

    expect(first.status).toBe(201);
    expect(rotated.status).toBe(201);
    const coarseIdentities = mocks.rpc.mock.calls.map((call) => {
      const args = call[1] as {
        p_checks: Array<{ scope: string; identity: string }>;
      };
      return args.p_checks[0]?.identity;
    });
    const atomicIdentities = mocks.submit.mock.calls.map(
      (call) => (call[1] as { networkIdentity: string }).networkIdentity
    );

    expect(coarseIdentities).toEqual([
      expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    ]);
    expect(coarseIdentities[0]).toBe(coarseIdentities[1]);
    expect(atomicIdentities).toEqual(coarseIdentities);
  });

  it.each([
    ["cross-origin", request({ origin: "https://attacker.example" })],
    ["missing origin", request({ origin: null })],
  ])(
    "rejects a %s browser request before rate limiting",
    async (_label, req) => {
      const response = await POST(req);

      expect(response.status).toBe(403);
      await expect(json(response)).resolves.toEqual({ error: "forbidden" });
      expect(mocks.rpc).not.toHaveBeenCalled();
      expect(mocks.submit).not.toHaveBeenCalled();
    }
  );

  it.each([
    ["wrong content type", request({ contentType: "text/plain" })],
    ["malformed JSON", request({ body: "{" })],
    [
      "body over 20 KiB",
      request({
        body: JSON.stringify({ ...BODY, details: "x".repeat(20_481) }),
      }),
    ],
  ])(
    "returns one safe invalid-request response for %s",
    async (_label, req) => {
      const response = await POST(req);

      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe("no-store");
      await expect(json(response)).resolves.toEqual({
        error: "invalid_request",
      });
      expect(mocks.submit).not.toHaveBeenCalled();
    }
  );

  it("accepts the intake contract's 4,000-character multibyte details", async () => {
    const details = "工".repeat(4_000);
    const body = { ...BODY, details };

    const response = await POST(request({ body: JSON.stringify(body) }));

    expect(response.status).toBe(201);
    expect(mocks.submit).toHaveBeenCalledWith(
      body,
      expect.objectContaining({
        networkIdentity: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
        emailIdentity: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      })
    );
  });

  it("returns a durable network denial with its exact retry delay", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: { allowed: false, remaining: 0, retry_after_seconds: 61 },
      error: null,
    });

    const response = await POST(request());

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("61");
    await expect(json(response)).resolves.toEqual({ error: "rate_limited" });
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it.each([
    ["missing network identity", request({ ip: null })],
    ["rate-limit RPC failure", request()],
  ])("fails closed when the limiter is unavailable: %s", async (label, req) => {
    if (label === "rate-limit RPC failure") {
      mocks.rpc.mockResolvedValueOnce({
        data: null,
        error: { message: "private rate-limit detail" },
      });
    }

    const response = await POST(req);

    expect(response.status).toBe(503);
    await expect(json(response)).resolves.toEqual({
      error: "temporarily_unavailable",
    });
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("returns 200 for an identical atomic replay", async () => {
    mocks.submit.mockResolvedValueOnce({
      submissionId: SUBMISSION_ID,
      created: false,
      replayed: true,
      suppressed: false,
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(json(response)).resolves.toEqual({
      ok: true,
      submissionId: SUBMISSION_ID,
      replayed: true,
    });
  });

  it("makes a honeypot suppression indistinguishable from creation", async () => {
    mocks.submit.mockResolvedValueOnce({
      submissionId: SUBMISSION_ID,
      created: false,
      replayed: false,
      suppressed: true,
    });

    const response = await POST(
      request({ body: JSON.stringify({ ...BODY, website: "spam" }) })
    );

    expect(response.status).toBe(201);
    await expect(json(response)).resolves.toEqual({
      ok: true,
      submissionId: SUBMISSION_ID,
      replayed: false,
    });
  });

  it("schedules the exact support alert through Next after", async () => {
    const response = await POST(request());
    expect(response.status).toBe(201);

    const notification: McpToolRequestNotification = {
      requesterEmail: BODY.email,
      details: BODY.details,
      submissionId: `mcp-tool:${SUBMISSION_ID}`,
    };
    expect(mocks.intakeConfig).not.toBeNull();
    mocks.intakeConfig?.scheduleNotification(notification);

    expect(mocks.after).toHaveBeenCalledTimes(1);
    const scheduled = mocks.after.mock.calls[0]?.[0] as () => Promise<void>;
    await scheduled();
    expect(mocks.sendMcpToolRequest).toHaveBeenCalledWith({
      requesterEmail: BODY.email,
      details: BODY.details,
      submissionId: `mcp-tool:${SUBMISSION_ID}`,
      adminUrl: "https://app.opsapp.co/admin/feedback",
    });
  });

  it("keeps a scheduled support-alert failure free of requester data", async () => {
    await POST(request());
    mocks.sendMcpToolRequest.mockRejectedValueOnce(
      new Error(`SendGrid rejected ${BODY.email}`)
    );
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    mocks.intakeConfig?.scheduleNotification({
      requesterEmail: BODY.email,
      details: BODY.details,
      submissionId: `mcp-tool:${SUBMISSION_ID}`,
    });
    const scheduled = mocks.after.mock.calls[0]?.[0] as () => Promise<void>;
    await expect(scheduled()).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalledWith(
      "mcp_tool_request_notification_failed"
    );
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(BODY.email);
  });

  it.each([
    ["invalid_request", 400],
    ["submission_conflict", 409],
    ["rate_limited", 429],
  ] as const)("maps the typed %s intake failure", async (code, status) => {
    mocks.submit.mockRejectedValueOnce(
      Object.assign(new Error("safe"), {
        code,
        status,
        retryAfterSeconds: status === 429 ? 419 : undefined,
      })
    );

    const response = await POST(request());

    expect(response.status).toBe(status);
    await expect(json(response)).resolves.toEqual({ error: code });
    if (status === 429) {
      expect(response.headers.get("retry-after")).toBe("419");
    }
  });

  it("collapses unexpected failures without leaking database details", async () => {
    mocks.submit.mockRejectedValueOnce(
      new Error("SUPABASE_SERVICE_ROLE_KEY private.feature_requests")
    );

    const response = await POST(request());
    const body = await json(response);

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "request_failed" });
    expect(JSON.stringify(body)).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
