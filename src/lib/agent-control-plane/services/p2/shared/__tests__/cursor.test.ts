import { describe, expect, it } from "vitest";

import {
  createP2ReadCursorCodec,
  P2ReadCursorError,
  type P2ReadCursorExpectation,
} from "../cursor";

const EXPECTATION: P2ReadCursorExpectation = {
  capabilityId: "list_tasks",
  schemaRevision: "2026-08-22.v1",
  capabilityManifestRevision: "2026-08-22.capability-manifest.v8",
  rankingRevision: "task-ranking:v1",
  actorUserId: "11111111-1111-4111-8111-111111111111",
  companyId: "22222222-2222-4222-8222-222222222222",
  oauthGrantId: "grant-1",
  grantedScopeDigest: `sha256:${"a".repeat(64)}`,
  permissionSnapshotRevision: `sha256:${"b".repeat(64)}`,
  queryHash: `sha256:${"c".repeat(64)}`,
  sourceRevisions: [
    { domain: "tasks", source_revision: 4 },
    { domain: "work_queue", source_revision: 7 },
  ],
  readAt: "2026-08-23T07:00:00.000Z",
};

const PREDECESSOR = {
  order: ["2026-08-23T08:00:00.000Z", 12],
  tie_breaker: "33333333-3333-4333-8333-333333333333",
} as const;

describe("P2 HMAC read cursor", () => {
  it("round trips a fully bound predecessor and its canonical order witness", () => {
    const codec = createP2ReadCursorCodec({
      keyId: "p2-test",
      key: Buffer.alloc(32, 7),
    });
    const token = codec.encode(
      { ...EXPECTATION, predecessor: PREDECESSOR },
      1_800_000_000
    );
    const decoded = codec.decode(token, EXPECTATION, 1_800_000_899);

    expect(decoded.predecessor).toEqual(PREDECESSOR);
    expect(decoded.predecessor_order_witness).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(decoded.issued_at).toBe(1_800_000_000);
    expect(decoded.expires_at).toBe(1_800_000_900);
    expect(Object.isFrozen(decoded)).toBe(true);
  });

  it("rejects tampering, expiration, and cross-tool replay", () => {
    const codec = createP2ReadCursorCodec({
      keyId: "p2-test",
      key: Buffer.alloc(32, 8),
    });
    const token = codec.encode(
      { ...EXPECTATION, predecessor: PREDECESSOR },
      1_800_000_000
    );
    const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;

    expect(() => codec.decode(tampered, EXPECTATION, 1_800_000_001)).toThrow(
      P2ReadCursorError
    );
    expect(() => codec.decode(token, EXPECTATION, 1_800_000_900)).toThrow(
      P2ReadCursorError
    );
    expect(() =>
      codec.decode(
        token,
        { ...EXPECTATION, capabilityId: "list_site_visits" },
        1_800_000_001
      )
    ).toThrow(P2ReadCursorError);
  });

  it("rejects a non-canonical revision vector before signing", () => {
    const codec = createP2ReadCursorCodec({
      keyId: "p2-test",
      key: Buffer.alloc(32, 9),
    });
    expect(() =>
      codec.encode({
        ...EXPECTATION,
        sourceRevisions: [...EXPECTATION.sourceRevisions].reverse(),
        predecessor: PREDECESSOR,
      })
    ).toThrow(P2ReadCursorError);
  });
});
