// tests/unit/email/unsubscribe-token.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  signUnsubscribeToken,
  verifyUnsubscribeToken,
  buildUnsubscribeUrl,
} from "@/lib/email/unsubscribe-token";

const TEST_SECRET = "a".repeat(64); // 64-char hex placeholder for tests

describe("unsubscribe-token", () => {
  const ORIGINAL_SECRET = process.env.EMAIL_UNSUBSCRIBE_SECRET;
  const ORIGINAL_BASE = process.env.NEXT_PUBLIC_APP_URL;

  beforeEach(() => {
    process.env.EMAIL_UNSUBSCRIBE_SECRET = TEST_SECRET;
    process.env.NEXT_PUBLIC_APP_URL = "https://app.opsapp.co";
  });

  afterEach(() => {
    process.env.EMAIL_UNSUBSCRIBE_SECRET = ORIGINAL_SECRET;
    process.env.NEXT_PUBLIC_APP_URL = ORIGINAL_BASE;
  });

  it("(1) signs and verifies a token roundtrip", () => {
    const tok = signUnsubscribeToken({ email: "user@example.com", list: "field_notes" });
    const r = verifyUnsubscribeToken(tok);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.email).toBe("user@example.com");
      expect(r.list).toBe("field_notes");
    }
  });

  it("(2) lowercases the email before signing", () => {
    const tok = signUnsubscribeToken({ email: "USER@EXAMPLE.COM" });
    const r = verifyUnsubscribeToken(tok);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.email).toBe("user@example.com");
  });

  it("(3) defaults list to 'global' when omitted", () => {
    const tok = signUnsubscribeToken({ email: "user@example.com" });
    const r = verifyUnsubscribeToken(tok);
    expect(r.ok && r.list === "global").toBe(true);
  });

  it("(4) rejects a malformed token (no dot)", () => {
    const r = verifyUnsubscribeToken("not-a-token");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("malformed");
  });

  it("(5) rejects a malformed token (only one dot, garbage)", () => {
    const r = verifyUnsubscribeToken("aaaa.bbbb");
    expect(r.ok).toBe(false);
  });

  it("(6) rejects a tampered signature", () => {
    const tok = signUnsubscribeToken({ email: "user@example.com" });
    const last = tok.slice(-1);
    const flipped = last === "A" ? "B" : "A";
    const tampered = tok.slice(0, -1) + flipped;
    const r = verifyUnsubscribeToken(tampered);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("bad_signature");
  });

  it("(7) rejects a tampered payload", () => {
    const tok = signUnsubscribeToken({ email: "user@example.com" });
    // Mangle the first byte of the payload
    const [p, s] = tok.split(".");
    const fakePayload = "Z" + p.slice(1);
    const r = verifyUnsubscribeToken(`${fakePayload}.${s}`);
    expect(r.ok).toBe(false);
  });

  it("(8) rejects an expired token", () => {
    const tok = signUnsubscribeToken({
      email: "user@example.com",
      ttlMs: 1000,
      now: 0,
    });
    const r = verifyUnsubscribeToken(tok, 5_000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("expired");
  });

  it("(9) rejects when secret is missing or too short", () => {
    process.env.EMAIL_UNSUBSCRIBE_SECRET = "short";
    expect(() => signUnsubscribeToken({ email: "user@example.com" })).toThrow();
  });

  it("(10) rejects when secret rotates between sign and verify", () => {
    const tok = signUnsubscribeToken({ email: "user@example.com" });
    process.env.EMAIL_UNSUBSCRIBE_SECRET = "b".repeat(64);
    const r = verifyUnsubscribeToken(tok);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("bad_signature");
  });

  it("(11) buildUnsubscribeUrl produces a parseable URL", () => {
    const url = buildUnsubscribeUrl({ email: "user@example.com", list: "field_notes" });
    expect(url.startsWith("https://app.opsapp.co/api/email/unsubscribe?t=")).toBe(true);
    const u = new URL(url);
    const t = u.searchParams.get("t");
    expect(t).toBeTruthy();
    const r = verifyUnsubscribeToken(t!);
    expect(r.ok).toBe(true);
  });
});
