import { beforeEach, describe, expect, it, vi } from "vitest";

const { boundaryFactoryMock, createBatchMock } = vi.hoisted(() => ({
  boundaryFactoryMock: vi.fn(),
  createBatchMock: vi.fn(),
}));

vi.mock("@/lib/external-api/http/boundary", () => ({
  createExternalApiRequestBoundary: boundaryFactoryMock,
}));

vi.mock("@/lib/external-api/uploads/upload-service", () => ({
  createExternalUploadBatch: createBatchMock,
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
    batch: unknown;
    idempotencyKey: string;
    requestedOrigin: string | null;
  }>;
  handler(context: {
    actor: typeof actor;
    auditRequestId: string;
    requestReceivedAt: string;
    input: {
      batch: unknown;
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
  boundaryFactoryMock.mockImplementation((config: CapturedRouteConfig) => {
    routeConfig = config;
    return vi.fn();
  });
});

describe("POST /v1/intake/uploads", () => {
  it("declares the protected no-store upload boundary", async () => {
    await import("@/app/v1/intake/uploads/route");

    expect(boundaryFactoryMock).toHaveBeenCalledOnce();
    expect(routeConfig).toMatchObject({
      route: "/v1/intake/uploads",
      method: "POST",
      requiredCredentialClass: "intake",
      requiredScopes: ["intake.write"],
    });
  });

  it("requires one idempotency key, preserves optional origin, and delegates without caller company input", async () => {
    await import("@/app/v1/intake/uploads/route");
    const request = new Request("https://app.opsapp.co/v1/intake/uploads", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "upload-request-0001",
        origin: "https://website.example",
      },
      body: JSON.stringify({
        sourceId: "src_0123456789abcdefghijkA",
        formId: "frm_0123456789abcdefghijkA",
        files: [
          {
            callerFileId: "front-photo",
            filename: "front.jpg",
            sizeBytes: 4_096,
            contentType: "image/jpeg",
          },
        ],
      }),
    });

    const parsed = await routeConfig.parseRequest(request);
    expect(parsed).toMatchObject({
      idempotencyKey: "upload-request-0001",
      requestedOrigin: "https://website.example",
    });
    expect(JSON.stringify(parsed)).not.toContain("companyId");

    createBatchMock.mockResolvedValue({
      result: { replayed: false, uploads: [] },
      auditBase: { requestId: "10000000-0000-4000-8000-000000000010" },
      idempotencyResult: "new",
    });
    await routeConfig.handler({
      actor,
      auditRequestId: "10000000-0000-4000-8000-000000000010",
      requestReceivedAt: "2026-07-26T22:00:00.000Z",
      input: parsed,
    });
    expect(createBatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actor,
        auditRequestId: "10000000-0000-4000-8000-000000000010",
        idempotencyKey: "upload-request-0001",
        requestedOrigin: "https://website.example",
      })
    );
  });

  it("returns the stable upload envelope with no browser cache", async () => {
    await import("@/app/v1/intake/uploads/route");
    const response = routeConfig.createResponse(
      {
        replayed: false,
        uploads: [
          {
            callerFileId: "front-photo",
            uploadId: "upl_0123456789abcdefghijkA",
            state: "issued",
            capability: {
              method: "PUT",
              url: "https://files.example.test/signed",
              expiresAt: "2026-07-26T22:02:00.000Z",
              requiredHeaders: {
                contentType: "image/jpeg",
                contentLength: 4_096,
                ifNoneMatch: "*",
              },
            },
          },
        ],
      },
      {
        requestId: "req_10000000-0000-4000-8000-000000000010",
        serverTimestamp: "2026-07-26T22:00:00.000Z",
      }
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(JSON.stringify(await response.json())).not.toMatch(
      /storage|bucket|objectKey|companyId|credential/
    );
  });
});
