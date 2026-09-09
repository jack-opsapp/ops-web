// @vitest-environment node

/**
 * CALIBRATION — every route reads under the server database context (049cb3f5).
 *
 * The deck route's own proof lives in calibration-deck-context.test.ts. This
 * file covers the three remaining calibration routes and asserts the property
 * that actually broke production: while a CalibrationService read is running,
 * the client a *nested* service would resolve through `requireSupabase()` must
 * be the service-role client — not the Firebase-backed browser client, which on
 * the server carries no user and is answered 42501 by PostgREST.
 *
 * These three methods happen to query the service client directly today, so
 * "the browser client was never called" passes even on the broken code. The
 * load-bearing assertion is `boundDuringRead` — it fails before the service
 * binds itself and passes after, and it keeps failing for any future nested
 * read someone adds to these methods.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const io = vi.hoisted(() => ({
  browserClient: { from: vi.fn(), rpc: vi.fn() },
  serviceClient: { from: vi.fn(), rpc: vi.fn() },
  authenticate: vi.fn(),
  permission: vi.fn(),
  access: vi.fn(),
  boundDuringRead: [] as unknown[],
}));

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseClient: () => io.browserClient,
}));
vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => io.serviceClient,
}));
vi.mock("@/app/api/agent/_lib/auth", async () => {
  const { NextResponse } = await import("next/server");
  return {
    authenticateRequest: io.authenticate,
    isErrorResponse: (value: unknown) => value instanceof NextResponse,
  };
});
vi.mock("@/lib/supabase/check-permission", () => ({
  checkPermissionById: io.permission,
}));
vi.mock("@/lib/email/email-opportunity-access", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resolveEmailInboxListAccess: io.access,
}));

import { GET as getFirstRun } from "@/app/api/calibration/first-run/route";
import { GET as getRecent } from "@/app/api/calibration/recent/route";
import { GET as getActivity } from "@/app/api/calibration/activity/route";
import { requireSupabase, setSupabaseOverride } from "@/lib/supabase/helpers";

const actorId = "actor-1";
const companyId = "company-1";
const NOW = "2026-09-08T12:00:00.000Z";

const ROWS: Record<string, Record<string, unknown>[]> = {
  agent_memories: [
    {
      id: "mem-1",
      source: "learning",
      category: null,
      content: "Client prefers morning calls",
      created_at: NOW,
      entity_id: null,
    },
  ],
  gmail_scan_jobs: [
    {
      id: "job-1",
      status: "complete",
      created_at: NOW,
      updated_at: NOW,
      result: {},
    },
  ],
  agent_actions: [
    {
      id: "act-1",
      action_type: "send_email",
      status: "executed",
      created_at: NOW,
    },
  ],
  users: [{ preferences: { calibrationFirstRunDismissed: true } }],
};

function databaseQuery(table: string) {
  const rows = ROWS[table];
  if (!rows) throw new Error(`Unexpected table: ${table}`);
  // The property under test: the client a nested service would resolve right
  // now, at the moment this read actually runs.
  io.boundDuringRead.push(requireSupabase());

  let single = false;
  const result = () => ({
    data: single ? (rows[0] ?? null) : rows,
    error: null,
    count: rows.length,
  });
  const query = {
    select: () => query,
    eq: () => query,
    in: () => query,
    not: () => query,
    gte: () => query,
    lt: () => query,
    order: () => query,
    limit: () => query,
    maybeSingle: async () => {
      single = true;
      return result();
    },
    then: <T>(resolve: (value: ReturnType<typeof result>) => T) =>
      Promise.resolve(result()).then(resolve),
  };
  return query;
}

function request(path: string) {
  return new NextRequest(`https://ops.test${path}`);
}

/** Every read in the request ran against the injected service client, and the
 *  binding was released again once the response was built. */
function expectServerContext() {
  expect(io.boundDuringRead.length).toBeGreaterThan(0);
  for (const client of io.boundDuringRead) {
    expect(client).toBe(io.serviceClient);
  }
  expect(io.browserClient.from).not.toHaveBeenCalled();
  expect(io.browserClient.rpc).not.toHaveBeenCalled();
  expect(requireSupabase()).toBe(io.browserClient);
}

beforeEach(() => {
  vi.clearAllMocks();
  setSupabaseOverride(null);
  io.boundDuringRead.length = 0;
  io.authenticate.mockResolvedValue({
    id: actorId,
    companyId,
    role: "operator",
  });
  io.permission.mockResolvedValue(true);
  io.access.mockResolvedValue({
    allowed: true,
    actor: { userId: actorId, companyId },
    inboxScope: "all",
    pipelineScope: "all",
    ownPersonalConnectionIds: [],
    assignedOpportunityIds: [],
  });
  io.serviceClient.from.mockImplementation(databaseQuery);
  io.serviceClient.rpc.mockImplementation(() => {
    throw new Error("Unexpected RPC");
  });
  // Both the anon browser client and the RPCs these reads reach are refused by
  // RLS on the server. A fallback must fail loudly, never read as empty.
  io.browserClient.from.mockImplementation(() => {
    throw new Error("permission denied for table agent_memories");
  });
  io.browserClient.rpc.mockImplementation(() => {
    throw new Error("permission denied for function");
  });
});

describe("calibration first-run route server database context", () => {
  it("answers the composite first-run read under the service client", async () => {
    const response = await getFirstRun(request("/api/calibration/first-run"));
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body).toEqual({
      dismissed: true,
      interviewDone: true,
      scanDone: true,
      miningDone: true,
      shouldShowWizard: false,
    });
    expectServerContext();
  });
});

describe("calibration recent route server database context", () => {
  it("merges the three recent sources under the service client", async () => {
    const response = await getRecent(request("/api/calibration/recent?limit=5"));
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.events).toHaveLength(3);
    expect(body.events.map((e: { type: string }) => e.type).sort()).toEqual([
      "draft",
      "learning",
      "scan_complete",
    ]);
    expectServerContext();
  });
});

describe("calibration activity route server database context", () => {
  it("answers the paginated activity log under the service client", async () => {
    const response = await getActivity(
      request("/api/calibration/activity?types=all&timeRange=day&limit=50")
    );
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.events).toHaveLength(3);
    expect(body.nextCursor).toBeNull();
    expectServerContext();
  });
});

describe("calibration route access gates", () => {
  const routes: [string, string, (r: NextRequest) => Promise<Response>][] = [
    ["first-run", "/api/calibration/first-run", getFirstRun],
    ["recent", "/api/calibration/recent", getRecent],
    ["activity", "/api/calibration/activity", getActivity],
  ];

  for (const [name, path, handler] of routes) {
    it.each(["unauthenticated", "permission", "mailbox"])(
      `${name} preserves the %s gate`,
      async (gate) => {
        if (gate === "unauthenticated") {
          io.authenticate.mockResolvedValue(
            NextResponse.json({ error: "Unauthorized" }, { status: 401 })
          );
        }
        if (gate === "permission") io.permission.mockResolvedValue(false);
        if (gate === "mailbox") {
          io.access.mockResolvedValue({
            allowed: false,
            reason: "missing_inbox_permission",
          });
        }
        const response = await handler(request(path));
        expect(response.status).toBe(gate === "unauthenticated" ? 401 : 403);
        expect(io.serviceClient.from).not.toHaveBeenCalled();
        expect(io.browserClient.from).not.toHaveBeenCalled();
      }
    );
  }
});
