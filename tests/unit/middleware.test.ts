import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";

function jwt(exp: number): string {
  const encode = (value: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
    sub: "firebase-user",
    exp,
  })}.signature`;
}

const freshToken = () => jwt(Math.floor(Date.now() / 1000) + 10 * 60);
const expiredToken = () => jwt(Math.floor(Date.now() / 1000) - 60);

function req(
  path: string,
  opts: {
    token?: string;
    legacyToken?: string;
    adminReturnHeader?: string;
  } = {}
) {
  const cookies = [
    opts.token ? `ops-auth-token=${opts.token}` : null,
    opts.legacyToken ? `__session=${opts.legacyToken}` : null,
  ].filter(Boolean);
  const headers = new Headers();
  if (cookies.length > 0) headers.set("cookie", cookies.join("; "));
  if (opts.adminReturnHeader) {
    headers.set("x-ops-admin-return-to", opts.adminReturnHeader);
  }
  return new NextRequest(`http://localhost${path}`, {
    headers,
  });
}

/** The `redirect` param the middleware stamped onto the /login URL. */
function redirectParam(res: Response): string | null {
  const location = res.headers.get("location");
  if (!location) return null;
  return new URL(location).searchParams.get("redirect");
}

describe("middleware — protected route → login redirect", () => {
  it("preserves the query string of the intended destination", () => {
    // The reported bug: a client-seeded deep link must survive the login bounce.
    const res = middleware(req("/projects/new?clientId=abc-123"));
    expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
    expect(redirectParam(res)).toBe("/projects/new?clientId=abc-123");
  });

  it("preserves multiple query params", () => {
    const res = middleware(req("/pipeline?status=won&view=table"));
    expect(redirectParam(res)).toBe("/pipeline?status=won&view=table");
  });

  it("still round-trips a bare path with no query", () => {
    const res = middleware(req("/projects/new"));
    expect(redirectParam(res)).toBe("/projects/new");
  });

  it("clears an expired canonical token and preserves the exact admin destination", () => {
    const res = middleware(
      req("/admin/acquisition?range=30d&channel=organic", {
        token: expiredToken(),
        legacyToken: freshToken(),
      })
    );

    expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
    expect(redirectParam(res)).toBe(
      "/admin/acquisition?range=30d&channel=organic"
    );
    expect(res.cookies.get("ops-auth-token")?.value).toBe("");
    expect(res.cookies.get("__session")?.value).toBe("");
  });
});

describe("middleware — auth recovery routing", () => {
  it("lets the client auth gate resolve a login request instead of trusting an unverified cookie", () => {
    const res = middleware(
      req("/login?redirect=%2Fadmin%2Facquisition", { token: freshToken() })
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("forwards a trusted exact admin destination and overwrites an inbound spoof", () => {
    const res = middleware(
      req("/admin/acquisition?range=30d", {
        token: freshToken(),
        adminReturnHeader: "//evil.example/steal",
      })
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-request-x-ops-admin-return-to")).toBe(
      "/admin/acquisition?range=30d"
    );
  });
});

describe("middleware — public developer reference", () => {
  it("serves the API reference without an OPS session", () => {
    const res = middleware(req("/developers/api"));

    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("does not change the reference response when dashboard cookies exist", () => {
    const res = middleware(req("/developers/api", { token: freshToken() }));

    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("serves the MCP guide without an OPS session", () => {
    const res = middleware(req("/developers/mcp"));

    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("does not change the MCP guide response when dashboard cookies exist", () => {
    const res = middleware(req("/developers/mcp", { token: freshToken() }));

    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });
});
