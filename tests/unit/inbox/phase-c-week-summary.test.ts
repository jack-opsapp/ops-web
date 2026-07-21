import { describe, expect, it } from "vitest";

import { getPhaseCWeekSummary } from "@/lib/api/services/phase-c-week-summary-service";
import type { AllowedEmailInboxListAccess } from "@/lib/email/email-opportunity-access";

type Call = { table: string; method: string; args: unknown[] };

function makeClient(
  tableResults: Record<string, { data: unknown; count?: number }>
) {
  const calls: Call[] = [];
  function from(table: string) {
    const result = tableResults[table] ?? { data: [] };
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "gte", "in", "is", "or"] as const) {
      builder[method] = (...args: unknown[]) => {
        calls.push({ table, method, args });
        return builder;
      };
    }
    builder.then = (
      resolve: (value: {
        data: unknown;
        count: number | null;
        error: null;
      }) => unknown
    ) =>
      Promise.resolve({
        data: result.data,
        count: result.count ?? null,
        error: null,
      }).then(resolve);
    return builder;
  }
  async function rpc(name: string, args: Record<string, unknown>) {
    calls.push({ table: "rpc", method: name, args: [args] });
    return { data: [], error: null };
  }
  return { client: { from, rpc }, calls };
}

const assignedAccess: AllowedEmailInboxListAccess = {
  allowed: true,
  actor: { userId: "actor-1", companyId: "company-1" },
  inboxScope: "assigned",
  pipelineScope: "assigned",
  ownPersonalConnectionIds: ["personal-1"],
  assignedOpportunityIds: ["opp-1"],
  usedLegacyPipelineManage: false,
  usedLegacyInboxViewCompany: false,
};

describe("Phase C weekly summary authorization", () => {
  it("scopes assigned users to their actor outcomes and inbox union before aggregation", async () => {
    const fake = makeClient({
      pending_auto_sends: { data: null, count: 2 },
      ai_draft_history: { data: null, count: 3 },
      email_threads: {
        data: [
          {
            connection_id: "shared-1",
            primary_category: "CUSTOMER",
            labels: [],
          },
          {
            connection_id: "personal-1",
            primary_category: "OTHER",
            labels: ["URGENT"],
          },
        ],
      },
      email_connections: {
        data: [
          {
            id: "shared-1",
            type: "company",
            user_id: null,
            auto_send_settings: {
              category_autonomy: { "primary:CUSTOMER": "auto_draft" },
            },
          },
          {
            id: "other-personal",
            type: "individual",
            user_id: "actor-2",
            auto_send_settings: {
              category_autonomy: { "primary:VENDOR": "auto_send" },
            },
          },
        ],
      },
    });

    const result = await getPhaseCWeekSummary({
      actor: assignedAccess.actor,
      access: assignedAccess,
      supabase: fake.client as never,
      now: new Date("2026-07-15T12:00:00.000Z"),
    });

    expect(result.auto).toBe(2);
    expect(result.draft).toBe(3);
    expect(result.surfaced).toBe(2);
    expect(result.autonomyMap.CUSTOMER).toBe("auto_draft");
    expect(result.autonomyMap.VENDOR).toBe("off");

    expect(fake.calls).toContainEqual({
      table: "pending_auto_sends",
      method: "eq",
      args: ["actor_user_id", "actor-1"],
    });
    expect(fake.calls).toContainEqual({
      table: "ai_draft_history",
      method: "eq",
      args: ["user_id", "actor-1"],
    });
    expect(fake.calls).toContainEqual({
      table: "email_threads",
      method: "or",
      args: [
        "opportunity_id.in.(opp-1),and(connection_id.in.(personal-1),opportunity_id.is.null)",
      ],
    });
    expect(fake.calls).toContainEqual({
      table: "email_connections",
      method: "in",
      args: ["id", ["personal-1", "shared-1"]],
    });
    expect(fake.calls).toContainEqual({
      table: "email_connections",
      method: "or",
      args: ["type.eq.company,and(type.eq.individual,user_id.eq.actor-1)"],
    });
    expect(fake.calls).toContainEqual({
      table: "rpc",
      method: "get_phase_c_actor_category_acceptances_as_system",
      args: [
        {
          p_connection_id: "shared-1",
          p_actor_user_id: "actor-1",
        },
      ],
    });
  });

  it("keeps personal calibration outcomes actor-scoped even for all/all viewers", async () => {
    const allAccess: AllowedEmailInboxListAccess = {
      ...assignedAccess,
      inboxScope: "all",
      pipelineScope: "all",
      ownPersonalConnectionIds: [],
      assignedOpportunityIds: [],
    };
    const fake = makeClient({
      pending_auto_sends: { data: null, count: 5 },
      ai_draft_history: { data: null, count: 7 },
      email_threads: { data: [] },
      email_connections: { data: [] },
    });

    await getPhaseCWeekSummary({
      actor: allAccess.actor,
      access: allAccess,
      supabase: fake.client as never,
      now: new Date("2026-07-15T12:00:00.000Z"),
    });

    expect(fake.calls).toContainEqual({
      table: "pending_auto_sends",
      method: "eq",
      args: ["actor_user_id", "actor-1"],
    });
    expect(fake.calls).toContainEqual({
      table: "ai_draft_history",
      method: "eq",
      args: ["user_id", "actor-1"],
    });
    expect(fake.calls).toContainEqual({
      table: "email_connections",
      method: "or",
      args: ["type.eq.company,and(type.eq.individual,user_id.eq.actor-1)"],
    });
  });
});
