import { describe, expect, it } from "vitest";
import { isSafeInternalNotificationActionUrl } from "@/lib/notifications/notification-action-url";

describe("isSafeInternalNotificationActionUrl", () => {
  it.each([
    "/pipeline",
    "/settings?section=team",
    "/dashboard?openProject=0f343b77-5186-4581-8c97-91a9f3f655ef&mode=view",
  ])("accepts an internal relative route: %s", (value) => {
    expect(isSafeInternalNotificationActionUrl(value)).toBe(true);
  });

  it.each([
    "javascript:alert(1)",
    "https://attacker.example/phish",
    "http://attacker.example/phish",
    "//attacker.example/phish",
    "/\\\\attacker.example/phish",
    " /pipeline",
    "/pipeline\njavascript:alert(1)",
    "",
  ])("rejects an unsafe notification action URL: %s", (value) => {
    expect(isSafeInternalNotificationActionUrl(value)).toBe(false);
  });

  it("allows null because notifications may be informational", () => {
    expect(isSafeInternalNotificationActionUrl(null)).toBe(true);
  });
});
