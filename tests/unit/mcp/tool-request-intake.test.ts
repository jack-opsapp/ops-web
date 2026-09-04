import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createMcpToolRequestIntake,
  McpToolRequestError,
  type McpToolRequestAtomicInput,
  type McpToolRequestAtomicResult,
  type McpToolRequestNotification,
  type McpToolRequestStore,
} from "@/lib/agent-control-plane/mcp/tool-request/intake";

const ACTIVE_EXPOSURE = "2026-08-29.mcp-exposure.v2";
const UPPERCASE_SUBMISSION_ID = "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE";
const SUBMISSION_ID = UPPERCASE_SUBMISSION_ID.toLowerCase();
const FEATURE_REQUEST_ID = `mcp-tool:${SUBMISSION_ID}`;
const NETWORK_IDENTITY = "n".repeat(43);
const EMAIL_IDENTITY = "e".repeat(43);
const BODY = Object.freeze({
  submissionId: UPPERCASE_SUBMISSION_ID,
  email: "  Builder@Example.COM ",
  details:
    "  Let the MCP server compare an active estimate with the last similar job.\r\nKeep the result read-only.  ",
  website: "",
});
const IDENTITIES = Object.freeze({
  networkIdentity: NETWORK_IDENTITY,
  emailIdentity: EMAIL_IDENTITY,
});

function atomicResult(
  outcome: McpToolRequestAtomicResult["outcome"] = "created"
): McpToolRequestAtomicResult {
  if (outcome === "rate_limited") {
    return {
      outcome,
      submissionId: SUBMISSION_ID,
      featureRequestId: null,
      retryAfterSeconds: 73,
    };
  }
  return {
    outcome,
    submissionId: SUBMISSION_ID,
    featureRequestId: FEATURE_REQUEST_ID,
    retryAfterSeconds: null,
  };
}

function harness(result: McpToolRequestAtomicResult = atomicResult()) {
  const events: string[] = [];
  const submitAtomic = vi.fn(
    async (
      _input: McpToolRequestAtomicInput
    ): Promise<McpToolRequestAtomicResult> => {
      events.push("store");
      return result;
    }
  );
  const store: McpToolRequestStore = { submitAtomic };
  const scheduleNotification = vi.fn(
    (_notification: McpToolRequestNotification) => {
      events.push("notify");
    }
  );
  const intake = createMcpToolRequestIntake({
    store,
    scheduleNotification,
    activeExposureRevision: ACTIVE_EXPOSURE,
  });

  return { events, intake, scheduleNotification, submitAtomic };
}

describe("public MCP tool-request intake", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("normalizes the public payload before one atomic submission", async () => {
    const subject = harness();

    await expect(subject.intake.submit(BODY, IDENTITIES)).resolves.toEqual({
      submissionId: SUBMISSION_ID,
      created: true,
      replayed: false,
      suppressed: false,
    });
    expect(subject.submitAtomic).toHaveBeenCalledWith({
      submissionId: SUBMISSION_ID,
      requesterEmail: "builder@example.com",
      details:
        "Let the MCP server compare an active estimate with the last similar job.\nKeep the result read-only.",
      networkIdentity: NETWORK_IDENTITY,
      emailIdentity: EMAIL_IDENTITY,
      activeExposureRevision: ACTIVE_EXPOSURE,
    });
    expect(subject.events).toEqual(["store", "notify"]);
  });

  it.each([
    ["non-object", null],
    ["missing submission id", { ...BODY, submissionId: undefined }],
    ["non-UUID submission id", { ...BODY, submissionId: "request-1" }],
    ["invalid email", { ...BODY, email: "not-an-email" }],
    ["short details", { ...BODY, details: "Too short" }],
    ["details over 4,000 characters", { ...BODY, details: "x".repeat(4_001) }],
    ["non-string honeypot", { ...BODY, website: false }],
    ["unknown field", { ...BODY, companyId: "spoofed-company" }],
  ])("rejects strict input: %s", async (_label, body) => {
    const subject = harness();

    await expect(subject.intake.submit(body, IDENTITIES)).rejects.toMatchObject(
      {
        code: "invalid_request",
        status: 400,
      }
    );
    expect(subject.submitAtomic).not.toHaveBeenCalled();
    expect(subject.scheduleNotification).not.toHaveBeenCalled();
  });

  it("silently suppresses a filled honeypot without persistence or notification", async () => {
    const subject = harness();

    await expect(
      subject.intake.submit(
        { ...BODY, website: "https://spam.example" },
        IDENTITIES
      )
    ).resolves.toEqual({
      submissionId: SUBMISSION_ID,
      created: false,
      replayed: false,
      suppressed: true,
    });
    expect(subject.submitAtomic).not.toHaveBeenCalled();
    expect(subject.scheduleNotification).not.toHaveBeenCalled();
  });

  it("schedules the support notification only after an atomic creation", async () => {
    const subject = harness();

    await subject.intake.submit(BODY, IDENTITIES);

    expect(subject.scheduleNotification).toHaveBeenCalledWith({
      requesterEmail: "builder@example.com",
      details:
        "Let the MCP server compare an active estimate with the last similar job.\nKeep the result read-only.",
      submissionId: FEATURE_REQUEST_ID,
    });
    expect(subject.events).toEqual(["store", "notify"]);
  });

  it("returns an atomic replay without scheduling another notification", async () => {
    const subject = harness(atomicResult("replayed"));

    await expect(subject.intake.submit(BODY, IDENTITIES)).resolves.toEqual({
      submissionId: SUBMISSION_ID,
      created: false,
      replayed: true,
      suppressed: false,
    });
    expect(subject.submitAtomic).toHaveBeenCalledOnce();
    expect(subject.scheduleNotification).not.toHaveBeenCalled();
  });

  it("preserves the atomic limiter's exact retry delay", async () => {
    const subject = harness(atomicResult("rate_limited"));

    await expect(subject.intake.submit(BODY, IDENTITIES)).rejects.toMatchObject(
      {
        code: "rate_limited",
        status: 429,
        retryAfterSeconds: 73,
      }
    );
    expect(subject.scheduleNotification).not.toHaveBeenCalled();
  });

  it.each([
    [new McpToolRequestError("invalid_request", 400), "invalid_request", 400],
    [
      new McpToolRequestError("submission_conflict", 409),
      "submission_conflict",
      409,
    ],
  ] as const)(
    "preserves a typed atomic-store %s failure",
    async (failure, code, status) => {
      const subject = harness();
      subject.submitAtomic.mockRejectedValueOnce(failure);

      await expect(
        subject.intake.submit(BODY, IDENTITIES)
      ).rejects.toMatchObject({
        code,
        status,
      });
      expect(subject.scheduleNotification).not.toHaveBeenCalled();
    }
  );

  it("collapses an unexpected atomic-store failure without database detail", async () => {
    const subject = harness();
    subject.submitAtomic.mockRejectedValueOnce(
      new Error("private.feature_requests leaked detail")
    );

    const failure = await subject.intake
      .submit(BODY, IDENTITIES)
      .catch((caught) => caught);
    expect(failure).toMatchObject({ code: "request_failed", status: 500 });
    expect(String((failure as Error).message)).not.toContain(
      "feature_requests"
    );
    expect(subject.scheduleNotification).not.toHaveBeenCalled();
  });

  it.each([
    ["raw network value", { ...IDENTITIES, networkIdentity: "203.0.113.8" }],
    [
      "raw email value",
      { ...IDENTITIES, emailIdentity: "builder@example.com" },
    ],
    [
      "same identity in both domains",
      { networkIdentity: NETWORK_IDENTITY, emailIdentity: NETWORK_IDENTITY },
    ],
  ])("fails safely before persistence for %s", async (_label, identities) => {
    const subject = harness();

    await expect(subject.intake.submit(BODY, identities)).rejects.toMatchObject(
      {
        code: "request_failed",
        status: 500,
      }
    );
    expect(subject.submitAtomic).not.toHaveBeenCalled();
  });

  it("keeps a durable creation successful when notification scheduling fails", async () => {
    const subject = harness();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    subject.scheduleNotification.mockImplementationOnce(() => {
      throw new Error("scheduler unavailable");
    });

    await expect(
      subject.intake.submit(BODY, IDENTITIES)
    ).resolves.toMatchObject({
      submissionId: SUBMISSION_ID,
      created: true,
      replayed: false,
    });
    expect(subject.submitAtomic).toHaveBeenCalledOnce();
    expect(subject.scheduleNotification).toHaveBeenCalledOnce();
    expect(consoleError).toHaveBeenCalledWith(
      "mcp_tool_request_notification_failed"
    );
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
      "builder@example.com"
    );
  });
});
