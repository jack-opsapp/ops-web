import { describe, expect, it } from "vitest";

import { buildAuthorizationResponseUrl } from "@/lib/agent-control-plane/mcp/oauth/authorization-response";

const REDIRECT_URI = "https://chatgpt.com/connector_platform_oauth_redirect";
const ISSUER = "https://app.opsapp.co";

describe("RFC 9207 authorization responses", () => {
  it("identifies the issuer on a successful response and preserves state", () => {
    const url = new URL(
      buildAuthorizationResponseUrl({
        redirectUri: REDIRECT_URI,
        issuer: ISSUER,
        state: "opaque state/+?",
        response: { kind: "code", code: "ops_mcp_ac_example" },
      })
    );

    expect(`${url.origin}${url.pathname}`).toBe(REDIRECT_URI);
    expect(url.searchParams.get("code")).toBe("ops_mcp_ac_example");
    expect(url.searchParams.getAll("iss")).toEqual([ISSUER]);
    expect(url.searchParams.get("state")).toBe("opaque state/+?");
    expect(url.searchParams.has("error")).toBe(false);
    expect([...url.searchParams.keys()].sort()).toEqual([
      "code",
      "iss",
      "state",
    ]);
    expect(url.search).toContain("iss=https%3A%2F%2Fapp.opsapp.co");
  });

  it("identifies the issuer on an explicit denial and omits absent state", () => {
    const url = new URL(
      buildAuthorizationResponseUrl({
        redirectUri: REDIRECT_URI,
        issuer: ISSUER,
        state: null,
        response: { kind: "error", error: "access_denied" },
      })
    );

    expect(url.searchParams.get("error")).toBe("access_denied");
    expect(url.searchParams.getAll("iss")).toEqual([ISSUER]);
    expect(url.searchParams.has("state")).toBe(false);
    expect(url.searchParams.has("code")).toBe(false);
    expect([...url.searchParams.keys()].sort()).toEqual(["error", "iss"]);
  });

  it.each([
    ["query", `${REDIRECT_URI}?already=present`],
    ["fragment", `${REDIRECT_URI}#fragment`],
  ])(
    "fails closed when the registered redirect carries a %s",
    (_label, redirectUri) => {
      expect(() =>
        buildAuthorizationResponseUrl({
          redirectUri,
          issuer: ISSUER,
          state: null,
          response: { kind: "error", error: "access_denied" },
        })
      ).toThrow("authorization_redirect_must_be_parameter_free");
    }
  );
});
