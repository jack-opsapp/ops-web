import { describe, it, expect } from "vitest";
import { safeRedirectPath } from "@/lib/auth/safe-redirect";

describe("safeRedirectPath", () => {
  it("returns the fallback for empty input", () => {
    expect(safeRedirectPath(null)).toBe("/dashboard");
    expect(safeRedirectPath(undefined)).toBe("/dashboard");
    expect(safeRedirectPath("")).toBe("/dashboard");
  });

  it("honours a custom fallback when input is rejected", () => {
    expect(safeRedirectPath(null, "/login")).toBe("/login");
    expect(safeRedirectPath("https://evil.com", "/login")).toBe("/login");
  });

  it("preserves a root-relative path", () => {
    expect(safeRedirectPath("/dashboard")).toBe("/dashboard");
    expect(safeRedirectPath("/projects/new")).toBe("/projects/new");
    expect(safeRedirectPath("/")).toBe("/");
  });

  it("preserves the query string on a root-relative path", () => {
    // The reported bug: a client-seeded deep link must keep its params.
    expect(safeRedirectPath("/projects/new?clientId=abc")).toBe(
      "/projects/new?clientId=abc"
    );
    expect(safeRedirectPath("/projects/new?a=1&b=2")).toBe(
      "/projects/new?a=1&b=2"
    );
    // The canonical project deep-link shape.
    expect(safeRedirectPath("/dashboard?openProject=abc&mode=view")).toBe(
      "/dashboard?openProject=abc&mode=view"
    );
  });

  it("keeps a decoded space inside a query value (not a control char)", () => {
    // `?q=hello world` decodes to a raw space — legitimate, must survive.
    expect(safeRedirectPath("/search?q=hello world")).toBe(
      "/search?q=hello world"
    );
  });

  it("rejects absolute URLs (open-redirect)", () => {
    expect(safeRedirectPath("https://evil.com")).toBe("/dashboard");
    expect(safeRedirectPath("http://evil.com/x")).toBe("/dashboard");
    expect(safeRedirectPath("javascript:alert(1)")).toBe("/dashboard");
    expect(safeRedirectPath("data:text/html,x")).toBe("/dashboard");
  });

  it("rejects scheme-relative URLs", () => {
    expect(safeRedirectPath("//evil.com")).toBe("/dashboard");
    expect(safeRedirectPath("//evil.com/path")).toBe("/dashboard");
  });

  it("rejects backslash-smuggled targets browsers normalise to '//'", () => {
    expect(safeRedirectPath("/\\evil.com")).toBe("/dashboard");
    expect(safeRedirectPath("\\/evil.com")).toBe("/dashboard");
    expect(safeRedirectPath("/path\\to\\thing")).toBe("/dashboard");
  });

  it("rejects paths that are not root-relative", () => {
    expect(safeRedirectPath("projects/new")).toBe("/dashboard");
    expect(safeRedirectPath("../etc/passwd")).toBe("/dashboard");
    expect(safeRedirectPath("evil.com")).toBe("/dashboard");
  });

  it("rejects raw control characters (CR/LF/TAB smuggling)", () => {
    expect(safeRedirectPath("/foo\nbar")).toBe("/dashboard");
    expect(safeRedirectPath("/foo\tbar")).toBe("/dashboard");
    expect(safeRedirectPath("/foo\rbar")).toBe("/dashboard");
  });
});
