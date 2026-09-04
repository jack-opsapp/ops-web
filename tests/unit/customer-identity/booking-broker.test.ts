/**
 * Guest booking broker operations (design §5.2, §6; I5, I11–I15).
 *
 * The real library against the in-memory fake: availability, holds, the OTP
 * challenge bound to an intent, the atomic confirm, and management behind a
 * fresh code. The assertions that matter most are the negative ones — no
 * identity is created, no session is minted, and a refusal is shaped exactly
 * like the success it is hiding.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { CustomerIdentityFake } from "../../utils/customer-identity-fake";
import {
  MAX_BOOKING_ANSWERS,
  holdSlot,
  parseBookingContact,
  readBookingAvailability,
  startBookingContact,
  startBookingManage,
  verifyBookingContact,
  verifyBookingManage,
} from "@/lib/customer-identity/booking-broker";

const COMPANY_ID = "ddee107c-33cd-483e-8278-0f8d8a180181";
const OTHER_COMPANY_ID = "11111111-2222-4333-8444-555555555555";
const EMAIL = "jordan@example.com";
const CODE = "482913";
const FINGERPRINT = "f".repeat(64);
const SLOT = new Date("2026-09-15T16:00:00.000Z");
const OTHER_SLOT = new Date("2026-09-15T17:00:00.000Z");

const CONTACT = Object.freeze({
  name: "Jordan Reese",
  email: EMAIL,
  phone: "+1 403 555 0134",
  answers: Object.freeze([{ question: "Gate code", answer: "west side" }]),
});

let fake: CustomerIdentityFake;

beforeEach(() => {
  fake = new CustomerIdentityFake();
  fake.setBookingPolicy(COMPANY_ID, {
    mode: "instant",
    timezone: "America/Edmonton",
    visit_duration_minutes: 90,
  });
  fake.setAvailability(COMPANY_ID, [SLOT, OTHER_SLOT]);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

/** Hold a slot and take the contact step, leaving a live armed challenge. */
async function armedIntent(slot = SLOT) {
  const held = await holdSlot(fake.deps(), {
    companyId: COMPANY_ID,
    slotStartAt: slot,
    networkFingerprint: FINGERPRINT,
  });
  if (!held.ok) throw new Error("hold refused in fixture");
  const started = await startBookingContact(fake.deps(), {
    intentId: held.intentId,
    contact: CONTACT,
    networkFingerprint: FINGERPRINT,
  });
  fake.codes.set(EMAIL, CODE);
  return { intentId: held.intentId, challengeId: started.challengeId };
}

describe("readBookingAvailability", () => {
  it("answers the policy header and the offered slots", async () => {
    const availability = await readBookingAvailability(fake.deps(), {
      companyId: COMPANY_ID,
      from: "2026-09-15",
      to: "2026-09-16",
    });
    expect(availability).toEqual({
      mode: "instant",
      timezone: "America/Edmonton",
      durationMinutes: 90,
      slots: [SLOT, OTHER_SLOT],
    });
  });

  it("is nothing at all when the company has not turned booking on (D9)", async () => {
    fake.setBookingPolicy(OTHER_COMPANY_ID, { mode: "off" });
    fake.setAvailability(OTHER_COMPANY_ID, [SLOT]);
    await expect(
      readBookingAvailability(fake.deps(), {
        companyId: OTHER_COMPANY_ID,
        from: "2026-09-15",
        to: "2026-09-16",
      })
    ).resolves.toBeNull();
  });

  it("answers an empty set rather than a failure when nothing is free", async () => {
    fake.setAvailability(COMPANY_ID, []);
    await expect(
      readBookingAvailability(fake.deps(), {
        companyId: COMPANY_ID,
        from: "2026-09-15",
        to: "2026-09-16",
      })
    ).resolves.toMatchObject({ slots: [] });
  });

  it("never reads a crew row (I11)", async () => {
    await readBookingAvailability(fake.deps(), {
      companyId: COMPANY_ID,
      from: "2026-09-15",
      to: "2026-09-16",
    });
    expect(fake.calls.map((call) => call.fn)).toEqual([
      "read_public_booking_policy_as_system",
      "read_public_availability_as_system",
    ]);
  });
});

describe("holdSlot (design I13)", () => {
  it("grants a hold on an offered slot and takes it out of availability", async () => {
    const held = await holdSlot(fake.deps(), {
      companyId: COMPANY_ID,
      slotStartAt: SLOT,
      networkFingerprint: FINGERPRINT,
    });
    expect(held.ok).toBe(true);
    const availability = await readBookingAvailability(fake.deps(), {
      companyId: COMPANY_ID,
      from: "2026-09-15",
      to: "2026-09-16",
    });
    expect(availability?.slots).toEqual([OTHER_SLOT]);
  });

  it("refuses a slot that is no longer offered, distinctly from a rate limit", async () => {
    const gone = await holdSlot(fake.deps(), {
      companyId: COMPANY_ID,
      slotStartAt: new Date("2026-09-20T16:00:00.000Z"),
      networkFingerprint: FINGERPRINT,
    });
    expect(gone).toEqual({ ok: false, reason: "slot_no_longer_available" });
  });

  it("refuses past the concurrent-hold cap, indistinguishably from a taken slot (I5)", async () => {
    fake.setAvailability(COMPANY_ID, [
      SLOT,
      OTHER_SLOT,
      new Date("2026-09-15T18:00:00.000Z"),
      new Date("2026-09-15T19:00:00.000Z"),
    ]);
    for (const at of [SLOT, OTHER_SLOT, new Date("2026-09-15T18:00:00.000Z")]) {
      const held = await holdSlot(fake.deps(), {
        companyId: COMPANY_ID,
        slotStartAt: at,
        networkFingerprint: FINGERPRINT,
      });
      expect(held.ok).toBe(true);
    }
    const fourth = await holdSlot(fake.deps(), {
      companyId: COMPANY_ID,
      slotStartAt: new Date("2026-09-15T19:00:00.000Z"),
      networkFingerprint: FINGERPRINT,
    });
    expect(fourth).toEqual({ ok: false, reason: "slot_no_longer_available" });
  });

  it("refuses every hold while booking is off", async () => {
    fake.setBookingPolicy(COMPANY_ID, { mode: "off" });
    await expect(
      holdSlot(fake.deps(), {
        companyId: COMPANY_ID,
        slotStartAt: SLOT,
        networkFingerprint: FINGERPRINT,
      })
    ).resolves.toEqual({ ok: false, reason: "slot_no_longer_available" });
  });
});

describe("parseBookingContact", () => {
  it("accepts a full contact and normalizes the email", () => {
    expect(
      parseBookingContact({
        name: "  Jordan Reese ",
        email: " Jordan@Example.COM ",
        phone: " +1 403 555 0134 ",
        answers: [{ gate_code: "west side", dogs: true, storeys: 2, notes: null }],
      })
    ).toEqual({
      name: "Jordan Reese",
      email: EMAIL,
      phone: "+1 403 555 0134",
      answers: [{ gate_code: "west side", dogs: true, storeys: 2, notes: null }],
    });
  });

  it("accepts a contact with no phone and no answers", () => {
    expect(parseBookingContact({ name: "Jordan", email: EMAIL })).toEqual({
      name: "Jordan",
      email: EMAIL,
      phone: null,
      answers: [],
    });
  });

  it("refuses a missing name, a blank name and an unusable email", () => {
    for (const input of [
      { email: EMAIL },
      { name: "   ", email: EMAIL },
      { name: "Jordan", email: "not-an-address" },
      { name: "Jordan" },
      { name: "J".repeat(201), email: EMAIL },
      { name: 42, email: EMAIL },
    ]) {
      expect(parseBookingContact(input)).toBeNull();
    }
  });

  it("refuses answers that are not a bounded array of flat objects", () => {
    const tooMany = Array.from({ length: MAX_BOOKING_ANSWERS + 1 }, () => ({ q: "x" }));
    const tooManyFields = [
      Object.fromEntries(Array.from({ length: 9 }, (_, index) => [`f${index}`, "x"])),
    ];
    for (const answers of [
      {},
      "gate code",
      [{ nested: { deep: true } }],
      [{ list: ["a"] }],
      [[{ q: "x" }]],
      ["not an object"],
      [{ ["k".repeat(121)]: "x" }],
      [{ "": "blank key" }],
      [{ big: "x".repeat(20_000) }],
      tooMany,
      tooManyFields,
    ]) {
      expect(parseBookingContact({ name: "Jordan", email: EMAIL, answers })).toBeNull();
    }
  });

  it("accepts an empty array and the full hundred entries", () => {
    expect(
      parseBookingContact({ name: "Jordan", email: EMAIL, answers: [] })
    ).toMatchObject({ answers: [] });
    const full = Array.from({ length: MAX_BOOKING_ANSWERS }, (_, index) => ({
      q: `question ${index}`,
    }));
    expect(
      parseBookingContact({ name: "Jordan", email: EMAIL, answers: full })
    ).toMatchObject({ answers: full });
  });

  it("refuses a phone longer than the evidence column holds", () => {
    expect(
      parseBookingContact({ name: "Jordan", email: EMAIL, phone: "1".repeat(41) })
    ).toBeNull();
    expect(
      parseBookingContact({ name: "Jordan", email: EMAIL, phone: "1".repeat(40) })
    ).toMatchObject({ phone: "1".repeat(40) });
  });
});

describe("startBookingContact", () => {
  it("attaches the contact and sends one code", async () => {
    const held = await holdSlot(fake.deps(), {
      companyId: COMPANY_ID,
      slotStartAt: SLOT,
      networkFingerprint: FINGERPRINT,
    });
    if (!held.ok) throw new Error("hold refused");
    const started = await startBookingContact(fake.deps(), {
      intentId: held.intentId,
      contact: CONTACT,
      networkFingerprint: FINGERPRINT,
    });
    expect(started.challengeId).toMatch(/^[0-9a-f-]{36}$/);
    expect(fake.otpSends).toEqual([EMAIL]);
    const attached = fake.intents.get(held.intentId);
    expect(attached).toMatchObject({
      contactName: "Jordan Reese",
      contactPhone: "+1 403 555 0134",
    });
    // The row never holds the address in the clear (design §4.2).
    expect(attached?.contactEmailEncrypted).not.toContain("@");
    expect(JSON.stringify(fake.callsTo("record_guest_booking_contact_as_system"))).not.toContain(
      "@"
    );
  });

  it("answers identically for a refused intent and never sends (I5)", async () => {
    fake.refuseIntent = true;
    const started = await startBookingContact(fake.deps(), {
      intentId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      contact: CONTACT,
      networkFingerprint: FINGERPRINT,
    });
    expect(Object.keys(started).sort()).toEqual(["challengeId", "retryAfterSeconds"]);
    expect(started.challengeId).toMatch(/^[0-9a-f-]{36}$/);
    expect(fake.otpSends).toEqual([]);
  });

  it("answers identically when the send limit refuses (I8)", async () => {
    const held = await holdSlot(fake.deps(), {
      companyId: COMPANY_ID,
      slotStartAt: SLOT,
      networkFingerprint: FINGERPRINT,
    });
    if (!held.ok) throw new Error("hold refused");
    fake.refuseSends = true;
    const started = await startBookingContact(fake.deps(), {
      intentId: held.intentId,
      contact: CONTACT,
      networkFingerprint: FINGERPRINT,
    });
    expect(started.retryAfterSeconds).toBe(60);
    expect(fake.otpSends).toEqual([]);
  });

  it("never creates an identity or a session (D11)", async () => {
    await armedIntent();
    expect(fake.identities.size).toBe(0);
    expect(fake.sessions.size).toBe(0);
  });
});

describe("verifyBookingContact", () => {
  it("books instantly and answers the real window", async () => {
    const { intentId, challengeId } = await armedIntent();
    const result = await verifyBookingContact(fake.deps(), {
      intentId,
      challengeId,
      email: EMAIL,
      code: CODE,
      networkFingerprint: FINGERPRINT,
    });
    expect(result).toEqual({
      ok: true,
      outcome: "confirmed",
      scheduledAt: SLOT.toISOString(),
    });
    expect(fake.intents.get(intentId)?.state).toBe("confirmed");
  });

  it("stops at a request in request mode and touches no calendar (I14)", async () => {
    fake.setBookingPolicy(COMPANY_ID, {
      mode: "request",
      timezone: "America/Edmonton",
      visit_duration_minutes: 90,
    });
    const { intentId, challengeId } = await armedIntent();
    const result = await verifyBookingContact(fake.deps(), {
      intentId,
      challengeId,
      email: EMAIL,
      code: CODE,
      networkFingerprint: FINGERPRINT,
    });
    // A request has no time on any calendar until staff accept it (I14).
    expect(result).toEqual({ ok: true, outcome: "submitted", scheduledAt: null });
    expect(fake.intents.get(intentId)?.state).toBe("submitted");
  });

  it("never creates an identity, a session or an app-metadata write (D11)", async () => {
    const { intentId, challengeId } = await armedIntent();
    await verifyBookingContact(fake.deps(), {
      intentId,
      challengeId,
      email: EMAIL,
      code: CODE,
      networkFingerprint: FINGERPRINT,
    });
    expect(fake.identities.size).toBe(0);
    expect(fake.sessions.size).toBe(0);
    expect(fake.appMetadataWrites).toEqual([]);
    expect(fake.callsTo("upsert_customer_identity_as_system")).toEqual([]);
    expect(fake.callsTo("mint_customer_session_as_system")).toEqual([]);
  });

  it("charges the attempt before proxying and refuses a wrong code", async () => {
    const { intentId, challengeId } = await armedIntent();
    const result = await verifyBookingContact(fake.deps(), {
      intentId,
      challengeId,
      email: EMAIL,
      code: "000000",
      networkFingerprint: FINGERPRINT,
    });
    expect(result).toEqual({ ok: false, reason: "invalid_code", attemptsRemaining: 4 });
    expect(fake.callsTo("confirm_guest_booking_as_system")).toEqual([]);
  });

  it("exhausts after five wrong codes and never proxies again", async () => {
    const { intentId, challengeId } = await armedIntent();
    const attempt = () =>
      verifyBookingContact(fake.deps(), {
        intentId,
        challengeId,
        email: EMAIL,
        code: "000000",
        networkFingerprint: FINGERPRINT,
      });
    for (let index = 0; index < 5; index += 1) await attempt();
    expect(await attempt()).toEqual({ ok: false, reason: "challenge_exhausted" });
    expect(fake.otpVerifies).toHaveLength(5);
  });

  it("treats an unknown challenge exactly like a closed one", async () => {
    const { intentId } = await armedIntent();
    await expect(
      verifyBookingContact(fake.deps(), {
        intentId,
        challengeId: "99999999-9999-4999-8999-999999999999",
        email: EMAIL,
        code: CODE,
        networkFingerprint: FINGERPRINT,
      })
    ).resolves.toEqual({ ok: false, reason: "challenge_closed" });
  });

  it("surfaces the I12 refusal cleanly when the slot went while the code was typed", async () => {
    const { intentId, challengeId } = await armedIntent();
    fake.slotGoneOnConfirm = true;
    await expect(
      verifyBookingContact(fake.deps(), {
        intentId,
        challengeId,
        email: EMAIL,
        code: CODE,
        networkFingerprint: FINGERPRINT,
      })
    ).resolves.toEqual({ ok: false, reason: "slot_no_longer_available" });
  });

  it("refuses a code proved for an address that is not on this intent", async () => {
    const { intentId, challengeId } = await armedIntent();
    // A second booking, verified under a different address, cannot confirm the
    // first: the confirm RPC compares the digest against the intent's own.
    fake.codes.set("someone.else@example.com", CODE);
    const other = fake.seedIntent({
      companyId: COMPANY_ID,
      emailDigest: "1:" + "a".repeat(64),
      state: "held",
    });
    await expect(
      verifyBookingContact(fake.deps(), {
        intentId: other.intentId,
        challengeId,
        email: EMAIL,
        code: CODE,
        networkFingerprint: FINGERPRINT,
      })
    ).resolves.toEqual({ ok: false, reason: "not_confirmable" });
    expect(fake.intents.get(intentId)?.state).toBe("held");
  });
});

describe("booking management (design I15)", () => {
  async function confirmedBooking() {
    const { intentId, challengeId } = await armedIntent();
    await verifyBookingContact(fake.deps(), {
      intentId,
      challengeId,
      email: EMAIL,
      code: CODE,
      networkFingerprint: FINGERPRINT,
    });
    return intentId;
  }

  it("costs a fresh code before anything can be changed", async () => {
    const intentId = await confirmedBooking();
    fake.otpSends.length = 0;
    const started = await startBookingManage(fake.deps(), {
      intentId,
      companyId: COMPANY_ID,
      email: EMAIL,
      networkFingerprint: FINGERPRINT,
    });
    expect(started.challengeId).toMatch(/^[0-9a-f-]{36}$/);
    expect(fake.otpSends).toEqual([EMAIL]);
  });

  it("answers identically for a booking that does not exist (I5, I11)", async () => {
    const started = await startBookingManage(fake.deps(), {
      intentId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      companyId: COMPANY_ID,
      email: EMAIL,
      networkFingerprint: FINGERPRINT,
    });
    expect(Object.keys(started).sort()).toEqual(["challengeId", "retryAfterSeconds"]);
    expect(fake.otpSends).toEqual([]);
  });

  it("answers identically for a booking held under a different email", async () => {
    const intentId = await confirmedBooking();
    fake.otpSends.length = 0;
    const started = await startBookingManage(fake.deps(), {
      intentId,
      companyId: COMPANY_ID,
      email: "someone.else@example.com",
      networkFingerprint: FINGERPRINT,
    });
    expect(started.challengeId).toMatch(/^[0-9a-f-]{36}$/);
    expect(fake.otpSends).toEqual([]);
  });

  it("sends nothing while the manageability read is undeployed (fails closed)", async () => {
    const intentId = await confirmedBooking();
    fake.otpSends.length = 0;
    fake.manageableRpcMissing = true;
    const started = await startBookingManage(fake.deps(), {
      intentId,
      companyId: COMPANY_ID,
      email: EMAIL,
      networkFingerprint: FINGERPRINT,
    });
    expect(Object.keys(started).sort()).toEqual(["challengeId", "retryAfterSeconds"]);
    expect(fake.otpSends).toEqual([]);
  });

  it("reschedules onto a slot that is still offered", async () => {
    const intentId = await confirmedBooking();
    const started = await startBookingManage(fake.deps(), {
      intentId,
      companyId: COMPANY_ID,
      email: EMAIL,
      networkFingerprint: FINGERPRINT,
    });
    fake.codes.set(EMAIL, CODE);
    const result = await verifyBookingManage(fake.deps(), {
      intentId,
      challengeId: started.challengeId,
      email: EMAIL,
      code: CODE,
      action: "reschedule",
      slotStartAt: OTHER_SLOT,
      networkFingerprint: FINGERPRINT,
    });
    expect(result).toEqual({
      ok: true,
      outcome: "rescheduled",
      scheduledAt: OTHER_SLOT.toISOString(),
    });
  });

  it("re-runs slot validation on reschedule and refuses a time that went", async () => {
    const intentId = await confirmedBooking();
    const started = await startBookingManage(fake.deps(), {
      intentId,
      companyId: COMPANY_ID,
      email: EMAIL,
      networkFingerprint: FINGERPRINT,
    });
    fake.codes.set(EMAIL, CODE);
    await expect(
      verifyBookingManage(fake.deps(), {
        intentId,
        challengeId: started.challengeId,
        email: EMAIL,
        code: CODE,
        action: "reschedule",
        slotStartAt: new Date("2026-09-30T16:00:00.000Z"),
        networkFingerprint: FINGERPRINT,
      })
    ).resolves.toEqual({ ok: false, reason: "slot_no_longer_available" });
  });

  it("cancels, and a cancelled booking is then indistinguishable from none (I5)", async () => {
    const intentId = await confirmedBooking();
    const first = await startBookingManage(fake.deps(), {
      intentId,
      companyId: COMPANY_ID,
      email: EMAIL,
      networkFingerprint: FINGERPRINT,
    });
    fake.codes.set(EMAIL, CODE);
    await expect(
      verifyBookingManage(fake.deps(), {
        intentId,
        challengeId: first.challengeId,
        email: EMAIL,
        code: CODE,
        action: "cancel",
        networkFingerprint: FINGERPRINT,
      })
    ).resolves.toEqual({ ok: true, outcome: "cancelled" });

    // The second start finds nothing manageable, so it answers with a decoy
    // that will never resolve — exactly what a ref naming no booking gets.
    fake.otpSends.length = 0;
    const second = await startBookingManage(fake.deps(), {
      intentId,
      companyId: COMPANY_ID,
      email: EMAIL,
      networkFingerprint: FINGERPRINT,
    });
    expect(second.challengeId).toMatch(/^[0-9a-f-]{36}$/);
    expect(fake.otpSends).toEqual([]);
    fake.codes.set(EMAIL, CODE);
    await expect(
      verifyBookingManage(fake.deps(), {
        intentId,
        challengeId: second.challengeId,
        email: EMAIL,
        code: CODE,
        action: "cancel",
        networkFingerprint: FINGERPRINT,
      })
    ).resolves.toEqual({ ok: false, reason: "challenge_closed" });
    expect(fake.callsTo("cancel_guest_booking_as_system")).toHaveLength(1);
  });

  it("refuses a wrong code on a management action before touching the booking", async () => {
    const intentId = await confirmedBooking();
    const started = await startBookingManage(fake.deps(), {
      intentId,
      companyId: COMPANY_ID,
      email: EMAIL,
      networkFingerprint: FINGERPRINT,
    });
    fake.codes.set(EMAIL, CODE);
    await expect(
      verifyBookingManage(fake.deps(), {
        intentId,
        challengeId: started.challengeId,
        email: EMAIL,
        code: "000000",
        action: "cancel",
        networkFingerprint: FINGERPRINT,
      })
    ).resolves.toEqual({ ok: false, reason: "invalid_code", attemptsRemaining: 4 });
    expect(fake.callsTo("cancel_guest_booking_as_system")).toEqual([]);
    expect(fake.intents.get(intentId)?.state).toBe("confirmed");
  });
});
