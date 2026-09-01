import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { decideWebhookHighWaterDrain } from "@/lib/api/services/sync-engine";

/**
 * Bug 86c758b1 — the webhook high-water gap.
 *
 * A Gmail push notification advertises the mailbox historyId at the moment mail
 * landed. When that push arrives while the per-connection mailbox lease is held,
 * its fire-and-forget manual sync is rejected ("Sync already in progress") and
 * the advertised position was, before this change, dropped on the floor: the
 * route only console.logged it. The mailbox then sat at the in-flight pass's
 * lower historyId until the next cron interval — up to an hour of invisible mail.
 *
 * The fix has two halves:
 *   1. the webhook durably records the advertised historyId as a monotone
 *      high-water mark on the connection, and
 *   2. the sync engine, at the end of a successful Gmail incremental pass,
 *      drains toward that high-water before it may report completion.
 *
 * `decideWebhookHighWaterDrain` is the pure decision at the centre of half 2.
 */

describe("decideWebhookHighWaterDrain — pure decision", () => {
  it("requests a drain pass when the webhook high-water is ahead of the pass", () => {
    expect(
      decideWebhookHighWaterDrain({
        passHistoryId: "3341840",
        highWaterHistoryId: "3341999",
        passesRun: 0,
      })
    ).toEqual({ action: "drain" });
  });

  it("completes when the pass already reached the high-water", () => {
    expect(
      decideWebhookHighWaterDrain({
        passHistoryId: "3341999",
        highWaterHistoryId: "3341999",
        passesRun: 0,
      })
    ).toEqual({ action: "complete" });
  });

  it("completes when the pass advanced past the high-water", () => {
    expect(
      decideWebhookHighWaterDrain({
        passHistoryId: "3342000",
        highWaterHistoryId: "3341999",
        passesRun: 0,
      })
    ).toEqual({ action: "complete" });
  });

  it("compares by magnitude, not lexicographically", () => {
    // "9999999" > "10000000" under a naive string compare. Gmail historyIds
    // cross digit-width boundaries constantly, so a lexicographic compare would
    // silently declare the mailbox caught up and re-open the exact gap.
    expect(
      decideWebhookHighWaterDrain({
        passHistoryId: "9999999",
        highWaterHistoryId: "10000000",
        passesRun: 0,
      })
    ).toEqual({ action: "drain" });
    expect(
      decideWebhookHighWaterDrain({
        passHistoryId: "10000000",
        highWaterHistoryId: "9999999",
        passesRun: 0,
      })
    ).toEqual({ action: "complete" });
  });

  it("compares beyond 64-bit precision without rounding", () => {
    // Gmail historyIds are uint64. Number() would round these two to the same
    // float and declare the mailbox caught up.
    expect(
      decideWebhookHighWaterDrain({
        passHistoryId: "9007199254740993",
        highWaterHistoryId: "9007199254740994",
        passesRun: 0,
      })
    ).toEqual({ action: "drain" });
  });

  it("tolerates leading zeros on either side", () => {
    expect(
      decideWebhookHighWaterDrain({
        passHistoryId: "0003341840",
        highWaterHistoryId: "3341840",
        passesRun: 0,
      })
    ).toEqual({ action: "complete" });
    expect(
      decideWebhookHighWaterDrain({
        passHistoryId: "3341840",
        highWaterHistoryId: "0003341999",
        passesRun: 0,
      })
    ).toEqual({ action: "drain" });
  });

  it("keeps draining while passes remain under the cap", () => {
    expect(
      decideWebhookHighWaterDrain({
        passHistoryId: "3341840",
        highWaterHistoryId: "3341999",
        passesRun: 1,
      })
    ).toEqual({ action: "drain" });
    expect(
      decideWebhookHighWaterDrain({
        passHistoryId: "3341840",
        highWaterHistoryId: "3341999",
        passesRun: 2,
      })
    ).toEqual({ action: "drain" });
  });

  it("reports exhausted once the bounded pass budget is spent", () => {
    expect(
      decideWebhookHighWaterDrain({
        passHistoryId: "3341840",
        highWaterHistoryId: "3341999",
        passesRun: 3,
      })
    ).toEqual({ action: "exhausted" });
    expect(
      decideWebhookHighWaterDrain({
        passHistoryId: "3341840",
        highWaterHistoryId: "3341999",
        passesRun: 9,
      })
    ).toEqual({ action: "exhausted" });
  });

  it("honours an explicit cap", () => {
    expect(
      decideWebhookHighWaterDrain({
        passHistoryId: "3341840",
        highWaterHistoryId: "3341999",
        passesRun: 1,
        maxPasses: 1,
      })
    ).toEqual({ action: "exhausted" });
  });

  it("completes when no high-water has ever been recorded", () => {
    // The overwhelming majority of connections: no webhook has fired since the
    // column was added, or the mailbox has no push subscription at all.
    for (const highWaterHistoryId of [null, undefined, ""]) {
      expect(
        decideWebhookHighWaterDrain({
          passHistoryId: "3341840",
          highWaterHistoryId: highWaterHistoryId as string | null,
          passesRun: 0,
        })
      ).toEqual({ action: "complete" });
    }
  });

  it("fails open on malformed input rather than wedging the mailbox", () => {
    const malformed = [
      "not-a-number",
      "334 1840",
      "3341840.5",
      "-3341840",
      "gmail:v1:{}",
      "1e9",
      // Absurdly long digit strings are treated as malformed too: a mailbox
      // cursor must never become an unbounded comparison.
      "9".repeat(64),
    ];
    for (const value of malformed) {
      expect(
        decideWebhookHighWaterDrain({
          passHistoryId: "3341840",
          highWaterHistoryId: value,
          passesRun: 0,
        })
      ).toEqual({ action: "complete" });
      expect(
        decideWebhookHighWaterDrain({
          passHistoryId: value,
          highWaterHistoryId: "9999999999",
          passesRun: 0,
        })
      ).toEqual({ action: "complete" });
    }
  });

  it("completes when the pass produced no plain historyId", () => {
    // A structured `gmail:v1:` continuation is already continuation-pending on
    // its own; the drain must not second-guess it.
    expect(
      decideWebhookHighWaterDrain({
        passHistoryId: null,
        highWaterHistoryId: "3341999",
        passesRun: 0,
      })
    ).toEqual({ action: "complete" });
  });
});

/**
 * The helper is only worth anything if the engine actually consults it. These
 * assertions read the engine as source text — the established convention for
 * sync-engine surface guards in this suite (see
 * sync-engine-pending-lead-scan-sweep.test.ts), which never executes the 250KB
 * engine.
 */
describe("sync-engine webhook high-water drain — wiring", () => {
  const source = readFileSync(
    join(process.cwd(), "src/lib/api/services/sync-engine.ts"),
    "utf8"
  );

  it("reads the persisted high-water for the connection under sync", () => {
    expect(source).toContain("webhook_history_high_water");
  });

  it("drains through the provider's own incremental pagination", () => {
    const drainBody = source.slice(
      source.indexOf("// ── Webhook high-water drain"),
      source.indexOf("// Discovery buckets are not authoritative direction.")
    );
    expect(drainBody.length).toBeGreaterThan(0);
    expect(drainBody).toContain("decideWebhookHighWaterDrain");
    // Reuses the same bounded fetch the main pass uses — no second pagination
    // implementation to keep in step.
    expect(drainBody).toContain("provider.fetchNewEmailsSince(");
    // Gmail only, and never on top of the expired-history recovery walk, which
    // owns its own checkpoint semantics.
    expect(drainBody).toContain('provider.providerType === "gmail"');
    expect(drainBody).toContain("!mailboxReconciliation");
  });

  it("blocks completion while the drain is still behind the high-water", () => {
    const checkpointStart = source.indexOf(
      "const persistSyncCheckpoint = async () => {"
    );
    expect(checkpointStart).toBeGreaterThan(-1);
    const checkpointBody = source.slice(
      checkpointStart,
      source.indexOf(
        "if (rawInboxEmails.length === 0 && rawSentEmails.length === 0) {",
        checkpointStart
      )
    );
    // Compared with line wrapping collapsed — the formatter owns where these
    // expressions break, and the assertion is about the logic, not the layout.
    const flattened = checkpointBody.replace(/\s+/g, " ");
    expect(flattened).toContain(
      "isEmailSyncContinuationPending(historyId) || webhookDrainPending"
    );
    // A mailbox with known-unfetched mail is not a complete provider snapshot.
    expect(flattened).toContain(
      "!isProviderSyncContinuationPending(historyId) && !webhookDrainPending"
    );
    // Completion stays the sole property of a fully drained pass.
    const completionIndex = checkpointBody.indexOf(
      "persistEmailConnectionSyncCompletion"
    );
    const pendingReturnIndex = checkpointBody.indexOf(
      "persistEmailConnectionSyncCheckpoint"
    );
    expect(pendingReturnIndex).toBeGreaterThan(-1);
    expect(completionIndex).toBeGreaterThan(pendingReturnIndex);
  });
});

// ── Gmail webhook route ────────────────────────────────────────────────────

const PUSH_AUDIENCE = "https://ops.test/api/integrations/email/webhook/gmail";
const PUSH_SERVICE_ACCOUNT = "pubsub@ops.test.iam.gserviceaccount.com";

const { getServiceRoleClientMock } = vi.hoisted(() => {
  // The route reads its Pub/Sub audience and service account into module
  // constants at import time and fails closed without them, so they have to be
  // in the environment before the static import below is evaluated.
  process.env.GOOGLE_PUBSUB_PUSH_AUDIENCE =
    "https://ops.test/api/integrations/email/webhook/gmail";
  process.env.GOOGLE_PUBSUB_SERVICE_ACCOUNT =
    "pubsub@ops.test.iam.gserviceaccount.com";
  return { getServiceRoleClientMock: vi.fn() };
});

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: getServiceRoleClientMock,
}));

vi.mock("@/lib/utils/app-url", () => ({
  getAppUrl: () => "https://ops.test",
}));

import { POST } from "@/app/api/integrations/email/webhook/gmail/route";

function pushRequest(payload: Record<string, unknown>): NextRequest {
  return new NextRequest(PUSH_AUDIENCE, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer pubsub-oidc-token",
    },
    body: JSON.stringify({
      message: {
        data: Buffer.from(JSON.stringify(payload)).toString("base64"),
      },
    }),
  });
}

interface SupabaseDoubleOptions {
  connections?: Array<{ id: string; last_synced_at: string | null }>;
  rpcError?: { message: string } | null;
}

function supabaseDouble({
  connections = [{ id: "connection-1", last_synced_at: null }],
  rpcError = null,
}: SupabaseDoubleOptions = {}) {
  const rpc = vi.fn(async () => ({ data: null, error: rpcError }));
  return {
    rpc,
    from: vi.fn(() => {
      const query = {
        select: vi.fn(() => query),
        ilike: vi.fn(() => query),
        eq: vi.fn(() => query),
        then: (
          resolve: (value: { data: unknown; error: null }) => unknown
        ): unknown => resolve({ data: connections, error: null }),
      };
      return query;
    }),
  };
}

describe("Gmail webhook route — high-water recording", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "cron-secret";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.startsWith("https://oauth2.googleapis.com/tokeninfo")) {
          return new Response(
            JSON.stringify({
              aud: PUSH_AUDIENCE,
              email: PUSH_SERVICE_ACCOUNT,
              email_verified: "true",
              exp: String(Math.floor(Date.now() / 1000) + 600),
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        return new Response(null, { status: 200 });
      })
    );
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("records the advertised historyId as the connection's high-water", async () => {
    const supabase = supabaseDouble();
    getServiceRoleClientMock.mockReturnValue(supabase);

    const response = await POST(
      pushRequest({ emailAddress: "ops@ops.test", historyId: "3341999" })
    );

    expect(response.status).toBe(200);
    expect(supabase.rpc).toHaveBeenCalledWith(
      "record_email_webhook_high_water",
      { p_connection_id: "connection-1", p_history_id: "3341999" }
    );
  });

  it("records the high-water even when the debounce skips the sync dispatch", async () => {
    // This IS the bug: the push that arrives while a sync is in flight is the
    // one carrying the position nothing else knows about. Recording must happen
    // before — and independently of — the dispatch decision.
    const supabase = supabaseDouble({
      connections: [
        { id: "connection-1", last_synced_at: new Date().toISOString() },
      ],
    });
    getServiceRoleClientMock.mockReturnValue(supabase);

    const response = await POST(
      pushRequest({ emailAddress: "ops@ops.test", historyId: "3341999" })
    );

    expect(response.status).toBe(200);
    expect(supabase.rpc).toHaveBeenCalledWith(
      "record_email_webhook_high_water",
      { p_connection_id: "connection-1", p_history_id: "3341999" }
    );
    // Debounced: no manual-sync dispatch.
    const dispatches = (
      globalThis.fetch as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls.filter((call) =>
      String(call[0]).includes("/api/integrations/email/manual-sync")
    );
    expect(dispatches).toHaveLength(0);
  });

  it("still returns 200 and dispatches sync when the high-water write fails", async () => {
    // Recording is observability for the drain, never a gate on acking Pub/Sub.
    // A failed record must not turn into a redelivery storm.
    const supabase = supabaseDouble({
      rpcError: { message: "record_email_webhook_high_water is missing" },
    });
    getServiceRoleClientMock.mockReturnValue(supabase);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const response = await POST(
      pushRequest({ emailAddress: "ops@ops.test", historyId: "3341999" })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(consoleError).toHaveBeenCalled();
    const dispatches = (
      globalThis.fetch as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls.filter((call) =>
      String(call[0]).includes("/api/integrations/email/manual-sync")
    );
    expect(dispatches).toHaveLength(1);

    consoleError.mockRestore();
  });

  it("does not call the RPC when the push carries no historyId", async () => {
    const supabase = supabaseDouble();
    getServiceRoleClientMock.mockReturnValue(supabase);

    const response = await POST(pushRequest({ emailAddress: "ops@ops.test" }));

    expect(response.status).toBe(200);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});

// ── Sync engine drain, end to end ──────────────────────────────────────────
//
// The wiring assertions above prove the engine reads the helper; these prove
// the loop it drives. Everything the zero-mail path touches is doubled, so the
// cycle exercises the real drain code with a real provider contract: a Gmail
// pass that lands behind the recorded high-water must fetch again from its own
// returned token, and — if it is still behind when the budget runs out — must
// checkpoint rather than report the mailbox complete.

const {
  getConnectionMock,
  getProviderMock,
  acquireSyncLockMock,
  releaseSyncLockMock,
  persistCheckpointMock,
  persistCompletionMock,
  persistRecoveryCheckpointMock,
  reconcileDraftsMock,
  fetchOperatorIdentityMock,
} = vi.hoisted(() => ({
  getConnectionMock: vi.fn(),
  getProviderMock: vi.fn(),
  acquireSyncLockMock: vi.fn(),
  releaseSyncLockMock: vi.fn(),
  persistCheckpointMock: vi.fn(),
  persistCompletionMock: vi.fn(),
  persistRecoveryCheckpointMock: vi.fn(),
  reconcileDraftsMock: vi.fn(),
  fetchOperatorIdentityMock: vi.fn(),
}));

vi.mock("@/lib/api/services/email-service", () => ({
  EmailService: {
    getConnection: getConnectionMock,
    getProvider: getProviderMock,
  },
}));

vi.mock("@/lib/api/services/email-connection-sync-lock", () => ({
  acquireEmailConnectionSyncLock: acquireSyncLockMock,
  releaseEmailConnectionSyncLock: releaseSyncLockMock,
  persistEmailConnectionSyncCheckpoint: persistCheckpointMock,
  persistEmailConnectionSyncCompletion: persistCompletionMock,
  persistEmailConnectionRecoveryCheckpoint: persistRecoveryCheckpointMock,
  createEmailConnectionSyncLockRenewer: () => {
    const renew = Object.assign(async () => {}, {
      stop: async () => {},
    });
    return renew;
  },
}));

vi.mock("@/lib/api/services/draft-reconciliation", () => ({
  reconcilePendingMailboxDraftsForConnection: reconcileDraftsMock,
}));

vi.mock("@/lib/api/services/conversation-state/operator-identity", () => ({
  fetchOperatorIdentity: fetchOperatorIdentityMock,
}));

import { SyncEngine } from "@/lib/api/services/sync-engine";
import { setSupabaseOverride } from "@/lib/supabase/helpers";

function gmailConnection() {
  return {
    id: "connection-1",
    companyId: "company-1",
    userId: "user-1",
    type: "individual",
    email: "ops@ops.test",
    provider: "gmail",
    status: "active",
    syncEnabled: true,
    syncFilters: {},
    historyId: "3341840",
    lastSyncedAt: new Date("2026-08-29T09:00:00Z"),
    createdAt: new Date("2026-01-01T00:00:00Z"),
    historyRecoveryTargetToken: null,
    historyRecoveryPageToken: null,
    historyRecoveryAnchor: null,
  };
}

/** Serves the engine's high-water read; every other table read is unused on
 *  the zero-mail path. */
function highWaterSupabase(highWater: string | null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { webhook_history_high_water: highWater },
            error: null,
          }),
        }),
      }),
    }),
    rpc: async () => ({ data: null, error: null }),
  } as never;
}

describe("sync engine — draining to the webhook high-water", () => {
  beforeEach(() => {
    acquireSyncLockMock.mockResolvedValue("lock-owner-1");
    releaseSyncLockMock.mockResolvedValue(undefined);
    persistCheckpointMock.mockResolvedValue(undefined);
    persistCompletionMock.mockResolvedValue(undefined);
    reconcileDraftsMock.mockResolvedValue(undefined);
    fetchOperatorIdentityMock.mockResolvedValue({
      emails: new Set(["ops@ops.test"]),
      domains: new Set(["ops.test"]),
      phones: new Set<string>(),
      addresses: new Set<string>(),
      companyName: "OPS",
      staffMembers: [],
    });
    getConnectionMock.mockResolvedValue(gmailConnection());
  });

  afterEach(() => {
    setSupabaseOverride(null);
    vi.clearAllMocks();
  });

  it("fetches again from its own token when the pass lands behind the mark", async () => {
    setSupabaseOverride(highWaterSupabase("3341999"));
    const fetchNewEmailsSince = vi
      .fn()
      // The in-flight pass finished at 3341900 — behind the 3341999 that a push
      // advertised while this very cycle held the lease.
      .mockResolvedValueOnce({ emails: [], nextSyncToken: "3341900" })
      // One more bounded pass catches the mailbox up.
      .mockResolvedValueOnce({ emails: [], nextSyncToken: "3342010" });
    getProviderMock.mockReturnValue({
      providerType: "gmail",
      fetchNewEmailsSince,
      fetchSentEmailsSince: vi.fn(),
    });

    const result = await SyncEngine.runSync("connection-1");

    expect(result.errors).toEqual([]);
    expect(fetchNewEmailsSince).toHaveBeenCalledTimes(2);
    // The drain resumes from the token the first pass returned — never from the
    // high-water mark, which is an observation and not a cursor.
    expect(fetchNewEmailsSince).toHaveBeenNthCalledWith(1, "3341840");
    expect(fetchNewEmailsSince).toHaveBeenNthCalledWith(2, "3341900");
    // Caught up, so the cycle completes at the drained position.
    expect(result.continuationPending).toBe(false);
    expect(persistCheckpointMock).not.toHaveBeenCalled();
    expect(persistCompletionMock).toHaveBeenCalledWith(
      expect.objectContaining({ historyId: "3342010" })
    );
  });

  it("does not fetch again when the pass already reached the mark", async () => {
    setSupabaseOverride(highWaterSupabase("3341900"));
    const fetchNewEmailsSince = vi
      .fn()
      .mockResolvedValue({ emails: [], nextSyncToken: "3341900" });
    getProviderMock.mockReturnValue({
      providerType: "gmail",
      fetchNewEmailsSince,
      fetchSentEmailsSince: vi.fn(),
    });

    const result = await SyncEngine.runSync("connection-1");

    expect(fetchNewEmailsSince).toHaveBeenCalledTimes(1);
    expect(result.continuationPending).toBe(false);
    expect(persistCompletionMock).toHaveBeenCalledTimes(1);
  });

  it("checkpoints instead of completing when the drain budget runs out", async () => {
    setSupabaseOverride(highWaterSupabase("9999999"));
    // Every pass lands short of the mark, so the budget is spent.
    const fetchNewEmailsSince = vi
      .fn()
      .mockResolvedValue({ emails: [], nextSyncToken: "3341900" });
    getProviderMock.mockReturnValue({
      providerType: "gmail",
      fetchNewEmailsSince,
      fetchSentEmailsSince: vi.fn(),
    });

    const result = await SyncEngine.runSync("connection-1");

    // One real pass plus the three bounded drain passes, and no more.
    expect(fetchNewEmailsSince).toHaveBeenCalledTimes(4);
    expect(result.continuationPending).toBe(true);
    // The whole point: a pass that knows it is behind must not look finished.
    expect(persistCompletionMock).not.toHaveBeenCalled();
    expect(persistCheckpointMock).toHaveBeenCalledWith(
      expect.objectContaining({
        historyId: "3341900",
        providerSnapshotComplete: false,
      })
    );
  });

  it("keeps the last good token and stays pending when a drain pass throws", async () => {
    setSupabaseOverride(highWaterSupabase("9999999"));
    const fetchNewEmailsSince = vi
      .fn()
      .mockResolvedValueOnce({ emails: [], nextSyncToken: "3341900" })
      .mockRejectedValueOnce(new Error("gmail history.list 429"));
    getProviderMock.mockReturnValue({
      providerType: "gmail",
      fetchNewEmailsSince,
      fetchSentEmailsSince: vi.fn(),
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const result = await SyncEngine.runSync("connection-1");

    // The main pass's work still lands; only the catch-up is abandoned.
    expect(result.errors).toEqual([]);
    expect(persistCompletionMock).not.toHaveBeenCalled();
    expect(persistCheckpointMock).toHaveBeenCalledWith(
      expect.objectContaining({
        // Never past mail the provider did not actually return.
        historyId: "3341900",
        providerSnapshotComplete: false,
      })
    );
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("completes normally when the high-water read fails", async () => {
    // Deploy-order safety: a build running ahead of its migration sees an
    // unknown column and must behave exactly as it did before this change.
    setSupabaseOverride({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: null,
              error: {
                message:
                  "column email_connections.webhook_history_high_water does not exist",
              },
            }),
          }),
        }),
      }),
      rpc: async () => ({ data: null, error: null }),
    } as never);
    const fetchNewEmailsSince = vi
      .fn()
      .mockResolvedValue({ emails: [], nextSyncToken: "3341900" });
    getProviderMock.mockReturnValue({
      providerType: "gmail",
      fetchNewEmailsSince,
      fetchSentEmailsSince: vi.fn(),
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const result = await SyncEngine.runSync("connection-1");

    expect(fetchNewEmailsSince).toHaveBeenCalledTimes(1);
    expect(result.continuationPending).toBe(false);
    expect(persistCompletionMock).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });

  it("leaves a structured provider continuation to the existing machinery", async () => {
    setSupabaseOverride(highWaterSupabase("9999999"));
    // A pass that stopped on its page/message cap is already continuation-
    // pending; the drain must not stack extra fetches on top of it.
    const fetchNewEmailsSince = vi.fn().mockResolvedValue({
      emails: [],
      nextSyncToken:
        'gmail:v1:{"startHistoryId":"3341840","pageToken":"page-2","finalHistoryId":"3341900","pendingMessageIds":[]}',
    });
    getProviderMock.mockReturnValue({
      providerType: "gmail",
      fetchNewEmailsSince,
      fetchSentEmailsSince: vi.fn(),
    });

    const result = await SyncEngine.runSync("connection-1");

    expect(fetchNewEmailsSince).toHaveBeenCalledTimes(1);
    expect(result.continuationPending).toBe(true);
    expect(persistCompletionMock).not.toHaveBeenCalled();
  });
});
