import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  getFirebaseIdTokenCookieMaxAge,
  selectFirebaseIdTokenCookie,
} from "@/lib/auth/firebase-id-token-cookie";

const NOW_MS = Date.UTC(2026, 8, 3, 20, 0, 0);
const NOW_SECONDS = Math.floor(NOW_MS / 1000);

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "RS256", typ: "JWT" })}.${encode(payload)}.signature`;
}

describe("Firebase ID token cookie lifetime", () => {
  it.each([
    ["malformed token", "not-a-jwt"],
    ["missing exp", jwt({ sub: "firebase-user" })],
    ["non-numeric exp", jwt({ exp: "tomorrow" })],
    ["expired token", jwt({ exp: NOW_SECONDS - 1 })],
    ["60-second refresh boundary", jwt({ exp: NOW_SECONDS + 60 })],
  ])("rejects %s", (_label, token) => {
    expect(getFirebaseIdTokenCookieMaxAge(token, NOW_MS)).toBeNull();
  });

  it("subtracts the 60-second refresh skew from a fresh token", () => {
    expect(
      getFirebaseIdTokenCookieMaxAge(
        jwt({ exp: NOW_SECONDS + 10 * 60 }),
        NOW_MS
      )
    ).toBe(9 * 60);
  });

  it("caps an implausibly long token lifetime at one hour", () => {
    expect(
      getFirebaseIdTokenCookieMaxAge(
        jwt({ exp: NOW_SECONDS + 24 * 60 * 60 }),
        NOW_MS
      )
    ).toBe(60 * 60);
  });
});

describe("Firebase auth cookie precedence", () => {
  it("uses the canonical token whenever both cookie names are present", () => {
    expect(selectFirebaseIdTokenCookie("canonical", "legacy")).toBe(
      "canonical"
    );
  });

  it("falls back to the legacy session only when the canonical cookie is absent", () => {
    expect(selectFirebaseIdTokenCookie(null, "legacy")).toBe("legacy");
  });
});

describe("middleware-facing E2E auth fixtures", () => {
  it.each([
    "tests/e2e/helpers/catalog-setup-auth.ts",
    "tests/e2e/fixtures/inbox-populated.ts",
    "tests/e2e/pipeline-table.spec.ts",
    "tests/e2e/projects-table-v2-phase4.spec.ts",
    "tests/e2e/projects-table-v2-phase5.spec.ts",
    "tests/e2e/won-conversion.spec.ts",
  ])("%s uses a structurally fresh JWT", (path) => {
    const source = readFileSync(path, "utf8");
    const token = source.match(
      /(?:export\s+)?const AUTH_TOKEN\s*=\s*"([^"]+)"/
    )?.[1];

    expect(token).toBeDefined();
    expect(getFirebaseIdTokenCookieMaxAge(token!, NOW_MS)).toBe(60 * 60);
  });
});
