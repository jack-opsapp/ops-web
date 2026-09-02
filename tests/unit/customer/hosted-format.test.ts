import { describe, it, expect } from "vitest";
import {
  extractDigits,
  fillCopy,
  formatCountdown,
  formatStep,
  isPlausibleEmail,
  safeCustomerNext,
} from "@/lib/customer-identity/hosted-format";
import { normalizeLogoUrl } from "@/lib/customer-identity/hosted-company";
import { isValidPublicHandle, parsePublicHandle } from "@/lib/customer-identity/handle";
import en from "@/i18n/dictionaries/en/customer.json";
import es from "@/i18n/dictionaries/es/customer.json";

describe("customer dictionaries", () => {
  it("en and es carry exactly the same keys", () => {
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
  });

  it("no string contains an exclamation point or emoji", () => {
    for (const value of [...Object.values(en), ...Object.values(es)]) {
      expect(value).not.toMatch(/!/);
      expect(value).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  it("never mentions account existence in any error (I5)", () => {
    const errors = Object.entries(en).filter(([k]) => k.startsWith("error."));
    for (const [, value] of errors) {
      expect(value.toLowerCase()).not.toMatch(/no account|not found|doesn't exist|unknown email|not registered/);
    }
  });
});

describe("fillCopy", () => {
  it("substitutes known tokens and leaves unknown ones intact", () => {
    expect(fillCopy("Sent to {email}. {other}", { email: "a@b.c" })).toBe("Sent to a@b.c. {other}");
    expect(fillCopy("STEP {step} / {total}", { step: "01", total: 2 })).toBe("STEP 01 / 2");
  });
});

describe("formatCountdown", () => {
  it("renders m:ss, rounding partial seconds up, never negative", () => {
    expect(formatCountdown(60)).toBe("1:00");
    expect(formatCountdown(59)).toBe("0:59");
    expect(formatCountdown(5.2)).toBe("0:06");
    expect(formatCountdown(0)).toBe("0:00");
    expect(formatCountdown(-4)).toBe("0:00");
    expect(formatCountdown(3600)).toBe("60:00");
  });
});

describe("formatStep", () => {
  it("zero-pads to two digits", () => {
    expect(formatStep(1)).toBe("01");
    expect(formatStep(12)).toBe("12");
  });
});

describe("isPlausibleEmail", () => {
  it("accepts ordinary addresses and rejects obvious typos", () => {
    expect(isPlausibleEmail("jackson@example.com")).toBe(true);
    expect(isPlausibleEmail("  first.last+tag@sub.example.co  ")).toBe(true);
    expect(isPlausibleEmail("jackson")).toBe(false);
    expect(isPlausibleEmail("jackson@")).toBe(false);
    expect(isPlausibleEmail("jackson@example")).toBe(false);
    expect(isPlausibleEmail("a b@example.com")).toBe(false);
    expect(isPlausibleEmail("")).toBe(false);
  });
});

describe("safeCustomerNext", () => {
  it("trusts only paths inside this company's hosted surface", () => {
    expect(safeCustomerNext("/c/acme/home", "acme")).toBe("/c/acme/home");
    expect(safeCustomerNext("/c/acme/bookings/abc", "acme")).toBe("/c/acme/bookings/abc");
    expect(safeCustomerNext("/c/other/home", "acme")).toBe("/c/acme/home");
    expect(safeCustomerNext("//evil.com/c/acme/home", "acme")).toBe("/c/acme/home");
    expect(safeCustomerNext("https://evil.com", "acme")).toBe("/c/acme/home");
    expect(safeCustomerNext("/dashboard", "acme")).toBe("/c/acme/home");
    expect(safeCustomerNext("/c/acme/\\evil", "acme")).toBe("/c/acme/home");
    expect(safeCustomerNext(undefined, "acme")).toBe("/c/acme/home");
    expect(safeCustomerNext(42, "acme")).toBe("/c/acme/home");
  });
});

describe("extractDigits", () => {
  it("keeps digits only, capped", () => {
    expect(extractDigits("12 34-56 78", 6)).toBe("123456");
    expect(extractDigits("Your code is 4821", 6)).toBe("4821");
    expect(extractDigits("abc", 6)).toBe("");
  });
});

describe("isValidPublicHandle", () => {
  it("mirrors the companies.public_handle CHECK", () => {
    expect(isValidPublicHandle("maverick-projects")).toBe(true);
    expect(isValidPublicHandle("abc")).toBe(true);
    expect(isValidPublicHandle("ab")).toBe(false);
    expect(isValidPublicHandle("Maverick")).toBe(false);
    expect(isValidPublicHandle("-maverick")).toBe(false);
    expect(isValidPublicHandle("maverick--projects")).toBe(false);
    expect(isValidPublicHandle("a".repeat(49))).toBe(false);
    expect(isValidPublicHandle("a".repeat(48))).toBe(true);
    expect(isValidPublicHandle("../etc")).toBe(false);
  });

  it("refuses a uuid-shaped string even though it fits the grammar (I4)", () => {
    expect(parsePublicHandle("ddee107c-33cd-483e-8278-0f8d8a180181")).toBeNull();
    expect(parsePublicHandle(" maverick")).toBeNull();
    expect(parsePublicHandle(42)).toBeNull();
    expect(parsePublicHandle("maverick-projects-ltd")).toBe("maverick-projects-ltd");
  });
});

describe("normalizeLogoUrl", () => {
  it("upgrades protocol-relative URLs and rejects non-http values", () => {
    expect(normalizeLogoUrl("//cdn.bubble.io/logo.png")).toBe("https://cdn.bubble.io/logo.png");
    expect(normalizeLogoUrl("https://x.com/a.png")).toBe("https://x.com/a.png");
    expect(normalizeLogoUrl("http://x.com/a.png")).toBe("http://x.com/a.png");
    expect(normalizeLogoUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeLogoUrl("data:image/png;base64,AAAA")).toBeNull();
    expect(normalizeLogoUrl("   ")).toBeNull();
    expect(normalizeLogoUrl(null)).toBeNull();
  });
});
