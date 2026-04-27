/**
 * Integration tests for /api/webhooks/sendgrid.
 *
 * Mocks Supabase service-role client + Vercel KV pipeline so the test
 * runs hermetically. Verifies: secret check, payload validation,
 * idempotent upsert, rate-limit short-circuit, error categories.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// Mock Supabase service-role client
const mockUpsert = vi.fn();
const mockFrom = vi.fn(() => ({ upsert: mockUpsert }));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({ from: mockFrom }),
}));

// Mock rate limiter
const mockRateLimit = vi.fn();
vi.mock("@/lib/utils/ratelimit", () => ({
  rateLimit: (...args: unknown[]) => mockRateLimit(...args),
}));

// Import AFTER mocks
import { POST } from "@/app/api/webhooks/sendgrid/route";

const ORIGINAL_SECRET = process.env.SENDGRID_WEBHOOK_SECRET;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SENDGRID_WEBHOOK_SECRET = "test-secret-abc";
  mockRateLimit.mockResolvedValue({ exceeded: false, count: 1, retryAfterSec: 0 });
  mockUpsert.mockResolvedValue({ error: null, count: 1 });
});

afterEach(() => {
  process.env.SENDGRID_WEBHOOK_SECRET = ORIGINAL_SECRET;
});

function makeRequest(body: unknown, opts: { secret?: string } = {}) {
  const url = new URL(`https://example.com/api/webhooks/sendgrid?secret=${opts.secret ?? "test-secret-abc"}`);
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "1.2.3.4" },
    body: JSON.stringify(body),
  });
}

describe("/api/webhooks/sendgrid", () => {
  it("rejects missing secret with 401", async () => {
    const req = new NextRequest(new URL("https://example.com/api/webhooks/sendgrid"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify([]),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("rejects wrong secret with 401", async () => {
    const res = await POST(makeRequest([], { secret: "wrong" }));
    expect(res.status).toBe(401);
  });

  it("rejects non-array body with 400", async () => {
    const res = await POST(makeRequest({ not: "array" }));
    expect(res.status).toBe(400);
  });

  it("returns 200 with received=0 for empty array", async () => {
    const res = await POST(makeRequest([]));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received).toBe(0);
  });

  it("rejects oversize batch (>1000) with 413", async () => {
    const events = Array.from({ length: 1001 }, () => ({
      email: "x@x.com",
      event: "delivered",
      timestamp: 1700000000,
    }));
    const res = await POST(makeRequest(events));
    expect(res.status).toBe(413);
  });

  it("upserts valid events with onConflict idempotency", async () => {
    const events = [
      { email: "a@x.com", event: "delivered", sg_message_id: "sg.1", timestamp: 1700000000 },
      { email: "b@x.com", event: "open", sg_message_id: "sg.2", timestamp: 1700000001, url: "https://x.com" },
    ];
    const res = await POST(makeRequest(events));
    expect(res.status).toBe(200);
    expect(mockFrom).toHaveBeenCalledWith("email_events");
    expect(mockUpsert).toHaveBeenCalledOnce();
    const [rows, options] = mockUpsert.mock.calls[0];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      email: "a@x.com",
      event: "delivered",
      sg_message_id: "sg.1",
    });
    expect(options).toMatchObject({
      onConflict: "sg_message_id,event,timestamp",
      ignoreDuplicates: true,
    });
  });

  it("skips invalid events but stores valid ones", async () => {
    const events = [
      { email: "a@x.com", event: "delivered", timestamp: 1700000000 },
      { /* missing email */ event: "open", timestamp: 1700000001 },
      { email: "b@x.com", event: "INVALID_EVENT", timestamp: 1700000002 },
      { email: "c@x.com", event: "click", timestamp: "not-a-number" },
    ];
    const res = await POST(makeRequest(events));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received).toBe(4);
    expect(body.skipped).toBe(3);
    expect(mockUpsert).toHaveBeenCalledOnce();
    const [rows] = mockUpsert.mock.calls[0];
    expect(rows).toHaveLength(1);
  });

  it("returns 500 when DB upsert fails (so SendGrid retries)", async () => {
    mockUpsert.mockResolvedValueOnce({ error: { message: "connection lost" }, count: null });
    const events = [{ email: "a@x.com", event: "delivered", timestamp: 1700000000 }];
    const res = await POST(makeRequest(events));
    expect(res.status).toBe(500);
  });

  it("returns 429 when rate-limited", async () => {
    mockRateLimit.mockResolvedValueOnce({ exceeded: true, count: 601, retryAfterSec: 30 });
    const res = await POST(makeRequest([]));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("30");
  });

  it("converts SendGrid epoch timestamps to ISO", async () => {
    const events = [{ email: "a@x.com", event: "delivered", sg_message_id: "sg.t", timestamp: 1700000000 }];
    await POST(makeRequest(events));
    const [rows] = mockUpsert.mock.calls[0];
    expect(rows[0].timestamp).toBe(new Date(1700000000 * 1000).toISOString());
  });
});
