import { describe, it, expect } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { createEditorialReadHandler } from "@/lib/social/editorial/routes";
describe("editorial route boundaries", () => {
  it("requires admin before reading source snapshots", async () => {
    let read = false;
    const handler = createEditorialReadHandler({
      authenticate: async () => {
        throw NextResponse.json({}, { status: 403 });
      },
      read: async () => {
        read = true;
        return {};
      },
    });
    const response = await handler(
      new NextRequest("https://ops.test/api/admin/social/editorial")
    );
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(read).toBe(false);
  });
  it("returns no-store verified admin output", async () => {
    const handler = createEditorialReadHandler({
      authenticate: async () => {},
      read: async () => ({ mode: "prepare", runs: [] }),
    });
    const response = await handler(
      new NextRequest("https://ops.test/api/admin/social/editorial")
    );
    expect(await response.json()).toEqual({ mode: "prepare", runs: [] });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
