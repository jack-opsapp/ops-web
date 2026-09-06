import { describe, it, expect, afterEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import {
  createEditorialCronHandler,
  createEditorialReadHandler,
} from "@/lib/social/editorial/routes";
const secret = "x".repeat(40);
afterEach(() => delete process.env.CRON_SECRET);
describe("editorial route boundaries", () => {
  it("fails closed with missing or wrong cron secret without running", async () => {
    let runs = 0;
    const handler = createEditorialCronHandler(async () => {
      runs++;
      return { state: "idle" };
    });
    expect(
      (
        await handler(
          new NextRequest("https://ops.test/api/cron/social-editorial")
        )
      ).status
    ).toBe(503);
    process.env.CRON_SECRET = secret;
    expect(
      (
        await handler(
          new NextRequest("https://ops.test/api/cron/social-editorial")
        )
      ).status
    ).toBe(401);
    expect(runs).toBe(0);
  });
  it("authenticated cron runs and conceals internal errors", async () => {
    process.env.CRON_SECRET = secret;
    const handler = createEditorialCronHandler(async () => {
      throw Error("SECRET_PROVIDER_PAYLOAD");
    });
    const response = await handler(
      new NextRequest("https://ops.test/api/cron/social-editorial", {
        headers: { authorization: `Bearer ${secret}` },
      })
    );
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("SECRET_PROVIDER");
  });
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

describe("manual draft trigger", () => {
  it("requires explicit authenticated POST action and delegates only preparation", async () => {
    process.env.CRON_SECRET = secret;
    let scheduled = 0;
    let date: unknown;
    const handler = createEditorialCronHandler(
      async () => {
        scheduled++;
      },
      async (value) => {
        date = value;
        return { state: "prepared" };
      }
    );
    const response = await handler(
      new NextRequest("https://ops.test/api/cron/social-editorial", {
        method: "POST",
        headers: { authorization: `Bearer ${secret}` },
        body: JSON.stringify({ action: "prepare_now", date: "2026-09-05" }),
      })
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ state: "prepared" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(date).toBe("2026-09-05");
    expect(scheduled).toBe(0);
  });
  it("rejects missing auth, malformed bodies and publication requests before running", async () => {
    process.env.CRON_SECRET = secret;
    let runs = 0;
    const handler = createEditorialCronHandler(
      async () => {
        runs++;
      },
      async () => {
        runs++;
      }
    );
    const denied = await handler(
      new NextRequest("https://ops.test/api/cron/social-editorial", {
        method: "POST",
        body: "{}",
      })
    );
    expect(denied.status).toBe(401);
    for (const body of [
      "{",
      "{}",
      '{"action":"publish","date":"2026-09-05"}',
      '{"action":"prepare_now","date":"2026-09-05","force":true}',
      '{"action":"prepare_now","date":"today"}',
    ]) {
      const response = await handler(
        new NextRequest("https://ops.test/api/cron/social-editorial", {
          method: "POST",
          headers: { authorization: `Bearer ${secret}` },
          body,
        })
      );
      expect(response.status).toBe(400);
    }
    expect(runs).toBe(0);
  });
  it("GET does not interpret a manual action in its URL", async () => {
    process.env.CRON_SECRET = secret;
    let manual = false;
    const handler = createEditorialCronHandler(
      async () => ({ state: "outside_window" }),
      async () => {
        manual = true;
      }
    );
    const response = await handler(
      new NextRequest(
        "https://ops.test/api/cron/social-editorial?action=prepare_now&date=2026-09-05",
        { headers: { authorization: `Bearer ${secret}` } }
      )
    );
    expect(await response.json()).toEqual({ state: "outside_window" });
    expect(manual).toBe(false);
  });
});
