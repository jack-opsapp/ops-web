/**
 * Broker-owned ciphertext for a guest's email address.
 *
 * `private.guest_booking_intents.contact_email_encrypted` is opaque to SQL —
 * nothing in the migration reads or interprets it — so the confidentiality of
 * a homeowner's address on that row is entirely this module's job.
 */

import { describe, expect, it } from "vitest";

import { FAKE_KEY_RING } from "../../utils/customer-identity-fake";
import {
  CONTACT_EMAIL_CIPHERTEXT_MAX_LENGTH,
  decryptContactEmail,
  encryptContactEmail,
} from "@/lib/customer-identity/booking-crypto";

const EMAIL = "jordan@example.com";

const ROTATED_KEY_RING = Object.freeze({
  activeKid: 2,
  keys: new Map([
    [1, Buffer.alloc(32, 7)],
    [2, Buffer.alloc(32, 9)],
  ]) as ReadonlyMap<number, Buffer>,
});

const FOREIGN_KEY_RING = Object.freeze({
  activeKid: 1,
  keys: new Map([[1, Buffer.alloc(32, 3)]]) as ReadonlyMap<number, Buffer>,
});

describe("contact email ciphertext", () => {
  it("round-trips the normalized address", () => {
    const sealed = encryptContactEmail(" Jordan@Example.COM ", FAKE_KEY_RING);
    expect(decryptContactEmail(sealed, FAKE_KEY_RING)).toBe(EMAIL);
  });

  it("never shows the address, and fits the column", () => {
    const sealed = encryptContactEmail(EMAIL, FAKE_KEY_RING);
    expect(sealed).not.toContain("jordan");
    expect(sealed).not.toContain("example.com");
    expect(sealed).not.toContain("@");
    expect(sealed.length).toBeLessThanOrEqual(CONTACT_EMAIL_CIPHERTEXT_MAX_LENGTH);
    expect(sealed.length).toBeGreaterThan(0);
  });

  it("is different every time, so two identical addresses do not collide", () => {
    const first = encryptContactEmail(EMAIL, FAKE_KEY_RING);
    const second = encryptContactEmail(EMAIL, FAKE_KEY_RING);
    expect(first).not.toEqual(second);
    expect(decryptContactEmail(first, FAKE_KEY_RING)).toBe(EMAIL);
    expect(decryptContactEmail(second, FAKE_KEY_RING)).toBe(EMAIL);
  });

  it("survives a rotation that keeps the sealing key in the ring", () => {
    const sealed = encryptContactEmail(EMAIL, FAKE_KEY_RING);
    expect(decryptContactEmail(sealed, ROTATED_KEY_RING)).toBe(EMAIL);
  });

  it("refuses a ring that never held the sealing key", () => {
    const sealed = encryptContactEmail(EMAIL, FAKE_KEY_RING);
    expect(decryptContactEmail(sealed, FOREIGN_KEY_RING)).toBeNull();
  });

  it("refuses tampered, truncated and nonsense ciphertext without throwing", () => {
    const sealed = encryptContactEmail(EMAIL, FAKE_KEY_RING);
    const parts = sealed.split(".");
    const tampered = [
      `${parts[0]}.${parts[1]}.${parts[2]}.${parts[3]}A`,
      `${parts[0]}.${parts[1]}.AAAA.${parts[3]}`,
      sealed.slice(0, -4),
      sealed.replace("v1", "v2"),
      "",
      "not.a.ciphertext",
      "x".repeat(5000),
    ];
    for (const candidate of tampered) {
      expect(decryptContactEmail(candidate, FAKE_KEY_RING)).toBeNull();
    }
    for (const candidate of [undefined, null, 42, {}]) {
      expect(decryptContactEmail(candidate as never, FAKE_KEY_RING)).toBeNull();
    }
  });

  it("refuses to seal something that is not an address", () => {
    for (const value of ["", "not-an-address", "a@b"]) {
      expect(() => encryptContactEmail(value, FAKE_KEY_RING)).toThrow(TypeError);
    }
  });
});
