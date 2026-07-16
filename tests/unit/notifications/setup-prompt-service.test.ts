import { beforeEach, describe, expect, it, vi } from "vitest";

const { checkPermissionMock, createTrustedMock } = vi.hoisted(() => ({
  checkPermissionMock: vi.fn(),
  createTrustedMock: vi.fn(),
}));

vi.mock("@/lib/supabase/check-permission", () => ({
  checkPermissionById: (...args: unknown[]) => checkPermissionMock(...args),
}));

vi.mock("@/lib/notifications/server-notification-service", () => ({
  createTrustedNotifications: (...args: unknown[]) =>
    createTrustedMock(...args),
}));

interface FakeDbState {
  companySize: string | null;
  connections: Array<{
    id: string;
    type: string;
    user_id: string | null;
    status?: string;
    sync_enabled?: boolean;
  }>;
  activeTeamCount: number;
  queryErrorTable?: string;
  updates: Array<{
    patch: Record<string, unknown>;
    filters: Array<[string, unknown]>;
  }>;
}

function makeDb(state: FakeDbState) {
  return {
    from(table: string) {
      let mode: "select" | "update" = "select";
      let patch: Record<string, unknown> = {};
      const filters: Array<[string, unknown]> = [];
      const builder = {
        select: () => builder,
        update: (value: Record<string, unknown>) => {
          mode = "update";
          patch = value;
          return builder;
        },
        eq: (column: string, value: unknown) => {
          filters.push([column, value]);
          return builder;
        },
        is: (column: string, value: unknown) => {
          filters.push([column, value]);
          return builder;
        },
        maybeSingle: async () => ({
          data:
            table === "companies" ? { company_size: state.companySize } : null,
          error:
            state.queryErrorTable === table
              ? { message: `${table} unavailable` }
              : null,
        }),
        then: (
          resolve: (value: {
            data: unknown;
            count?: number;
            error: { message: string } | null;
          }) => unknown,
          reject?: (error: unknown) => unknown
        ) => {
          let result: {
            data: unknown;
            count?: number;
            error: { message: string } | null;
          };
          if (mode === "update") {
            state.updates.push({ patch, filters: [...filters] });
            result = { data: null, error: null };
          } else if (table === "email_connections") {
            result = { data: state.connections, error: null };
          } else if (table === "users") {
            result = {
              data: null,
              count: state.activeTeamCount,
              error: null,
            };
          } else {
            result = { data: null, error: null };
          }
          if (state.queryErrorTable === table) {
            result = {
              data: null,
              count: null as never,
              error: { message: `${table} unavailable` },
            };
          }
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

const actor = {
  userId: "11111111-1111-4111-8111-111111111111",
  companyId: "22222222-2222-4222-8222-222222222222",
  name: "Operator One",
};

function state(
  overrides: Partial<Omit<FakeDbState, "updates">> = {}
): FakeDbState {
  return {
    companySize: "2-5",
    connections: [],
    activeTeamCount: 1,
    updates: [],
    ...overrides,
  };
}

async function loadService() {
  return import("@/lib/notifications/setup-prompt-service");
}

describe("setup prompt service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkPermissionMock.mockResolvedValue(true);
    createTrustedMock.mockResolvedValue({
      attempted: 1,
      errors: 0,
      createdRecipientIds: [actor.userId],
    });
  });

  it("creates only the two deterministic self prompts from current server state", async () => {
    const dbState = state();
    const { syncSetupPromptNotifications } = await loadService();

    const result = await syncSetupPromptNotifications({
      actor,
      db: makeDb(dbState) as never,
    });

    expect(checkPermissionMock).toHaveBeenCalledWith(
      actor.userId,
      "settings.integrations",
      "all"
    );
    expect(checkPermissionMock).toHaveBeenCalledWith(
      actor.userId,
      "team.manage",
      "all"
    );
    expect(createTrustedMock).toHaveBeenCalledTimes(2);
    expect(createTrustedMock).toHaveBeenNthCalledWith(
      1,
      {
        companyId: actor.companyId,
        recipientUserIds: [actor.userId],
        type: "setup_prompt",
        title: "Connect Gmail",
        body: "Automate your pipeline by connecting your inbox.",
        actionUrl: "/settings?tab=integrations",
        actionLabel: "Set up",
        dedupeKey: `setup-prompt:connect-email:${actor.userId}`,
      },
      expect.anything()
    );
    expect(createTrustedMock).toHaveBeenNthCalledWith(
      2,
      {
        companyId: actor.companyId,
        recipientUserIds: [actor.userId],
        type: "setup_prompt",
        title: "Invite your team",
        body: "Get your crew on OPS so everyone stays in sync.",
        actionUrl: "/settings?tab=team&action=invite",
        actionLabel: "Invite",
        dedupeKey: `setup-prompt:invite-team:${actor.userId}`,
      },
      expect.anything()
    );
    expect(result).toEqual({ created: 2, resolved: 0 });
    expect(dbState.updates).toEqual([]);
  });

  it("does not treat another user's individual mailbox as the actor's connection", async () => {
    const dbState = state({
      connections: [
        {
          id: "personal-2",
          type: "individual",
          user_id: "other-user",
          status: "active",
          sync_enabled: true,
        },
      ],
      activeTeamCount: 2,
    });
    const { syncSetupPromptNotifications } = await loadService();

    await syncSetupPromptNotifications({
      actor,
      db: makeDb(dbState) as never,
    });

    expect(createTrustedMock).toHaveBeenCalledTimes(1);
    expect(createTrustedMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Connect Gmail" }),
      expect.anything()
    );
  });

  it("does not treat a disconnected mailbox as a current connection", async () => {
    const dbState = state({
      connections: [
        {
          id: "company-disconnected",
          type: "company",
          user_id: null,
          status: "disconnected",
          sync_enabled: false,
        },
      ],
      activeTeamCount: 2,
    });
    const { syncSetupPromptNotifications } = await loadService();

    await syncSetupPromptNotifications({
      actor,
      db: makeDb(dbState) as never,
    });

    expect(createTrustedMock).toHaveBeenCalledTimes(1);
    expect(createTrustedMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Connect Gmail" }),
      expect.anything()
    );
  });

  it("counts only sync-enabled active or setup-incomplete mailboxes as usable", async () => {
    const dbState = state({
      connections: [
        {
          id: "company-error",
          type: "company",
          user_id: null,
          status: "error",
          sync_enabled: true,
        },
        {
          id: "company-disabled",
          type: "company",
          user_id: null,
          status: "active",
          sync_enabled: false,
        },
      ],
      activeTeamCount: 2,
    });
    const { syncSetupPromptNotifications } = await loadService();

    await syncSetupPromptNotifications({
      actor,
      db: makeDb(dbState) as never,
    });

    expect(createTrustedMock).toHaveBeenCalledTimes(1);
    expect(createTrustedMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Connect Gmail" }),
      expect.anything()
    );
  });

  it("resolves stale self prompts when permissions or setup conditions no longer apply", async () => {
    const dbState = state({
      connections: [
        {
          id: "company-1",
          type: "company",
          user_id: null,
          status: "active",
          sync_enabled: true,
        },
      ],
      activeTeamCount: 2,
    });
    checkPermissionMock.mockResolvedValue(false);
    const { syncSetupPromptNotifications } = await loadService();

    const result = await syncSetupPromptNotifications({
      actor,
      db: makeDb(dbState) as never,
    });

    expect(createTrustedMock).not.toHaveBeenCalled();
    expect(dbState.updates).toHaveLength(2);
    expect(dbState.updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          patch: expect.objectContaining({
            is_read: true,
            resolved_at: expect.any(String),
          }),
          filters: expect.arrayContaining([
            ["company_id", actor.companyId],
            ["user_id", actor.userId],
            ["type", "setup_prompt"],
            ["dedupe_key", `setup-prompt:connect-email:${actor.userId}`],
            ["is_read", false],
          ]),
        }),
        expect.objectContaining({
          filters: expect.arrayContaining([
            ["company_id", actor.companyId],
            ["user_id", actor.userId],
            ["type", "setup_prompt"],
            ["dedupe_key", `setup-prompt:invite-team:${actor.userId}`],
            ["is_read", false],
          ]),
        }),
      ])
    );
    expect(result).toEqual({ created: 0, resolved: 2 });
  });

  it("fails closed before creating or resolving when setup state is unavailable", async () => {
    const dbState = state({ queryErrorTable: "email_connections" });
    const { syncSetupPromptNotifications } = await loadService();

    await expect(
      syncSetupPromptNotifications({
        actor,
        db: makeDb(dbState) as never,
      })
    ).rejects.toThrow("Failed to load setup prompt state");
    expect(createTrustedMock).not.toHaveBeenCalled();
    expect(dbState.updates).toEqual([]);
  });
});
