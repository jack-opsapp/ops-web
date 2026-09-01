import { describe, expect, it, vi } from "vitest";

import {
  P2RepositoryBoundaryError,
  readThroughP2RepositoryBoundary,
} from "../repository-boundary";

interface TrustedFixtureRepository {
  readonly trusted: true;
}

const repository = Object.freeze({ trusted: true as const });
const isTrusted = (value: unknown): value is TrustedFixtureRepository =>
  value === repository;

describe("P2 repository boundary", () => {
  it("rejects a forged repository without invoking the read", async () => {
    const read = vi.fn(async () => ({ ok: true }));
    await expect(
      readThroughP2RepositoryBoundary({
        repository: { trusted: true },
        isTrusted,
        read,
        parse: (value) => value,
      })
    ).rejects.toMatchObject({
      name: "P2RepositoryBoundaryError",
      code: "P2_REPOSITORY_UNTRUSTED",
      message: "P2_REPOSITORY_UNTRUSTED",
    });
    expect(read).not.toHaveBeenCalled();
  });

  it("aborts both before the await and after an in-flight read settles", async () => {
    const before = new AbortController();
    before.abort();
    const beforeRead = vi.fn(async () => ({ ok: true }));
    await expect(
      readThroughP2RepositoryBoundary({
        repository,
        isTrusted,
        signal: before.signal,
        read: beforeRead,
        parse: (value) => value,
      })
    ).rejects.toMatchObject({ code: "P2_REPOSITORY_ABORTED" });
    expect(beforeRead).not.toHaveBeenCalled();

    const after = new AbortController();
    await expect(
      readThroughP2RepositoryBoundary({
        repository,
        isTrusted,
        signal: after.signal,
        read: async () => {
          after.abort();
          return { ok: true };
        },
        parse: (value) => value,
      })
    ).rejects.toMatchObject({ code: "P2_REPOSITORY_ABORTED" });
  });

  it("maps source and parser failures to fixed privacy-safe errors without raw causes", async () => {
    const sourceSecret = "postgres://admin:secret@private/table";
    let sourceError: unknown;
    try {
      await readThroughP2RepositoryBoundary({
        repository,
        isTrusted,
        read: async () => {
          throw new Error(sourceSecret);
        },
        parse: (value) => value,
      });
    } catch (error) {
      sourceError = error;
    }
    expect(sourceError).toBeInstanceOf(P2RepositoryBoundaryError);
    expect(sourceError).toMatchObject({ code: "P2_REPOSITORY_READ_FAILED" });
    expect(JSON.stringify(sourceError)).not.toContain(sourceSecret);
    expect((sourceError as Error).cause).toBeUndefined();

    await expect(
      readThroughP2RepositoryBoundary({
        repository,
        isTrusted,
        read: async () => ({ provider_id: "secret" }),
        parse: () => {
          throw new Error("raw database row invalid");
        },
      })
    ).rejects.toMatchObject({ code: "P2_REPOSITORY_RESULT_INVALID" });
  });

  it("returns a deeply frozen parsed snapshot", async () => {
    const result = await readThroughP2RepositoryBoundary({
      repository,
      isTrusted,
      read: async () => ({ nested: { values: [1, 2] } }),
      parse: (value) => value as { nested: { values: number[] } },
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.nested)).toBe(true);
    expect(Object.isFrozen(result.nested.values)).toBe(true);
  });
});
