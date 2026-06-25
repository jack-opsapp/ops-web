// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { importSPKI, jwtVerify, decodeProtectedHeader } from "jose";
import { isAppStoreConfigured, mintToken } from "@/lib/analytics/app-store-client";

// Throwaway ES256 (P-256) keypair generated for tests only — not used anywhere real.
const PKCS8 = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgLGJOaYXeCWxYrVPB
hmxMSKU1AEVbJSgKsP8h3Yk9U/GhRANCAASARzuPsj2+6XmCgahyhp0giR8dVWRz
+vwm+fA5j7zb7qU/HL/nexlKjtTXo/cLdQVRJeaNDtOyBKjpfLuGA/dz
-----END PRIVATE KEY-----`;

const SPKI = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEgEc7j7I9vul5goGocoadIIkfHVVk
c/r8JvnwOY+82+6lPxy/53sZSo7U16P3C3UFUSXmjQ7TsgSo6Xy7hgP3cw==
-----END PUBLIC KEY-----`;

describe("isAppStoreConfigured", () => {
  beforeEach(() => {
    delete process.env.ASC_KEY_ID;
    delete process.env.ASC_ISSUER_ID;
    delete process.env.ASC_PRIVATE_KEY;
    delete process.env.ASC_APP_ID;
  });

  it("is false when any required var is missing", () => {
    process.env.ASC_KEY_ID = "K";
    process.env.ASC_ISSUER_ID = "I";
    process.env.ASC_PRIVATE_KEY = "P";
    // ASC_APP_ID missing
    expect(isAppStoreConfigured()).toBe(false);
  });

  it("is true when all four are set", () => {
    process.env.ASC_KEY_ID = "K";
    process.env.ASC_ISSUER_ID = "I";
    process.env.ASC_PRIVATE_KEY = "P";
    process.env.ASC_APP_ID = "123456789";
    expect(isAppStoreConfigured()).toBe(true);
  });
});

describe("mintToken", () => {
  const ISS = "11111111-2222-3333-4444-555555555555";

  beforeEach(() => {
    process.env.ASC_KEY_ID = "ABC123KEYID";
    process.env.ASC_ISSUER_ID = ISS;
    // Stored with literal \n to also exercise parsePrivateKey's newline handling.
    process.env.ASC_PRIVATE_KEY = PKCS8.replace(/\n/g, "\\n");
  });

  it("signs a verifiable ES256 JWT with correct header, claims, and exp <= 20min", async () => {
    const token = await mintToken();

    const header = decodeProtectedHeader(token);
    expect(header.alg).toBe("ES256");
    expect(header.kid).toBe("ABC123KEYID");
    expect(header.typ).toBe("JWT");

    const pub = await importSPKI(SPKI, "ES256");
    const { payload } = await jwtVerify(token, pub, {
      audience: "appstoreconnect-v1",
      issuer: ISS,
    });

    expect(payload.aud).toBe("appstoreconnect-v1");
    expect(payload.iss).toBe(ISS);
    const lifetime = (payload.exp as number) - (payload.iat as number);
    expect(lifetime).toBeGreaterThan(0);
    expect(lifetime).toBeLessThanOrEqual(1200);
  });

  it("throws when not configured", async () => {
    delete process.env.ASC_PRIVATE_KEY;
    await expect(mintToken()).rejects.toThrow();
  });
});
