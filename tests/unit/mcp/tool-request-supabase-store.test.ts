import { describe, expect, it, vi } from "vitest";

import {
  createSupabaseMcpToolRequestStore,
  type McpToolRequestAtomicInput,
} from "@/lib/agent-control-plane/mcp/tool-request/intake";

const SUBMISSION_ID = "11111111-1111-4111-8111-111111111111";
const FEATURE_REQUEST_ID = `mcp-tool:${SUBMISSION_ID}`;
const INPUT: McpToolRequestAtomicInput = Object.freeze({
  submissionId: SUBMISSION_ID,
  requesterEmail: "builder@example.com",
  details:
    "Let the MCP server compare an active estimate with the last similar job.",
  networkIdentity: "n".repeat(43),
  emailIdentity: "e".repeat(43),
  activeExposureRevision: "2026-08-29.mcp-exposure.v2",
});

function clientWith(response: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(response);
  return {
    rpc,
    store: createSupabaseMcpToolRequestStore({ rpc } as never),
  };
}

describe("Supabase MCP tool-request store", () => {
  it("submits the complete atomic RPC contract without exposing raw identity values", async () => {
    const subject = clientWith({
      data: [
        {
          outcome: "created",
          submission_id: SUBMISSION_ID,
          feature_request_id: FEATURE_REQUEST_ID,
          retry_after_seconds: null,
        },
      ],
      error: null,
    });

    await expect(subject.store.submitAtomic(INPUT)).resolves.toEqual({
      outcome: "created",
      submissionId: SUBMISSION_ID,
      featureRequestId: FEATURE_REQUEST_ID,
      retryAfterSeconds: null,
    });
    expect(subject.rpc).toHaveBeenCalledWith(
      "submit_public_mcp_tool_request_as_system",
      {
        p_submission_id: SUBMISSION_ID,
        p_requester_email: "builder@example.com",
        p_details: INPUT.details,
        p_network_identity: "n".repeat(43),
        p_email_identity: "e".repeat(43),
        p_active_exposure_revision: "2026-08-29.mcp-exposure.v2",
      }
    );
    const args = subject.rpc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(args.p_network_identity).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(args.p_email_identity).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(args.p_network_identity).not.toBe(args.p_email_identity);
    expect(args.p_network_identity).not.toBe("203.0.113.8");
    expect(args.p_email_identity).not.toBe("builder@example.com");
  });

  it.each([
    [
      "created",
      {
        outcome: "created",
        submission_id: SUBMISSION_ID,
        feature_request_id: FEATURE_REQUEST_ID,
        retry_after_seconds: null,
      },
    ],
    [
      "replayed",
      {
        outcome: "replayed",
        submission_id: SUBMISSION_ID,
        feature_request_id: FEATURE_REQUEST_ID,
        retry_after_seconds: null,
      },
    ],
    [
      "rate_limited",
      {
        outcome: "rate_limited",
        submission_id: SUBMISSION_ID,
        feature_request_id: null,
        retry_after_seconds: 419,
      },
    ],
  ] as const)("maps the exact %s RPC result", async (_label, row) => {
    const subject = clientWith({ data: [row], error: null });

    await expect(subject.store.submitAtomic(INPUT)).resolves.toEqual({
      outcome: row.outcome,
      submissionId: SUBMISSION_ID,
      featureRequestId: row.feature_request_id,
      retryAfterSeconds: row.retry_after_seconds,
    });
  });

  it.each([
    [
      "conflicting id",
      { code: "23505", message: "mcp_tool_request_id_conflict" },
      { code: "submission_conflict", status: 409 },
    ],
    [
      "invalid input",
      { code: "22023", message: "invalid private argument detail" },
      { code: "invalid_request", status: 400 },
    ],
  ])(
    "maps the %s RPC error to a safe typed failure",
    async (_label, error, expected) => {
      const subject = clientWith({ data: null, error });

      await expect(subject.store.submitAtomic(INPUT)).rejects.toMatchObject(
        expected
      );
    }
  );

  it("collapses an unexpected RPC error without leaking its detail", async () => {
    const subject = clientWith({
      data: null,
      error: {
        code: "XX000",
        message: "SUPABASE_SERVICE_ROLE_KEY private.feature_requests",
      },
    });

    const failure = await subject.store
      .submitAtomic(INPUT)
      .catch((error) => error);
    expect(String((failure as Error).message)).toBe(
      "tool_request_submission_failed"
    );
    expect(String((failure as Error).message)).not.toContain(
      "feature_requests"
    );
  });

  it.each([
    ["zero rows", []],
    [
      "extra row",
      [
        {
          outcome: "created",
          submission_id: SUBMISSION_ID,
          feature_request_id: FEATURE_REQUEST_ID,
          retry_after_seconds: null,
        },
        {
          outcome: "created",
          submission_id: SUBMISSION_ID,
          feature_request_id: FEATURE_REQUEST_ID,
          retry_after_seconds: null,
        },
      ],
    ],
    [
      "unknown field",
      [
        {
          outcome: "created",
          submission_id: SUBMISSION_ID,
          feature_request_id: FEATURE_REQUEST_ID,
          retry_after_seconds: null,
          private_detail: "leak",
        },
      ],
    ],
    [
      "invalid outcome invariants",
      [
        {
          outcome: "rate_limited",
          submission_id: SUBMISSION_ID,
          feature_request_id: FEATURE_REQUEST_ID,
          retry_after_seconds: null,
        },
      ],
    ],
  ])("rejects a malformed RPC result: %s", async (_label, data) => {
    const subject = clientWith({ data, error: null });

    await expect(subject.store.submitAtomic(INPUT)).rejects.toThrow(
      "tool_request_submission_failed"
    );
  });
});
