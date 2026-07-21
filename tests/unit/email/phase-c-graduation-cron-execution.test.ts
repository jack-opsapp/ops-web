import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  categoryGetMock,
  categoryGraduationMock,
  checkDraftFeedbackMock,
  checkSyncMock,
  rpcMock,
} = vi.hoisted(() => ({
  categoryGetMock: vi.fn(),
  categoryGraduationMock: vi.fn(),
  checkDraftFeedbackMock: vi.fn(),
  checkSyncMock: vi.fn(),
  rpcMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({ rpc: rpcMock }),
}));

vi.mock("@/lib/supabase/helpers", () => ({
  runWithSupabase: async (_client: unknown, work: () => Promise<unknown>) =>
    work(),
}));

vi.mock("@/lib/api/services/phase-c-category-autonomy-service", () => ({
  PhaseCCategoryAutonomy: {
    get: categoryGetMock,
    isGraduated: categoryGraduationMock,
  },
}));

vi.mock("@/lib/api/services/autonomy-milestone-service", () => ({
  AutonomyMilestoneService: {
    checkMilestonesAfterSync: checkSyncMock,
    checkMilestonesAfterDraftFeedback: checkDraftFeedbackMock,
  },
}));

import { GET } from "@/app/api/cron/phase-c-graduation-check/route";
import { EMAIL_THREAD_CATEGORIES } from "@/lib/types/email-thread";

const scope = {
  company_id: "00000000-0000-4000-8000-000000000001",
  connection_id: "00000000-0000-4000-8000-000000000002",
  actor_user_id: "00000000-0000-4000-8000-000000000003",
  lease_token: "00000000-0000-4000-8000-000000000004",
};

function request(): NextRequest {
  return new NextRequest("https://ops.test/api/cron/phase-c-graduation-check", {
    headers: { authorization: "Bearer cron-test-secret" },
  });
}

describe("Phase C graduation cron execution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "cron-test-secret";
    categoryGetMock.mockResolvedValue(
      Object.fromEntries(
        EMAIL_THREAD_CATEGORIES.map((category) => [
          category,
          category === "CUSTOMER" ? "auto_draft" : "off",
        ])
      )
    );
    categoryGraduationMock.mockResolvedValue({
      ready: true,
      approvalRate: 0.95,
      sampleSize: 20,
    });
    checkSyncMock.mockResolvedValue(undefined);
    checkDraftFeedbackMock.mockResolvedValue(undefined);
  });

  it("executes a ready category from a durable lease and records the real calibration action", async () => {
    rpcMock.mockImplementation(async (name: string) => {
      if (name === "claim_phase_c_graduation_actor_scopes_as_system") {
        return { data: [scope], error: null };
      }
      if (name === "record_phase_c_graduation_prompt_as_system") {
        return { data: true, error: null };
      }
      if (name === "complete_phase_c_graduation_scope_check_as_system") {
        return { data: null, error: null };
      }
      throw new Error(`Unexpected RPC ${name}`);
    });

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, actorScopes: 1, notified: 1 });
    expect(rpcMock).toHaveBeenCalledWith(
      "record_phase_c_graduation_prompt_as_system",
      expect.objectContaining({
        p_company_id: scope.company_id,
        p_connection_id: scope.connection_id,
        p_actor_user_id: scope.actor_user_id,
        p_category: "CUSTOMER",
        p_title: "Auto-send is ready for customer email",
        p_body: "95% approved across 20 drafts. Review and turn it on.",
        p_action_url: `/agent/auto-send?connectionId=${scope.connection_id}&category=CUSTOMER`,
        p_action_label: "Review auto-send",
      })
    );
    expect(rpcMock).toHaveBeenCalledWith(
      "complete_phase_c_graduation_scope_check_as_system",
      expect.objectContaining({
        p_lease_token: scope.lease_token,
        p_succeeded: true,
      })
    );
  });

  it("retries completion once and returns non-success when durable bookkeeping remains unavailable", async () => {
    rpcMock.mockImplementation(async (name: string) => {
      if (name === "claim_phase_c_graduation_actor_scopes_as_system") {
        return { data: [scope], error: null };
      }
      if (name === "record_phase_c_graduation_prompt_as_system") {
        return { data: false, error: null };
      }
      if (name === "complete_phase_c_graduation_scope_check_as_system") {
        return { data: null, error: { message: "bookkeeping unavailable" } };
      }
      throw new Error(`Unexpected RPC ${name}`);
    });

    const response = await GET(request());
    const body = await response.json();
    const completionCalls = rpcMock.mock.calls.filter(
      ([name]) => name === "complete_phase_c_graduation_scope_check_as_system"
    );

    expect(completionCalls).toHaveLength(2);
    expect(response.status).toBe(500);
    expect(body).toMatchObject({ ok: false, bookkeepingFailed: 1 });
  });
});
