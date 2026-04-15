import { describe, it, expect } from "vitest";
import { normalizePhoneE164, InvalidPhoneError, formatPhoneNational } from "@/lib/sms/phone-utils";

describe("normalizePhoneE164", () => {
  it("accepts a US 10-digit number and returns E.164", () => {
    expect(normalizePhoneE164("4155551234")).toBe("+14155551234");
  });

  it("accepts a US 10-digit number with formatting", () => {
    expect(normalizePhoneE164("(415) 555-1234")).toBe("+14155551234");
  });

  it("accepts a US number with dashes", () => {
    expect(normalizePhoneE164("415-555-1234")).toBe("+14155551234");
  });

  it("accepts a US number with dots", () => {
    expect(normalizePhoneE164("415.555.1234")).toBe("+14155551234");
  });

  it("accepts a number already in E.164 format", () => {
    expect(normalizePhoneE164("+14155551234")).toBe("+14155551234");
  });

  it("accepts a Canadian number with country code", () => {
    expect(normalizePhoneE164("+15145551234")).toBe("+15145551234");
  });

  it("throws InvalidPhoneError on gibberish", () => {
    expect(() => normalizePhoneE164("not a phone")).toThrow(InvalidPhoneError);
  });

  it("throws InvalidPhoneError on too-short number", () => {
    expect(() => normalizePhoneE164("12345")).toThrow(InvalidPhoneError);
  });

  it("throws InvalidPhoneError on empty string", () => {
    expect(() => normalizePhoneE164("")).toThrow(InvalidPhoneError);
  });

  it("InvalidPhoneError preserves raw input", () => {
    try {
      normalizePhoneE164("bogus");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidPhoneError);
      expect((err as InvalidPhoneError).raw).toBe("bogus");
    }
  });
});

describe("formatPhoneNational", () => {
  it("formats E.164 US number to national display", () => {
    expect(formatPhoneNational("+14155551234")).toBe("(415) 555-1234");
  });

  it("returns input unchanged if invalid", () => {
    expect(formatPhoneNational("not a number")).toBe("not a number");
  });
});
