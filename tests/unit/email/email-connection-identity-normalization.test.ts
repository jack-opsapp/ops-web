import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { reconcilePersonalMailboxMock } = vi.hoisted(() => ({
  reconcilePersonalMailboxMock: vi.fn(),
}));

vi.mock(
  "@/lib/api/services/personal-email-connection-lifecycle-service",
  () => ({
    PersonalEmailConnectionLifecycleService: {
      reconcile: reconcilePersonalMailboxMock,
    },
  })
);

import { EmailConnectionService } from "@/lib/api/services/email-connection-service";
import { GmailService } from "@/lib/api/services/gmail-service";
import { persistEmailOAuthConnection } from "@/lib/email/email-oauth-connection";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { GmailConnectionType } from "@/lib/types/pipeline";

const COMPANY_ID = "00000000-0000-4000-8000-000000000001";
const ACTOR_ID = "00000000-0000-4000-8000-000000000002";
const CONNECTION_ID = "00000000-0000-4000-8000-000000000003";
const NOW = "2026-07-15T12:00:00.000Z";

function connectionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CONNECTION_ID,
    company_id: COMPANY_ID,
    provider: "gmail",
    type: "company",
    user_id: "legacy-company-connector",
    email: "shared@ops.test",
    access_token: "access-token",
    refresh_token: "refresh-token",
    expires_at: NOW,
    history_id: null,
    sync_enabled: true,
    last_synced_at: null,
    sync_interval_minutes: 60,
    sync_filters: {},
    history_recovery_anchor: null,
    history_recovery_page_token: null,
    history_recovery_target_token: null,
    webhook_subscription_id: null,
    webhook_expires_at: null,
    webhook_client_state_hash: null,
    ops_label_id: null,
    ai_review_enabled: false,
    ai_memory_enabled: false,
    status: "active",
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function connectionServiceClient(row = connectionRow()) {
  let inserted: Record<string, unknown> | null = null;
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    single: vi.fn(async () => ({
      data: inserted ? { ...row, ...inserted } : row,
      error: null,
    })),
    insert: vi.fn((payload: Record<string, unknown>) => {
      inserted = payload;
      return query;
    }),
  };
  return {
    client: { from: vi.fn(() => query) } as unknown as SupabaseClient,
    getInserted: () => inserted,
  };
}

function oauthClient(existingRow: Record<string, unknown> | null) {
  const writes: {
    update: Record<string, unknown> | null;
    upsert: Record<string, unknown> | null;
  } = { update: null, upsert: null };

  const from = vi.fn(() => {
    let mode: "select" | "update" = "select";
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      update: vi.fn((payload: Record<string, unknown>) => {
        mode = "update";
        writes.update = payload;
        return query;
      }),
      maybeSingle: vi.fn(async () => ({
        data: mode === "update" ? { id: CONNECTION_ID } : existingRow,
        error: null,
      })),
      upsert: vi.fn(async (payload: Record<string, unknown>) => {
        writes.upsert = payload;
        return { error: null };
      }),
    };
    return query;
  });

  return {
    client: { from } as unknown as SupabaseClient,
    writes,
  };
}

describe("email connection OPS-user identity normalization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reconcilePersonalMailboxMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    setSupabaseOverride(null);
  });

  it("never exposes a legacy company connector user_id as an OPS owner", async () => {
    const { client } = connectionServiceClient();
    setSupabaseOverride(client);

    const connection =
      await EmailConnectionService.getConnection(CONNECTION_ID);

    expect(connection).not.toBeNull();
    expect(connection?.type).toBe("company");
    expect(connection?.userId).toBeNull();
  });

  it("preserves the exact owner only for an individual mailbox", async () => {
    const { client } = connectionServiceClient(
      connectionRow({ type: "individual", user_id: ACTOR_ID })
    );
    setSupabaseOverride(client);

    const connection =
      await EmailConnectionService.getConnection(CONNECTION_ID);

    expect(connection?.userId).toBe(ACTOR_ID);
  });

  it("stores a null owner when application code creates a company mailbox", async () => {
    const { client, getInserted } = connectionServiceClient();
    setSupabaseOverride(client);

    await EmailConnectionService.createConnection({
      companyId: COMPANY_ID,
      provider: "gmail",
      type: "company",
      userId: ACTOR_ID,
      email: "shared@ops.test",
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresAt: new Date(NOW),
    });

    expect(getInserted()).toMatchObject({ type: "company", user_id: null });
  });

  it("keeps the legacy Gmail wrapper from persisting a company connector owner", async () => {
    const { client, getInserted } = connectionServiceClient();
    setSupabaseOverride(client);

    const connection = await GmailService.createConnection({
      companyId: COMPANY_ID,
      type: GmailConnectionType.Company,
      userId: ACTOR_ID,
      email: "shared@ops.test",
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresAt: new Date(NOW),
    });

    expect(getInserted()).toMatchObject({ type: "company", user_id: null });
    expect(connection.userId).toBeNull();
  });

  it("stores the exact owner for an individual OAuth connection", async () => {
    const { client, writes } = oauthClient(null);

    await persistEmailOAuthConnection(client, {
      state: {
        companyId: COMPANY_ID,
        userId: ACTOR_ID,
        type: "individual",
        source: "wizard",
      },
      provider: "gmail",
      email: "operator@ops.test",
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresAt: NOW,
    });

    expect(writes.upsert).toMatchObject({
      type: "individual",
      user_id: ACTOR_ID,
    });
  });

  it("stores a null owner for a company OAuth connection", async () => {
    const { client, writes } = oauthClient(null);

    await persistEmailOAuthConnection(client, {
      state: {
        companyId: COMPANY_ID,
        userId: ACTOR_ID,
        type: "company",
        source: "wizard",
      },
      provider: "gmail",
      email: "shared@ops.test",
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresAt: NOW,
    });

    expect(writes.upsert).toMatchObject({ type: "company", user_id: null });
  });

  it("scrubs a legacy company connector identity during OAuth reconnect", async () => {
    const { client, writes } = oauthClient({
      id: CONNECTION_ID,
      email: "shared@ops.test",
      auto_send_settings: {},
      refresh_token: "refresh-token",
      status: "needs_reconnect",
      sync_enabled: true,
    });

    await persistEmailOAuthConnection(client, {
      state: {
        companyId: COMPANY_ID,
        userId: ACTOR_ID,
        type: "company",
        source: "alert",
        connectionId: CONNECTION_ID,
        expectedEmail: "shared@ops.test",
      },
      provider: "gmail",
      email: "shared@ops.test",
      accessToken: "new-access-token",
      refreshToken: "new-refresh-token",
      expiresAt: NOW,
    });

    expect(writes.update).toMatchObject({ user_id: null, status: "active" });
    expect(reconcilePersonalMailboxMock).not.toHaveBeenCalled();
  });
});
