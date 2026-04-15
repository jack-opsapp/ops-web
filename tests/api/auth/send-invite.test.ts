import { describe, it, expect } from "vitest";
import { normalizePhoneE164, InvalidPhoneError } from "@/lib/sms/phone-utils";

describe("send-invite phone normalization (contract)", () => {
  it("normalizes raw phone to E.164 before reaching Twilio", () => {
    const raw = "(415) 555-1234";
    expect(normalizePhoneE164(raw)).toBe("+14155551234");
  });

  it("rejects gibberish before it reaches Twilio", () => {
    expect(() => normalizePhoneE164("not a phone")).toThrow(InvalidPhoneError);
  });

  it("accepts already-E.164 input unchanged", () => {
    expect(normalizePhoneE164("+14155551234")).toBe("+14155551234");
  });
});
