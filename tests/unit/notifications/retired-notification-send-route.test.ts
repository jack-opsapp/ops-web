import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/notifications/send/route";

describe("retired POST /api/notifications/send", () => {
  it("cannot proxy arbitrary recipient IDs or copy to OneSignal", async () => {
    const response = await POST();
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Not found" });
  });
});
