import { describe, expect, it } from "vitest";
import {
  GENERIC_MAILBOX_TOKENS,
  isPlaceholderClientName,
} from "@/lib/email/placeholder-name";

describe("isPlaceholderClientName", () => {
  it("treats a bare email local-part as a placeholder", () => {
    expect(isPlaceholderClientName("canprojack", "canprojack@gmail.com")).toBe(
      true
    );
  });

  it("matches the local part case-insensitively", () => {
    expect(isPlaceholderClientName("CanProJack", "canprojack@gmail.com")).toBe(
      true
    );
  });

  it("treats a name containing an @ as a placeholder", () => {
    expect(
      isPlaceholderClientName("canprojack@gmail.com", "canprojack@gmail.com")
    ).toBe(true);
  });

  it("treats an empty or missing name as a placeholder", () => {
    expect(isPlaceholderClientName(null, "canprojack@gmail.com")).toBe(true);
    expect(isPlaceholderClientName("   ", "canprojack@gmail.com")).toBe(true);
  });

  it("treats generic mailbox labels as placeholders", () => {
    expect(isPlaceholderClientName("info", "info@marigoldcoop.ca")).toBe(true);
    expect(isPlaceholderClientName("Sales Team", "hello@vendor.com")).toBe(true);
    expect(isPlaceholderClientName("Office", "reception@vitrum.com")).toBe(true);
    expect(isPlaceholderClientName("noreply", "docs@vitrum.com")).toBe(true);
  });

  it("keeps a real person name", () => {
    expect(isPlaceholderClientName("Cecilia Reyes", "creyes@gmail.com")).toBe(
      false
    );
  });

  it("keeps a real business name", () => {
    expect(
      isPlaceholderClientName("Bob's Roofing", "bobsroofing@gmail.com")
    ).toBe(false);
  });

  it("keeps a real name when no sender email is known", () => {
    expect(isPlaceholderClientName("Cecilia Reyes", null)).toBe(false);
  });

  it("exposes the generic mailbox token set", () => {
    expect(GENERIC_MAILBOX_TOKENS.has("no-reply")).toBe(true);
    expect(GENERIC_MAILBOX_TOKENS.has("office")).toBe(true);
    expect(GENERIC_MAILBOX_TOKENS.has("reyes")).toBe(false);
  });
});
