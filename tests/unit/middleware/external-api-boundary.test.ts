import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { config, middleware } from "@/middleware";

describe("middleware — external API boundary", () => {
  it("explicitly excludes /v1 from the dashboard middleware matcher", () => {
    expect(config.matcher).toHaveLength(1);
    expect(config.matcher[0]).toContain("|v1");
  });

  it("never redirects /v1 based on OPS session cookies", () => {
    const response = middleware(
      new NextRequest("https://ops.example/v1/intake/config", {
        headers: {
          cookie: "__session=dashboard-session; ops-auth-token=browser-token",
        },
      })
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("passes bearer handling through to /v1 route authentication", () => {
    const response = middleware(
      new NextRequest("https://ops.example/v1/analytics/leads", {
        headers: { authorization: "Bearer route-owned-credential" },
      })
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});
