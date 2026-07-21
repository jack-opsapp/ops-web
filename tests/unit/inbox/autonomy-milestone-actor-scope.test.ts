import { beforeEach, describe, expect, it, vi } from "vitest";

const requireSupabaseMock = vi.fn();
const getProfileMock = vi.fn();
const getConfidenceMock = vi.fn();
const getHumanDraftAccuracyMock = vi.fn();
const notificationCreateMock = vi.fn();
const categoryAutonomyGetMock = vi.fn();

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: () => requireSupabaseMock(),
}));

vi.mock("@/lib/api/services/writing-profile-service", () => ({
  WritingProfileService: {
    getProfile: (...args: unknown[]) => getProfileMock(...args),
    getConfidence: (...args: unknown[]) => getConfidenceMock(...args),
  },
}));

vi.mock("@/lib/api/services/phase-c-draft-accuracy-service", () => ({
  getHumanDraftAccuracy: (...args: unknown[]) =>
    getHumanDraftAccuracyMock(...args),
}));

vi.mock("@/lib/api/services/notification-service", () => ({
  NotificationService: {
    create: (...args: unknown[]) => notificationCreateMock(...args),
  },
}));

vi.mock("@/lib/api/services/phase-c-category-autonomy-service", () => ({
  PhaseCCategoryAutonomy: {
    get: (...args: unknown[]) => categoryAutonomyGetMock(...args),
  },
}));

vi.mock("@/lib/api/services/company-managers", () => ({
  getCompanyManagerUserIds: vi.fn().mockResolvedValue([]),
}));

import { AutonomyMilestoneService } from "@/lib/api/services/autonomy-milestone-service";

interface MilestoneRow {
  draft_available_shown: boolean;
  auto_draft_suggested: boolean;
  auto_send_suggested: boolean;
  comms_wizard_ready_shown: boolean;
}

const EMPTY_MILESTONES: MilestoneRow = {
  draft_available_shown: false,
  auto_draft_suggested: false,
  auto_send_suggested: false,
  comms_wizard_ready_shown: false,
};

function makeClient(input: {
  milestonesByUser?: Record<string, MilestoneRow>;
  milestoneReadError?: string;
  companyReadError?: string;
  profileReadError?: string;
  profileEmailsAnalyzed?: number;
  connection?: {
    type: "company" | "individual";
    user_id: string | null;
  };
  autoSendSettings?: Record<string, unknown>;
}) {
  const calls: Array<{ table?: string; method: string; args: unknown[] }> = [];

  const client = {
    from(table: string) {
      calls.push({ method: "from", args: [table] });
      const filters = new Map<string, unknown>();
      const builder: Record<string, unknown> = {};

      Object.assign(builder, {
        select: (...args: unknown[]) => {
          calls.push({ table, method: "select", args });
          return builder;
        },
        eq: (column: string, value: unknown) => {
          filters.set(column, value);
          calls.push({ table, method: "eq", args: [column, value] });
          return builder;
        },
        update: (...args: unknown[]) => {
          calls.push({ table, method: "update", args });
          return builder;
        },
        order: (...args: unknown[]) => {
          calls.push({ table, method: "order", args });
          return builder;
        },
        limit: (...args: unknown[]) => {
          calls.push({ table, method: "limit", args });
          return builder;
        },
        single: async () => {
          if (table !== "email_connections") {
            return { data: null, error: { message: "unexpected single" } };
          }
          return {
            data: {
              type: input.connection?.type ?? "company",
              user_id: input.connection?.user_id ?? "legacy-connector",
              auto_send_settings: {
                auto_draft_enabled: true,
                enabled: false,
                category_autonomy: {},
                // This legacy shared flag belongs to an unknown actor and
                // must not suppress the exact actor row below.
                milestones: { auto_send_suggested: true },
                ...input.autoSendSettings,
              },
            },
            error: null,
          };
        },
        maybeSingle: async () => {
          if (table === "agent_writing_profiles") {
            return input.profileReadError
              ? { data: null, error: { message: input.profileReadError } }
              : {
                  data: {
                    emails_analyzed: input.profileEmailsAnalyzed ?? 25,
                  },
                  error: null,
                };
          }
          if (table === "companies") {
            return input.companyReadError
              ? { data: null, error: { message: input.companyReadError } }
              : {
                  data: {
                    client_comms_settings: {
                      comms_wizard_completed_at: null,
                      comms_wizard_version: 0,
                    },
                  },
                  error: null,
                };
          }
          if (table !== "email_autonomy_milestones") {
            return { data: null, error: { message: "unexpected maybeSingle" } };
          }
          if (input.milestoneReadError) {
            return {
              data: null,
              error: { message: input.milestoneReadError },
            };
          }
          const userId = String(filters.get("user_id") ?? "");
          return {
            data: input.milestonesByUser?.[userId] ?? null,
            error: null,
          };
        },
      });

      return builder;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ method: "rpc", args: [name, args] });
      return { data: true, error: null };
    },
  };

  return { client, calls };
}

beforeEach(() => {
  requireSupabaseMock.mockReset();
  getProfileMock.mockReset().mockResolvedValue({ emails_analyzed: 25 });
  getConfidenceMock.mockReset().mockReturnValue(0.3);
  getHumanDraftAccuracyMock.mockReset().mockResolvedValue({
    sampleSize: 20,
    approvedWithoutChanges: 19,
    errors: 1,
    approvalRate: 0.95,
    errorRate: 0.05,
  });
  notificationCreateMock.mockReset().mockResolvedValue(undefined);
  categoryAutonomyGetMock.mockReset().mockResolvedValue({
    CUSTOMER: "off",
    PLATFORM_BID: "off",
    VENDOR: "off",
    INTERNAL: "off",
    FINANCIAL: "off",
    LEGAL: "off",
    SYSTEM: "off",
    MARKETING: "off",
    OTHER: "off",
  });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("actor-scoped Phase C autonomy milestones", () => {
  it("does not create the retired mailbox-wide auto-send prompt for any actor", async () => {
    const fake = makeClient({
      milestonesByUser: {
        "actor-a": { ...EMPTY_MILESTONES, auto_send_suggested: true },
        "actor-b": { ...EMPTY_MILESTONES },
      },
    });
    requireSupabaseMock.mockReturnValue(fake.client);

    await AutonomyMilestoneService.checkMilestonesAfterDraftFeedback(
      "company-1",
      "actor-a",
      "connection-1"
    );
    await AutonomyMilestoneService.checkMilestonesAfterDraftFeedback(
      "company-1",
      "actor-b",
      "connection-1"
    );

    const milestoneRpcs = fake.calls.filter(
      (call) =>
        call.method === "rpc" &&
        call.args[0] === "record_email_autonomy_milestone"
    );
    expect(milestoneRpcs).toHaveLength(0);
    expect(notificationCreateMock).not.toHaveBeenCalled();
    expect(
      fake.calls.some(
        (call) => call.table === "email_connections" && call.method === "update"
      )
    ).toBe(false);
  });

  it("reads milestone state by exact company, connection, and OPS actor UUID", async () => {
    const fake = makeClient({
      milestonesByUser: { "actor-b": { ...EMPTY_MILESTONES } },
    });
    requireSupabaseMock.mockReturnValue(fake.client);

    const result = await AutonomyMilestoneService.getAutonomyLevel(
      "company-1",
      "actor-b",
      "connection-1"
    );

    expect(result.milestones).toEqual(EMPTY_MILESTONES);
    expect(categoryAutonomyGetMock).toHaveBeenCalledWith(
      "connection-1",
      "actor-b"
    );
    expect(fake.calls).toEqual(
      expect.arrayContaining([
        {
          table: "email_autonomy_milestones",
          method: "eq",
          args: ["company_id", "company-1"],
        },
        {
          table: "email_autonomy_milestones",
          method: "eq",
          args: ["connection_id", "connection-1"],
        },
        {
          table: "email_autonomy_milestones",
          method: "eq",
          args: ["user_id", "actor-b"],
        },
      ])
    );
  });

  it("fails closed when the actor milestone ledger cannot be read", async () => {
    const fake = makeClient({
      milestoneReadError: "milestone ledger unavailable",
    });
    requireSupabaseMock.mockReturnValue(fake.client);

    await expect(
      AutonomyMilestoneService.checkMilestonesAfterDraftFeedback(
        "company-1",
        "actor-b",
        "connection-1"
      )
    ).resolves.toBeUndefined();

    expect(fake.calls.some((call) => call.method === "rpc")).toBe(false);
    expect(console.error).toHaveBeenCalledWith(
      "[autonomy-milestones] Check after draft feedback failed (non-fatal):",
      expect.objectContaining({ message: "milestone ledger unavailable" })
    );
  });

  it("rethrows milestone failures for the durable graduation retry sweep", async () => {
    const fake = makeClient({
      milestoneReadError: "milestone ledger unavailable",
    });
    requireSupabaseMock.mockReturnValue(fake.client);

    await expect(
      AutonomyMilestoneService.checkMilestonesAfterDraftFeedback(
        "company-1",
        "actor-b",
        "connection-1",
        { throwOnError: true }
      )
    ).rejects.toThrow("milestone ledger unavailable");
  });

  it("leaves exact category readiness to the category graduation path", async () => {
    const fake = makeClient({
      milestonesByUser: { "actor-b": { ...EMPTY_MILESTONES } },
    });
    requireSupabaseMock.mockReturnValue(fake.client);

    await AutonomyMilestoneService.checkMilestonesAfterDraftFeedback(
      "company-1",
      "actor-b",
      "connection-1"
    );

    expect(getHumanDraftAccuracyMock).not.toHaveBeenCalled();
    expect(
      fake.calls.some(
        (call) =>
          call.method === "rpc" &&
          call.args[0] === "record_email_autonomy_milestone" &&
          (call.args[1] as Record<string, unknown>).p_milestone ===
            "auto_send_suggested"
      )
    ).toBe(false);
  });

  it("never writes milestones for a different user's individual mailbox", async () => {
    const fake = makeClient({
      connection: { type: "individual", user_id: "actor-a" },
      milestonesByUser: { "actor-b": { ...EMPTY_MILESTONES } },
    });
    requireSupabaseMock.mockReturnValue(fake.client);

    await expect(
      AutonomyMilestoneService.checkMilestonesAfterSync(
        "company-1",
        "actor-b",
        "connection-1",
        { throwOnError: true }
      )
    ).rejects.toThrow("Email connection unavailable for actor");

    expect(fake.calls.some((call) => call.method === "rpc")).toBe(false);
    expect(getProfileMock).not.toHaveBeenCalled();
  });

  it("never turns mailbox-wide draft accuracy into auto-send readiness", async () => {
    const fake = makeClient({
      profileEmailsAnalyzed: 300,
      autoSendSettings: {
        enabled: true,
        category_autonomy: { "primary:CUSTOMER": "auto_send" },
      },
      milestonesByUser: { "actor-b": { ...EMPTY_MILESTONES } },
    });
    requireSupabaseMock.mockReturnValue(fake.client);
    getProfileMock.mockResolvedValue({ emails_analyzed: 300 });
    getConfidenceMock.mockReturnValue(0.9);
    getHumanDraftAccuracyMock.mockResolvedValue({
      sampleSize: 20,
      approvedWithoutChanges: 20,
      errors: 0,
      approvalRate: 1,
      errorRate: 0,
    });

    const result = await AutonomyMilestoneService.getAutonomyLevel(
      "company-1",
      "actor-b",
      "connection-1"
    );

    expect(result.level).toBe(3);
  });

  it("propagates communications prerequisite read failures in strict retry mode", async () => {
    const fake = makeClient({
      companyReadError: "communications settings unavailable",
      milestonesByUser: {
        "actor-b": {
          ...EMPTY_MILESTONES,
          draft_available_shown: true,
          auto_draft_suggested: true,
        },
      },
    });
    requireSupabaseMock.mockReturnValue(fake.client);
    getProfileMock.mockResolvedValue({ emails_analyzed: 300 });
    getConfidenceMock.mockReturnValue(0.9);

    await expect(
      AutonomyMilestoneService.checkMilestonesAfterSync(
        "company-1",
        "actor-b",
        "connection-1",
        { throwOnError: true }
      )
    ).rejects.toThrow("communications settings unavailable");
  });

  it("propagates writing-profile prerequisite read failures in strict retry mode", async () => {
    const fake = makeClient({
      profileReadError: "writing profile unavailable",
      milestonesByUser: { "actor-b": { ...EMPTY_MILESTONES } },
    });
    requireSupabaseMock.mockReturnValue(fake.client);

    await expect(
      AutonomyMilestoneService.checkMilestonesAfterSync(
        "company-1",
        "actor-b",
        "connection-1",
        { throwOnError: true }
      )
    ).rejects.toThrow("writing profile unavailable");
  });
});
