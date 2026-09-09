import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import { hashEmail, normalizeEmail } from "@/lib/ads/identifier-hashing";

const sha256hex = (s: string) => createHash("sha256").update(s).digest("hex");

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Owner@Example.COM ")).toBe("owner@example.com");
  });
  it("removes dots from the local part for gmail and googlemail only", () => {
    expect(normalizeEmail("Jack.Sweet@Gmail.com")).toBe("jacksweet@gmail.com");
    expect(normalizeEmail("j.a.c.k@googlemail.com")).toBe("jack@googlemail.com");
    expect(normalizeEmail("first.last@example.com")).toBe("first.last@example.com");
  });
  it("returns null for blanks and malformed addresses", () => {
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail("   ")).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail(undefined)).toBeNull();
    expect(normalizeEmail("not-an-email")).toBeNull();
    expect(normalizeEmail("two@@example.com")).toBeNull();
  });
});

describe("hashEmail", () => {
  it("normalizes then SHA-256-hex hashes an email", () => {
    expect(hashEmail("  Jack.Sweet@Gmail.com ")).toBe(sha256hex("jacksweet@gmail.com"));
    expect(hashEmail("Owner@Example.com")).toBe(sha256hex("owner@example.com"));
    expect(hashEmail("")).toBeNull();
  });
  it("produces lowercase hex of length 64", () => {
    expect(hashEmail("a@b.co")).toMatch(/^[0-9a-f]{64}$/);
  });
});
