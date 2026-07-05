import { describe, it, expect } from "vitest";
import {
  classifyFailure,
  pickWorstFailure,
  STALE_SYNC_THRESHOLD_MS,
  type ConnectionRow,
  type FailureSignal,
} from "@/lib/email/ingest-heartbeat-classify";

const H = 60 * 60 * 1000;
// A heartbeat tick. Absolute value is irrelevant — everything is relative.
const NOW = 1_760_000_000_000;

/** A healthy, actively-syncing company Gmail connection. */
function baseConn(overrides: Partial<ConnectionRow> = {}): ConnectionRow {
  return {
    id: "conn-1",
    company_id: "co-1",
    user_id: "user-1",
    email: "crew@example.com",
    provider: "gmail",
    type: "company",
    status: "active",
    sync_enabled: true,
    webhook_subscription_id: "sub-123",
    webhook_expires_at: new Date(NOW + 48 * H).toISOString(),
    last_synced_at: new Date(NOW - 1 * H).toISOString(),
    created_at: new Date(NOW - 30 * 24 * H).toISOString(),
    ...overrides,
  };
}

describe("classifyFailure — sync_stale blackout awareness", () => {
  it("13h threshold clears the ~9h nightly email-sync poll blackout", () => {
    // The poll cron is dark 05:00–13:00 UTC (~8h); worst healthy gap ~9h.
    expect(STALE_SYNC_THRESHOLD_MS).toBeGreaterThan(9 * H);
  });

  it("does NOT alert a healthy but quiet inbox 9h since last sync (the false-alarm regression)", () => {
    const conn = baseConn({ last_synced_at: new Date(NOW - 9 * H).toISOString() });
    // Under the old 6h threshold this returned sync_stale every quiet night.
    expect(classifyFailure(conn, NOW)).toBeNull();
  });

  it("does NOT alert at 12h (still inside the tolerated gap)", () => {
    const conn = baseConn({ last_synced_at: new Date(NOW - 12 * H).toISOString() });
    expect(classifyFailure(conn, NOW)).toBeNull();
  });

  it("DOES alert once genuinely dark for 14h", () => {
    const conn = baseConn({ last_synced_at: new Date(NOW - 14 * H).toISOString() });
    const result = classifyFailure(conn, NOW);
    expect(result?.reason).toBe("sync_stale");
    expect(result?.hoursSilent).toBe(14);
  });

  it("fires just past the 13h boundary", () => {
    const conn = baseConn({
      last_synced_at: new Date(NOW - (13 * H + 60_000)).toISOString(),
    });
    expect(classifyFailure(conn, NOW)?.reason).toBe("sync_stale");
  });
});

describe("classifyFailure — genuine provider failures still fire", () => {
  it("webhook_expired fires regardless of a fresh last_synced_at", () => {
    const conn = baseConn({
      webhook_expires_at: new Date(NOW - 1 * H).toISOString(),
      last_synced_at: new Date(NOW - 1 * H).toISOString(),
    });
    expect(classifyFailure(conn, NOW)?.reason).toBe("webhook_expired");
  });

  it("webhook_setup_failed fires when subscription never registered past the 24h grace", () => {
    const conn = baseConn({
      webhook_subscription_id: null,
      webhook_expires_at: null,
      created_at: new Date(NOW - 25 * H).toISOString(),
    });
    expect(classifyFailure(conn, NOW)?.reason).toBe("webhook_setup_failed");
  });
});

describe("classifyFailure — never alerts on non-actionable rows", () => {
  it("ignores non-active connections (e.g. the orphan setup_incomplete row)", () => {
    const conn = baseConn({
      status: "setup_incomplete",
      email: "",
      last_synced_at: null,
      webhook_subscription_id: null,
      webhook_expires_at: null,
      created_at: new Date(NOW - 60 * 24 * H).toISOString(),
    });
    expect(classifyFailure(conn, NOW)).toBeNull();
  });

  it("ignores connections with sync disabled", () => {
    const conn = baseConn({
      sync_enabled: false,
      last_synced_at: new Date(NOW - 20 * H).toISOString(),
    });
    expect(classifyFailure(conn, NOW)).toBeNull();
  });

  it("does not sync_stale a brand-new active connection that has never synced", () => {
    const conn = baseConn({
      last_synced_at: null,
      created_at: new Date(NOW - 1 * H).toISOString(),
    });
    expect(classifyFailure(conn, NOW)).toBeNull();
  });
});

describe("pickWorstFailure", () => {
  it("prefers webhook_expired over sync_stale", () => {
    const stale: FailureSignal = {
      connectionId: "a",
      companyId: "co",
      email: "a@x.com",
      provider: "gmail",
      connectionUserId: "u",
      type: "company",
      reason: "sync_stale",
      hoursSilent: 20,
    };
    const expired: FailureSignal = { ...stale, connectionId: "b", reason: "webhook_expired", hoursSilent: 2 };
    expect(pickWorstFailure([stale, expired]).reason).toBe("webhook_expired");
  });
});
