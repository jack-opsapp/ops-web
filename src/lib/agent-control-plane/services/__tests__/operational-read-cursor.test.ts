import { describe, expect, it } from "vitest";

import { CursorPageSchema } from "@/lib/agent-control-plane/contracts";
import {
  createOperationalReadCursorCodec,
  OperationalReadCursorError,
  OperationalReadCursorPermissionStaleError,
} from "../operational-read-cursor";

const KEY = new Uint8Array(32).fill(17);
const NOW = new Date("2026-08-12T18:00:00.000Z");
const EXPECTED = {
  capabilityId: "list_job_readiness_issues" as const,
  schemaRevision: "2026-08-07.v1",
  capabilityManifestRevision: "2026-08-12.capability-manifest.v4",
  ruleRevisions: [
    "site-photos-missing:v1",
    "customer-record-unresolved:v1",
    "schedule-unconfirmed:v1",
    "crew-unassigned:v1",
    "address-incomplete:v1",
  ],
  actorUserId: "11111111-1111-4111-8111-111111111111",
  companyId: "22222222-2222-4222-8222-222222222222",
  permissionSnapshotRevision: `sha256:${"a".repeat(64)}`,
  queryHash: `sha256:${"b".repeat(64)}`,
} as const;
const CLAIMS = {
  capability_id: EXPECTED.capabilityId,
  schema_revision: EXPECTED.schemaRevision,
  capability_manifest_revision: EXPECTED.capabilityManifestRevision,
  rule_revisions: [...EXPECTED.ruleRevisions],
  actor_user_id: EXPECTED.actorUserId,
  company_id: EXPECTED.companyId,
  permission_snapshot_revision: EXPECTED.permissionSnapshotRevision,
  query_hash: EXPECTED.queryHash,
  source_revision: 91,
  read_as_of: "2026-08-12T17:59:59.000Z",
  first_scheduled_start_utc: "2026-08-19T16:00:00.000Z",
  project_id: "33333333-3333-4333-8333-333333333333",
} as const;

function codec(key = KEY, version = 1) {
  return createOperationalReadCursorCodec({
    key,
    keyId: "task11-key",
    version,
    now: () => NOW,
  });
}

function payload(cursor: string) {
  const encoded = cursor.split(":")[3]!.split(".")[0]!;
  return JSON.parse(Buffer.from(encoded, "base64url").toString()) as Record<
    string,
    unknown
  >;
}

describe("operational read cursor", () => {
  it("round-trips all trusted bindings in a prompt-contract-safe token", () => {
    const cursorCodec = codec();
    const cursor = cursorCodec.encode(CLAIMS);

    expect(cursor.length).toBeLessThanOrEqual(512);
    expect(
      CursorPageSchema.parse({ next_cursor: cursor, has_more: true })
    ).toEqual({ next_cursor: cursor, has_more: true });
    expect(cursorCodec.decode({ cursor, expected: EXPECTED })).toMatchObject(
      CLAIMS
    );
    expect(cursor).not.toContain(EXPECTED.permissionSnapshotRevision);
  });

  it.each([
    (cursor: string) => `${cursor}=`,
    (cursor: string) => cursor.replace(".", "=."),
    (cursor: string) => cursor.replace(".", ".="),
    (cursor: string) => cursor.replace("ops_cursor:v1", "ops_cursor:v2"),
    (cursor: string) => cursor.replace("task11-key", "task11_key"),
  ])("rejects noncanonical or prefix-tampered tokens %#", (mutate) => {
    const cursorCodec = codec();
    const cursor = mutate(cursorCodec.encode(CLAIMS));

    expect(() => cursorCodec.decode({ cursor, expected: EXPECTED })).toThrow(
      OperationalReadCursorError
    );
  });

  it("types only a current permission-snapshot mismatch as stale", () => {
    const cursorCodec = codec();
    const cursor = cursorCodec.encode(CLAIMS);

    expect(() =>
      cursorCodec.decode({
        cursor,
        expected: {
          ...EXPECTED,
          permissionSnapshotRevision: `sha256:${"c".repeat(64)}`,
        },
      })
    ).toThrow(OperationalReadCursorPermissionStaleError);
    expect(() =>
      cursorCodec.decode({
        cursor,
        expected: {
          ...EXPECTED,
          companyId: "99999999-9999-4999-8999-999999999999",
        },
      })
    ).toThrow(OperationalReadCursorError);
  });

  it("binds the format version into the signature even when key material is reused", () => {
    const versionOne = codec(KEY, 1).encode(CLAIMS);
    const relabeled = versionOne.replace("ops_cursor:v1", "ops_cursor:v2");

    expect(() =>
      codec(KEY, 2).decode({ cursor: relabeled, expected: EXPECTED })
    ).toThrow(OperationalReadCursorError);
  });

  it("uses a key-scoped HMAC permission digest and rejects unsafe key IDs", () => {
    const firstCursor = codec(new Uint8Array(32).fill(17)).encode(CLAIMS);
    const secondCursor = codec(new Uint8Array(32).fill(18)).encode(CLAIMS);

    expect(payload(firstCursor).p).not.toBe(payload(secondCursor).p);
    for (const keyId of ["bad:key", "bad.key", "bad=key", "bad key"]) {
      expect(() =>
        createOperationalReadCursorCodec({ key: KEY, keyId, version: 1 })
      ).toThrow(TypeError);
    }
  });
});
