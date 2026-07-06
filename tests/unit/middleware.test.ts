import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";

/** Build a request; `authed` attaches the Firebase session cookie the
 *  middleware looks for. */
function req(path: string, opts: { authed?: boolean } = {}) {
  return new NextRequest(`http://localhost${path}`, {
    headers: opts.authed ? { cookie: "__session=fake-token" } : {},
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
});

describe("middleware — authenticated user on /login (post-login redirect)", () => {
  it("returns the user to a safe same-origin path, query intact", () => {
    const res = middleware(
      req("/login?redirect=%2Fprojects%2Fnew%3FclientId%3Dabc", {
        authed: true,
      })
    );
    const location = new URL(res.headers.get("location")!);
    expect(location.origin).toBe("http://localhost");
    expect(location.pathname).toBe("/projects/new");
    expect(location.search).toBe("?clientId=abc");
  });

  it("refuses an absolute-URL redirect (open-redirect guard)", () => {
    const res = middleware(
      req("/login?redirect=https%3A%2F%2Fevil.com", { authed: true })
    );
    const location = new URL(res.headers.get("location")!);
    expect(location.origin).toBe("http://localhost");
    expect(location.pathname).toBe("/dashboard");
  });

  it("refuses a scheme-relative redirect (open-redirect guard)", () => {
    const res = middleware(
      req("/login?redirect=%2F%2Fevil.com", { authed: true })
    );
    const location = new URL(res.headers.get("location")!);
    expect(location.host).toBe("localhost");
    expect(location.pathname).toBe("/dashboard");
  });

  it("defaults to /dashboard when no redirect is supplied", () => {
    const res = middleware(req("/login", { authed: true }));
    expect(new URL(res.headers.get("location")!).pathname).toBe("/dashboard");
  });
});
