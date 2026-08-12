/**
 * persistEmailOAuthConnection — provider credential persistence across the
 * three OAuth sources.
 *
 *   wizard   → upsert by provider/mailbox identity (setup_incomplete)
 *   alert    → bound-row reconnect (status → active, sync re-enabled)
 *   calendar → bound-row scope upgrade: tokens + granted_scopes only. It must
 *              never demote an active connection to setup_incomplete and never
 *              touch sync_enabled / auto_send_settings — the mailbox keeps
 *              running exactly as configured while the grant widens.
 *
 * Every source persists `granted_scopes` when the token response reported a
 * scope list, so the row always states what the stored refresh token can do.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { persistEmailOAuthConnection } from "@/lib/email/email-oauth-connection";

vi.mock("@/lib/api/services/mailbox-draft-helpers", () => ({
  defaultAutoSendSettings: () => ({ mode: "off" }),
}));

const reconcileMock = vi.hoisted(() => vi.fn());
vi.mock(
  "@/lib/api/services/personal-email-connection-lifecycle-service",
  () => ({
    PersonalEmailConnectionLifecycleService: {
      reconcile: reconcileMock,
    },
  })
);

const GMAIL_SCOPE = "https://mail.google.com/";
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";

interface ScriptedResponse {
  data: unknown;
  error: { message: string } | null;
}

let selectResponses: ScriptedResponse[] = [];
let updateResponses: ScriptedResponse[] = [];
let upsertResponse: ScriptedResponse;
let updatePayloads: Array<Record<string, unknown>>;
let upsertPayloads: Array<Record<string, unknown>>;
let updateFilters: Array<Array<[string, unknown]>>;

function makeSupabase() {
  return {
    from: vi.fn(() => makeQuery()),
  } as never;
}

function makeQuery() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q: any = {};
  let mode: "select" | "update" | "upsert" = "select";
  let filters: Array<[string, unknown]> = [];
  q.select = () => q;
  q.eq = (column: string, value: unknown) => {
    filters.push([column, value]);
    return q;
  };
  q.update = (payload: Record<string, unknown>) => {
    mode = "update";
    filters = [];
    updatePayloads.push(payload);
    updateFilters.push(filters);
    return q;
  };
  q.upsert = (payload: Record<string, unknown>, options: unknown) => {
    mode = "upsert";
    upsertPayloads.push({ ...payload, __options: options });
    return Promise.resolve(upsertResponse);
  };
  q.maybeSingle = () => {
    const response =
      mode === "update"
        ? (updateResponses.shift() ?? { data: { id: "connection-1" }, error: null })
        : (selectResponses.shift() ?? { data: null, error: null });
    return Promise.resolve(response);
  };
  return q;
}

beforeEach(() => {
  selectResponses = [];
  updateResponses = [];
  upsertResponse = { data: null, error: null };
  updatePayloads = [];
  upsertPayloads = [];
  updateFilters = [];
  reconcileMock.mockReset();
});

const wizardState = {
  companyId: "company-1",
  userId: "user-1",
  type: "company" as const,
  source: "wizard" as const,
  returnTo: null,
};

const calendarState = {
  companyId: "company-1",
  userId: "user-1",
  type: "company" as const,
  source: "calendar" as const,
  connectionId: "connection-1",
  expectedEmail: "ops@example.com",
  returnTo: "/settings?section=email",
};

describe("persistEmailOAuthConnection — wizard", () => {
  it("persists the reported grant scopes on the provider upsert", async () => {
    selectResponses = [{ data: null, error: null }];

    await persistEmailOAuthConnection(makeSupabase(), {
      state: wizardState,
      provider: "gmail",
      email: "ops@example.com",
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiresAt: "2026-08-12T12:00:00.000Z",
      grantedScopes: [GMAIL_SCOPE, CALENDAR_SCOPE],
    });

    expect(upsertPayloads).toHaveLength(1);
    expect(upsertPayloads[0]).toMatchObject({
      status: "setup_incomplete",
      granted_scopes: [GMAIL_SCOPE, CALENDAR_SCOPE],
    });
  });

  it("leaves granted_scopes untouched when the provider omitted them", async () => {
    selectResponses = [{ data: null, error: null }];

    await persistEmailOAuthConnection(makeSupabase(), {
      state: wizardState,
      provider: "gmail",
      email: "ops@example.com",
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiresAt: "2026-08-12T12:00:00.000Z",
    });

    expect(upsertPayloads).toHaveLength(1);
    expect(upsertPayloads[0]).not.toHaveProperty("granted_scopes");
  });
});

describe("persistEmailOAuthConnection — alert reconnect", () => {
  const alertState = {
    companyId: "company-1",
    userId: "user-1",
    type: "company" as const,
    source: "alert" as const,
    connectionId: "connection-1",
    expectedEmail: "ops@example.com",
    returnTo: null,
  };

  it("persists the reported grant scopes on the bound-row update", async () => {
    selectResponses = [
      {
        data: {
          id: "connection-1",
          email: "ops@example.com",
          auto_send_settings: null,
          refresh_token: "refresh-old",
          status: "needs_reconnect",
          sync_enabled: true,
        },
        error: null,
      },
    ];

    await persistEmailOAuthConnection(makeSupabase(), {
      state: alertState,
      provider: "gmail",
      email: "ops@example.com",
      accessToken: "access-2",
      refreshToken: null,
      expiresAt: "2026-08-12T12:00:00.000Z",
      grantedScopes: [GMAIL_SCOPE],
    });

    expect(updatePayloads).toHaveLength(1);
    expect(updatePayloads[0]).toMatchObject({
      status: "active",
      refresh_token: "refresh-old",
      granted_scopes: [GMAIL_SCOPE],
    });
  });
});

describe("persistEmailOAuthConnection — calendar scope upgrade", () => {
  function scriptBoundRow(overrides: Record<string, unknown> = {}) {
    selectResponses = [
      {
        data: {
          id: "connection-1",
          email: "ops@example.com",
          auto_send_settings: { mode: "assisted" },
          refresh_token: "refresh-old",
          status: "active",
          sync_enabled: false,
          ...overrides,
        },
        error: null,
      },
    ];
  }

  it("updates tokens and scopes without touching sync or setup state", async () => {
    scriptBoundRow();

    await persistEmailOAuthConnection(makeSupabase(), {
      state: calendarState,
      provider: "gmail",
      email: "ops@example.com",
      accessToken: "access-3",
      refreshToken: "refresh-new",
      expiresAt: "2026-08-12T12:00:00.000Z",
      grantedScopes: [GMAIL_SCOPE, CALENDAR_SCOPE],
    });

    expect(updatePayloads).toHaveLength(1);
    const payload = updatePayloads[0];
    expect(payload).toMatchObject({
      access_token: "access-3",
      refresh_token: "refresh-new",
      expires_at: "2026-08-12T12:00:00.000Z",
      granted_scopes: [GMAIL_SCOPE, CALENDAR_SCOPE],
      status: "active",
    });
    // The mailbox keeps running exactly as configured: a scope upgrade must
    // never resurrect paused sync, reset auto-send, or reassign ownership.
    expect(payload).not.toHaveProperty("sync_enabled");
    expect(payload).not.toHaveProperty("auto_send_settings");
    expect(payload).not.toHaveProperty("user_id");
  });

  it("keeps the stored refresh token when Google omits a new one", async () => {
    scriptBoundRow();

    await persistEmailOAuthConnection(makeSupabase(), {
      state: calendarState,
      provider: "gmail",
      email: "ops@example.com",
      accessToken: "access-3",
      refreshToken: null,
      expiresAt: "2026-08-12T12:00:00.000Z",
      grantedScopes: [GMAIL_SCOPE, CALENDAR_SCOPE],
    });

    expect(updatePayloads[0]).toMatchObject({ refresh_token: "refresh-old" });
  });

  it("heals a needs_reconnect row to active on a successful upgrade", async () => {
    scriptBoundRow({ status: "needs_reconnect" });

    await persistEmailOAuthConnection(makeSupabase(), {
      state: calendarState,
      provider: "gmail",
      email: "ops@example.com",
      accessToken: "access-3",
      refreshToken: "refresh-new",
      expiresAt: "2026-08-12T12:00:00.000Z",
      grantedScopes: [GMAIL_SCOPE, CALENDAR_SCOPE],
    });

    expect(updatePayloads[0]).toMatchObject({ status: "active" });
  });

  it("rejects an upgrade when the operator consented the wrong mailbox", async () => {
    scriptBoundRow();

    await expect(
      persistEmailOAuthConnection(makeSupabase(), {
        state: calendarState,
        provider: "gmail",
        email: "someone-else@example.com",
        accessToken: "access-3",
        refreshToken: "refresh-new",
        expiresAt: "2026-08-12T12:00:00.000Z",
        grantedScopes: [GMAIL_SCOPE, CALENDAR_SCOPE],
      })
    ).rejects.toThrow("Provider mailbox does not match bound OAuth state");
    expect(updatePayloads).toHaveLength(0);
  });

  it("rejects an upgrade when the bound row vanished or left upgradeable state", async () => {
    selectResponses = [{ data: null, error: null }];
    await expect(
      persistEmailOAuthConnection(makeSupabase(), {
        state: calendarState,
        provider: "gmail",
        email: "ops@example.com",
        accessToken: "access-3",
        refreshToken: "refresh-new",
        expiresAt: "2026-08-12T12:00:00.000Z",
        grantedScopes: [GMAIL_SCOPE, CALENDAR_SCOPE],
      })
    ).rejects.toThrow("Bound email connection no longer matches OAuth state");

    scriptBoundRow({ status: "setup_incomplete" });
    await expect(
      persistEmailOAuthConnection(makeSupabase(), {
        state: calendarState,
        provider: "gmail",
        email: "ops@example.com",
        accessToken: "access-3",
        refreshToken: "refresh-new",
        expiresAt: "2026-08-12T12:00:00.000Z",
        grantedScopes: [GMAIL_SCOPE, CALENDAR_SCOPE],
      })
    ).rejects.toThrow("Bound email connection is not upgradeable");
    expect(updatePayloads).toHaveLength(0);
  });

  it("fails closed when the bound row changed between read and write", async () => {
    scriptBoundRow();
    updateResponses = [{ data: null, error: null }];

    await expect(
      persistEmailOAuthConnection(makeSupabase(), {
        state: calendarState,
        provider: "gmail",
        email: "ops@example.com",
        accessToken: "access-3",
        refreshToken: "refresh-new",
        expiresAt: "2026-08-12T12:00:00.000Z",
        grantedScopes: [GMAIL_SCOPE, CALENDAR_SCOPE],
      })
    ).rejects.toThrow("Bound email connection changed during OAuth callback");
  });
});
