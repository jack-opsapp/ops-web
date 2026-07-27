import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  afterMock,
  boundaryFactoryMock,
  createSubmissionMock,
  processOutboxMock,
} = vi.hoisted(() => ({
  afterMock: vi.fn(),
  boundaryFactoryMock: vi.fn(),
  createSubmissionMock: vi.fn(),
  processOutboxMock: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: afterMock,
}));

vi.mock("@/lib/external-api/http/boundary", () => ({
  createExternalApiRequestBoundary: boundaryFactoryMock,
}));

vi.mock("@/lib/external-api/intake/submission-service", () => ({
  createExternalIntakeSubmission: createSubmissionMock,
}));

vi.mock("@/lib/external-api/intake/outbox-worker", () => ({
  processExternalIntakeOutboxBatch: processOutboxMock,
}));

const actor = {
  principalId: "10000000-0000-4000-8000-000000000001",
  credentialId: "10000000-0000-4000-8000-000000000002",
  companyId: "10000000-0000-4000-8000-000000000003",
  credentialClass: "intake",
  scopes: ["intake.write"],
  allowedSourceIds: ["10000000-0000-4000-8000-000000000004"],
  authorizationEpoch: 2,
  digestVersion: 1,
  credentialDigest: `\\x${"ab".repeat(32)}`,
  visiblePrefix: "opsx_1_abcdefghijkl",
};

interface CapturedRouteConfig {
  route: string;
  method: string;
  requiredCredentialClass: string;
  requiredScopes: string[];
  parseRequest(request: Request): Promise<{
    submission: unknown;
    idempotencyKey: string;
    requestedOrigin: string | null;
  }>;
  handler(context: {
    actor: typeof actor;
    auditRequestId: string;
    requestReceivedAt: string;
    input: {
      submission: unknown;
      idempotencyKey: string;
      requestedOrigin: string | null;
    };
  }): Promise<unknown>;
  createResponse(
    result: unknown,
    options: { requestId: string; serverTimestamp: string }
  ): Response;
}

let routeConfig: CapturedRouteConfig;

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  boundaryFactoryMock.mockImplementation((config: CapturedRouteConfig) => {
    routeConfig = config;
    return vi.fn();
  });
});

describe("POST /v1/intake/submissions", () => {
  it("requires intake scope, a bounded body, one key, and an exact origin", async () => {
    await import("@/app/v1/intake/submissions/route");
    expect(routeConfig).toMatchObject({
      route: "/v1/intake/submissions",
      method: "POST",
      requiredCredentialClass: "intake",
      requiredScopes: ["intake.write"],
    });

    const parsed = await routeConfig.parseRequest(
      new Request("https://app.opsapp.co/v1/intake/submissions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "submission-0001",
          origin: "https://example.ca",
        },
        body: JSON.stringify({
          sourceId: "src_0123456789abcdefghijkA",
          formId: "frm_0123456789abcdefghijkA",
          contact: { name: "Ana", email: "ana@example.ca" },
          answers: [],
          uploadIds: [],
        }),
      })
    );

    expect(parsed).toMatchObject({
      idempotencyKey: "submission-0001",
      requestedOrigin: "https://example.ca",
    });
    expect(JSON.stringify(parsed)).not.toContain("companyId");
  });

  it.each([
    [false, 201],
    [true, 200],
  ] as const)(
    "returns the safe submission envelope when replayed=%s",
    async (replayed, expectedStatus) => {
      await import("@/app/v1/intake/submissions/route");
      const result = {
        publicSubmissionId: "sub_0123456789abcdefghijkA",
        publicLeadId: "lead_0123456789abcdefghijkA",
        customerOutcome: "created",
        leadCreatedAt: "2026-07-26T22:00:00.000Z",
        initialLeadStage: "new_lead",
        attachments: [],
        replayed,
      };
      createSubmissionMock.mockResolvedValue({
        result,
        auditBase: {
          requestId: "10000000-0000-4000-8000-000000000010",
        },
        idempotencyResult: replayed ? "replay" : "new",
      });

      const handled = (await routeConfig.handler({
        actor,
        auditRequestId: "10000000-0000-4000-8000-000000000010",
        requestReceivedAt: "2026-07-26T22:00:00.000Z",
        input: {
          submission: {
            sourceId: "src_0123456789abcdefghijkA",
            formId: "frm_0123456789abcdefghijkA",
            contact: { name: "Ana", email: "ana@example.ca" },
            answers: [],
            uploadIds: [],
          },
          idempotencyKey: "submission-0001",
          requestedOrigin: null,
        },
      })) as { result: unknown };
      const response = routeConfig.createResponse(handled.result, {
        requestId: "req_10000000-0000-4000-8000-000000000010",
        serverTimestamp: "2026-07-26T22:00:00.000Z",
      });
      const serialized = JSON.stringify(await response.json());

      expect(response.status).toBe(expectedStatus);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(serialized).not.toMatch(
        /contact|answer|message|customerId|storage|companyId|internal/
      );
      expect(afterMock).toHaveBeenCalledOnce();
    }
  );
});
