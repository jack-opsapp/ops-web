import { beforeEach, describe, expect, it, vi } from "vitest";

const { boundaryFactoryMock, configServiceMock } = vi.hoisted(() => ({
  boundaryFactoryMock: vi.fn(),
  configServiceMock: vi.fn(),
}));

vi.mock("@/lib/external-api/http/boundary", () => ({
  createExternalApiRequestBoundary: boundaryFactoryMock,
}));

vi.mock("@/lib/external-api/intake/config-service", () => ({
  getExternalIntakeConfig: configServiceMock,
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
  parseRequest(request: Request): Promise<void>;
  handler(context: {
    actor: typeof actor;
    auditRequestId: string;
    requestReceivedAt: string;
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

describe("GET /v1/intake/config", () => {
  it("declares an intake-only no-body boundary", async () => {
    await import("@/app/v1/intake/config/route");

    expect(routeConfig).toMatchObject({
      route: "/v1/intake/config",
      method: "GET",
      requiredCredentialClass: "intake",
      requiredScopes: ["intake.write"],
    });
    await expect(
      routeConfig.parseRequest(
        new Request("https://app.opsapp.co/v1/intake/config")
      )
    ).resolves.toBeUndefined();
  });

  it("returns only active source configuration and public file limits", async () => {
    await import("@/app/v1/intake/config/route");
    const result = {
      contractVersion: "v1",
      sources: [
        {
          sourceId: "src_0123456789abcdefghijkA",
          label: "Main website",
          canonicalSiteHost: "example.ca",
          defaultPhoneRegion: "CA",
          defaultOwnerConfigured: true,
          forms: [
            {
              formId: "frm_0123456789abcdefghijkA",
              label: "Default",
              isDefault: true,
            },
          ],
        },
      ],
      acceptedFilePolicy: {
        contentTypes: ["image/jpeg"],
        maxFiles: 10,
        maxFileBytes: 26_214_400,
        maxBatchBytes: 52_428_800,
      },
      requestLimits: { maxJsonBodyBytes: 262_144, maxAnswers: 100 },
    };
    configServiceMock.mockResolvedValue({
      result,
      auditBase: {
        requestId: "10000000-0000-4000-8000-000000000010",
      },
    });

    const handled = (await routeConfig.handler({
      actor,
      auditRequestId: "10000000-0000-4000-8000-000000000010",
      requestReceivedAt: "2026-07-26T22:00:00.000Z",
    })) as { result: unknown };

    expect(configServiceMock).toHaveBeenCalledWith({
      actor,
      auditRequestId: "10000000-0000-4000-8000-000000000010",
      requestReceivedAt: "2026-07-26T22:00:00.000Z",
    });
    const response = routeConfig.createResponse(handled.result, {
      requestId: "req_10000000-0000-4000-8000-000000000010",
      serverTimestamp: "2026-07-26T22:00:00.000Z",
    });
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(serialized).not.toMatch(
      /companyId|principal|credential|mailbox|ownerId|internal/
    );
  });
});
