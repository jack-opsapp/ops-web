import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SERVER_AUTH_COOKIE_CONSUMERS = [
  "src/app/(auth)/reconnect-inbox/page.tsx",
  "src/app/(auth)/reconnect-inbox/success/page.tsx",
  "src/app/account/spec/[id]/request-refund/page.tsx",
] as const;

describe("server auth cookie consumers", () => {
  it.each(SERVER_AUTH_COOKIE_CONSUMERS)(
    "%s delegates cookie selection to the canonical auth helper",
    (path) => {
      const source = readFileSync(path, "utf8");

      expect(source).toContain("selectFirebaseIdTokenCookie(");
      expect(source).toMatch(
        /selectFirebaseIdTokenCookie\(\s*cookieStore\.get\(OPS_AUTH_COOKIE_NAME\)\?\.value,\s*cookieStore\.get\(LEGACY_SESSION_COOKIE_NAME\)\?\.value\s*\)/
      );
      expect(source).not.toMatch(
        /get\("__session"\)[\s\S]{0,160}get\("ops-auth-token"\)/
      );
    }
  );

  it("uses selected-token freshness only as the reconnect success CTA hint", () => {
    const source = readFileSync(
      "src/app/(auth)/reconnect-inbox/success/page.tsx",
      "utf8"
    );

    expect(source).toContain("getFirebaseIdTokenCookieMaxAge(token)");
    expect(source).toMatch(
      /const isAuthenticated\s*=\s*token !== null\s*&&\s*getFirebaseIdTokenCookieMaxAge\(token\) !== null/
    );
  });
});
