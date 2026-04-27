/**
 * Integration tests for POST /api/email/unsubscribe.
 *
 * Covers JSON, application/x-www-form-urlencoded (Gmail one-click POST),
 * missing token, malformed token, expired, bad signature, and per-list
 * reason mapping (`global` → `unsubscribe`, otherwise `group_unsubscribe`).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const addSuppressionMock = vi.fn();

vi.mock("@/lib/email/suppressions", () => ({
  addSuppression: (...args: unknown[]) => addSuppressionMock(...args),
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({
    from: () => ({
      update: () => ({
        eq: () => Promise.resolve({ error: null }),
      }),
    }),
  }),
}));

import { POST } from "@/app/api/email/unsubscribe/route";
import { signUnsubscribeToken } from "@/lib/email/unsubscribe-token";

beforeEach(() => {
  process.env.EMAIL_UNSUBSCRIBE_SECRET = "z".repeat(64);
  process.env.NEXT_PUBLIC_APP_URL = "https://app.opsapp.co";
  addSuppressionMock.mockReset();
  addSuppressionMock.mockResolvedValue({
    id: "x",
    email: "user@example.com",
    list: "global",
    reason: "unsubscribe",
    source: "webhook",
    sourceEventId: null,
    metadata: {},
    createdAt: new Date().toISOString(),
    expiresAt: null,
  });
});

function makeJsonReq(body: object): NextRequest {
  return new NextRequest("https://app.opsapp.co/api/email/unsubscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeFormReq(form: string): NextRequest {
  return new NextRequest("https://app.opsapp.co/api/email/unsubscribe", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form,
  });
}

describe("POST /api/email/unsubscribe", () => {
  it("(1) accepts JSON token and adds suppression", async () => {
    const tok = signUnsubscribeToken({ email: "user@example.com", list: "global" });
    const res = await POST(makeJsonReq({ token: tok }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(addSuppressionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "user@example.com",
        list: "global",
        reason: "unsubscribe",
      }),
    );
  });

  it("(2) accepts application/x-www-form-urlencoded (Gmail one-click)", async () => {
    const tok = signUnsubscribeToken({ email: "user@example.com" });
    const res = await POST(makeFormReq(`token=${encodeURIComponent(tok)}`));
    expect(res.status).toBe(200);
  });

  it("(3) returns 400 when token missing", async () => {
    const res = await POST(makeJsonReq({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.reason).toBe("missing_token");
  });

  it("(4) returns 400 on malformed token", async () => {
    const res = await POST(makeJsonReq({ token: "garbage" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.reason).toBe("malformed");
  });

  it("(5) returns 400 on expired token", async () => {
    const tok = signUnsubscribeToken({ email: "user@example.com", ttlMs: 1, now: 0 });
    const res = await POST(makeJsonReq({ token: tok }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.reason).toBe("expired");
  });

  it("(6) returns 400 on bad signature", async () => {
    const tok = signUnsubscribeToken({ email: "user@example.com" });
    // Replace the signature half with all-zero bytes — guaranteed mismatch.
    const [payload] = tok.split(".");
    const fakeSig = "A".repeat(43); // 43 base64url chars = 32 bytes (sha256)
    const tampered = `${payload}.${fakeSig}`;
    const res = await POST(makeJsonReq({ token: tampered }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.reason).toBe("bad_signature");
  });

  it("(7) maps field_notes list to group_unsubscribe reason", async () => {
    const tok = signUnsubscribeToken({ email: "u@example.com", list: "field_notes" });
    await POST(makeJsonReq({ token: tok }));
    expect(addSuppressionMock).toHaveBeenCalledWith(
      expect.objectContaining({ list: "field_notes", reason: "group_unsubscribe" }),
    );
  });
});
