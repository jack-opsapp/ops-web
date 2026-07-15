import { describe, expect, it } from "vitest";

import {
  hashMicrosoft365ClientState,
  matchesMicrosoft365ClientState,
} from "@/lib/email/microsoft365-webhook-security";

describe("Microsoft 365 webhook clientState", () => {
  it("stores a deterministic digest and compares the secret safely", async () => {
    const digest = await hashMicrosoft365ClientState("secret-state");

    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    await expect(
      matchesMicrosoft365ClientState("secret-state", digest)
    ).resolves.toBe(true);
    await expect(
      matchesMicrosoft365ClientState("forged-state", digest)
    ).resolves.toBe(false);
  });

  it("rejects blank or missing state", async () => {
    await expect(hashMicrosoft365ClientState("   ")).rejects.toThrow(/blank/i);
    await expect(matchesMicrosoft365ClientState("", null)).resolves.toBe(false);
  });
});
