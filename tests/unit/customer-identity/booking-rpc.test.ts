/**
 * Typed access to the P2 guest-booking system RPCs, as the migration
 * `20260902190000_public_booking_foundation.sql` actually landed them.
 *
 * Two things this layer owns and the routes therefore cannot get wrong: the
 * confirm and management RPCs signal refusals by raising named exceptions, and
 * they hand back real client, opportunity and site-visit ids. Refusals become
 * typed outcomes here, and the ids stop here (I4).
 */

import { describe, expect, it, vi } from "vitest";

import { CustomerIdentityStoreError } from "@/lib/customer-identity/errors";
import {
  cancelGuestBooking,
  confirmGuestBooking,
  holdBookingSlot,
  readBookingPolicy,
  readGuestBookingManageable,
  readPublicAvailability,
  recordBookingContact,
  rescheduleGuestBooking,
  type CustomerIdentityRpcClient,
} from "@/lib/customer-identity/booking-rpc";

const COMPANY_ID = "ddee107c-33cd-483e-8278-0f8d8a180181";
const INTEGRATION_ID = "77777777-7777-4777-8777-777777777777";
const INTENT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const CLIENT_ID = "44444444-4444-4444-8444-444444444444";
const OPPORTUNITY_ID = "55555555-5555-4555-8555-555555555555";
const SITE_VISIT_ID = "66666666-6666-4666-8666-666666666666";
const FINGERPRINT = "c".repeat(64);
const EMAIL_DIGEST = `2:${"b".repeat(64)}`;
const SLOT = new Date("2026-09-15T16:00:00.000Z");

function clientReturning(
  data: unknown,
  error: unknown = null
): CustomerIdentityRpcClient & { rpc: ReturnType<typeof vi.fn> } {
  return { rpc: vi.fn(async () => ({ data, error })) };
}

/** How supabase-js surfaces a `raise exception ... using errcode` from plpgsql. */
function clientRaising(message: string, code = "P0001") {
  return { rpc: vi.fn(async () => ({ data: null, error: { code, message } })) };
}

const POLICY_ROW = {
  mode: "instant",
  timezone: "America/Edmonton",
  visit_duration_minutes: 60,
  min_notice_hours: 48,
  horizon_days: 21,
};

describe("readBookingPolicy", () => {
  it("reads the policy header for a company that takes bookings", async () => {
    const client = clientReturning([POLICY_ROW]);
    await expect(readBookingPolicy(client, { companyId: COMPANY_ID })).resolves.toEqual(
      POLICY_ROW
    );
    expect(client.rpc).toHaveBeenCalledWith("read_public_booking_policy_as_system", {
      p_company_id: COMPANY_ID,
    });
  });

  it("is null when the company does not take bookings — the RPC returns no row", async () => {
    await expect(
      readBookingPolicy(clientReturning([]), { companyId: COMPANY_ID })
    ).resolves.toBeNull();
    await expect(
      readBookingPolicy(clientReturning(null), { companyId: COMPANY_ID })
    ).resolves.toBeNull();
  });

  it("accepts request mode and refuses a mode outside the CHECK", async () => {
    await expect(
      readBookingPolicy(clientReturning([{ ...POLICY_ROW, mode: "request" }]), {
        companyId: COMPANY_ID,
      })
    ).resolves.toMatchObject({ mode: "request" });
    await expect(
      readBookingPolicy(clientReturning([{ ...POLICY_ROW, mode: "maybe" }]), {
        companyId: COMPANY_ID,
      })
    ).rejects.toBeInstanceOf(CustomerIdentityStoreError);
  });

  it("refuses a duration outside the column CHECK and a blank timezone", async () => {
    for (const row of [
      { ...POLICY_ROW, visit_duration_minutes: 0 },
      { ...POLICY_ROW, visit_duration_minutes: 481 },
      { ...POLICY_ROW, timezone: "" },
    ]) {
      await expect(
        readBookingPolicy(clientReturning([row]), { companyId: COMPANY_ID })
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
});

describe("readPublicAvailability", () => {
  it("passes the range through and parses the slot starts", async () => {
    const client = clientReturning([
      { slot_start_at: "2026-09-15T16:00:00+00:00" },
      { slot_start_at: "2026-09-15T17:00:00+00:00" },
    ]);
    await expect(
      readPublicAvailability(client, {
        companyId: COMPANY_ID,
        from: "2026-09-15",
        to: "2026-09-16",
      })
    ).resolves.toEqual([SLOT, new Date("2026-09-15T17:00:00.000Z")]);
    expect(client.rpc).toHaveBeenCalledWith("read_public_availability_as_system", {
      p_company_id: COMPANY_ID,
      p_from: "2026-09-15",
      p_to: "2026-09-16",
    });
  });

  it("treats an empty result as no availability, not a failure", async () => {
    for (const data of [[], null]) {
      await expect(
        readPublicAvailability(clientReturning(data), {
          companyId: COMPANY_ID,
          from: "2026-09-15",
          to: "2026-09-16",
        })
      ).resolves.toEqual([]);
    }
  });

  it("refuses an unparseable timestamp and a malformed date bound", async () => {
    await expect(
      readPublicAvailability(clientReturning([{ slot_start_at: "not a time" }]), {
        companyId: COMPANY_ID,
        from: "2026-09-15",
        to: "2026-09-16",
      })
    ).rejects.toBeInstanceOf(CustomerIdentityStoreError);
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
  const input = {
    companyId: COMPANY_ID,
    integrationId: INTEGRATION_ID,
    slotStartAt: SLOT,
    networkFingerprint: FINGERPRINT,
  };

  it("carries the integration the hold is attributed to", async () => {
    const client = clientReturning([
      {
        intent_id: INTENT_ID,
        hold_expires_at: "2026-09-10T12:05:00+00:00",
        allowed: true,
        retry_after_seconds: null,
      },
    ]);
    await expect(holdBookingSlot(client, input)).resolves.toMatchObject({
      allowed: true,
      intent_id: INTENT_ID,
    });
    expect(client.rpc).toHaveBeenCalledWith("hold_booking_slot_as_system", {
      p_company_id: COMPANY_ID,
      p_integration_id: INTEGRATION_ID,
      p_slot_start_at: SLOT.toISOString(),
      p_network_fingerprint: FINGERPRINT,
    });
  });

  it("accepts the one refusal shape — success minus the intent (I5)", async () => {
    const client = clientReturning([
      {
        intent_id: null,
        hold_expires_at: null,
        allowed: false,
        retry_after_seconds: 60,
      },
    ]);
    await expect(holdBookingSlot(client, input)).resolves.toEqual({
      intent_id: null,
      hold_expires_at: null,
      allowed: false,
      retry_after_seconds: 60,
    });
  });

  it("refuses a granted hold that carries no intent", async () => {
    const client = clientReturning([
      {
        intent_id: null,
        hold_expires_at: null,
        allowed: true,
        retry_after_seconds: null,
      },
    ]);
    await expect(holdBookingSlot(client, input)).rejects.toBeInstanceOf(
      CustomerIdentityStoreError
    );
  });

  it("refuses a fingerprint that is not a sha-256 digest", async () => {
    const client = clientReturning([]);
    await expect(
      holdBookingSlot(client, { ...input, networkFingerprint: "203.0.113.7" })
    ).rejects.toBeInstanceOf(CustomerIdentityStoreError);
    expect(client.rpc).not.toHaveBeenCalled();
  });
});

describe("recordBookingContact", () => {
  const input = {
    intentId: INTENT_ID,
    contactName: "Jordan Reese",
    contactEmailDigest: EMAIL_DIGEST,
    contactEmailEncrypted: "v1.1.abcdefghijklmnop.qrstuvwxyz012345678901",
    contactPhone: "+1 403 555 0134",
    answers: [{ question: "Gate code", answer: "west side" }],
  };

  it("sends the digest and the ciphertext, never the address", async () => {
    const client = clientReturning([
      { intent_id: INTENT_ID, hold_expires_at: "2026-09-10T12:05:00+00:00", accepted: true },
    ]);
    await expect(recordBookingContact(client, input)).resolves.toMatchObject({
      accepted: true,
    });
    const args = client.rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(client.rpc.mock.calls[0][0]).toBe("record_guest_booking_contact_as_system");
    expect(args).toEqual({
      p_intent_id: INTENT_ID,
      p_contact_name: "Jordan Reese",
      p_contact_email_digest: EMAIL_DIGEST,
      p_contact_email_encrypted: input.contactEmailEncrypted,
      p_contact_phone: "+1 403 555 0134",
      p_answers: [{ question: "Gate code", answer: "west side" }],
    });
    expect(JSON.stringify(args)).not.toContain("@");
  });

  it("carries a null phone rather than an empty string", async () => {
    const client = clientReturning([
      { intent_id: INTENT_ID, hold_expires_at: null, accepted: false },
    ]);
    await recordBookingContact(client, { ...input, contactPhone: null });
    expect(client.rpc.mock.calls[0][1]).toMatchObject({ p_contact_phone: null });
  });

  it("accepts the refusal for a hold that is dead or already used", async () => {
    const client = clientReturning([
      { intent_id: INTENT_ID, hold_expires_at: null, accepted: false },
    ]);
    await expect(recordBookingContact(client, input)).resolves.toMatchObject({
      accepted: false,
    });
  });

  it("refuses a malformed digest before calling anything", async () => {
    const client = clientReturning([]);
    await expect(
      recordBookingContact(client, { ...input, contactEmailDigest: "nope" })
    ).rejects.toBeInstanceOf(CustomerIdentityStoreError);
    expect(client.rpc).not.toHaveBeenCalled();
  });
});

describe("confirmGuestBooking", () => {
  const input = {
    intentId: INTENT_ID,
    contactEmailDigest: EMAIL_DIGEST,
    contactEmail: "jordan@example.com",
    verifiedChannel: "email" as const,
  };

  it("confirms and keeps every id behind the boundary (I4)", async () => {
    const client = clientReturning([
      {
        outcome: "confirmed",
        intent_id: INTENT_ID,
        client_id: CLIENT_ID,
        opportunity_id: OPPORTUNITY_ID,
        site_visit_id: SITE_VISIT_ID,
        scheduled_at: "2026-09-15T16:00:00+00:00",
      },
    ]);
    const result = await confirmGuestBooking(client, input);
    expect(result).toEqual({
      outcome: "confirmed",
      scheduledAt: "2026-09-15T16:00:00+00:00",
    });
    expect(JSON.stringify(result)).not.toContain(CLIENT_ID);
    expect(JSON.stringify(result)).not.toContain(OPPORTUNITY_ID);
    expect(JSON.stringify(result)).not.toContain(SITE_VISIT_ID);
    expect(client.rpc).toHaveBeenCalledWith("confirm_guest_booking_as_system", {
      p_intent_id: INTENT_ID,
      p_contact_email_digest: EMAIL_DIGEST,
      p_contact_email: "jordan@example.com",
      p_verified_channel: "email",
    });
  });

  it("submits without a scheduled time in request mode (I14)", async () => {
    const client = clientReturning([
      {
        outcome: "submitted",
        intent_id: INTENT_ID,
        client_id: CLIENT_ID,
        opportunity_id: OPPORTUNITY_ID,
        site_visit_id: null,
        scheduled_at: null,
      },
    ]);
    await expect(confirmGuestBooking(client, input)).resolves.toEqual({
      outcome: "submitted",
      scheduledAt: null,
    });
  });

  it("turns the slot exceptions into a gone slot", async () => {
    for (const message of ["booking_slot_unavailable", "booking_not_available"]) {
      await expect(
        confirmGuestBooking(clientRaising(message, "55000"), input)
      ).resolves.toEqual({ outcome: "slot_no_longer_available", scheduledAt: null });
    }
  });

  it("turns the intent exceptions into a refusal that names nothing", async () => {
    for (const [message, code] of [
      ["booking_intent_not_found", "P0002"],
      ["booking_intent_not_holdable", "55000"],
      ["booking_hold_expired", "55000"],
      ["booking_contact_mismatch", "42501"],
    ] as const) {
      await expect(
        confirmGuestBooking(clientRaising(message, code), input)
      ).resolves.toEqual({ outcome: "not_actionable", scheduledAt: null });
    }
  });

  it("does not swallow a genuine failure as a refusal", async () => {
    for (const [message, code] of [
      ["access_denied", "42501"],
      ["booking_verified_channel_invalid", "22023"],
      ["some unrelated database failure", "XX000"],
    ] as const) {
      await expect(
        confirmGuestBooking(clientRaising(message, code), input)
      ).rejects.toBeInstanceOf(CustomerIdentityStoreError);
    }
  });

  it("refuses a confirmed row with no scheduled time", async () => {
    const client = clientReturning([
      {
        outcome: "confirmed",
        intent_id: INTENT_ID,
        client_id: CLIENT_ID,
        opportunity_id: OPPORTUNITY_ID,
        site_visit_id: SITE_VISIT_ID,
        scheduled_at: null,
      },
    ]);
    await expect(confirmGuestBooking(client, input)).rejects.toBeInstanceOf(
      CustomerIdentityStoreError
    );
  });
});

describe("readGuestBookingManageable", () => {
  const input = {
    intentId: INTENT_ID,
    companyId: COMPANY_ID,
    contactEmailDigest: EMAIL_DIGEST,
  };

  it("asks whether this address may manage this booking", async () => {
    const client = clientReturning(true);
    await expect(readGuestBookingManageable(client, input)).resolves.toBe(true);
    expect(client.rpc).toHaveBeenCalledWith("read_guest_booking_manageable_as_system", {
      p_intent_id: INTENT_ID,
      p_company_id: COMPANY_ID,
      p_contact_email_digest: EMAIL_DIGEST,
    });
  });

  it("is false, never a throw, when the answer is no", async () => {
    await expect(readGuestBookingManageable(clientReturning(false), input)).resolves.toBe(
      false
    );
  });

  it("fails closed while the RPC does not exist yet, so no code is ever sent", async () => {
    for (const [message, code] of [
      ["Could not find the function public.read_guest_booking_manageable_as_system", "PGRST202"],
      ["function public.read_guest_booking_manageable_as_system does not exist", "42883"],
    ] as const) {
      await expect(
        readGuestBookingManageable(clientRaising(message, code), input)
      ).resolves.toBe(false);
    }
  });

  it("does not hide a real store failure behind the closed door", async () => {
    await expect(
      readGuestBookingManageable(clientRaising("access_denied", "42501"), input)
    ).rejects.toBeInstanceOf(CustomerIdentityStoreError);
  });
});

describe("rescheduleGuestBooking and cancelGuestBooking", () => {
  it("reschedules and returns only the new time", async () => {
    const client = clientReturning([
      {
        intent_id: INTENT_ID,
        site_visit_id: SITE_VISIT_ID,
        scheduled_at: "2026-09-16T16:00:00+00:00",
      },
    ]);
    const result = await rescheduleGuestBooking(client, {
      intentId: INTENT_ID,
      scheduledAt: SLOT,
    });
    expect(result).toEqual({
      outcome: "rescheduled",
      scheduledAt: "2026-09-16T16:00:00+00:00",
    });
    expect(JSON.stringify(result)).not.toContain(SITE_VISIT_ID);
    expect(client.rpc).toHaveBeenCalledWith("reschedule_guest_booking_as_system", {
      p_intent_id: INTENT_ID,
      p_scheduled_at: SLOT.toISOString(),
    });
  });

  it("turns a reschedule's exceptions into typed refusals", async () => {
    await expect(
      rescheduleGuestBooking(clientRaising("booking_slot_unavailable", "55000"), {
        intentId: INTENT_ID,
        scheduledAt: SLOT,
      })
    ).resolves.toMatchObject({ outcome: "slot_no_longer_available" });
    for (const message of [
      "booking_not_reschedulable",
      "booking_intent_not_found",
      "site_visit_not_reschedulable",
      "site_visit_not_a_booking",
      "site_visit_not_found",
    ]) {
      await expect(
        rescheduleGuestBooking(clientRaising(message, "55000"), {
          intentId: INTENT_ID,
          scheduledAt: SLOT,
        })
      ).resolves.toMatchObject({ outcome: "not_actionable" });
    }
  });

  it("cancels, and turns its exceptions into typed refusals", async () => {
    const client = clientReturning([
      { intent_id: INTENT_ID, site_visit_id: SITE_VISIT_ID },
    ]);
    await expect(
      cancelGuestBooking(client, { intentId: INTENT_ID, reason: "customer_cancelled" })
    ).resolves.toEqual({ outcome: "cancelled", scheduledAt: null });
    expect(client.rpc).toHaveBeenCalledWith("cancel_guest_booking_as_system", {
      p_intent_id: INTENT_ID,
      p_reason: "customer_cancelled",
    });
    for (const message of ["booking_not_cancellable", "booking_intent_not_found"]) {
      await expect(
        cancelGuestBooking(clientRaising(message, "55000"), { intentId: INTENT_ID })
      ).resolves.toMatchObject({ outcome: "not_actionable" });
    }
    await expect(
      cancelGuestBooking(clientRaising("access_denied", "42501"), { intentId: INTENT_ID })
    ).rejects.toBeInstanceOf(CustomerIdentityStoreError);
  });
});
