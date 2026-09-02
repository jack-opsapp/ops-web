/** @vitest-environment node */

const TEST_KEY = Buffer.alloc(32, 11).toString("base64");

describe("Instagram token cipher", () => {
  beforeEach(() => {
    process.env.INSTAGRAM_TOKEN_ENC_KEY = TEST_KEY;
  });

  afterEach(() => {
    process.env.INSTAGRAM_TOKEN_ENC_KEY = TEST_KEY;
  });

  it("encrypts with a unique authenticated envelope and round-trips", async () => {
    const { decryptInstagramToken, encryptInstagramToken } = await import(
      "@/lib/social/token-cipher"
    );
    const token = "IGAA-secret-token";
    const first = encryptInstagramToken(token);
    const second = encryptInstagramToken(token);

    expect(first).toMatch(/^ig-token:v1:/);
    expect(first).not.toContain(token);
    expect(first).not.toBe(second);
    expect(decryptInstagramToken(first)).toBe(token);
    expect(decryptInstagramToken(second)).toBe(token);
  });

  it("rejects plaintext, malformed envelopes, and tampering", async () => {
    const { decryptInstagramToken, encryptInstagramToken } = await import(
      "@/lib/social/token-cipher"
    );

    expect(() => decryptInstagramToken("plaintext-token")).toThrow(/envelope/i);
    expect(() => decryptInstagramToken("ig-token:v1:bad")).toThrow(/envelope/i);

    const parts = encryptInstagramToken("sensitive").split(":");
    const ciphertext = Buffer.from(parts[4], "base64");
    ciphertext[0] ^= 0xff;
    parts[4] = ciphertext.toString("base64");
    expect(() => decryptInstagramToken(parts.join(":"))).toThrow();
  });

  it("fails closed for missing or malformed keys", async () => {
    const { encryptInstagramToken } = await import("@/lib/social/token-cipher");

    delete process.env.INSTAGRAM_TOKEN_ENC_KEY;
    expect(() => encryptInstagramToken("secret")).toThrow(/INSTAGRAM_TOKEN_ENC_KEY/);

    process.env.INSTAGRAM_TOKEN_ENC_KEY = Buffer.alloc(16, 1).toString("base64");
    expect(() => encryptInstagramToken("secret")).toThrow(/32 bytes/);
  });
});
