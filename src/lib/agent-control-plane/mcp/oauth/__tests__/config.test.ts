import { afterEach, describe, expect, it, vi } from "vitest";

import {
  canonicalizeResourceUri,
  resolveMcpOAuthConfig,
} from "@/lib/agent-control-plane/mcp/oauth/config";

const ISSUER = "https://app.opsapp.co";

/**
 * `getAppUrl()` prefers NEXT_PUBLIC_APP_URL and falls back to
 * NEXT_PUBLIC_BASE_URL, so both are stubbed to keep the resolution
 * deterministic no matter what the ambient shell carries.
 */
function stubAppUrl(value: string): void {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", value);
  vi.stubEnv("NEXT_PUBLIC_BASE_URL", value);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("RFC 8707 resource canonicalization", () => {
  it.each([
    {
      label: "lowercases the scheme and host",
      input: "HTTPS://App.OpsApp.CO/api/mcp",
      expected: "https://app.opsapp.co/api/mcp",
    },
    {
      label: "elides the default https port",
      input: "https://app.opsapp.co:443/api/mcp",
      expected: "https://app.opsapp.co/api/mcp",
    },
    {
      label: "elides the default http port",
      input: "http://localhost:80/api/mcp",
      expected: "http://localhost/api/mcp",
    },
    {
      label: "keeps a non-default port",
      input: "https://app.opsapp.co:8443/api/mcp",
      expected: "https://app.opsapp.co:8443/api/mcp",
    },
    {
      label: "keeps the local development port",
      input: "http://localhost:3000/api/mcp",
      expected: "http://localhost:3000/api/mcp",
    },
    {
      label: "strips a single trailing slash",
      input: "https://app.opsapp.co/api/mcp/",
      expected: "https://app.opsapp.co/api/mcp",
    },
    {
      label: "strips multiple trailing slashes",
      input: "https://app.opsapp.co/api/mcp////",
      expected: "https://app.opsapp.co/api/mcp",
    },
    {
      label: "reduces a bare root path to the origin",
      input: "https://app.opsapp.co/",
      expected: "https://app.opsapp.co",
    },
    {
      label: "reduces a slash-only path to the origin",
      input: "https://app.opsapp.co///",
      expected: "https://app.opsapp.co",
    },
    {
      label: "accepts an origin with no path at all",
      input: "https://app.opsapp.co",
      expected: "https://app.opsapp.co",
    },
    {
      label: "strips a fragment",
      input: "https://app.opsapp.co/api/mcp#section",
      expected: "https://app.opsapp.co/api/mcp",
    },
    {
      label: "strips an empty fragment",
      input: "https://app.opsapp.co/api/mcp#",
      expected: "https://app.opsapp.co/api/mcp",
    },
    {
      label: "strips a fragment behind a trailing slash",
      input: "https://APP.opsapp.co:443/api/mcp/#frag",
      expected: "https://app.opsapp.co/api/mcp",
    },
    {
      label: "preserves path case",
      input: "https://app.opsapp.co/API/McP",
      expected: "https://app.opsapp.co/API/McP",
    },
    {
      label: "preserves a query string",
      input: "https://app.opsapp.co/api/mcp?tenant=Maverick",
      expected: "https://app.opsapp.co/api/mcp?tenant=Maverick",
    },
  ])("$label", ({ input, expected }) => {
    expect(canonicalizeResourceUri(input)).toBe(expected);
  });

  it("is idempotent — canonicalizing an already-canonical value is a no-op", () => {
    const once = canonicalizeResourceUri("HTTPS://App.OpsApp.CO:443/api/mcp/");

    expect(once).toBe(`${ISSUER}/api/mcp`);
    expect(canonicalizeResourceUri(once as string)).toBe(once);
  });

  it.each([
    { label: "credentials in the authority", input: "https://user:pass@app.opsapp.co/api/mcp" },
    { label: "a username with no password", input: "https://user@app.opsapp.co/api/mcp" },
    { label: "an empty username with a password", input: "https://:pass@app.opsapp.co/api/mcp" },
    { label: "an ftp scheme", input: "ftp://app.opsapp.co/api/mcp" },
    { label: "a file scheme", input: "file:///etc/passwd" },
    { label: "a javascript scheme", input: "javascript:alert(1)" },
    { label: "a data scheme", input: "data:text/plain,mcp" },
    { label: "a scheme-relative reference", input: "//app.opsapp.co/api/mcp" },
    { label: "a relative path", input: "/api/mcp" },
    { label: "unparseable garbage", input: "not a url" },
    { label: "an empty string", input: "" },
    { label: "a bare hostname", input: "app.opsapp.co/api/mcp" },
  ])("rejects $label", ({ input }) => {
    expect(canonicalizeResourceUri(input)).toBeNull();
  });
});

describe("MCP OAuth topology resolution", () => {
  it("derives every endpoint from the configured app origin", () => {
    stubAppUrl(ISSUER);

    expect(resolveMcpOAuthConfig()).toEqual({
      issuer: ISSUER,
      resource: `${ISSUER}/api/mcp`,
      authorizationEndpoint: `${ISSUER}/oauth/authorize`,
      tokenEndpoint: `${ISSUER}/api/mcp/oauth/token`,
      registrationEndpoint: `${ISSUER}/api/mcp/oauth/register`,
      revocationEndpoint: `${ISSUER}/api/mcp/oauth/revoke`,
      protectedResourceMetadataUrl: `${ISSUER}/.well-known/oauth-protected-resource/api/mcp`,
    });
  });

  it("canonicalizes a messily configured origin before deriving endpoints", () => {
    stubAppUrl("HTTPS://App.OpsApp.CO:443/");

    const config = resolveMcpOAuthConfig();

    expect(config.issuer).toBe(ISSUER);
    expect(config.resource).toBe(`${ISSUER}/api/mcp`);
    expect(config.protectedResourceMetadataUrl).toBe(
      `${ISSUER}/.well-known/oauth-protected-resource/api/mcp`
    );
  });

  it("keeps the local development origin intact, port included", () => {
    stubAppUrl("http://localhost:3000");

    const config = resolveMcpOAuthConfig();

    expect(config.issuer).toBe("http://localhost:3000");
    expect(config.resource).toBe("http://localhost:3000/api/mcp");
    expect(config.tokenEndpoint).toBe(
      "http://localhost:3000/api/mcp/oauth/token"
    );
  });

  it("returns a frozen configuration", () => {
    stubAppUrl(ISSUER);

    expect(Object.isFrozen(resolveMcpOAuthConfig())).toBe(true);
  });

  it("keeps the protected-resource metadata path aligned with the resource path", () => {
    stubAppUrl(ISSUER);

    const config = resolveMcpOAuthConfig();
    const resourcePath = new URL(config.resource).pathname;

    expect(config.protectedResourceMetadataUrl).toBe(
      `${config.issuer}/.well-known/oauth-protected-resource${resourcePath}`
    );
  });

  it.each([
    { label: "unparseable garbage", value: "not a url" },
    { label: "a non-http scheme", value: "ftp://app.opsapp.co" },
    { label: "credentials in the authority", value: "https://user:pass@app.opsapp.co" },
  ])("throws when the app origin is $label", ({ value }) => {
    stubAppUrl(value);

    expect(() => resolveMcpOAuthConfig()).toThrow(TypeError);
  });
});
