import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  buildFilter: vi.fn(),
  from: vi.fn(),
  operations: [] as Array<{
    table: string;
    name: string;
    args: unknown[];
  }>,
  resolveActor: vi.fn(),
  resolveListAccess: vi.fn(),
  weekRows: [] as Array<Record<string, unknown>>,
  activityRows: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/email/email-route-auth", () => ({
  resolveEmailRouteActor: state.resolveActor,
}));

vi.mock("@/lib/email/email-opportunity-access", () => ({
  buildEmailThreadListAuthorizationFilter: state.buildFilter,
  resolveEmailInboxListAccess: state.resolveListAccess,
}));

function makeQuery(table: string) {
  const query: Record<string, unknown> = {};
  const localOperations: Array<{ name: string; args: unknown[] }> = [];
  for (const name of ["select", "eq", "is", "gt", "gte", "in", "or", "order"]) {
    query[name] = (...args: unknown[]) => {
      state.operations.push({ table, name, args });
      localOperations.push({ name, args });
      return query;
    };
  }
  query.then = (
    resolve: (value: { data: unknown[]; error: null }) => unknown
  ) => {
    const data =
      table === "activities"
        ? state.activityRows
        : localOperations.some((operation) => operation.name === "gte")
          ? state.weekRows
          : [];
    return Promise.resolve({ data, error: null }).then(resolve);
  };
  return query;
}

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({
    from: (table: string) => {
      state.from(table);
      return makeQuery(table);
    },
  }),
}));

const actor = { userId: "user-1", companyId: "company-1" } as const;
const listAccess = {
  allowed: true,
  actor,
  inboxScope: "assigned",
  pipelineScope: "assigned",
  ownPersonalConnectionIds: [],
  assignedOpportunityIds: ["opportunity-assigned"],
  usedLegacyPipelineManage: false,
  usedLegacyInboxViewCompany: false,
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  state.operations = [];
  state.weekRows = [];
  state.activityRows = [];
  state.resolveActor.mockResolvedValue({ ok: true, actor });
  state.resolveListAccess.mockResolvedValue(listAccess);
  state.buildFilter.mockReturnValue({
    empty: false,
    or: "opportunity_id.in.(opportunity-assigned)",
  });
});

describe("assigned inbox dashboard widget authorization", () => {
  it("fails closed before reading metrics when inbox access is denied", async () => {
    state.resolveListAccess.mockResolvedValue({
      allowed: false,
      reason: "missing_inbox_permission",
    });
    const { GET } = await import("@/app/api/inbox/widgets/leads/route");

    const response = await GET(
      new NextRequest("https://ops.test/api/inbox/widgets/leads")
    );

    expect(response.status).toBe(403);
    expect(state.from).not.toHaveBeenCalled();
  });

  it("applies the assigned opportunity union to both thread metric queries", async () => {
    const { GET } = await import("@/app/api/inbox/widgets/leads/route");

    const response = await GET(
      new NextRequest("https://ops.test/api/inbox/widgets/leads")
    );

    expect(response.status).toBe(200);
    const threadAuthorizationOps = state.operations.filter(
      (operation) =>
        operation.table === "email_threads" &&
        operation.name === "or" &&
        operation.args[0] === "opportunity_id.in.(opportunity-assigned)"
    );
    expect(threadAuthorizationOps).toHaveLength(2);
  });

  it("keys response metrics by mailbox connection plus provider thread", async () => {
    state.weekRows = [
      {
        id: "thread-a",
        connection_id: "connection-a",
        provider_thread_id: "provider-thread-shared",
        first_message_at: new Date().toISOString(),
      },
      {
        id: "thread-b",
        connection_id: "connection-b",
        provider_thread_id: "provider-thread-shared",
        first_message_at: new Date().toISOString(),
      },
    ];
    state.activityRows = [
      {
        email_connection_id: "connection-a",
        email_thread_id: "provider-thread-shared",
        direction: "inbound",
        created_at: "2026-07-15T10:00:00.000Z",
      },
      {
        email_connection_id: "connection-a",
        email_thread_id: "provider-thread-shared",
        direction: "outbound",
        created_at: "2026-07-15T10:10:00.000Z",
      },
      {
        email_connection_id: "connection-b",
        email_thread_id: "provider-thread-shared",
        direction: "inbound",
        created_at: "2026-07-15T11:00:00.000Z",
      },
      {
        email_connection_id: "connection-b",
        email_thread_id: "provider-thread-shared",
        direction: "outbound",
        created_at: "2026-07-15T11:30:00.000Z",
      },
    ];
    const { GET } = await import("@/app/api/inbox/widgets/leads/route");

    const response = await GET(
      new NextRequest("https://ops.test/api/inbox/widgets/leads")
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.medianResponseSeconds).toBe(1200);
    const activityConnectionFilters = state.operations.filter(
      (operation) =>
        operation.table === "activities" &&
        operation.name === "eq" &&
        operation.args[0] === "email_connection_id"
    );
    expect(activityConnectionFilters.map((operation) => operation.args[1])).toEqual(
      expect.arrayContaining(["connection-a", "connection-b"])
    );
  });
});
