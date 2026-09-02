/** @vitest-environment node */

import {
  consumeInstagramOAuthState,
  createInstagramOAuthState,
  type InstagramOAuthStateStore,
} from "@/lib/social/instagram-oauth-state";

function store(): InstagramOAuthStateStore & {
  pruneExpired: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  consume: ReturnType<typeof vi.fn>;
} {
  return {
    pruneExpired: vi.fn(async () => undefined),
    insert: vi.fn(async () => undefined),
    consume: vi.fn(async () => null),
  };
}

describe("Instagram OAuth state", () => {
  it("stores only a SHA-256 digest with normalized admin context and a ten-minute expiry", async () => {
    const repository = store();
    const now = new Date("2026-09-02T20:00:00.000Z");
    const token = await createInstagramOAuthState(
      repository,
      "  JACKSON@OPSAPP.CO  ",
      now
    );

    expect(token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(repository.pruneExpired).toHaveBeenCalledWith(now.toISOString());
    expect(repository.insert).toHaveBeenCalledWith({
      nonceHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      adminEmail: "jackson@opsapp.co",
      expiresAt: "2026-09-02T20:10:00.000Z",
    });
    expect(repository.insert.mock.calls[0][0].nonceHash).not.toBe(token);
  });

  it("consumes the hashed state exactly once through the store", async () => {
    const repository = store();
    repository.consume.mockResolvedValueOnce("jackson@opsapp.co");
    repository.consume.mockResolvedValueOnce(null);

    const first = await consumeInstagramOAuthState(repository, "opaque-state");
    const second = await consumeInstagramOAuthState(repository, "opaque-state");

    expect(first).toBe("jackson@opsapp.co");
    expect(second).toBeNull();
    expect(repository.consume).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/^[a-f0-9]{64}$/)
    );
  });

  it("rejects invalid admin identities and oversized callback state", async () => {
    const repository = store();

    await expect(
      createInstagramOAuthState(repository, "not-an-email")
    ).rejects.toThrow(/admin email/i);
    await expect(
      consumeInstagramOAuthState(repository, "x".repeat(513))
    ).resolves.toBeNull();
    expect(repository.consume).not.toHaveBeenCalled();
  });
});
