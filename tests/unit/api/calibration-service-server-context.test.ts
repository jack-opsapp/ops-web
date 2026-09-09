// @vitest-environment node

/**
 * CALIBRATION — the service binds its own database context (049cb3f5).
 *
 * CalibrationService reaches nested services that resolve their client through
 * `requireSupabase()` — PhaseCCategoryAutonomy.get and, through
 * PhaseCCategoryAutonomy.isGraduated, getHumanDraftAccuracy. On the server, an
 * unbound `requireSupabase()` falls through to the Firebase-backed browser
 * client, which holds no user: PostgREST answers 42501 and the caller 500s.
 *
 * Binding at the route was not enough — a second route, a cron, or a new caller
 * would have to remember. So every exported read binds itself, and this test
 * holds that line: `CALLS` is typed against the service's own keys, so a method
 * added later fails to compile until it is registered here, and then fails at
 * runtime unless it is actually bound.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const io = vi.hoisted(() => ({
  browserClient: { from: vi.fn(), rpc: vi.fn() },
  serviceClient: { from: vi.fn(), rpc: vi.fn() },
  boundDuringRead: [] as unknown[],
}));

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseClient: () => io.browserClient,
}));
vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => io.serviceClient,
}));

import { CalibrationService } from "@/lib/api/services/calibration-service";
import { requireSupabase, setSupabaseOverride } from "@/lib/supabase/helpers";
import type { AllowedEmailInboxListAccess } from "@/lib/email/email-opportunity-access";

const companyId = "company-1";
const userId = "actor-1";
const connectionId = "company-mailbox";
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
    { id: "job-1", status: "complete", created_at: NOW, updated_at: NOW, result: {} },
  ],
  agent_actions: [
    { id: "act-1", action_type: "send_email", status: "executed", created_at: NOW },
  ],
  agent_writing_profiles: [{ emails_analyzed: 40 }],
  users: [{ preferences: {} }],
  admin_feature_overrides: [{ enabled: true }],
  email_autonomy_milestones: [{}],
  email_connections: [
    {
      id: connectionId,
      type: "company",
      user_id: null,
      status: "active",
      auto_send_settings: { category_autonomy: {} },
      sync_filters: { rules: [{ id: "rule-1" }] },
    },
  ],
};

function databaseQuery(table: string) {
  const rows = ROWS[table];
  if (!rows) throw new Error(`Unexpected table: ${table}`);
  // Record the client a nested `requireSupabase()` would resolve right now.
  io.boundDuringRead.push(requireSupabase());

  let single = false;
  const result = () => ({
    data: single ? (rows[0] ?? null) : rows,
    error: null,
    count: rows.length,
  });
  const query = {
    select: () => query,
    update: () => query,
    eq: () => query,
    in: () => query,
    is: () => query,
    or: () => query,
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

async function databaseRpc(name: string) {
  io.boundDuringRead.push(requireSupabase());
  if (
    name === "get_phase_c_actor_category_acceptances_as_system" ||
    name === "get_human_draft_accuracy_for_category_as_system"
  ) {
    return { data: [], error: null };
  }
  throw new Error(`Unexpected RPC: ${name}`);
}

const access: AllowedEmailInboxListAccess = {
  allowed: true,
  actor: { userId, companyId },
  inboxScope: "all",
  pipelineScope: "all",
  ownPersonalConnectionIds: [],
  assignedOpportunityIds: [],
  usedLegacyPipelineManage: false,
  usedLegacyInboxViewCompany: false,
};

/**
 * One invocation per exported read. Typed against the service's own keys, so
 * this map cannot fall behind the service without failing to compile.
 */
const CALLS: Record<keyof typeof CalibrationService, () => Promise<unknown>> = {
  getDeckState: () => CalibrationService.getDeckState(companyId, userId, access),
  getFirstRunState: () => CalibrationService.getFirstRunState(companyId, userId),
  dismissFirstRun: () => CalibrationService.dismissFirstRun(userId),
  getRecentEvents: () => CalibrationService.getRecentEvents(companyId, userId, 5),
  getActivityLog: () =>
    CalibrationService.getActivityLog(companyId, userId, {
      types: "all",
      timeRange: "day",
    }),
  getInputsState: () => CalibrationService.getInputsState(companyId, userId),
  getCorpusState: () => CalibrationService.getCorpusState(companyId, userId),
  getConfigState: () =>
    CalibrationService.getConfigState(companyId, userId, "all"),
  getActivityState: () => CalibrationService.getActivityState(companyId, userId),
  getMilestonesState: () =>
    CalibrationService.getMilestonesState(companyId, userId, "all"),
};

beforeEach(() => {
  vi.clearAllMocks();
  setSupabaseOverride(null);
  io.boundDuringRead.length = 0;
  io.serviceClient.from.mockImplementation(databaseQuery);
  io.serviceClient.rpc.mockImplementation(databaseRpc);
  io.browserClient.from.mockImplementation(() => {
    throw new Error("permission denied for table email_connections");
  });
  io.browserClient.rpc.mockImplementation(() => {
    throw new Error("permission denied for function");
  });
});

describe("CalibrationService server database context", () => {
  it.each(Object.keys(CALLS))(
    "%s runs every read against the service client",
    async (name) => {
      await CALLS[name as keyof typeof CALLS]();

      expect(io.boundDuringRead.length).toBeGreaterThan(0);
      for (const client of io.boundDuringRead) {
        expect(client).toBe(io.serviceClient);
      }
      expect(io.browserClient.from).not.toHaveBeenCalled();
      expect(io.browserClient.rpc).not.toHaveBeenCalled();
      // The binding is per-call: it must not leak past the read.
      expect(requireSupabase()).toBe(io.browserClient);
    }
  );

  it("reaches the nested category and graduation reads it is meant to protect", async () => {
    await CalibrationService.getMilestonesState(companyId, userId, "all");
    const rpcNames = io.serviceClient.rpc.mock.calls.map(([name]) => name);
    expect(rpcNames).toContain("get_phase_c_actor_category_acceptances_as_system");
    expect(rpcNames).toContain("get_human_draft_accuracy_for_category_as_system");
  });
});
