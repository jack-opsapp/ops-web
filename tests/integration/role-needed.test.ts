import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/notifications/role-needed/route";

describe("retired POST /api/notifications/role-needed", () => {
  it("fails closed regardless of body-trusted identity or copy", async () => {
    const response = await POST();
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Not found" });
  });
});
