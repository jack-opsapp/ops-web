/**
 * Typed access to the P2 guest-booking system RPCs (design §5).
 *
 * Every row that crosses this boundary is validated exactly against the
 * contract: a malformed database result is an internal failure, never a
 * partially trusted value. These tests are the executable statement of that
 * contract — the migration (P2-1) must satisfy them literally.
 */

import { describe, expect, it, vi } from "vitest";

import { CustomerIdentityStoreError } from "@/lib/customer-identity/errors";
import {
  beginBookingContact,
  beginBookingManage,
  cancelGuestBooking,
  confirmGuestBooking,
  holdBookingSlot,
  readBookingPolicy,
  readPublicAvailability,
  rescheduleGuestBooking,
  type CustomerIdentityRpcClient,
} from "@/lib/customer-identity/booking-rpc";

const COMPANY_ID = "ddee107c-33cd-483e-8278-0f8d8a180181";
const INTENT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const CHALLENGE_ID = "11111111-1111-4111-8111-111111111111";
const FINGERPRINT = "c".repeat(64);
const EMAIL_DIGEST = `2:${"b".repeat(64)}`;
const SLOT = new Date("2026-09-15T16:00:00.000Z");

function clientReturning(
  data: unknown,
  error: unknown = null
): CustomerIdentityRpcClient & { rpc: ReturnType<typeof vi.fn> } {
  return { rpc: vi.fn(async () => ({ data, error })) };
}

function clientThrowing(): CustomerIdentityRpcClient {
  return {
    rpc: async () => {
      throw new Error("network");
    },
  };
}

const POLICY_ROW = {
  mode: "instant",
  timezone: "America/Edmonton",
  visit_duration_minutes: 60,
  horizon_days: 21,
  min_notice_hours: 48,
  slot_granularity_minutes: 60,
};

describe("readBookingPolicy", () => {
  it("calls read_public_booking_policy_as_system with the company", async () => {
    const client = clientReturning([POLICY_ROW]);
    const policy = await readBookingPolicy(client, { companyId: COMPANY_ID });
    expect(client.rpc).toHaveBeenCalledWith("read_public_booking_policy_as_system", {
      p_company_id: COMPANY_ID,
    });
    expect(policy).toEqual(POLICY_ROW);
  });

  it("accepts every mode the policy CHECK allows", async () => {
    for (const mode of ["off", "request", "instant"]) {
      const client = clientReturning([{ ...POLICY_ROW, mode }]);
      await expect(readBookingPolicy(client, { companyId: COMPANY_ID })).resolves.toMatchObject(
        { mode }
      );
    }
  });

  it("refuses a mode outside the contract", async () => {
    const client = clientReturning([{ ...POLICY_ROW, mode: "maybe" }]);
    await expect(readBookingPolicy(client, { companyId: COMPANY_ID })).rejects.toBeInstanceOf(
      CustomerIdentityStoreError
    );
  });

  it("refuses a missing row, an extra row and a nonsense duration", async () => {
    for (const data of [
      [],
      [POLICY_ROW, POLICY_ROW],
      [{ ...POLICY_ROW, visit_duration_minutes: 0 }],
      [{ ...POLICY_ROW, timezone: "" }],
      null,
    ]) {
      await expect(
        readBookingPolicy(clientReturning(data), { companyId: COMPANY_ID })
      ).rejects.toBeInstanceOf(CustomerIdentityStoreError);
    }
  });

  it("refuses a non-uuid company before calling anything", async () => {
    const client = clientReturning([POLICY_ROW]);
    await expect(readBookingPolicy(client, { companyId: "nope" })).rejects.toBeInstanceOf(
      CustomerIdentityStoreError
    );
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("wraps a transport failure as a store error", async () => {
    await expect(
      readBookingPolicy(clientThrowing(), { companyId: COMPANY_ID })
    ).rejects.toBeInstanceOf(CustomerIdentityStoreError);
  });
});

describe("readPublicAvailability", () => {
  it("passes the date range through and returns the slot starts in order", async () => {
    const client = clientReturning([
      { slot_start_at: "2026-09-15T16:00:00+00:00" },
      { slot_start_at: "2026-09-15T17:00:00+00:00" },
    ]);
    const slots = await readPublicAvailability(client, {
      companyId: COMPANY_ID,
      from: "2026-09-15",
      to: "2026-09-16",
    });
    expect(client.rpc).toHaveBeenCalledWith("read_public_availability_as_system", {
      p_company_id: COMPANY_ID,
      p_from: "2026-09-15",
      p_to: "2026-09-16",
    });
    expect(slots).toEqual([SLOT, new Date("2026-09-15T17:00:00.000Z")]);
  });

  it("treats an empty result as no availability, not a failure", async () => {
    await expect(
      readPublicAvailability(clientReturning([]), {
        companyId: COMPANY_ID,
        from: "2026-09-15",
        to: "2026-09-16",
      })
    ).resolves.toEqual([]);
    await expect(
      readPublicAvailability(clientReturning(null), {
        companyId: COMPANY_ID,
        from: "2026-09-15",
        to: "2026-09-16",
      })
    ).resolves.toEqual([]);
  });

  it("refuses an unparseable timestamp rather than passing NaN on", async () => {
    await expect(
      readPublicAvailability(clientReturning([{ slot_start_at: "not a time" }]), {
        companyId: COMPANY_ID,
        from: "2026-09-15",
        to: "2026-09-16",
      })
    ).rejects.toBeInstanceOf(CustomerIdentityStoreError);
  });

  it("refuses a malformed date bound before calling anything", async () => {
    const client = clientReturning([]);
    await expect(
      readPublicAvailability(client, {
        companyId: COMPANY_ID,
        from: "2026-9-15",
        to: "2026-09-16",
      })
    ).rejects.toBeInstanceOf(CustomerIdentityStoreError);
    expect(client.rpc).not.toHaveBeenCalled();
  });
});

describe("holdBookingSlot", () => {
  it("returns the intent and its expiry when the hold is granted", async () => {
    const client = clientReturning([
      {
        intent_id: INTENT_ID,
        hold_expires_at: "2026-09-10T12:05:00+00:00",
        allowed: true,
        reason: "ok",
        retry_after_seconds: 0,
      },
    ]);
    const held = await holdBookingSlot(client, {
      companyId: COMPANY_ID,
      slotStartAt: SLOT,
      networkFingerprint: FINGERPRINT,
    });
    expect(client.rpc).toHaveBeenCalledWith("hold_booking_slot_as_system", {
      p_company_id: COMPANY_ID,
      p_slot_start_at: SLOT.toISOString(),
      p_network_fingerprint: FINGERPRINT,
    });
    expect(held).toEqual({
      intent_id: INTENT_ID,
      hold_expires_at: "2026-09-10T12:05:00+00:00",
      allowed: true,
      reason: "ok",
      retry_after_seconds: 0,
    });
  });

  it("accepts a refusal shaped identically minus the intent (I5)", async () => {
    for (const reason of ["slot_unavailable", "rate_limited"]) {
      const client = clientReturning([
        {
          intent_id: null,
          hold_expires_at: null,
          allowed: false,
          reason,
          retry_after_seconds: 60,
        },
      ]);
      await expect(
        holdBookingSlot(client, {
          companyId: COMPANY_ID,
          slotStartAt: SLOT,
          networkFingerprint: FINGERPRINT,
        })
      ).resolves.toMatchObject({ allowed: false, reason, intent_id: null });
    }
  });

  it("refuses a granted hold that carries no intent", async () => {
    const client = clientReturning([
      {
        intent_id: null,
        hold_expires_at: null,
        allowed: true,
        reason: "ok",
        retry_after_seconds: 0,
      },
    ]);
    await expect(
      holdBookingSlot(client, {
        companyId: COMPANY_ID,
        slotStartAt: SLOT,
        networkFingerprint: FINGERPRINT,
      })
    ).rejects.toBeInstanceOf(CustomerIdentityStoreError);
  });

  it("refuses a reason outside the contract", async () => {
    const client = clientReturning([
      {
        intent_id: null,
        hold_expires_at: null,
        allowed: false,
        reason: "because",
        retry_after_seconds: 0,
      },
    ]);
    await expect(
      holdBookingSlot(client, {
        companyId: COMPANY_ID,
        slotStartAt: SLOT,
        networkFingerprint: FINGERPRINT,
      })
    ).rejects.toBeInstanceOf(CustomerIdentityStoreError);
  });

  it("refuses a fingerprint that is not a sha-256 digest", async () => {
    const client = clientReturning([]);
    await expect(
      holdBookingSlot(client, {
        companyId: COMPANY_ID,
        slotStartAt: SLOT,
        networkFingerprint: "203.0.113.7",
      })
    ).rejects.toBeInstanceOf(CustomerIdentityStoreError);
    expect(client.rpc).not.toHaveBeenCalled();
  });
});

describe("beginBookingContact", () => {
  const input = {
    intentId: INTENT_ID,
    companyId: COMPANY_ID,
    contactName: "Jordan Reese",
    contactEmail: "jordan@example.com",
    contactPhone: "+1 403 555 0134",
    answers: { gate_code: "1234" },
    emailDigest: EMAIL_DIGEST,
    networkFingerprint: FINGERPRINT,
  };

  it("attaches the contact and begins the challenge in one call", async () => {
    const client = clientReturning([
      { accepted: true, challenge_id: CHALLENGE_ID, allowed: true, retry_after_seconds: 60 },
    ]);
    const result = await beginBookingContact(client, input);
    expect(client.rpc).toHaveBeenCalledWith("begin_guest_booking_contact_as_system", {
      p_intent_id: INTENT_ID,
      p_company_id: COMPANY_ID,
      p_contact_name: "Jordan Reese",
      p_contact_email: "jordan@example.com",
      p_contact_phone: "+1 403 555 0134",
      p_answers: { gate_code: "1234" },
      p_email_digest: EMAIL_DIGEST,
      p_network_fingerprint: FINGERPRINT,
    });
    expect(result).toMatchObject({ accepted: true, allowed: true });
  });

  it("carries a null phone through rather than an empty string", async () => {
    const client = clientReturning([
      { accepted: true, challenge_id: CHALLENGE_ID, allowed: true, retry_after_seconds: 60 },
    ]);
    await beginBookingContact(client, { ...input, contactPhone: null });
    expect(client.rpc.mock.calls[0][1]).toMatchObject({ p_contact_phone: null });
  });

  it("accepts a refused intent and a refused send, both without a challenge", async () => {
    for (const row of [
      { accepted: false, challenge_id: null, allowed: false, retry_after_seconds: 0 },
      { accepted: true, challenge_id: null, allowed: false, retry_after_seconds: 60 },
    ]) {
      await expect(beginBookingContact(clientReturning([row]), input)).resolves.toEqual(row);
    }
  });

  it("refuses an allowed challenge that carries no challenge id", async () => {
    const client = clientReturning([
      { accepted: true, challenge_id: null, allowed: true, retry_after_seconds: 0 },
    ]);
    await expect(beginBookingContact(client, input)).rejects.toBeInstanceOf(
      CustomerIdentityStoreError
    );
  });
});

describe("confirmGuestBooking", () => {
  const input = {
    intentId: INTENT_ID,
    companyId: COMPANY_ID,
    challengeId: CHALLENGE_ID,
    verifiedChannel: "email" as const,
    networkFingerprint: FINGERPRINT,
  };

  it("returns the booked window on an instant confirmation", async () => {
    const client = clientReturning([
      {
        outcome: "confirmed",
        scheduled_at: "2026-09-15T16:00:00+00:00",
        duration_minutes: 60,
      },
    ]);
    const result = await confirmGuestBooking(client, input);
    expect(client.rpc).toHaveBeenCalledWith("confirm_guest_booking_as_system", {
      p_intent_id: INTENT_ID,
      p_company_id: COMPANY_ID,
      p_challenge_id: CHALLENGE_ID,
      p_verified_channel: "email",
      p_network_fingerprint: FINGERPRINT,
    });
    expect(result).toMatchObject({ outcome: "confirmed", duration_minutes: 60 });
  });

  it("returns the proposed window on a request-mode submission (I14)", async () => {
    const client = clientReturning([
      {
        outcome: "submitted",
        scheduled_at: "2026-09-15T16:00:00+00:00",
        duration_minutes: 90,
      },
    ]);
    await expect(confirmGuestBooking(client, input)).resolves.toMatchObject({
      outcome: "submitted",
    });
  });

  it("carries the I12 refusal without a window", async () => {
    for (const outcome of ["slot_no_longer_available", "not_confirmable"]) {
      const client = clientReturning([
        { outcome, scheduled_at: null, duration_minutes: null },
      ]);
      await expect(confirmGuestBooking(client, input)).resolves.toMatchObject({ outcome });
    }
  });

  it("refuses a booked outcome with no window and an outcome outside the contract", async () => {
    for (const row of [
      { outcome: "confirmed", scheduled_at: null, duration_minutes: null },
      { outcome: "confirmed", scheduled_at: "2026-09-15T16:00:00+00:00", duration_minutes: null },
      { outcome: "booked", scheduled_at: null, duration_minutes: null },
    ]) {
      await expect(confirmGuestBooking(clientReturning([row]), input)).rejects.toBeInstanceOf(
        CustomerIdentityStoreError
      );
    }
  });
});

describe("beginBookingManage", () => {
  it("begins a fresh challenge for a management action (I15)", async () => {
    const client = clientReturning([
      { accepted: true, challenge_id: CHALLENGE_ID, allowed: true, retry_after_seconds: 60 },
    ]);
    await beginBookingManage(client, {
      intentId: INTENT_ID,
      companyId: COMPANY_ID,
      emailDigest: EMAIL_DIGEST,
      networkFingerprint: FINGERPRINT,
    });
    expect(client.rpc).toHaveBeenCalledWith("begin_guest_booking_manage_as_system", {
      p_intent_id: INTENT_ID,
      p_company_id: COMPANY_ID,
      p_email_digest: EMAIL_DIGEST,
      p_network_fingerprint: FINGERPRINT,
    });
  });
});

describe("rescheduleGuestBooking and cancelGuestBooking", () => {
  it("re-runs slot validation and returns the new window", async () => {
    const client = clientReturning([
      {
        outcome: "rescheduled",
        scheduled_at: "2026-09-16T16:00:00+00:00",
        duration_minutes: 60,
      },
    ]);
    const result = await rescheduleGuestBooking(client, {
      intentId: INTENT_ID,
      companyId: COMPANY_ID,
      challengeId: CHALLENGE_ID,
      slotStartAt: SLOT,
      networkFingerprint: FINGERPRINT,
    });
    expect(client.rpc).toHaveBeenCalledWith("reschedule_guest_booking_as_system", {
      p_intent_id: INTENT_ID,
      p_company_id: COMPANY_ID,
      p_challenge_id: CHALLENGE_ID,
      p_slot_start_at: SLOT.toISOString(),
      p_network_fingerprint: FINGERPRINT,
    });
    expect(result).toMatchObject({ outcome: "rescheduled" });
  });

  it("carries a reschedule refusal without a window", async () => {
    for (const outcome of ["slot_no_longer_available", "not_manageable"]) {
      const client = clientReturning([
        { outcome, scheduled_at: null, duration_minutes: null },
      ]);
      await expect(
        rescheduleGuestBooking(client, {
          intentId: INTENT_ID,
          companyId: COMPANY_ID,
          challengeId: CHALLENGE_ID,
          slotStartAt: SLOT,
          networkFingerprint: FINGERPRINT,
        })
      ).resolves.toMatchObject({ outcome });
    }
  });

  it("cancels and refuses an outcome outside the contract", async () => {
    const client = clientReturning([{ outcome: "cancelled" }]);
    await expect(
      cancelGuestBooking(client, {
        intentId: INTENT_ID,
        companyId: COMPANY_ID,
        challengeId: CHALLENGE_ID,
        networkFingerprint: FINGERPRINT,
      })
    ).resolves.toEqual({ outcome: "cancelled" });
    expect(client.rpc).toHaveBeenCalledWith("cancel_guest_booking_as_system", {
      p_intent_id: INTENT_ID,
      p_company_id: COMPANY_ID,
      p_challenge_id: CHALLENGE_ID,
      p_network_fingerprint: FINGERPRINT,
    });

    await expect(
      cancelGuestBooking(clientReturning([{ outcome: "gone" }]), {
        intentId: INTENT_ID,
        companyId: COMPANY_ID,
        challengeId: CHALLENGE_ID,
        networkFingerprint: FINGERPRINT,
      })
    ).rejects.toBeInstanceOf(CustomerIdentityStoreError);
  });
});
