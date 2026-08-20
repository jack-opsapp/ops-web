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

const CUSTOMER_DISCOVERY_EXPECTED = {
  capabilityId: "search_customers" as const,
  schemaRevision: "2026-08-20.v1",
  capabilityManifestRevision: "2026-08-20.capability-manifest.v7",
  rankingRevision: "customer-discovery-ranking:v1" as const,
  ruleRevisions: [],
  actorUserId: EXPECTED.actorUserId,
  companyId: EXPECTED.companyId,
  permissionSnapshotRevision: EXPECTED.permissionSnapshotRevision,
  queryHash: `sha256:${"c".repeat(64)}`,
} as const;

const CUSTOMER_DISCOVERY_CLAIMS = {
  capability_id: CUSTOMER_DISCOVERY_EXPECTED.capabilityId,
  schema_revision: CUSTOMER_DISCOVERY_EXPECTED.schemaRevision,
  capability_manifest_revision:
    CUSTOMER_DISCOVERY_EXPECTED.capabilityManifestRevision,
  ranking_revision: CUSTOMER_DISCOVERY_EXPECTED.rankingRevision,
  rule_revisions: [],
  actor_user_id: CUSTOMER_DISCOVERY_EXPECTED.actorUserId,
  company_id: CUSTOMER_DISCOVERY_EXPECTED.companyId,
  permission_snapshot_revision:
    CUSTOMER_DISCOVERY_EXPECTED.permissionSnapshotRevision,
  query_hash: CUSTOMER_DISCOVERY_EXPECTED.queryHash,
  source_revision: 92,
  read_as_of: "2026-08-12T17:59:58.000Z",
  rank_ordinal: 17,
  customer_kind: "sub_client" as const,
  customer_id: "44444444-4444-4444-8444-444444444444",
} as const;

const JOB_DISCOVERY_EXPECTED = {
  capabilityId: "search_jobs" as const,
  schemaRevision: "2026-08-20.v1",
  capabilityManifestRevision: "2026-08-20.capability-manifest.v7",
  rankingRevision: "job-discovery-ranking:v1" as const,
  ruleRevisions: [],
  actorUserId: EXPECTED.actorUserId,
  companyId: EXPECTED.companyId,
  permissionSnapshotRevision: EXPECTED.permissionSnapshotRevision,
  queryHash: `sha256:${"d".repeat(64)}`,
} as const;

const JOB_DISCOVERY_CLAIMS = {
  capability_id: JOB_DISCOVERY_EXPECTED.capabilityId,
  schema_revision: JOB_DISCOVERY_EXPECTED.schemaRevision,
  capability_manifest_revision:
    JOB_DISCOVERY_EXPECTED.capabilityManifestRevision,
  ranking_revision: JOB_DISCOVERY_EXPECTED.rankingRevision,
  rule_revisions: [],
  actor_user_id: JOB_DISCOVERY_EXPECTED.actorUserId,
  company_id: JOB_DISCOVERY_EXPECTED.companyId,
  permission_snapshot_revision:
    JOB_DISCOVERY_EXPECTED.permissionSnapshotRevision,
  query_hash: JOB_DISCOVERY_EXPECTED.queryHash,
  source_revision: 93,
  read_as_of: "2026-08-12T17:59:57.000Z",
  rank_ordinal: 23,
  job_kind: "project" as const,
  job_id: "55555555-5555-4555-8555-555555555555",
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

function mutateSignedPayload(
  cursor: string,
  mutation: Readonly<Record<string, unknown>>
): string {
  const payloadStart = cursor.lastIndexOf(":") + 1;
  const signatureStart = cursor.indexOf(".", payloadStart);
  const mutatedPayload = Buffer.from(
    JSON.stringify({ ...payload(cursor), ...mutation })
  ).toString("base64url");
  return `${cursor.slice(0, payloadStart)}${mutatedPayload}${cursor.slice(signatureStart)}`;
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

  it("round-trips the bounded customer-discovery rank and identity tuple", () => {
    const cursorCodec = codec();
    const cursor = cursorCodec.encode(CUSTOMER_DISCOVERY_CLAIMS);

    expect(cursor.length).toBeLessThanOrEqual(512);
    expect(
      cursorCodec.decode({
        cursor,
        expected: CUSTOMER_DISCOVERY_EXPECTED,
      })
    ).toMatchObject(CUSTOMER_DISCOVERY_CLAIMS);
    expect(payload(cursor)).toMatchObject({
      c: "u",
      o: 17,
      k: "sub_client",
      x: CUSTOMER_DISCOVERY_CLAIMS.customer_id,
    });
  });

  it("round-trips the bounded job-discovery rank and identity tuple", () => {
    const cursorCodec = codec();
    const cursor = cursorCodec.encode(JOB_DISCOVERY_CLAIMS);

    expect(cursor.length).toBeLessThanOrEqual(512);
    expect(
      cursorCodec.decode({ cursor, expected: JOB_DISCOVERY_EXPECTED })
    ).toMatchObject(JOB_DISCOVERY_CLAIMS);
    expect(payload(cursor)).toMatchObject({
      c: "j",
      o: 23,
      k: "project",
      x: JOB_DISCOVERY_CLAIMS.job_id,
    });
  });

  it("authenticates every customer-discovery source and keyset wire field", () => {
    const cursorCodec = codec();
    const cursor = cursorCodec.encode(CUSTOMER_DISCOVERY_CLAIMS);
    const mutations = [
      { r: 94 },
      { a: "2026-08-12T17:59:56.000Z" },
      { o: 18 },
      { k: "client" },
      { x: "66666666-6666-4666-8666-666666666666" },
    ] as const;

    for (const mutation of mutations) {
      expect(() =>
        cursorCodec.decode({
          cursor: mutateSignedPayload(cursor, mutation),
          expected: CUSTOMER_DISCOVERY_EXPECTED,
        })
      ).toThrow(OperationalReadCursorError);
    }
  });

  it("authenticates every job-discovery source and keyset wire field", () => {
    const cursorCodec = codec();
    const cursor = cursorCodec.encode(JOB_DISCOVERY_CLAIMS);
    const mutations = [
      { r: 94 },
      { a: "2026-08-12T17:59:56.000Z" },
      { o: 24 },
      { k: "opportunity" },
      { x: "77777777-7777-4777-8777-777777777777" },
    ] as const;

    for (const mutation of mutations) {
      expect(() =>
        cursorCodec.decode({
          cursor: mutateSignedPayload(cursor, mutation),
          expected: JOB_DISCOVERY_EXPECTED,
        })
      ).toThrow(OperationalReadCursorError);
    }
  });

  it.each([
    ["schema", { schemaRevision: "2026-08-20.v2" }],
    [
      "manifest",
      { capabilityManifestRevision: "2026-08-21.capability-manifest.v8" },
    ],
    ["ranking", { rankingRevision: "customer-discovery-ranking:v2" }],
    ["actor", { actorUserId: "99999999-9999-4999-8999-999999999999" }],
    ["company", { companyId: "99999999-9999-4999-8999-999999999999" }],
    ["query", { queryHash: `sha256:${"e".repeat(64)}` }],
  ])(
    "binds customer discovery to the expected %s identity",
    (_label, change) => {
      const cursorCodec = codec();
      const cursor = cursorCodec.encode(CUSTOMER_DISCOVERY_CLAIMS);

      expect(() =>
        cursorCodec.decode({
          cursor,
          expected: {
            ...CUSTOMER_DISCOVERY_EXPECTED,
            ...change,
          } as unknown as typeof CUSTOMER_DISCOVERY_EXPECTED,
        })
      ).toThrow(OperationalReadCursorError);
    }
  );

  it("distinguishes discovery permission drift from malformed or cross-capability replay", () => {
    const cursorCodec = codec();
    const cursor = cursorCodec.encode(CUSTOMER_DISCOVERY_CLAIMS);

    expect(() =>
      cursorCodec.decode({
        cursor,
        expected: {
          ...CUSTOMER_DISCOVERY_EXPECTED,
          permissionSnapshotRevision: `sha256:${"f".repeat(64)}`,
        },
      })
    ).toThrow(OperationalReadCursorPermissionStaleError);
    expect(() =>
      cursorCodec.decode({ cursor, expected: JOB_DISCOVERY_EXPECTED })
    ).toThrow(OperationalReadCursorError);
  });

  it("rejects out-of-bound or caller-expanded discovery keysets", () => {
    const cursorCodec = codec();

    for (const rank_ordinal of [0, 501]) {
      expect(() =>
        cursorCodec.encode({
          ...CUSTOMER_DISCOVERY_CLAIMS,
          rank_ordinal,
        })
      ).toThrow(OperationalReadCursorError);
    }
    expect(() =>
      cursorCodec.encode({
        ...JOB_DISCOVERY_CLAIMS,
        normalized_match_value: "caller-selected-sort-key",
      } as typeof JOB_DISCOVERY_CLAIMS)
    ).toThrow(OperationalReadCursorError);
  });

  it("supports exactly a one-hour maximum cursor lifetime", () => {
    let clock = NOW;
    const cursorCodec = createOperationalReadCursorCodec({
      key: KEY,
      keyId: "task11-key",
      version: 1,
      ttlSeconds: 3_600,
      now: () => clock,
    });
    const cursor = cursorCodec.encode(CUSTOMER_DISCOVERY_CLAIMS);

    clock = new Date("2026-08-12T18:59:59.000Z");
    expect(
      cursorCodec.decode({ cursor, expected: CUSTOMER_DISCOVERY_EXPECTED })
    ).toMatchObject(CUSTOMER_DISCOVERY_CLAIMS);
    clock = new Date("2026-08-12T19:00:00.000Z");
    expect(() =>
      cursorCodec.decode({ cursor, expected: CUSTOMER_DISCOVERY_EXPECTED })
    ).toThrow(OperationalReadCursorError);
    expect(() =>
      createOperationalReadCursorCodec({
        key: KEY,
        keyId: "task11-key",
        version: 1,
        ttlSeconds: 3_601,
      })
    ).toThrow(TypeError);
  });
});
