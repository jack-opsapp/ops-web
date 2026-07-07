import { describe, expect, it } from "vitest";
import type { JWTPayload } from "jose";
import { isFirebaseIssuedToken } from "@/lib/firebase/admin-verify";

/**
 * isFirebaseIssuedToken is the defense-in-depth guard on every write to
 * users.firebase_uid (audit risk R8). OPS verifies Firebase ID tokens only, so
 * in production it is always true — these cases prove it correctly discriminates
 * the Firebase issuer from anything else, should a non-Firebase issuer ever be
 * introduced.
 */
describe("isFirebaseIssuedToken", () => {
  it("is true for a Firebase securetoken issuer", () => {
    const claims = {
      iss: "https://securetoken.google.com/ops-project",
      sub: "firebase-uid",
    } as JWTPayload;
    expect(isFirebaseIssuedToken(claims)).toBe(true);
  });

  it("is false for a Supabase (or any non-Firebase) issuer", () => {
    const claims = {
      iss: "https://ops-project.supabase.co/auth/v1",
      sub: "00000000-0000-0000-0000-000000000000",
    } as JWTPayload;
    expect(isFirebaseIssuedToken(claims)).toBe(false);
  });

  it("is false when iss is missing", () => {
    expect(isFirebaseIssuedToken({ sub: "x" } as JWTPayload)).toBe(false);
  });

  it("is false when iss is a non-string value", () => {
    expect(
      isFirebaseIssuedToken({ iss: 123 as unknown as string } as JWTPayload)
    ).toBe(false);
  });

  it("does not match a look-alike issuer that only contains the Firebase host", () => {
    // Must be a prefix match, not a substring — an attacker-controlled host
    // that merely embeds the Firebase domain elsewhere is rejected.
    const claims = {
      iss: "https://evil.example.com/https://securetoken.google.com/ops",
      sub: "x",
    } as JWTPayload;
    expect(isFirebaseIssuedToken(claims)).toBe(false);
  });
});
