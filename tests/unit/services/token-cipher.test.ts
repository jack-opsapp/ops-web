import { afterEach, beforeEach, describe, expect, it } from "vitest";

// A deterministic 32-byte test key (base64). Real key comes from env in prod.
const TEST_KEY = Buffer.alloc(32, 7).toString("base64");

async function importFresh() {
  // Re-import so module-level code (if any) sees the current env.
  return await import("@/lib/api/services/token-cipher");
}

describe("token-cipher (AES-256-GCM at rest)", () => {
  beforeEach(() => {
    process.env.QB_TOKEN_ENC_KEY = TEST_KEY;
  });
  afterEach(() => {
    process.env.QB_TOKEN_ENC_KEY = TEST_KEY;
  });

  it("round-trips a secret", async () => {
    const { encryptToken, decryptToken } = await importFresh();
    const secret = "qbo-refresh-token-RT1-62-abc123";
    const enc = encryptToken(secret);
    expect(enc).not.toContain(secret); // ciphertext must not contain plaintext
    expect(enc.startsWith("enc:v1:")).toBe(true);
    expect(decryptToken(enc)).toBe(secret);
  });

  it("produces a unique ciphertext each time (random IV)", async () => {
    const { encryptToken, decryptToken } = await importFresh();
    const a = encryptToken("same-value");
    const b = encryptToken("same-value");
    expect(a).not.toBe(b);
    expect(decryptToken(a)).toBe("same-value");
    expect(decryptToken(b)).toBe("same-value");
  });

  it("detects tampering via the GCM auth tag", async () => {
    const { encryptToken, decryptToken } = await importFresh();
    const enc = encryptToken("sensitive");
    const parts = enc.split(":");
    // Flip a byte in the ciphertext segment.
    const ct = Buffer.from(parts[4], "base64");
    ct[0] = ct[0] ^ 0xff;
    parts[4] = ct.toString("base64");
    expect(() => decryptToken(parts.join(":"))).toThrow();
  });

  it("treats non-enveloped values as legacy plaintext (tolerant read)", async () => {
    const { decryptToken } = await importFresh();
    expect(decryptToken("legacy-plaintext-token")).toBe("legacy-plaintext-token");
    expect(decryptToken(null)).toBeNull();
    expect(decryptToken(undefined)).toBeNull();
  });

  it("encryptNullable passes null/empty through", async () => {
    const { encryptNullable } = await importFresh();
    expect(encryptNullable(null)).toBeNull();
    expect(encryptNullable("")).toBeNull();
    expect(encryptNullable(undefined)).toBeNull();
    expect(encryptNullable("x")).not.toBeNull();
  });

  it("fails closed when the key is missing (never silently stores plaintext)", async () => {
    delete process.env.QB_TOKEN_ENC_KEY;
    const { encryptToken } = await importFresh();
    expect(() => encryptToken("secret")).toThrow(/QB_TOKEN_ENC_KEY/);
  });

  it("rejects a key that is not 32 bytes", async () => {
    process.env.QB_TOKEN_ENC_KEY = Buffer.alloc(16, 1).toString("base64");
    const { encryptToken } = await importFresh();
    expect(() => encryptToken("secret")).toThrow(/32 bytes/);
  });
});
