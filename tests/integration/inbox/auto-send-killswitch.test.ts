/**
 * Integration tests for the fail-closed kill switch on /api/cron/auto-send.
 *
 * The guard fires AFTER auth so unauthorized callers still get 401.
 * When INBOX_AUTO_SEND_ENABLED is unset (or != "true") the handler returns
 * { skipped: true } without calling AutoSendService.processPendingSends.
 * When INBOX_AUTO_SEND_ENABLED is "true" the handler proceeds past the guard
 * and reaches processPendingSends.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// ─── Hoisted mocks ─────────────────────────────────────────────────────────────

const { processPendingSendsMock } = vi.hoisted(() => ({
  processPendingSendsMock: vi.fn(),
}));

vi.mock("@/lib/api/services/auto-send-service", () => ({
  AutoSendService: {
    processPendingSends: processPendingSendsMock,
  },
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({}),
}));

vi.mock("@/lib/supabase/helpers", () => ({
  setSupabaseOverride: vi.fn(),
  requireSupabase: vi.fn(),
}));

import { GET } from "@/app/api/cron/auto-send/route";

// ─── Helpers ───────────────────────────────────────────────────────────────────

function buildRequest(authHeader?: string): NextRequest {
  const headers = new Headers();
  if (authHeader) headers.set("authorization", authHeader);
  return new NextRequest(
    new URL("https://example.com/api/cron/auto-send"),
    { headers }
  );
}

// ─── Setup / teardown ──────────────────────────────────────────────────────────

const CRON_SECRET = "test-cron-secret";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = CRON_SECRET;
  // Default: kill switch OFF (unset) — this is the launch default.
  delete process.env.INBOX_AUTO_SEND_ENABLED;
});

afterEach(() => {
  delete process.env.INBOX_AUTO_SEND_ENABLED;
});

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("auto-send cron — kill switch", () => {
  describe("auth precedes kill switch", () => {
    it("returns 401 with missing auth header, regardless of kill switch state", async () => {
      // Kill switch off (default)
      const res = await GET(buildRequest());
      expect(res.status).toBe(401);
      expect(processPendingSendsMock).not.toHaveBeenCalled();
    });

    it("returns 401 with wrong secret, regardless of kill switch state", async () => {
      const res = await GET(buildRequest("Bearer wrong-secret"));
      expect(res.status).toBe(401);
      expect(processPendingSendsMock).not.toHaveBeenCalled();
    });

    it("returns 401 with missing auth when INBOX_AUTO_SEND_ENABLED=true", async () => {
      process.env.INBOX_AUTO_SEND_ENABLED = "true";
      const res = await GET(buildRequest());
      expect(res.status).toBe(401);
      expect(processPendingSendsMock).not.toHaveBeenCalled();
    });
  });

  describe("kill switch — disabled (launch default)", () => {
    it("no-ops and returns { skipped: true } when env var is unset", async () => {
      const res = await GET(buildRequest(`Bearer ${CRON_SECRET}`));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.skipped).toBe(true);
      expect(body.reason).toBe("auto_send_disabled");
      expect(processPendingSendsMock).not.toHaveBeenCalled();
    });

    it("no-ops when INBOX_AUTO_SEND_ENABLED is set to a non-true value", async () => {
      process.env.INBOX_AUTO_SEND_ENABLED = "false";
      const res = await GET(buildRequest(`Bearer ${CRON_SECRET}`));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.skipped).toBe(true);
      expect(processPendingSendsMock).not.toHaveBeenCalled();
    });

    it("no-ops when INBOX_AUTO_SEND_ENABLED is set to '1'", async () => {
      process.env.INBOX_AUTO_SEND_ENABLED = "1";
      const res = await GET(buildRequest(`Bearer ${CRON_SECRET}`));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.skipped).toBe(true);
      expect(processPendingSendsMock).not.toHaveBeenCalled();
    });
  });

  describe("kill switch — enabled", () => {
    it("proceeds past the guard and calls processPendingSends when INBOX_AUTO_SEND_ENABLED=true", async () => {
      process.env.INBOX_AUTO_SEND_ENABLED = "true";
      processPendingSendsMock.mockResolvedValue({ sent: 0, failed: 0, errors: [] });

      const res = await GET(buildRequest(`Bearer ${CRON_SECRET}`));
      expect(res.status).toBe(200);
      const body = await res.json();
      // Should NOT be the kill-switch skip response
      expect(body.skipped).toBeUndefined();
      expect(body.reason).toBeUndefined();
      // processPendingSends must have been called
      expect(processPendingSendsMock).toHaveBeenCalledTimes(1);
    });

    it("returns send counts when enabled and sends succeed", async () => {
      process.env.INBOX_AUTO_SEND_ENABLED = "true";
      processPendingSendsMock.mockResolvedValue({ sent: 3, failed: 1, errors: ["err"] });

      const res = await GET(buildRequest(`Bearer ${CRON_SECRET}`));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.sent).toBe(3);
      expect(body.failed).toBe(1);
    });
  });
});
