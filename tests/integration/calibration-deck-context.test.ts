// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const io = vi.hoisted(() => ({
  browserClient: { from: vi.fn(), rpc: vi.fn() },
  serviceClient: { from: vi.fn(), rpc: vi.fn() },
  authenticate: vi.fn(),
  permission: vi.fn(),
  access: vi.fn(),
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

import { GET } from "@/app/api/calibration/deck/route";
import { requireSupabase, setSupabaseOverride } from "@/lib/supabase/helpers";

const actorId = "actor-1";
const companyId = "company-1";
const connectionId = "company-mailbox";
const connection = {
  id: connectionId,
  type: "company",
  user_id: null,
  status: "active",
  auto_send_settings: {
    category_autonomy: { "primary:CUSTOMER": "auto_send" },
  },
  sync_filters: { rules: [{ id: "rule-1" }] },
};

function databaseQuery(table: string) {
  const knownTables = new Set([
    "agent_memories",
    "agent_writing_profiles",
    "gmail_scan_jobs",
    "agent_actions",
    "admin_feature_overrides",
    "email_connections",
    "email_autonomy_milestones",
  ]);
  if (!knownTables.has(table)) throw new Error(`Unexpected table: ${table}`);
  const filters: Record<string, unknown> = {};
  let single = false;
  const result = () => {
    const data = table === "email_connections" ? [connection] : [];
    if (table === "email_connections" && filters.id !== undefined) {
      expect(filters.id).toBe(connectionId);
    }
    return { data: single ? (data[0] ?? null) : data, error: null, count: 0 };
  };
  const query = {
    select: () => query,
    eq: (key: string, value: unknown) => {
      filters[key] = value;
      return query;
    },
    in: () => query,
    not: () => query,
    gte: () => query,
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

async function readRpc(name: string, args: Record<string, unknown>) {
  expect(args.p_actor_user_id).toBe(actorId);
  expect(args.p_connection_id).toBe(connectionId);
  if (name === "get_phase_c_actor_category_acceptances_as_system") {
    return { data: [], error: null };
  }
  if (name === "get_human_draft_accuracy_for_category_as_system") {
    expect(args.p_company_id).toBe(companyId);
    expect(args.p_limit).toBe(50);
    return {
      data:
        args.p_primary_category === "CUSTOMER"
          ? [
              {
                draft_outcome: { sentWithoutChanges: true },
                profile_type: "client_new_inquiry",
              },
            ]
          : [],
      error: null,
    };
  }
  throw new Error(`Unexpected RPC: ${name}`);
}

function request() {
  return new NextRequest("https://ops.test/api/calibration/deck");
}

beforeEach(() => {
  vi.clearAllMocks();
  setSupabaseOverride(null);
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
  io.serviceClient.rpc.mockImplementation(readRpc);
  // Both live actor/category RPCs grant EXECUTE to service_role only. The
  // browser fallback must not silently become an empty successful read.
  io.browserClient.from.mockImplementation(() => {
    throw new Error("permission denied for table email_connections");
  });
  io.browserClient.rpc.mockImplementation(() => {
    throw new Error(
      "permission denied for function get_phase_c_actor_category_acceptances_as_system"
    );
  });
});

describe("calibration deck server database context", () => {
  it("loads real nested category and graduation reads without browser auth", async () => {
    const response = await GET(request());
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.config).toMatchObject({
      categoriesCount: 12,
      rulesCount: 1,
      emailTypeCounts: { auto_send: 0 },
    });
    // A configured send level without actor acceptance remains capped; the
    // server context must not bypass the real category/graduation policy.
    expect(body.config.emailTypeCounts.auto_draft).toBeGreaterThan(0);
    expect(body.milestones.ladder).toContainEqual({
      position: 8,
      status: "in_training",
      persistent: true,
    });
    expect(body.milestones.ladder).toContainEqual({
      position: 9,
      status: "gated",
      persistent: false,
    });
    expect(requireSupabase()).toBe(io.browserClient);
  });

  it("survives a concurrent request clearing the legacy global client", async () => {
    let resume!: () => void;
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    let paused!: () => void;
    const reached = new Promise<void>((resolve) => {
      paused = resolve;
    });
    // Pause at the first database read, before nested category lookup, so
    // this test also fails promptly on the original unscoped route.
    let first = true;
    io.serviceClient.from.mockImplementation((table: string) => {
      const query = databaseQuery(table);
      if (table !== "email_connections" || !first) return query;
      first = false;
      const then = query.then;
      query.then = async (resolve) => {
        paused();
        await gate;
        return then(resolve);
      };
      return query;
    });
    const pending = GET(request());
    await reached;
    try {
      const overlapping = await GET(request());
      expect(overlapping.status).toBe(200);
      setSupabaseOverride(null);
      expect(requireSupabase()).toBe(io.browserClient);
    } finally {
      resume();
    }
    const response = await pending;
    expect(response.status).toBe(200);
    expect((await response.json()).config.rulesCount).toBe(1);
    expect(requireSupabase()).toBe(io.browserClient);
  });

  it("keeps a nested database failure visible and releases request context", async () => {
    io.serviceClient.rpc.mockImplementation(async (name, args) =>
      name === "get_human_draft_accuracy_for_category_as_system"
        ? { data: null, error: { message: "category ledger unavailable" } }
        : readRpc(name, args)
    );
    const response = await GET(request());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "category ledger unavailable",
    });
    expect(requireSupabase()).toBe(io.browserClient);
  });

  it.each(["unauthenticated", "permission", "mailbox"])(
    "preserves the %s access gate",
    async (gate) => {
      if (gate === "unauthenticated")
        io.authenticate.mockResolvedValue(
          NextResponse.json({ error: "Unauthorized" }, { status: 401 })
        );
      if (gate === "permission") io.permission.mockResolvedValue(false);
      if (gate === "mailbox")
        io.access.mockResolvedValue({
          allowed: false,
          reason: "missing_inbox_permission",
        });
      const response = await GET(request());
      expect(response.status).toBe(gate === "unauthenticated" ? 401 : 403);
      expect(io.serviceClient.from).not.toHaveBeenCalled();
      expect(io.serviceClient.rpc).not.toHaveBeenCalled();
    }
  );
});
