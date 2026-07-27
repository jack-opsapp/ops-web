import { beforeEach, describe, expect, it, vi } from "vitest";

const { boundaryFactoryMock, statusServiceMock } = vi.hoisted(() => ({
  boundaryFactoryMock: vi.fn(),
  statusServiceMock: vi.fn(),
}));

vi.mock("@/lib/external-api/http/boundary", () => ({
  createExternalApiRequestBoundary: boundaryFactoryMock,
}));

vi.mock("@/lib/external-api/intake/status-service", () => ({
  getExternalIntakeSubmissionStatus: statusServiceMock,
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
  parseRequest(request: Request): Promise<{ publicSubmissionId: string }>;
  handler(context: {
    actor: typeof actor;
    auditRequestId: string;
    requestReceivedAt: string;
    input: { publicSubmissionId: string };
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

describe("GET /v1/intake/submissions/{publicSubmissionId}", () => {
  it("parses only the opaque path identifier behind the intake boundary", async () => {
    await import("@/app/v1/intake/submissions/[publicSubmissionId]/route");

    expect(routeConfig).toMatchObject({
      route: "/v1/intake/submissions/{publicSubmissionId}",
      method: "GET",
      requiredCredentialClass: "intake",
      requiredScopes: ["intake.write"],
    });
    await expect(
      routeConfig.parseRequest(
        new Request(
          "https://app.opsapp.co/v1/intake/submissions/sub_0123456789abcdefghijkA?unsafe=ignored"
        )
      )
    ).resolves.toEqual({
      publicSubmissionId: "sub_0123456789abcdefghijkA",
    });
  });

  it("returns safe current attachment states and bounded polling guidance", async () => {
    await import("@/app/v1/intake/submissions/[publicSubmissionId]/route");
    const result = {
      publicSubmissionId: "sub_0123456789abcdefghijkA",
      publicLeadId: "lead_0123456789abcdefghijkA",
      createdAt: "2026-07-26T22:00:00.000Z",
      customerOutcome: "matched",
      attachments: [
        {
          uploadId: "upl_0123456789abcdefghijkA",
          callerFileId: "site-photo",
          state: "pending_inspection",
          safeCode: null,
        },
      ],
      attachmentProcessingTerminal: false,
      pollAfterSeconds: 10,
    };
    statusServiceMock.mockResolvedValue({
      result,
      auditBase: {
        requestId: "10000000-0000-4000-8000-000000000010",
      },
    });

    const handled = (await routeConfig.handler({
      actor,
      auditRequestId: "10000000-0000-4000-8000-000000000010",
      requestReceivedAt: "2026-07-26T22:00:00.000Z",
      input: { publicSubmissionId: result.publicSubmissionId },
    })) as { result: unknown };
    const response = routeConfig.createResponse(handled.result, {
      requestId: "req_10000000-0000-4000-8000-000000000010",
      serverTimestamp: "2026-07-26T22:00:00.000Z",
    });
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(200);
    expect(serialized).not.toMatch(
      /contactName|contactEmail|answer|message|customerId|storage|companyId|principal|credential/
    );
  });
});
