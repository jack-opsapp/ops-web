/**
 * Opaque booking descriptors (design §4.4, I4, I12).
 *
 * The slot descriptor is the only one of the three that carries a time bound:
 * a valid signature proves OPS offered the slot within the last ten minutes
 * and nothing else. Intent and booking refs name a row that the database
 * still governs; they are opaque so no uuid ever crosses the boundary.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FAKE_KEY_RING } from "../../utils/customer-identity-fake";
import {
  BOOKING_REF_PATTERN,
  INTENT_REF_PATTERN,
  SLOT_DESCRIPTOR_PATTERN,
  SLOT_DESCRIPTOR_TTL_MINUTES,
  decodeBookingRef,
  decodeIntentRef,
  decodeSlotDescriptor,
  encodeBookingRef,
  encodeIntentRef,
  encodeSlotDescriptor,
} from "@/lib/customer-identity/booking-refs";

const COMPANY_ID = "ddee107c-33cd-483e-8278-0f8d8a180181";
const OTHER_COMPANY_ID = "11111111-2222-4333-8444-555555555555";
const INTENT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const SLOT = new Date("2026-09-15T16:00:00.000Z");
const NOW = new Date("2026-09-10T12:00:30.000Z");

/** A second ring holding key 1 unchanged plus a new active key 2. */
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

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("slot descriptors — shape", () => {
  it("renders as sl_ plus 56 base64url characters and nothing else", () => {
    const slot = encodeSlotDescriptor(COMPANY_ID, SLOT, FAKE_KEY_RING);
    expect(slot).toMatch(SLOT_DESCRIPTOR_PATTERN);
    expect(slot.startsWith("sl_")).toBe(true);
    expect(slot).toHaveLength(59);
  });

  it("carries no company id, slot time or key material in readable form", () => {
    const slot = encodeSlotDescriptor(COMPANY_ID, SLOT, FAKE_KEY_RING);
    expect(slot).not.toContain(COMPANY_ID);
    expect(slot).not.toContain(COMPANY_ID.replace(/-/g, ""));
    expect(slot).not.toContain(String(Math.floor(SLOT.getTime() / 1000)));
    expect(slot).not.toContain(SLOT.toISOString());
  });

  it("differs per company and per slot under the same key", () => {
    const a = encodeSlotDescriptor(COMPANY_ID, SLOT, FAKE_KEY_RING);
    const b = encodeSlotDescriptor(OTHER_COMPANY_ID, SLOT, FAKE_KEY_RING);
    const c = encodeSlotDescriptor(
      COMPANY_ID,
      new Date(SLOT.getTime() + 3_600_000),
      FAKE_KEY_RING
    );
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it("refuses to mint for a non-canonical company id or a non-whole-second slot", () => {
    expect(() => encodeSlotDescriptor("nope", SLOT, FAKE_KEY_RING)).toThrow(TypeError);
    expect(() =>
      encodeSlotDescriptor(COMPANY_ID, new Date(SLOT.getTime() + 500), FAKE_KEY_RING)
    ).toThrow(TypeError);
    expect(() =>
      encodeSlotDescriptor(COMPANY_ID, new Date(Number.NaN), FAKE_KEY_RING)
    ).toThrow(TypeError);
  });
});

describe("slot descriptors — verification", () => {
  it("round-trips the company and the slot start", () => {
    const slot = encodeSlotDescriptor(COMPANY_ID, SLOT, FAKE_KEY_RING);
    const decoded = decodeSlotDescriptor(slot, COMPANY_ID, FAKE_KEY_RING);
    expect(decoded).toEqual({ ok: true, slotStartAt: SLOT });
  });

  it("refuses a descriptor minted for another company", () => {
    const slot = encodeSlotDescriptor(OTHER_COMPANY_ID, SLOT, FAKE_KEY_RING);
    expect(decodeSlotDescriptor(slot, COMPANY_ID, FAKE_KEY_RING)).toEqual({
      ok: false,
      reason: "mismatch",
    });
  });

  it("refuses a descriptor signed by a key this ring does not hold", () => {
    const slot = encodeSlotDescriptor(COMPANY_ID, SLOT, FOREIGN_KEY_RING);
    expect(decodeSlotDescriptor(slot, COMPANY_ID, FAKE_KEY_RING)).toEqual({
      ok: false,
      reason: "mismatch",
    });
  });

  it("accepts a descriptor minted under a retired key the ring still validates", () => {
    const slot = encodeSlotDescriptor(COMPANY_ID, SLOT, FAKE_KEY_RING);
    expect(decodeSlotDescriptor(slot, COMPANY_ID, ROTATED_KEY_RING)).toEqual({
      ok: true,
      slotStartAt: SLOT,
    });
  });

  it("refuses any single-character tamper", () => {
    const slot = encodeSlotDescriptor(COMPANY_ID, SLOT, FAKE_KEY_RING);
    for (let index = 3; index < slot.length; index += 7) {
      const original = slot[index];
      const replacement = original === "A" ? "B" : "A";
      const tampered = `${slot.slice(0, index)}${replacement}${slot.slice(index + 1)}`;
      expect(decodeSlotDescriptor(tampered, COMPANY_ID, FAKE_KEY_RING).ok).toBe(false);
    }
  });

  it("refuses anything that is not the canonical rendering", () => {
    const slot = encodeSlotDescriptor(COMPANY_ID, SLOT, FAKE_KEY_RING);
    const malformed = [
      undefined,
      null,
      42,
      "",
      "sl_",
      slot.slice(3),
      `${slot}A`,
      slot.slice(0, -1),
      slot.replace("sl_", "ch_"),
      slot.toUpperCase(),
      `sl_${"+".repeat(56)}`,
      `sl_${"/".repeat(56)}`,
      `sl_${"=".repeat(56)}`,
    ];
    for (const candidate of malformed) {
      const decoded = decodeSlotDescriptor(candidate, COMPANY_ID, FAKE_KEY_RING);
      expect(decoded.ok).toBe(false);
    }
  });
});

describe("slot descriptors — ten minute validity (design §4.4)", () => {
  it("stays valid for the whole ten minute window", () => {
    const slot = encodeSlotDescriptor(COMPANY_ID, SLOT, FAKE_KEY_RING);
    for (let minutes = 0; minutes < SLOT_DESCRIPTOR_TTL_MINUTES; minutes += 1) {
      vi.setSystemTime(new Date(NOW.getTime() + minutes * 60_000));
      expect(decodeSlotDescriptor(slot, COMPANY_ID, FAKE_KEY_RING).ok).toBe(true);
    }
  });

  it("never outlives ten minutes", () => {
    const slot = encodeSlotDescriptor(COMPANY_ID, SLOT, FAKE_KEY_RING);
    vi.setSystemTime(new Date(NOW.getTime() + SLOT_DESCRIPTOR_TTL_MINUTES * 60_000));
    expect(decodeSlotDescriptor(slot, COMPANY_ID, FAKE_KEY_RING)).toEqual({
      ok: false,
      reason: "mismatch",
    });
    vi.setSystemTime(new Date(NOW.getTime() + 60 * 60_000));
    expect(decodeSlotDescriptor(slot, COMPANY_ID, FAKE_KEY_RING).ok).toBe(false);
  });

  it("expires an old descriptor even when the slot itself is still in the future", () => {
    const slot = encodeSlotDescriptor(COMPANY_ID, SLOT, FAKE_KEY_RING);
    vi.setSystemTime(new Date(SLOT.getTime() - 24 * 3_600_000));
    expect(decodeSlotDescriptor(slot, COMPANY_ID, FAKE_KEY_RING).ok).toBe(false);
  });

  it("tolerates a minute of clock skew between minting and verifying instances", () => {
    const slot = encodeSlotDescriptor(COMPANY_ID, SLOT, FAKE_KEY_RING);
    vi.setSystemTime(new Date(NOW.getTime() - 60_000));
    expect(decodeSlotDescriptor(slot, COMPANY_ID, FAKE_KEY_RING).ok).toBe(true);
    vi.setSystemTime(new Date(NOW.getTime() - 5 * 60_000));
    expect(decodeSlotDescriptor(slot, COMPANY_ID, FAKE_KEY_RING).ok).toBe(false);
  });
});

describe("intent and booking refs", () => {
  it("render as their prefix plus 46 base64url characters", () => {
    const intent = encodeIntentRef(INTENT_ID, COMPANY_ID, FAKE_KEY_RING);
    const booking = encodeBookingRef(INTENT_ID, COMPANY_ID, FAKE_KEY_RING);
    expect(intent).toMatch(INTENT_REF_PATTERN);
    expect(booking).toMatch(BOOKING_REF_PATTERN);
    expect(intent).toHaveLength(49);
    expect(booking).toHaveLength(49);
    expect(intent).not.toContain(INTENT_ID.replace(/-/g, ""));
    expect(booking).not.toContain(INTENT_ID.replace(/-/g, ""));
  });

  it("round-trip the intent id under the company they were minted for", () => {
    const intent = encodeIntentRef(INTENT_ID, COMPANY_ID, FAKE_KEY_RING);
    expect(decodeIntentRef(intent, COMPANY_ID, FAKE_KEY_RING)).toEqual({
      ok: true,
      intentId: INTENT_ID,
    });
    const booking = encodeBookingRef(INTENT_ID, COMPANY_ID, FAKE_KEY_RING);
    expect(decodeBookingRef(booking, COMPANY_ID, FAKE_KEY_RING)).toEqual({
      ok: true,
      intentId: INTENT_ID,
    });
  });

  it("are domain separated — an intent ref never reads as a booking ref", () => {
    const intent = encodeIntentRef(INTENT_ID, COMPANY_ID, FAKE_KEY_RING);
    const booking = encodeBookingRef(INTENT_ID, COMPANY_ID, FAKE_KEY_RING);
    expect(intent.slice(3)).not.toEqual(booking.slice(3));
    expect(decodeBookingRef(`bk_${intent.slice(3)}`, COMPANY_ID, FAKE_KEY_RING)).toEqual({
      ok: false,
      reason: "mismatch",
    });
    expect(decodeIntentRef(`in_${booking.slice(3)}`, COMPANY_ID, FAKE_KEY_RING)).toEqual({
      ok: false,
      reason: "mismatch",
    });
  });

  it("refuse a ref replayed against another company's handle", () => {
    const intent = encodeIntentRef(INTENT_ID, OTHER_COMPANY_ID, FAKE_KEY_RING);
    expect(decodeIntentRef(intent, COMPANY_ID, FAKE_KEY_RING)).toEqual({
      ok: false,
      reason: "mismatch",
    });
  });

  it("do not expire — the database governs the intent's life, not the ref", () => {
    const intent = encodeIntentRef(INTENT_ID, COMPANY_ID, FAKE_KEY_RING);
    vi.setSystemTime(new Date(NOW.getTime() + 30 * 24 * 3_600_000));
    expect(decodeIntentRef(intent, COMPANY_ID, FAKE_KEY_RING).ok).toBe(true);
  });

  it("survive a key rotation that keeps the minting key in the ring", () => {
    const intent = encodeIntentRef(INTENT_ID, COMPANY_ID, FAKE_KEY_RING);
    expect(decodeIntentRef(intent, COMPANY_ID, ROTATED_KEY_RING).ok).toBe(true);
  });

  it("refuse malformed input without throwing", () => {
    for (const candidate of [undefined, null, 7, "", "in_", "in_short", INTENT_ID]) {
      expect(decodeIntentRef(candidate, COMPANY_ID, FAKE_KEY_RING)).toEqual({
        ok: false,
        reason: "malformed",
      });
      expect(decodeBookingRef(candidate, COMPANY_ID, FAKE_KEY_RING)).toEqual({
        ok: false,
        reason: "malformed",
      });
    }
  });

  it("refuse to mint from a non-canonical uuid or company id", () => {
    expect(() => encodeIntentRef("nope", COMPANY_ID, FAKE_KEY_RING)).toThrow(TypeError);
    expect(() => encodeBookingRef(INTENT_ID, "nope", FAKE_KEY_RING)).toThrow(TypeError);
  });
});
