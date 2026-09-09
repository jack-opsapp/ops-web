// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  service: { name: "service" },
  browser: { name: "browser" },
  authenticate: vi.fn(),
  permission: vi.fn(),
  queue: vi.fn(),
  stats: vi.fn(),
  count: vi.fn(),
  propose: vi.fn(),
  approve: vi.fn(),
  reject: vi.fn(),
  cancel: vi.fn(),
  bulk: vi.fn(),
}));
vi.mock("@/lib/supabase/client", () => ({
  getSupabaseClient: () => mocks.browser,
}));
vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => mocks.service,
}));
vi.mock("../../_lib/auth", () => ({
  authenticateRequest: mocks.authenticate,
  isErrorResponse: () => false,
  requirePermission: mocks.permission,
}));
vi.mock("@/lib/api/services/approval-queue-service", () => ({
  ApprovalQueueService: {
    getQueue: mocks.queue,
    getStats: mocks.stats,
    getPendingCount: mocks.count,
    proposeAction: mocks.propose,
    approveAction: mocks.approve,
    rejectAction: mocks.reject,
    cancelAction: mocks.cancel,
    bulkApprove: mocks.bulk,
    bulkReject: mocks.bulk,
  },
}));

import { requireSupabase, setSupabaseOverride } from "@/lib/supabase/helpers";
import { GET, POST } from "../route";
import { PATCH, DELETE } from "../[actionId]/route";
import { POST as BULK } from "../bulk/route";

const actor = { id: "actor", companyId: "company" };
const params = { params: Promise.resolve({ actionId: "action" }) };
const request = (method: string, body?: object, query = "") =>
  new NextRequest(`https://app.opsapp.co/api/agent/queue${query}`, {
    method,
    ...(body
      ? {
          body: JSON.stringify(body),
          headers: { "content-type": "application/json" },
        }
      : {}),
  });

describe("approval queue request-local database client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSupabaseOverride(null);
    mocks.authenticate.mockResolvedValue(actor);
    mocks.permission.mockResolvedValue(null);
    mocks.stats.mockResolvedValue({});
  });

  it.each([
    ["list", () => GET(request("GET")), mocks.queue, []],
    [
      "count",
      () => GET(request("GET", undefined, "?countOnly=true")),
      mocks.count,
      1,
    ],
    [
      "propose",
      () =>
        POST(
          request("POST", {
            actionType: "create_task",
            actionData: {},
            contextSummary: "test",
          })
        ),
      mocks.propose,
      "action",
    ],
    [
      "approve",
      () => PATCH(request("PATCH", { action: "approve" }), params),
      mocks.approve,
      {},
    ],
    [
      "reject",
      () => PATCH(request("PATCH", { action: "reject" }), params),
      mocks.reject,
      {},
    ],
    [
      "cancel",
      () => DELETE(request("DELETE"), params),
      mocks.cancel,
      undefined,
    ],
    [
      "bulk",
      () => BULK(request("POST", { action: "approve", actionIds: ["action"] })),
      mocks.bulk,
      {},
    ],
  ] as const)(
    "keeps %s authorized when another request finishes first",
    async (_name, invoke, method, value) => {
      let resume!: () => void;
      const gate = new Promise<void>((resolve) => {
        resume = resolve;
      });
      mocks.authenticate.mockImplementationOnce(async () => {
        await gate;
        return actor;
      });
      method.mockImplementation(async () => {
        expect(requireSupabase()).toBe(mocks.service);
        return value;
      });
      const slow = invoke();
      // A concurrent request reaches its finally block while the first awaits auth.
      expect(
        (await GET(request("GET", undefined, "?statsOnly=true"))).status
      ).toBe(200);
      resume();
      const response = await slow;
      expect(response.status).toBe(_name === "propose" ? 201 : 200);
      expect(method).toHaveBeenCalledOnce();
      expect(requireSupabase()).toBe(mocks.browser);
    }
  );
});
