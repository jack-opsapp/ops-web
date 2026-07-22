/**
 * Integration tests for /api/cron/email/projection-stuck-check.
 *
 * Covers: auth gating, the exact stuck-row predicate (meaningful,
 * unprojected, older than 5 minutes), the persistent deduped operator
 * alert, the missing-operator-env fallback, and incident resolution that
 * re-arms the dedupe key once no stuck rows remain.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const rpcMock = vi.fn();
const fromMock = vi.fn();

interface CapturedEventsQuery {
  eqs: Array<[string, unknown]>;
  lts: Array<[string, unknown]>;
  limits: number[];
}

interface CapturedNotificationsUpdate {
  payload: Record<string, unknown> | null;
  eqs: Array<[string, unknown]>;
  isCalls: Array<[string, unknown]>;
}

const eventsQuery: CapturedEventsQuery = { eqs: [], lts: [], limits: [] };
const notificationsUpdate: CapturedNotificationsUpdate = {
  payload: null,
  eqs: [],
  isCalls: [],
};
let stuckRowsResponse: { data: unknown; error: { message: string } | null } = {
  data: [],
  error: null,
};

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({ rpc: rpcMock, from: fromMock }),
}));

import { GET } from "@/app/api/cron/email/projection-stuck-check/route";

function buildRequest(authHeader?: string): NextRequest {
  const headers = new Headers();
  if (authHeader) headers.set("authorization", authHeader);
  return new NextRequest(
    new URL("https://example.com/api/cron/email/projection-stuck-check"),
    { headers }
  );
}

function buildEventsBuilder() {
  const builder = {
    select: () => builder,
    eq: (column: string, value: unknown) => {
      eventsQuery.eqs.push([column, value]);
      return builder;
    },
    lt: (column: string, value: unknown) => {
      eventsQuery.lts.push([column, value]);
      return builder;
    },
    order: () => builder,
    limit: (count: number) => {
      eventsQuery.limits.push(count);
      return Promise.resolve(stuckRowsResponse);
    },
  };
  return builder;
}

function buildNotificationsBuilder() {
  const builder = {
    update: (payload: Record<string, unknown>) => {
      notificationsUpdate.payload = payload;
      return builder;
    },
    eq: (column: string, value: unknown) => {
      notificationsUpdate.eqs.push([column, value]);
      return builder;
    },
    is: (column: string, value: unknown) => {
      notificationsUpdate.isCalls.push([column, value]);
      return builder;
    },
    select: () =>
      Promise.resolve({ data: [{ id: "resolved-1" }], error: null }),
  };
  return builder;
}

beforeEach(() => {
  vi.clearAllMocks();
  eventsQuery.eqs.length = 0;
  eventsQuery.lts.length = 0;
  eventsQuery.limits.length = 0;
  notificationsUpdate.payload = null;
  notificationsUpdate.eqs.length = 0;
  notificationsUpdate.isCalls.length = 0;
  stuckRowsResponse = { data: [], error: null };
  process.env.CRON_SECRET = "test-secret";
  process.env.PMF_OPERATOR_USER_ID = "operator-user";
  process.env.PMF_OPERATOR_COMPANY_ID = "operator-company";
  // The route now issues two kinds of RPC: apply_opportunity_correspondence_event
  // (auto-repair) and create_notification_if_new_with_identity (alert). Default
  // both to success; individual tests override the apply branch as needed.
  rpcMock.mockImplementation((name: string) =>
    name === "apply_opportunity_correspondence_event"
      ? Promise.resolve({ data: [{ correspondence_count: 1 }], error: null })
      : Promise.resolve({
          data: [{ notification_id: "notif-1", created: true }],
          error: null,
        })
  );
  fromMock.mockImplementation((table: string) =>
    table === "opportunity_correspondence_events"
      ? buildEventsBuilder()
      : buildNotificationsBuilder()
  );
});

describe("projection-stuck-check cron", () => {
  it("rejects requests without the cron bearer secret", async () => {
    const unauthenticated = await GET(buildRequest());
    expect(unauthenticated.status).toBe(401);
    const wrongSecret = await GET(buildRequest("Bearer wrong"));
    expect(wrongSecret.status).toBe(401);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("scans exactly the outage predicate: meaningful, unprojected, older than 5 minutes", async () => {
    const before = Date.now();
    await GET(buildRequest("Bearer test-secret"));
    expect(eventsQuery.eqs).toContainEqual(["is_meaningful", true]);
    expect(eventsQuery.eqs).toContainEqual([
      "opportunity_projection_applied",
      false,
    ]);
    expect(eventsQuery.lts).toHaveLength(1);
    const [column, thresholdIso] = eventsQuery.lts[0];
    expect(column).toBe("created_at");
    const threshold = Date.parse(thresholdIso as string);
    expect(before - threshold).toBeGreaterThanOrEqual(5 * 60 * 1000 - 50);
    expect(before - threshold).toBeLessThan(5 * 60 * 1000 + 5_000);
  });

  it("fires one persistent deduped operator alert when rows are stuck", async () => {
    stuckRowsResponse = {
      data: [
        {
          id: "evt-1",
          company_id: "co-1",
          opportunity_id: "opp-1",
          created_at: new Date(Date.now() - 47 * 60_000).toISOString(),
        },
        {
          id: "evt-2",
          company_id: "co-1",
          opportunity_id: "opp-2",
          created_at: new Date(Date.now() - 6 * 60_000).toISOString(),
        },
      ],
      error: null,
    };

    const response = await GET(buildRequest("Bearer test-secret"));
    const body = await response.json();

    expect(rpcMock).toHaveBeenCalledTimes(1);
    const [rpcName, rpcArgs] = rpcMock.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(rpcName).toBe("create_notification_if_new_with_identity");
    expect(rpcArgs.p_user_id).toBe("operator-user");
    expect(rpcArgs.p_company_id).toBe("operator-company");
    expect(rpcArgs.p_type).toBe("system_alert");
    expect(rpcArgs.p_title).toBe("CRITICAL :: EMAIL PROJECTION STUCK");
    expect(rpcArgs.p_body).toBe(
      "2 meaningful email events unprojected for over 5 minutes across 2 leads. Oldest 47m. Lifecycle writes are running without this evidence."
    );
    expect(rpcArgs.p_persistent).toBe(true);
    expect(rpcArgs.p_dedupe_key).toBe(
      "email-correspondence-projection-stuck"
    );
    expect(rpcArgs.p_action_url).toBe("/admin/email?tab=event-monitor");
    expect(rpcArgs.p_action_label).toBe("VIEW MONITOR");

    expect(body).toMatchObject({
      ok: true,
      stuck: 2,
      opportunities: 2,
      companies: 1,
      oldestAgeMinutes: 47,
      alerted: true,
    });
  });

  it("still reports counts when operator env vars are unset, without inserting", async () => {
    delete process.env.PMF_OPERATOR_USER_ID;
    stuckRowsResponse = {
      data: [
        {
          id: "evt-1",
          company_id: "co-1",
          opportunity_id: "opp-1",
          created_at: new Date(Date.now() - 10 * 60_000).toISOString(),
        },
      ],
      error: null,
    };

    const response = await GET(buildRequest("Bearer test-secret"));
    const body = await response.json();
    expect(rpcMock).not.toHaveBeenCalled();
    expect(body).toMatchObject({ ok: true, stuck: 1, alerted: false });
  });

  it("resolves the open alert and re-arms the dedupe key once no rows are stuck", async () => {
    const response = await GET(buildRequest("Bearer test-secret"));
    const body = await response.json();

    expect(rpcMock).not.toHaveBeenCalled();
    expect(notificationsUpdate.payload).toMatchObject({
      is_read: true,
      resolution_reason: "projection_recovered",
    });
    expect(typeof notificationsUpdate.payload?.resolved_at).toBe("string");
    expect(notificationsUpdate.eqs).toContainEqual([
      "dedupe_key",
      "email-correspondence-projection-stuck",
    ]);
    expect(notificationsUpdate.isCalls).toContainEqual(["resolved_at", null]);
    expect(body).toMatchObject({ ok: true, stuck: 0, resolved: 1 });
  });

  it("returns 500 when the scan itself fails", async () => {
    stuckRowsResponse = { data: null, error: { message: "boom" } };
    const response = await GET(buildRequest("Bearer test-secret"));
    expect(response.status).toBe(500);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("auto-repairs a stuck row via the apply RPC and resolves instead of alerting", async () => {
    stuckRowsResponse = {
      data: [
        {
          id: "evt-1",
          company_id: "co-1",
          opportunity_id: "opp-1",
          created_at: new Date(Date.now() - 12 * 60_000).toISOString(),
          connection_id: "conn-1",
          provider_message_id: "msg-1",
        },
      ],
      error: null,
    };

    const response = await GET(buildRequest("Bearer test-secret"));
    const body = await response.json();

    // Exactly one RPC — the idempotent apply repair, keyed on the row identity.
    expect(rpcMock).toHaveBeenCalledTimes(1);
    const [rpcName, rpcArgs] = rpcMock.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(rpcName).toBe("apply_opportunity_correspondence_event");
    expect(rpcArgs).toEqual({
      p_company_id: "co-1",
      p_opportunity_id: "opp-1",
      p_connection_id: "conn-1",
      p_provider_message_id: "msg-1",
    });
    // No operator alert fired — the backlog drained itself.
    expect(
      rpcMock.mock.calls.some(
        ([name]) => name === "create_notification_if_new_with_identity"
      )
    ).toBe(false);
    // Fully drained → the resolution branch runs and re-arms the dedupe key.
    expect(notificationsUpdate.payload).toMatchObject({
      is_read: true,
      resolution_reason: "projection_recovered",
    });
    expect(body).toMatchObject({
      ok: true,
      stuck: 0,
      repaired: 1,
      resolved: 1,
    });
  });

  it("still alerts on the un-repaired remainder and names the repaired count", async () => {
    stuckRowsResponse = {
      data: [
        {
          id: "evt-ok",
          company_id: "co-1",
          opportunity_id: "opp-1",
          created_at: new Date(Date.now() - 30 * 60_000).toISOString(),
          connection_id: "conn-1",
          provider_message_id: "msg-ok",
        },
        {
          id: "evt-fail",
          company_id: "co-1",
          opportunity_id: "opp-2",
          created_at: new Date(Date.now() - 20 * 60_000).toISOString(),
          connection_id: "conn-1",
          provider_message_id: "msg-fail",
        },
      ],
      error: null,
    };
    rpcMock.mockImplementation(
      (name: string, args: Record<string, unknown>) => {
        if (name === "apply_opportunity_correspondence_event") {
          return args.p_provider_message_id === "msg-fail"
            ? Promise.resolve({ data: null, error: { message: "boom" } })
            : Promise.resolve({
                data: [{ correspondence_count: 1 }],
                error: null,
              });
        }
        return Promise.resolve({
          data: [{ notification_id: "notif-1", created: true }],
          error: null,
        });
      }
    );

    const response = await GET(buildRequest("Bearer test-secret"));
    const body = await response.json();

    // Two repair attempts (one ok, one failed), then one operator alert for the
    // row that could not self-heal.
    const applyCalls = rpcMock.mock.calls.filter(
      ([name]) => name === "apply_opportunity_correspondence_event"
    );
    expect(applyCalls).toHaveLength(2);
    const alertCall = rpcMock.mock.calls.find(
      ([name]) => name === "create_notification_if_new_with_identity"
    ) as [string, Record<string, unknown>] | undefined;
    expect(alertCall).toBeDefined();
    expect(alertCall?.[1].p_body).toBe(
      "1 meaningful email event unprojected for over 5 minutes across 1 lead. Oldest 20m. Auto-repaired 1 this run. Lifecycle writes are running without this evidence."
    );
    expect(body).toMatchObject({
      ok: true,
      stuck: 1,
      repaired: 1,
      alerted: true,
    });
  });

  it("does not attempt repair for rows lacking a connection or message id", async () => {
    stuckRowsResponse = {
      data: [
        {
          id: "evt-1",
          company_id: "co-1",
          opportunity_id: "opp-1",
          created_at: new Date(Date.now() - 15 * 60_000).toISOString(),
          connection_id: null,
          provider_message_id: null,
        },
      ],
      error: null,
    };

    const response = await GET(buildRequest("Bearer test-secret"));
    const body = await response.json();

    // Un-repairable rows skip the apply RPC entirely and alert as before.
    expect(
      rpcMock.mock.calls.some(
        ([name]) => name === "apply_opportunity_correspondence_event"
      )
    ).toBe(false);
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock.mock.calls[0][0]).toBe(
      "create_notification_if_new_with_identity"
    );
    expect(body).toMatchObject({
      ok: true,
      stuck: 1,
      repaired: 0,
      alerted: true,
    });
  });
});
