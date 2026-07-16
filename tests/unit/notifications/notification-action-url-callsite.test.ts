import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("notification action URL call sites", () => {
  it("keeps the trial rail action relative while email keeps its absolute CTA", () => {
    const source = readFileSync(
      join(process.cwd(), "src/lib/api/services/trial-expiry-service.ts"),
      "utf8"
    );

    const inAppMethod = source.slice(
      source.indexOf("async createInAppNotifications"),
      source.indexOf("};", source.indexOf("async createInAppNotifications"))
    );
    expect(inAppMethod).toContain('action_url: "/settings?tab=subscription"');
    expect(inAppMethod).not.toContain("action_url: params.subscribeUrl");
  });
});
