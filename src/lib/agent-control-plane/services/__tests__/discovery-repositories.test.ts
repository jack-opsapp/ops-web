import { describe, expect, it } from "vitest";

import { REGISTERED_ACTOR_PERMISSION_KEYS } from "@/lib/agent-control-plane/actor/authority-repository";
import {
  CUSTOMER_DISCOVERY_RANKING_REVISION,
  DISCOVERY_CAPABILITY_SCHEMA_REVISION,
  JOB_DISCOVERY_RANKING_REVISION,
} from "@/lib/agent-control-plane/contracts/discovery";
import {
  CustomerDiscoveryRepositoryError,
  createSupabaseCustomerDiscoveryRepository,
  isTrustedCustomerDiscoveryRepository,
} from "../customer-discovery-repository";
import {
  createSupabaseJobDiscoveryRepository,
  isTrustedJobDiscoveryRepository,
  JobDiscoveryRepositoryError,
} from "../job-discovery-repository";
import {
  hashOperationalProjection,
  type CanonicalProjection,
} from "../operational-read-projection";
import {
  FROZEN_V7_OPERATIONAL_CURSOR_MANIFEST_REVISION,
  hashOperationalReadQuery,
} from "../operational-read-cursor";
import {
  AtomicDiscoveryClaim,
  CAPABILITY_MANIFEST_REVISION,
  DISCOVERY_ACTOR_ID,
  DISCOVERY_CLIENT_ID,
  DISCOVERY_COMPANY_ID,
  DISCOVERY_CUSTOMER_INPUT,
  DISCOVERY_GENERATED_AT,
  DISCOVERY_JOB_INPUT,
  DISCOVERY_PERMISSION_REVISION,
  DISCOVERY_READ_AT,
  DISCOVERY_SOURCE_REVISION,
  StubDiscoveryRpcClient,
  cloneDiscoveryFixture,
  convertedProjectDiscoveryMatch,
  customerDiscoveryAuthorization,
  customerDiscoveryMatch,
  customerDiscoverySnapshot,
  discoveryCursorCodec,
  discoverySourceFence,
  jobDiscoveryAuthorization,
  jobDiscoverySnapshot,
  opportunityDiscoveryMatch,
  recoupleDiscoveryClaim,
  recoupleDiscoveryCollection,
} from "./fixtures/discovery-fixtures";

type MutableSnapshot = Record<string, unknown>;

function customerRepository(
  client: StubDiscoveryRpcClient,
  codec = discoveryCursorCodec({
    now: () => new Date(DISCOVERY_GENERATED_AT),
  })
) {
  return createSupabaseCustomerDiscoveryRepository(client, codec);
}

function jobRepository(
  client: StubDiscoveryRpcClient,
  codec = discoveryCursorCodec({
    now: () => new Date(DISCOVERY_GENERATED_AT),
  })
) {
  return createSupabaseJobDiscoveryRepository(client, codec);
}

function claims(snapshot: MutableSnapshot): AtomicDiscoveryClaim[] {
  return snapshot.match_claims as AtomicDiscoveryClaim[];
}

function collection(snapshot: MutableSnapshot): AtomicDiscoveryClaim {
  return snapshot.collection_claim as AtomicDiscoveryClaim;
}

function cursorAnchorOrderWitness(snapshot: MutableSnapshot) {
  return collection(snapshot).raw.cursor_anchor_order_witness as {
    rank_ordinal: number;
    raw: Record<string, unknown>;
  };
}

function selectionAnchors(claim: AtomicDiscoveryClaim) {
  return (
    claim.selection_witness as {
      anchors: Array<Record<string, unknown>>;
    }
  ).anchors;
}

function recoupleExistingProjection(claim: AtomicDiscoveryClaim): void {
  const hash = hashOperationalProjection(
    claim.proof.projection as CanonicalProjection
  );
  claim.proof.source_content_hash = hash;
  claim.proof.source_version.version = `${claim.proof.source_version.source_type}:v1:${hash}`;
  claim.source_version.version = claim.proof.source_version.version;
  claim.evidence[0]!.version = claim.proof.source_version.version;
}

describe("customer discovery repository boundary", () => {
  it("uses the exact current-only RPC and server-owned argument map", async () => {
    const authorization = await customerDiscoveryAuthorization();
    const client = new StubDiscoveryRpcClient([
      {
        data: customerDiscoverySnapshot(authorization),
        error: null,
      },
    ]);
    const snapshot = await customerRepository(client).read({ authorization });

    expect(client.calls).toEqual([
      {
        functionName: "read_agent_customer_discovery_as_system",
        args: {
          p_request_id: authorization.actorContext.requestId,
          p_actor_user_id: DISCOVERY_ACTOR_ID,
          p_company_id: DISCOVERY_COMPANY_ID,
          p_permission_snapshot_revision: DISCOVERY_PERMISSION_REVISION,
          p_registered_permission_keys: [...REGISTERED_ACTOR_PERMISSION_KEYS],
          p_capability_id: "search_customers",
          p_capability_revision: authorization.capabilityRevision,
          p_capability_manifest_revision: CAPABILITY_MANIFEST_REVISION,
          p_capability_schema_revision: DISCOVERY_CAPABILITY_SCHEMA_REVISION,
          p_ranking_revision: CUSTOMER_DISCOVERY_RANKING_REVISION,
          p_required_oauth_scopes: ["ops.customers.read"],
          p_clients_scope: "all",
          p_lookup: "name",
          p_query: "acme construction",
          p_customer_kinds: ["client", "sub_client"],
          p_read_as_of: null,
          p_cursor_source_revision: null,
          p_cursor_rank_ordinal: null,
          p_cursor_customer_kind: null,
          p_cursor_customer_id: null,
          p_limit: 2,
        },
      },
    ]);
    expect(Object.keys(client.calls[0]!.args)).not.toEqual(
      expect.arrayContaining([
        "p_cursor",
        "p_as_of",
        "p_sort",
        "p_column",
        "p_direction",
        "p_raw_limit",
        "p_policy",
      ])
    );
    expect(snapshot.match_claims[0]!.raw.customer_ref.id).toBe(
      DISCOVERY_CLIENT_ID
    );
    expect(snapshot.page).toEqual({ next_cursor: null, has_more: false });
  });

  it("forwards stronger exact-contact authority without ever returning the lookup value", async () => {
    const rawInput = {
      lookup: "exact_email",
      query: "dispatch@example.com",
      customer_kinds: ["client"],
      limit: 1,
    } as const;
    const authorization = await customerDiscoveryAuthorization(rawInput);
    const match = customerDiscoveryMatch(1, { basis: "exact_email" });
    const client = new StubDiscoveryRpcClient([
      {
        data: customerDiscoverySnapshot(authorization, [match]),
        error: null,
      },
    ]);

    const result = await customerRepository(client).read({ authorization });

    expect(client.calls[0]!.args.p_required_oauth_scopes).toEqual([
      "ops.customer_contacts.read",
      "ops.customers.read",
    ]);
    expect(client.calls[0]!.args.p_query).toBe("dispatch@example.com");
    expect(JSON.stringify(result.match_claims[0]!.raw)).not.toContain(
      "dispatch@example.com"
    );
  });

  it("requires an exact-contact selection witness bound to query and identity", async () => {
    const authorization = await customerDiscoveryAuthorization({
      lookup: "exact_email",
      query: "dispatch@example.com",
      customer_kinds: ["client"],
      limit: 1,
    });
    const claim = customerDiscoveryMatch(1, { basis: "exact_email" });
    const wire = cloneDiscoveryFixture(
      customerDiscoverySnapshot(authorization, [claim])
    ) as MutableSnapshot;
    delete claims(wire)[0]!.selection_witness;
    recoupleDiscoveryClaim(claims(wire)[0]!, "match");
    recoupleDiscoveryCollection(wire);

    await expect(
      customerRepository(
        new StubDiscoveryRpcClient([{ data: wire, error: null }])
      ).read({ authorization })
    ).rejects.toMatchObject({ code: "CUSTOMER_DISCOVERY_INVALID" });
  });

  it.each([
    ["exact_email", "dispatch@example.com"],
    ["exact_phone", "+16045550123"],
  ] as const)(
    "rejects a fully rehashed %s witness whose query binding was changed",
    async (lookup, query) => {
      const authorization = await customerDiscoveryAuthorization({
        lookup,
        query,
        customer_kinds: ["client"],
        limit: 1,
      });
      const wire = cloneDiscoveryFixture(
        customerDiscoverySnapshot(authorization, [
          customerDiscoveryMatch(1, { basis: lookup }),
        ])
      ) as MutableSnapshot;
      const claim = claims(wire)[0]!;
      const witness = claim.selection_witness as {
        query_binding_hash: string;
      };
      witness.query_binding_hash = `sha256:${"f".repeat(64)}`;
      recoupleDiscoveryClaim(claim, "match");
      recoupleDiscoveryCollection(wire);

      await expect(
        customerRepository(
          new StubDiscoveryRpcClient([{ data: wire, error: null }])
        ).read({ authorization })
      ).rejects.toMatchObject({ code: "CUSTOMER_DISCOVERY_INVALID" });
    }
  );

  it("captures the RPC client and read-input getters exactly once", async () => {
    const authorization = await customerDiscoveryAuthorization();
    const stub = new StubDiscoveryRpcClient([
      { data: customerDiscoverySnapshot(authorization), error: null },
    ]);
    let rpcReads = 0;
    const client = Object.create(null) as StubDiscoveryRpcClient;
    Object.defineProperty(client, "rpc", {
      get() {
        rpcReads += 1;
        return stub.rpc.bind(stub);
      },
    });
    const repository = createSupabaseCustomerDiscoveryRepository(
      client,
      discoveryCursorCodec()
    );
    let authorizationReads = 0;
    let signalReads = 0;
    const input = Object.create(null) as {
      authorization: typeof authorization;
      signal?: AbortSignal;
    };
    Object.defineProperties(input, {
      authorization: {
        get() {
          authorizationReads += 1;
          return authorization;
        },
      },
      signal: {
        get() {
          signalReads += 1;
          return undefined;
        },
      },
    });

    await repository.read(input);

    expect(rpcReads).toBe(1);
    expect(authorizationReads).toBe(1);
    expect(signalReads).toBe(1);
  });

  it("is nominal, clone-resistant, strict, and deeply freezes a valid snapshot", async () => {
    const authorization = await customerDiscoveryAuthorization();
    const wire = customerDiscoverySnapshot(authorization);
    const repository = customerRepository(
      new StubDiscoveryRpcClient([{ data: wire, error: null }])
    );

    const snapshot = await repository.read({ authorization });

    expect(isTrustedCustomerDiscoveryRepository(repository)).toBe(true);
    expect(isTrustedCustomerDiscoveryRepository({ ...repository })).toBe(false);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.match_claims)).toBe(true);
    expect(Object.isFrozen(snapshot.match_claims[0]!.proof.projection)).toBe(
      true
    );

    const forgedClient = new StubDiscoveryRpcClient([]);
    await expect(
      customerRepository(forgedClient).read({
        authorization: { ...authorization } as typeof authorization,
      })
    ).rejects.toMatchObject({ code: "CUSTOMER_DISCOVERY_INVALID" });
    expect(forgedClient.calls).toHaveLength(0);
  });

  it("retains a mandatory independently hashed collection proof for empty results", async () => {
    const authorization = await customerDiscoveryAuthorization();
    const client = new StubDiscoveryRpcClient([
      { data: customerDiscoverySnapshot(authorization, []), error: null },
    ]);

    const snapshot = await customerRepository(client).read({ authorization });

    expect(snapshot.match_claims).toEqual([]);
    expect(snapshot.collection_claim.proof.projection).toMatchObject({
      retained_proof_sources: [],
      collection: { returned_match_count: 0, page_rows: [] },
    });
    expect(snapshot.collection_claim.proof.source_content_hash).not.toBe(
      snapshot.source_fence.version
    );
  });

  it("accepts exactly 26 raw page identities only as 25 claims plus one sentinel", async () => {
    const rawInput = {
      ...DISCOVERY_CUSTOMER_INPUT,
      limit: 25,
    };
    const authorization = await customerDiscoveryAuthorization(rawInput);
    const matches = Array.from({ length: 25 }, (_, index) =>
      customerDiscoveryMatch(index + 1)
    );
    const wire = customerDiscoverySnapshot(authorization, matches, {
      hasMore: true,
      authorizedCandidateCount: 26,
    });

    const snapshot = await customerRepository(
      new StubDiscoveryRpcClient([{ data: wire, error: null }])
    ).read({ authorization });

    expect(snapshot.raw_page_count).toBe(26);
    expect(snapshot.match_claims).toHaveLength(25);
    expect(snapshot.page.has_more).toBe(true);
    expect(snapshot.page.next_cursor).toMatch(/^ops_cursor:/);
  });

  it("rejects a 27th raw row, a mismatched sentinel count, and a 502nd authorized candidate", async () => {
    const authorization = await customerDiscoveryAuthorization();
    const base = customerDiscoverySnapshot(
      authorization,
      [customerDiscoveryMatch(1), customerDiscoveryMatch(2)],
      { hasMore: true, authorizedCandidateCount: 3 }
    );
    const mutations: Array<(snapshot: MutableSnapshot) => void> = [
      (snapshot) => {
        snapshot.page_rows = Array.from({ length: 27 }, () => ({
          rank_ordinal: 1,
          source_kind: "client",
          source_id: DISCOVERY_CLIENT_ID,
        }));
        snapshot.raw_page_count = 27;
      },
      (snapshot) => {
        snapshot.raw_page_count = 2;
      },
      (snapshot) => {
        snapshot.authorized_candidate_count = 502;
      },
    ];

    for (const mutate of mutations) {
      const wire = cloneDiscoveryFixture(base) as MutableSnapshot;
      mutate(wire);
      recoupleDiscoveryCollection(wire);
      await expect(
        customerRepository(
          new StubDiscoveryRpcClient([{ data: wire, error: null }])
        ).read({ authorization })
      ).rejects.toMatchObject({ code: "CUSTOMER_DISCOVERY_INVALID" });
    }
  });

  it("returns only the fixed proof-bound query-bound state for candidate 501", async () => {
    const authorization = await customerDiscoveryAuthorization();
    const wire = customerDiscoverySnapshot(authorization, [], {
      queryBound: true,
    });

    const snapshot = await customerRepository(
      new StubDiscoveryRpcClient([{ data: wire, error: null }])
    ).read({ authorization });

    expect(snapshot.authorized_candidate_count).toBe(501);
    expect(snapshot.gaps).toEqual(["SOURCE_QUERY_BOUND"]);
    expect(snapshot.match_claims).toEqual([]);
    expect(snapshot.collection_claim).toBeDefined();
    expect(snapshot.page).toEqual({ next_cursor: null, has_more: false });
  });

  it.each(["email", "phone", "notes", "description", "private_fields"])(
    "rejects fully rehashed forbidden customer field %s",
    async (field) => {
      const authorization = await customerDiscoveryAuthorization();
      const wire = cloneDiscoveryFixture(
        customerDiscoverySnapshot(authorization)
      ) as MutableSnapshot;
      const claim = claims(wire)[0]!;
      claim.raw[field] =
        field === "private_fields"
          ? { employee_home_phone: "+16045550199" }
          : "forbidden-source-value";
      recoupleDiscoveryClaim(claim, "match");
      recoupleDiscoveryCollection(wire);

      await expect(
        customerRepository(
          new StubDiscoveryRpcClient([{ data: wire, error: null }])
        ).read({ authorization })
      ).rejects.toMatchObject({ code: "CUSTOMER_DISCOVERY_INVALID" });
    }
  );

  it.each([
    "actor_user_id",
    "company_id",
    "capability_id",
    "capability_revision",
    "capability_manifest_revision",
    "schema_revision",
    "permission_snapshot_revision",
    "canonical_input",
    "read_at",
    "source_revision",
    "ranking_revision",
  ])(
    "rejects fully rehashed child projection binding drift in %s",
    async (key) => {
      const authorization = await customerDiscoveryAuthorization();
      const wire = cloneDiscoveryFixture(
        customerDiscoverySnapshot(authorization)
      ) as MutableSnapshot;
      const claim = claims(wire)[0]!;
      claim.proof.projection[key] =
        key === "source_revision"
          ? DISCOVERY_SOURCE_REVISION + 1
          : key === "canonical_input"
            ? { lookup: "name", query: "foreign", customer_kinds: ["client"] }
            : "attacker-rebound";
      recoupleDiscoveryClaim(claim, "match");
      recoupleDiscoveryCollection(wire);

      await expect(
        customerRepository(
          new StubDiscoveryRpcClient([{ data: wire, error: null }])
        ).read({ authorization })
      ).rejects.toMatchObject({ code: "CUSTOMER_DISCOVERY_INVALID" });
    }
  );

  it("rejects a fully rehashed customer name that does not match the canonical query", async () => {
    const authorization = await customerDiscoveryAuthorization();
    const wire = cloneDiscoveryFixture(
      customerDiscoverySnapshot(authorization)
    ) as MutableSnapshot;
    const claim = claims(wire)[0]!;
    claim.raw.display_name = "Completely unrelated customer";
    recoupleDiscoveryClaim(claim, "match");
    recoupleDiscoveryCollection(wire);

    await expect(
      customerRepository(
        new StubDiscoveryRpcClient([{ data: wire, error: null }])
      ).read({ authorization })
    ).rejects.toMatchObject({ code: "CUSTOMER_DISCOVERY_INVALID" });
  });

  it("rejects fully rehashed customer claims outside the canonical order", async () => {
    const authorization = await customerDiscoveryAuthorization();
    const exact = {
      ...customerDiscoveryMatch(2, { basis: "exact_name" }),
      display_name: "Acme Construction",
    };
    const wire = customerDiscoverySnapshot(authorization, [
      customerDiscoveryMatch(1, { basis: "prefix_name" }),
      exact,
    ]);

    await expect(
      customerRepository(
        new StubDiscoveryRpcClient([{ data: wire, error: null }])
      ).read({ authorization })
    ).rejects.toMatchObject({ code: "CUSTOMER_DISCOVERY_INVALID" });
  });

  it("applies the safe kind tie-break to exact-contact results", async () => {
    const authorization = await customerDiscoveryAuthorization({
      lookup: "exact_email",
      query: "dispatch@example.com",
      customer_kinds: ["client", "sub_client"],
      limit: 2,
    });
    const wire = customerDiscoverySnapshot(authorization, [
      customerDiscoveryMatch(1, {
        kind: "sub_client",
        basis: "exact_email",
      }),
      customerDiscoveryMatch(2, { kind: "client", basis: "exact_email" }),
    ]);

    await expect(
      customerRepository(
        new StubDiscoveryRpcClient([{ data: wire, error: null }])
      ).read({ authorization })
    ).rejects.toMatchObject({ code: "CUSTOMER_DISCOVERY_INVALID" });
  });

  it("rejects unsafe exact-contact identity strings even for a single claim", async () => {
    const authorization = await customerDiscoveryAuthorization({
      lookup: "exact_email",
      query: "dispatch@example.com",
      customer_kinds: ["client"],
      limit: 1,
    });
    for (const unsafeDisplayName of [
      "Dispatch\u061c Team",
      "Dispatch\u200e Team",
      "Dispatch\u200f Team",
      "Dispatch\u202e Team",
      "Dispatch\uFEFF Team",
      "\uFEFFDispatch Team",
      "Dispatch Team\uFEFF",
      " Dispatch Team",
      "Dispatch Team ",
    ]) {
      const wire = cloneDiscoveryFixture(
        customerDiscoverySnapshot(authorization, [
          customerDiscoveryMatch(1, { basis: "exact_email" }),
        ])
      ) as MutableSnapshot;
      const claim = claims(wire)[0]!;
      claim.raw.display_name = unsafeDisplayName;
      recoupleDiscoveryClaim(claim, "match");
      recoupleDiscoveryCollection(wire);

      await expect(
        customerRepository(
          new StubDiscoveryRpcClient([{ data: wire, error: null }])
        ).read({ authorization })
      ).rejects.toMatchObject({ code: "CUSTOMER_DISCOVERY_INVALID" });
    }
  });

  it("rejects fully rehashed UUID case aliases and uppercase proof identities", async () => {
    const authorization = await customerDiscoveryAuthorization();
    const lower = customerDiscoveryMatch(1);
    const upperId = lower.customer_ref.id.toUpperCase();
    const upper = {
      ...customerDiscoveryMatch(2),
      customer_ref: { kind: "client" as const, id: upperId },
      evidence_ids: [
        `evidence:customer_discovery_projection:client:${upperId}:ordinal:2`,
      ],
    };
    const duplicateWire = customerDiscoverySnapshot(authorization, [
      lower,
      upper,
    ]);
    await expect(
      customerRepository(
        new StubDiscoveryRpcClient([{ data: duplicateWire, error: null }])
      ).read({ authorization })
    ).rejects.toMatchObject({ code: "CUSTOMER_DISCOVERY_INVALID" });

    const proofWire = cloneDiscoveryFixture(
      customerDiscoverySnapshot(authorization)
    ) as MutableSnapshot;
    const claim = claims(proofWire)[0]!;
    claim.proof.source_version.source_id =
      claim.proof.source_version.source_id.toUpperCase();
    claim.source_version.source_id = claim.proof.source_version.source_id;
    claim.evidence[0]!.source_id = claim.proof.source_version.source_id;
    recoupleDiscoveryCollection(proofWire);
    await expect(
      customerRepository(
        new StubDiscoveryRpcClient([{ data: proofWire, error: null }])
      ).read({ authorization })
    ).rejects.toMatchObject({ code: "CUSTOMER_DISCOVERY_INVALID" });
  });
});

describe("job discovery repository boundary", () => {
  it("requires a proof-bound per-anchor selection witness", async () => {
    const authorization = await jobDiscoveryAuthorization();
    const wire = cloneDiscoveryFixture(
      jobDiscoverySnapshot(authorization)
    ) as MutableSnapshot;
    const claim = claims(wire)[0]!;
    delete claim.selection_witness;
    recoupleDiscoveryClaim(claim, "match");
    recoupleDiscoveryCollection(wire);

    await expect(
      jobRepository(
        new StubDiscoveryRpcClient([{ data: wire, error: null }])
      ).read({ authorization })
    ).rejects.toMatchObject({ code: "JOB_DISCOVERY_INVALID" });
  });

  it("rejects a fully rehashed witness whose unsafe edge text was pre-sanitized in its projection", async () => {
    const authorization = await jobDiscoveryAuthorization();
    const wire = cloneDiscoveryFixture(
      jobDiscoverySnapshot(authorization)
    ) as MutableSnapshot;
    const claim = claims(wire)[0]!;
    const originalTitle = selectionAnchors(claim)[0]!.display_title as string;
    selectionAnchors(claim)[0]!.display_title = `\uFEFF${originalTitle}`;
    recoupleDiscoveryClaim(claim, "match");
    const proofWitness = claim.proof.projection.selection_witness as {
      anchors: Array<Record<string, unknown>>;
    };
    proofWitness.anchors[0]!.display_title = originalTitle;
    recoupleExistingProjection(claim);
    recoupleDiscoveryCollection(wire);

    await expect(
      jobRepository(
        new StubDiscoveryRpcClient([{ data: wire, error: null }])
      ).read({ authorization })
    ).rejects.toMatchObject({ code: "JOB_DISCOVERY_INVALID" });
  });

  it("rejects year zero in a fully rehashed project selection witness", async () => {
    const authorization = await jobDiscoveryAuthorization();
    const wire = cloneDiscoveryFixture(
      jobDiscoverySnapshot(authorization, [convertedProjectDiscoveryMatch()])
    ) as MutableSnapshot;
    const claim = claims(wire)[0]!;
    const rawDates = claim.raw.dates as Record<string, unknown>;
    rawDates.start_date = "0000-01-01";
    const projectAnchor = selectionAnchors(claim)[1]!;
    const witnessDates = projectAnchor.dates as Record<string, unknown>;
    witnessDates.start_date = "0000-01-01";
    recoupleDiscoveryClaim(claim, "match");
    recoupleDiscoveryCollection(wire);

    await expect(
      jobRepository(
        new StubDiscoveryRpcClient([{ data: wire, error: null }])
      ).read({ authorization })
    ).rejects.toMatchObject({ code: "JOB_DISCOVERY_INVALID" });
  });

  it("uses the exact current-only cumulative job RPC argument map", async () => {
    const authorization = await jobDiscoveryAuthorization();
    const client = new StubDiscoveryRpcClient([
      { data: jobDiscoverySnapshot(authorization), error: null },
    ]);

    await jobRepository(client).read({ authorization });

    expect(client.calls).toEqual([
      {
        functionName: "read_agent_job_discovery_as_system",
        args: {
          p_request_id: authorization.actorContext.requestId,
          p_actor_user_id: DISCOVERY_ACTOR_ID,
          p_company_id: DISCOVERY_COMPANY_ID,
          p_permission_snapshot_revision: DISCOVERY_PERMISSION_REVISION,
          p_registered_permission_keys: [...REGISTERED_ACTOR_PERMISSION_KEYS],
          p_capability_id: "search_jobs",
          p_capability_revision: authorization.capabilityRevision,
          p_capability_manifest_revision: CAPABILITY_MANIFEST_REVISION,
          p_capability_schema_revision: DISCOVERY_CAPABILITY_SCHEMA_REVISION,
          p_ranking_revision: JOB_DISCOVERY_RANKING_REVISION,
          p_required_oauth_scopes: ["ops.jobs.read"],
          p_pipeline_scope: "all",
          p_projects_scope: "all",
          p_query: "cedar street",
          p_query_fields: ["title", "address"],
          p_job_kinds: ["opportunity", "project"],
          p_lifecycle_states: ["active", "terminal"],
          p_opportunity_stages: ["quoting", "quoted"],
          p_project_statuses: ["accepted", "in_progress"],
          p_date_field: "updated_at",
          p_date_from: "2026-01-01T00:00:00.000Z",
          p_date_to_exclusive: "2026-08-15T00:00:00.000Z",
          p_read_as_of: null,
          p_cursor_source_revision: null,
          p_cursor_rank_ordinal: null,
          p_cursor_job_kind: null,
          p_cursor_job_id: null,
          p_limit: 2,
        },
      },
    ]);
  });

  it("is nominal and rejects a structural authorization clone before the RPC", async () => {
    const authorization = await jobDiscoveryAuthorization();
    const client = new StubDiscoveryRpcClient([]);
    const repository = jobRepository(client);

    expect(isTrustedJobDiscoveryRepository(repository)).toBe(true);
    expect(isTrustedJobDiscoveryRepository({ ...repository })).toBe(false);
    await expect(
      repository.read({
        authorization: { ...authorization } as typeof authorization,
      })
    ).rejects.toMatchObject({ code: "JOB_DISCOVERY_INVALID" });
    expect(client.calls).toHaveLength(0);
  });

  it("accepts a canonical converted project once under cumulative job authority", async () => {
    const authorization = await jobDiscoveryAuthorization();
    const wire = jobDiscoverySnapshot(authorization, [
      convertedProjectDiscoveryMatch(),
    ]);

    const snapshot = await jobRepository(
      new StubDiscoveryRpcClient([{ data: wire, error: null }])
    ).read({ authorization });

    expect(snapshot.match_claims[0]!.raw.conversion.state).toBe("converted");
    expect(snapshot.match_claims[0]!.raw.anchor_refs).toHaveLength(2);
  });

  it("rejects a fully rehashed opportunity/project alias collision", async () => {
    const authorization = await jobDiscoveryAuthorization();
    const wire = cloneDiscoveryFixture(
      jobDiscoverySnapshot(authorization, [
        opportunityDiscoveryMatch(1),
        convertedProjectDiscoveryMatch(2),
      ])
    ) as MutableSnapshot;
    const first = claims(wire)[0]!;
    const second = claims(wire)[1]!;
    const opportunityRef = (first.raw as { job_ref: unknown }).job_ref;
    (second.raw as { anchor_refs: unknown[] }).anchor_refs[0] =
      structuredClone(opportunityRef);
    (
      second.raw as {
        conversion: { opportunity_ref: unknown };
      }
    ).conversion.opportunity_ref = structuredClone(opportunityRef);
    recoupleDiscoveryClaim(second, "match");
    recoupleDiscoveryCollection(wire);

    await expect(
      jobRepository(
        new StubDiscoveryRpcClient([{ data: wire, error: null }])
      ).read({ authorization })
    ).rejects.toMatchObject({ code: "JOB_DISCOVERY_INVALID" });
  });

  it.each([
    [
      "conversion mirror",
      (claim: AtomicDiscoveryClaim) => {
        const raw = claim.raw as {
          conversion: { project_ref: { id: string } };
        };
        raw.conversion.project_ref.id = DISCOVERY_CLIENT_ID;
      },
    ],
    [
      "canonical alias",
      (claim: AtomicDiscoveryClaim) => {
        const raw = claim.raw as { anchor_refs: unknown[] };
        raw.anchor_refs.reverse();
      },
    ],
    [
      "job-kind mismatch",
      (claim: AtomicDiscoveryClaim) => {
        const raw = claim.raw as { status: { kind: string } };
        raw.status.kind = "opportunity";
      },
    ],
  ] as const)(
    "rejects a fully rehashed %s conflict",
    async (_label, mutate) => {
      const authorization = await jobDiscoveryAuthorization();
      const wire = cloneDiscoveryFixture(
        jobDiscoverySnapshot(authorization, [convertedProjectDiscoveryMatch()])
      ) as MutableSnapshot;
      const claim = claims(wire)[0]!;
      mutate(claim);
      recoupleDiscoveryClaim(claim, "match");
      recoupleDiscoveryCollection(wire);

      await expect(
        jobRepository(
          new StubDiscoveryRpcClient([{ data: wire, error: null }])
        ).read({ authorization })
      ).rejects.toMatchObject({ code: "JOB_DISCOVERY_INVALID" });
    }
  );

  it.each([
    "description",
    "notes",
    "customer_email",
    "customer_phone",
    "estimate_total",
    "private_employee_fields",
  ])("rejects fully rehashed forbidden job field %s", async (field) => {
    const authorization = await jobDiscoveryAuthorization();
    const wire = cloneDiscoveryFixture(
      jobDiscoverySnapshot(authorization)
    ) as MutableSnapshot;
    const claim = claims(wire)[0]!;
    claim.raw[field] = "forbidden narrative or private value";
    recoupleDiscoveryClaim(claim, "match");
    recoupleDiscoveryCollection(wire);

    await expect(
      jobRepository(
        new StubDiscoveryRpcClient([{ data: wire, error: null }])
      ).read({ authorization })
    ).rejects.toMatchObject({ code: "JOB_DISCOVERY_INVALID" });
  });

  it("rejects a fully rehashed job title that does not match the canonical query", async () => {
    const authorization = await jobDiscoveryAuthorization();
    const wire = cloneDiscoveryFixture(
      jobDiscoverySnapshot(authorization)
    ) as MutableSnapshot;
    const claim = claims(wire)[0]!;
    claim.raw.display_title = "Completely unrelated job";
    claim.raw.address = "999 Nowhere Road";
    recoupleDiscoveryClaim(claim, "match");
    recoupleDiscoveryCollection(wire);

    await expect(
      jobRepository(
        new StubDiscoveryRpcClient([{ data: wire, error: null }])
      ).read({ authorization })
    ).rejects.toMatchObject({ code: "JOB_DISCOVERY_INVALID" });
  });

  it("rejects a fully rehashed lower-priority match basis", async () => {
    const authorization = await jobDiscoveryAuthorization();
    const wire = cloneDiscoveryFixture(
      jobDiscoverySnapshot(authorization)
    ) as MutableSnapshot;
    const claim = claims(wire)[0]!;
    claim.raw.address = "Cedar Street";
    recoupleDiscoveryClaim(claim, "match");
    recoupleDiscoveryCollection(wire);

    await expect(
      jobRepository(
        new StubDiscoveryRpcClient([{ data: wire, error: null }])
      ).read({ authorization })
    ).rejects.toMatchObject({ code: "JOB_DISCOVERY_INVALID" });
  });

  it("rejects fully rehashed job claims outside the canonical order", async () => {
    const authorization = await jobDiscoveryAuthorization();
    const exact = {
      ...opportunityDiscoveryMatch(2),
      display_title: "Cedar Street",
      address: "999 Nowhere Road",
      match_basis: {
        ranking_revision: JOB_DISCOVERY_RANKING_REVISION,
        kind: "exact_title" as const,
        field: "title" as const,
      },
    };
    const wire = jobDiscoverySnapshot(authorization, [
      opportunityDiscoveryMatch(1),
      exact,
    ]);

    await expect(
      jobRepository(
        new StubDiscoveryRpcClient([{ data: wire, error: null }])
      ).read({ authorization })
    ).rejects.toMatchObject({ code: "JOB_DISCOVERY_INVALID" });
  });

  it("rejects unsafe filter-only job strings even for a single claim", async () => {
    const authorization = await jobDiscoveryAuthorization({
      job_kinds: ["opportunity"],
      lifecycle_states: ["active"],
      limit: 1,
    });
    for (const unsafeDisplayTitle of [
      "Cedar\u061c Street",
      "Cedar\u200e Street",
      "Cedar\u200f Street",
      "Cedar\u202e Street",
      "Cedar\uFEFF Street",
      "\uFEFFCedar Street",
      "Cedar Street\uFEFF",
      " Cedar Street",
      "Cedar Street ",
    ]) {
      const match = {
        ...opportunityDiscoveryMatch(),
        display_title: unsafeDisplayTitle,
        match_basis: {
          ranking_revision: JOB_DISCOVERY_RANKING_REVISION,
          kind: "filter_only" as const,
          field: "none" as const,
        },
      };
      const wire = jobDiscoverySnapshot(authorization, [match]);

      await expect(
        jobRepository(
          new StubDiscoveryRpcClient([{ data: wire, error: null }])
        ).read({ authorization })
      ).rejects.toMatchObject({ code: "JOB_DISCOVERY_INVALID" });
    }
  });

  it("requires every converted anchor to satisfy status and lifecycle filters", async () => {
    const authorization = await jobDiscoveryAuthorization({
      query: "cedar street",
      query_fields: ["title", "address"],
      job_kinds: ["opportunity", "project"],
      lifecycle_states: ["active"],
      opportunity_stages: ["lost"],
      project_statuses: ["in_progress"],
      limit: 1,
    });
    const wire = jobDiscoverySnapshot(authorization, [
      convertedProjectDiscoveryMatch(),
    ]);

    await expect(
      jobRepository(
        new StubDiscoveryRpcClient([{ data: wire, error: null }])
      ).read({ authorization })
    ).rejects.toMatchObject({ code: "JOB_DISCOVERY_INVALID" });
  });

  it("accepts a discarded opportunity as archived even without archived_at", async () => {
    const authorization = await jobDiscoveryAuthorization({
      query: "cedar street",
      query_fields: ["title", "address"],
      job_kinds: ["opportunity"],
      lifecycle_states: ["archived"],
      opportunity_stages: ["discarded"],
      limit: 1,
    });
    const match = {
      ...opportunityDiscoveryMatch(),
      lifecycle_state: "archived" as const,
      status: { kind: "opportunity" as const, value: "discarded" as const },
    };
    const wire = cloneDiscoveryFixture(
      jobDiscoverySnapshot(authorization, [match])
    ) as MutableSnapshot;
    const claim = claims(wire)[0]!;
    selectionAnchors(claim)[0]!.archived = false;
    recoupleDiscoveryClaim(claim, "match");
    recoupleDiscoveryCollection(wire);

    await expect(
      jobRepository(
        new StubDiscoveryRpcClient([{ data: wire, error: null }])
      ).read({ authorization })
    ).resolves.toMatchObject({ returned_match_count: 1 });
  });

  it("requires every converted anchor to satisfy the exact date window", async () => {
    const authorization = await jobDiscoveryAuthorization({
      query: "cedar street",
      query_fields: ["title", "address"],
      job_kinds: ["opportunity", "project"],
      lifecycle_states: ["active"],
      opportunity_stages: ["quoting"],
      project_statuses: ["in_progress"],
      date_window: {
        field: "updated_at",
        from: "2026-08-14T10:30:00.000Z",
        to_exclusive: "2026-08-15T00:00:00.000Z",
      },
      limit: 1,
    });
    const wire = jobDiscoverySnapshot(authorization, [
      convertedProjectDiscoveryMatch(),
    ]);

    await expect(
      jobRepository(
        new StubDiscoveryRpcClient([{ data: wire, error: null }])
      ).read({ authorization })
    ).rejects.toMatchObject({ code: "JOB_DISCOVERY_INVALID" });
  });

  it("rejects fully rehashed converted source text and canonical projection drift", async () => {
    const authorization = await jobDiscoveryAuthorization();
    for (const mutation of ["source_text", "canonical_projection"] as const) {
      const wire = cloneDiscoveryFixture(
        jobDiscoverySnapshot(authorization, [convertedProjectDiscoveryMatch()])
      ) as MutableSnapshot;
      const claim = claims(wire)[0]!;
      const anchors = selectionAnchors(claim);
      if (mutation === "source_text") {
        anchors[0]!.display_title = "Completely unrelated opportunity";
        anchors[0]!.address = "999 Nowhere Road";
      } else {
        anchors[1]!.display_title = "Cedar Street alternate title";
      }
      recoupleDiscoveryClaim(claim, "match");
      recoupleDiscoveryCollection(wire);

      await expect(
        jobRepository(
          new StubDiscoveryRpcClient([{ data: wire, error: null }])
        ).read({ authorization })
      ).rejects.toMatchObject({ code: "JOB_DISCOVERY_INVALID" });
    }
  });

  it("never carries a hidden linked-side witness on an unpaired card", async () => {
    const authorization = await jobDiscoveryAuthorization();
    const unpaired = {
      ...opportunityDiscoveryMatch(),
      conversion: { state: "linked_project_not_returned" as const },
    };
    const wire = cloneDiscoveryFixture(
      jobDiscoverySnapshot(authorization, [unpaired])
    ) as MutableSnapshot;
    const claim = claims(wire)[0]!;
    const hiddenProjectAnchor = selectionAnchors(
      claims(
        jobDiscoverySnapshot(authorization, [convertedProjectDiscoveryMatch()])
      )[0]!
    )[1]!;
    selectionAnchors(claim).push(structuredClone(hiddenProjectAnchor));
    recoupleDiscoveryClaim(claim, "match");
    recoupleDiscoveryCollection(wire);

    await expect(
      jobRepository(
        new StubDiscoveryRpcClient([{ data: wire, error: null }])
      ).read({ authorization })
    ).rejects.toMatchObject({ code: "JOB_DISCOVERY_INVALID" });
  });

  it("rejects fully rehashed job aliases that differ only by UUID case", async () => {
    const authorization = await jobDiscoveryAuthorization();
    const lower = opportunityDiscoveryMatch(1);
    const upperId = lower.job_ref.id.toUpperCase();
    const upperRef = { kind: "opportunity" as const, id: upperId };
    const upper = {
      ...opportunityDiscoveryMatch(2),
      job_ref: upperRef,
      anchor_refs: [upperRef],
      evidence_ids: [
        `evidence:job_discovery_projection:opportunity:${upperId}:ordinal:2`,
      ],
    };
    const wire = jobDiscoverySnapshot(authorization, [lower, upper]);

    await expect(
      jobRepository(
        new StubDiscoveryRpcClient([{ data: wire, error: null }])
      ).read({ authorization })
    ).rejects.toMatchObject({ code: "JOB_DISCOVERY_INVALID" });
  });
});

describe("discovery proof, order, and cursor coupling", () => {
  it.each(["customer", "job"] as const)(
    "requires unique exact %s child and collection source/evidence/locator identities",
    async (kind) => {
      const authorization =
        kind === "customer"
          ? await customerDiscoveryAuthorization()
          : await jobDiscoveryAuthorization();
      const base =
        kind === "customer"
          ? customerDiscoverySnapshot(authorization as never, [
              customerDiscoveryMatch(1),
              customerDiscoveryMatch(2),
            ])
          : jobDiscoverySnapshot(authorization as never, [
              opportunityDiscoveryMatch(1),
              opportunityDiscoveryMatch(2),
            ]);
      const mutations: Array<(snapshot: MutableSnapshot) => void> = [
        (snapshot) => {
          claims(snapshot)[1]!.proof.evidence_id =
            claims(snapshot)[0]!.proof.evidence_id;
          claims(snapshot)[1]!.raw.evidence_ids = [
            claims(snapshot)[0]!.proof.evidence_id,
          ];
          claims(snapshot)[1]!.evidence[0]!.evidence_id =
            claims(snapshot)[0]!.proof.evidence_id;
          recoupleDiscoveryClaim(claims(snapshot)[1]!, "match");
          recoupleDiscoveryCollection(snapshot);
        },
        (snapshot) => {
          claims(snapshot)[0]!.evidence[0]!.locator =
            "ops://evidence/evidence%3Aforeign";
        },
        (snapshot) => {
          collection(snapshot).proof.source_version.source_id =
            "company:foreign";
          collection(snapshot).source_version.source_id = "company:foreign";
          collection(snapshot).evidence[0]!.source_id = "company:foreign";
        },
        (snapshot) => {
          collection(snapshot).proof.evidence_id = "evidence:foreign";
          collection(snapshot).evidence[0]!.evidence_id = "evidence:foreign";
        },
      ];

      for (const mutate of mutations) {
        const wire = cloneDiscoveryFixture(base) as MutableSnapshot;
        mutate(wire);
        const repository =
          kind === "customer"
            ? customerRepository(
                new StubDiscoveryRpcClient([{ data: wire, error: null }])
              )
            : jobRepository(
                new StubDiscoveryRpcClient([{ data: wire, error: null }])
              );
        await expect(
          repository.read({ authorization } as never)
        ).rejects.toMatchObject({
          code:
            kind === "customer"
              ? "CUSTOMER_DISCOVERY_INVALID"
              : "JOB_DISCOVERY_INVALID",
        });
      }
    }
  );

  it.each(["customer", "job"] as const)(
    "rejects reordered %s claims and retained proof sources even when atoms remain independently hashed",
    async (kind) => {
      const authorization =
        kind === "customer"
          ? await customerDiscoveryAuthorization()
          : await jobDiscoveryAuthorization();
      const base =
        kind === "customer"
          ? customerDiscoverySnapshot(authorization as never, [
              customerDiscoveryMatch(1),
              customerDiscoveryMatch(2),
            ])
          : jobDiscoverySnapshot(authorization as never, [
              opportunityDiscoveryMatch(1),
              opportunityDiscoveryMatch(2),
            ]);
      const wire = cloneDiscoveryFixture(base) as MutableSnapshot;
      claims(wire).reverse();
      recoupleDiscoveryCollection(wire);
      const repository =
        kind === "customer"
          ? customerRepository(
              new StubDiscoveryRpcClient([{ data: wire, error: null }])
            )
          : jobRepository(
              new StubDiscoveryRpcClient([{ data: wire, error: null }])
            );

      await expect(
        repository.read({ authorization } as never)
      ).rejects.toMatchObject({
        code:
          kind === "customer"
            ? "CUSTOMER_DISCOVERY_INVALID"
            : "JOB_DISCOVERY_INVALID",
      });
    }
  );

  it("rejects a fully rehashed customer continuation that sorts before its signed cursor boundary", async () => {
    const codec = discoveryCursorCodec({
      now: () => new Date(DISCOVERY_GENERATED_AT),
    });
    const firstAuthorization = await customerDiscoveryAuthorization();
    const firstPage = await customerRepository(
      new StubDiscoveryRpcClient([
        {
          data: customerDiscoverySnapshot(
            firstAuthorization,
            [customerDiscoveryMatch(1), customerDiscoveryMatch(2)],
            { hasMore: true, authorizedCandidateCount: 3 }
          ),
          error: null,
        },
      ]),
      codec
    ).read({ authorization: firstAuthorization });
    const authorization = await customerDiscoveryAuthorization({
      ...DISCOVERY_CUSTOMER_INPUT,
      cursor: firstPage.page.next_cursor!,
    });
    const reordered = customerDiscoveryMatch(3);
    reordered.display_name = "Acme Construction 000";

    await expect(
      customerRepository(
        new StubDiscoveryRpcClient([
          {
            data: customerDiscoverySnapshot(authorization, [reordered], {
              startOrdinal: 3,
              authorizedCandidateCount: 3,
            }),
            error: null,
          },
        ]),
        codec
      ).read({ authorization })
    ).rejects.toMatchObject({ code: "CUSTOMER_DISCOVERY_INVALID" });
  });

  it("rejects a fully rehashed job continuation that sorts before its signed cursor boundary", async () => {
    const codec = discoveryCursorCodec({
      now: () => new Date(DISCOVERY_GENERATED_AT),
    });
    const firstAuthorization = await jobDiscoveryAuthorization();
    const firstPage = await jobRepository(
      new StubDiscoveryRpcClient([
        {
          data: jobDiscoverySnapshot(
            firstAuthorization,
            [opportunityDiscoveryMatch(1), opportunityDiscoveryMatch(2)],
            { hasMore: true, authorizedCandidateCount: 3 }
          ),
          error: null,
        },
      ]),
      codec
    ).read({ authorization: firstAuthorization });
    const authorization = await jobDiscoveryAuthorization({
      ...DISCOVERY_JOB_INPUT,
      cursor: firstPage.page.next_cursor!,
    });
    const reordered = opportunityDiscoveryMatch(3);
    reordered.display_title = "Cedar Street deck 000";

    await expect(
      jobRepository(
        new StubDiscoveryRpcClient([
          {
            data: jobDiscoverySnapshot(authorization, [reordered], {
              startOrdinal: 3,
              authorizedCandidateCount: 3,
            }),
            error: null,
          },
        ]),
        codec
      ).read({ authorization })
    ).rejects.toMatchObject({ code: "JOB_DISCOVERY_INVALID" });
  });

  it.each(["customer", "job"] as const)(
    "requires a parsed, proof-bound, query-valid %s cursor anchor with exact signed identity",
    async (kind) => {
      const codec = discoveryCursorCodec({
        now: () => new Date(DISCOVERY_GENERATED_AT),
      });
      const firstAuthorization =
        kind === "customer"
          ? await customerDiscoveryAuthorization()
          : await jobDiscoveryAuthorization();
      const firstWire =
        kind === "customer"
          ? customerDiscoverySnapshot(
              firstAuthorization as never,
              [customerDiscoveryMatch(1), customerDiscoveryMatch(2)],
              { hasMore: true, authorizedCandidateCount: 3 }
            )
          : jobDiscoverySnapshot(
              firstAuthorization as never,
              [opportunityDiscoveryMatch(1), opportunityDiscoveryMatch(2)],
              { hasMore: true, authorizedCandidateCount: 3 }
            );
      const firstRepository =
        kind === "customer"
          ? customerRepository(
              new StubDiscoveryRpcClient([{ data: firstWire, error: null }]),
              codec
            )
          : jobRepository(
              new StubDiscoveryRpcClient([{ data: firstWire, error: null }]),
              codec
            );
      const firstPage = await firstRepository.read({
        authorization: firstAuthorization,
      } as never);
      const authorization =
        kind === "customer"
          ? await customerDiscoveryAuthorization({
              ...DISCOVERY_CUSTOMER_INPUT,
              cursor: firstPage.page.next_cursor!,
            })
          : await jobDiscoveryAuthorization({
              ...DISCOVERY_JOB_INPUT,
              cursor: firstPage.page.next_cursor!,
            });
      const base =
        kind === "customer"
          ? customerDiscoverySnapshot(
              authorization as never,
              [customerDiscoveryMatch(3)],
              { startOrdinal: 3, authorizedCandidateCount: 3 }
            )
          : jobDiscoverySnapshot(
              authorization as never,
              [opportunityDiscoveryMatch(3)],
              { startOrdinal: 3, authorizedCandidateCount: 3 }
            );
      const mutations: Array<(snapshot: MutableSnapshot) => void> = [
        (snapshot) => {
          delete collection(snapshot).raw.cursor_anchor_order_witness;
        },
        (snapshot) => {
          collection(snapshot).raw.cursor_anchor_order_witness = null;
          recoupleDiscoveryCollection(snapshot);
        },
        (snapshot) => {
          cursorAnchorOrderWitness(snapshot).rank_ordinal = 1;
          recoupleDiscoveryCollection(snapshot);
        },
        (snapshot) => {
          const raw = cursorAnchorOrderWitness(snapshot).raw;
          if (kind === "customer") {
            raw.display_name = "Unrelated customer";
          } else {
            raw.display_title = "Unrelated job";
            raw.address = "200 Other Street";
          }
          recoupleDiscoveryCollection(snapshot);
        },
        (snapshot) => {
          const raw = cursorAnchorOrderWitness(snapshot).raw;
          raw[kind === "customer" ? "display_name" : "display_title"] =
            kind === "customer"
              ? "Acme Construction 002A"
              : "Cedar Street deck 002A";
        },
      ];

      for (const mutate of mutations) {
        const wire = cloneDiscoveryFixture(base) as MutableSnapshot;
        mutate(wire);
        const repository =
          kind === "customer"
            ? customerRepository(
                new StubDiscoveryRpcClient([{ data: wire, error: null }]),
                codec
              )
            : jobRepository(
                new StubDiscoveryRpcClient([{ data: wire, error: null }]),
                codec
              );

        await expect(
          repository.read({ authorization } as never)
        ).rejects.toMatchObject({
          code:
            kind === "customer"
              ? "CUSTOMER_DISCOVERY_INVALID"
              : "JOB_DISCOVERY_INVALID",
        });
      }
    }
  );

  it("decodes customer cursors into exact RPC claims without forwarding the cursor", async () => {
    const codec = discoveryCursorCodec({
      now: () => new Date(DISCOVERY_GENERATED_AT),
    });
    const authorization = await customerDiscoveryAuthorization();
    const first = await customerRepository(
      new StubDiscoveryRpcClient([
        {
          data: customerDiscoverySnapshot(
            authorization,
            [customerDiscoveryMatch(1), customerDiscoveryMatch(2)],
            { hasMore: true, authorizedCandidateCount: 3 }
          ),
          error: null,
        },
      ]),
      codec
    ).read({ authorization });
    const rawInput = {
      ...DISCOVERY_CUSTOMER_INPUT,
      cursor: first.page.next_cursor!,
    };
    const continued = await customerDiscoveryAuthorization(rawInput);
    const client = new StubDiscoveryRpcClient([
      {
        data: customerDiscoverySnapshot(
          continued,
          [customerDiscoveryMatch(3)],
          { startOrdinal: 3, authorizedCandidateCount: 3 }
        ),
        error: null,
      },
    ]);

    await customerRepository(client, codec).read({ authorization: continued });

    expect(client.calls[0]!.args).toMatchObject({
      p_read_as_of: DISCOVERY_READ_AT,
      p_cursor_source_revision: DISCOVERY_SOURCE_REVISION,
      p_cursor_rank_ordinal: 2,
      p_cursor_customer_kind: "client",
    });
    expect(client.calls[0]!.args).not.toHaveProperty("p_cursor");
  });

  it("continues a frozen v7 customer cursor under v8 and reissues only v8", async () => {
    const codec = discoveryCursorCodec({
      now: () => new Date(DISCOVERY_GENERATED_AT),
    });
    const initialAuthorization = await customerDiscoveryAuthorization();
    const { cursor: _initialCursor, ...canonicalQuery } =
      initialAuthorization.query;
    const v7QueryHash = hashOperationalReadQuery({
      capability_id: initialAuthorization.capabilityId,
      schema_revision: DISCOVERY_CAPABILITY_SCHEMA_REVISION,
      capability_manifest_revision:
        FROZEN_V7_OPERATIONAL_CURSOR_MANIFEST_REVISION,
      query: canonicalQuery,
    });
    const boundary = customerDiscoveryMatch(2).customer_ref;
    const v7Cursor = codec.encode({
      capability_id: "search_customers",
      schema_revision: DISCOVERY_CAPABILITY_SCHEMA_REVISION,
      capability_manifest_revision:
        FROZEN_V7_OPERATIONAL_CURSOR_MANIFEST_REVISION,
      ranking_revision: CUSTOMER_DISCOVERY_RANKING_REVISION,
      rule_revisions: [],
      actor_user_id: initialAuthorization.actorContext.actorUserId,
      company_id: initialAuthorization.actorContext.companyId,
      permission_snapshot_revision:
        initialAuthorization.actorContext.permissionSnapshotRevision,
      query_hash: v7QueryHash,
      source_revision: DISCOVERY_SOURCE_REVISION,
      read_as_of: DISCOVERY_READ_AT,
      rank_ordinal: 2,
      customer_kind: boundary.kind,
      customer_id: boundary.id,
    });
    const continued = await customerDiscoveryAuthorization({
      ...DISCOVERY_CUSTOMER_INPUT,
      cursor: v7Cursor,
    });
    const client = new StubDiscoveryRpcClient([
      {
        data: customerDiscoverySnapshot(
          continued,
          [customerDiscoveryMatch(3), customerDiscoveryMatch(4)],
          { startOrdinal: 3, hasMore: true, authorizedCandidateCount: 5 }
        ),
        error: null,
      },
    ]);

    const result = await customerRepository(client, codec).read({
      authorization: continued,
    });

    expect(client.calls[0]!.args).toMatchObject({
      p_capability_manifest_revision: CAPABILITY_MANIFEST_REVISION,
      p_cursor_rank_ordinal: 2,
      p_cursor_customer_kind: boundary.kind,
      p_cursor_customer_id: boundary.id,
    });
    expect(result.page.next_cursor).toMatch(/^ops_cursor:/);
    const currentQueryHash = hashOperationalReadQuery({
      capability_id: continued.capabilityId,
      schema_revision: DISCOVERY_CAPABILITY_SCHEMA_REVISION,
      capability_manifest_revision: CAPABILITY_MANIFEST_REVISION,
      query: canonicalQuery,
    });
    const activeExpectation = {
      capabilityId: continued.capabilityId,
      schemaRevision: DISCOVERY_CAPABILITY_SCHEMA_REVISION,
      capabilityManifestRevision: CAPABILITY_MANIFEST_REVISION,
      rankingRevision: CUSTOMER_DISCOVERY_RANKING_REVISION,
      ruleRevisions: [],
      actorUserId: continued.actorContext.actorUserId,
      companyId: continued.actorContext.companyId,
      permissionSnapshotRevision:
        continued.actorContext.permissionSnapshotRevision,
      queryHash: currentQueryHash,
    } as const;
    expect(
      codec.decode({
        cursor: result.page.next_cursor!,
        expected: activeExpectation,
      }).capability_manifest_revision
    ).toBe(CAPABILITY_MANIFEST_REVISION);
    expect(() =>
      codec.decode({
        cursor: result.page.next_cursor!,
        expected: {
          ...activeExpectation,
          capabilityManifestRevision:
            FROZEN_V7_OPERATIONAL_CURSOR_MANIFEST_REVISION,
          queryHash: v7QueryHash,
        },
      })
    ).toThrow();
  });

  it("decodes job cursors into exact RPC claims and binds the last retained identity", async () => {
    const codec = discoveryCursorCodec({
      now: () => new Date(DISCOVERY_GENERATED_AT),
    });
    const authorization = await jobDiscoveryAuthorization();
    const first = await jobRepository(
      new StubDiscoveryRpcClient([
        {
          data: jobDiscoverySnapshot(
            authorization,
            [opportunityDiscoveryMatch(1), opportunityDiscoveryMatch(2)],
            { hasMore: true, authorizedCandidateCount: 3 }
          ),
          error: null,
        },
      ]),
      codec
    ).read({ authorization });
    const continued = await jobDiscoveryAuthorization({
      ...DISCOVERY_JOB_INPUT,
      cursor: first.page.next_cursor!,
    });
    const client = new StubDiscoveryRpcClient([
      {
        data: jobDiscoverySnapshot(continued, [opportunityDiscoveryMatch(3)], {
          startOrdinal: 3,
          authorizedCandidateCount: 3,
        }),
        error: null,
      },
    ]);

    await jobRepository(client, codec).read({ authorization: continued });

    expect(client.calls[0]!.args).toMatchObject({
      p_read_as_of: DISCOVERY_READ_AT,
      p_cursor_source_revision: DISCOVERY_SOURCE_REVISION,
      p_cursor_rank_ordinal: 2,
      p_cursor_job_kind: "opportunity",
    });
    expect(client.calls[0]!.args).not.toHaveProperty("p_cursor");
  });

  it.each(["customer", "job"] as const)(
    "rejects a tampered %s cursor before the RPC",
    async (kind) => {
      const codec = discoveryCursorCodec({
        now: () => new Date(DISCOVERY_GENERATED_AT),
      });
      const authorization =
        kind === "customer"
          ? await customerDiscoveryAuthorization()
          : await jobDiscoveryAuthorization();
      const first =
        kind === "customer"
          ? await customerRepository(
              new StubDiscoveryRpcClient([
                {
                  data: customerDiscoverySnapshot(
                    authorization as never,
                    [customerDiscoveryMatch(1), customerDiscoveryMatch(2)],
                    { hasMore: true, authorizedCandidateCount: 3 }
                  ),
                  error: null,
                },
              ]),
              codec
            ).read({ authorization } as never)
          : await jobRepository(
              new StubDiscoveryRpcClient([
                {
                  data: jobDiscoverySnapshot(
                    authorization as never,
                    [
                      opportunityDiscoveryMatch(1),
                      opportunityDiscoveryMatch(2),
                    ],
                    { hasMore: true, authorizedCandidateCount: 3 }
                  ),
                  error: null,
                },
              ]),
              codec
            ).read({ authorization } as never);
      const cursor = first.page.next_cursor!;
      const tampered = `${cursor.slice(0, -1)}${cursor.endsWith("x") ? "y" : "x"}`;
      const continued =
        kind === "customer"
          ? await customerDiscoveryAuthorization({
              ...DISCOVERY_CUSTOMER_INPUT,
              cursor: tampered,
            })
          : await jobDiscoveryAuthorization({
              ...DISCOVERY_JOB_INPUT,
              cursor: tampered,
            });
      const client = new StubDiscoveryRpcClient([]);
      const repository =
        kind === "customer"
          ? customerRepository(client, codec)
          : jobRepository(client, codec);

      await expect(
        repository.read({ authorization: continued } as never)
      ).rejects.toMatchObject({
        code:
          kind === "customer"
            ? "CUSTOMER_DISCOVERY_INVALID"
            : "JOB_DISCOVERY_INVALID",
      });
      expect(client.calls).toHaveLength(0);
    }
  );
});

describe("discovery cancellation and privacy-safe failures", () => {
  it.each(["customer", "job"] as const)(
    "accepts only the canonical operational source fence in a %s stale error",
    async (kind) => {
      const authorization =
        kind === "customer"
          ? await customerDiscoveryAuthorization()
          : await jobDiscoveryAuthorization();
      const namespace =
        kind === "customer" ? "customer_discovery" : "job_discovery";
      const validFence = discoverySourceFence(42);
      const validRepository =
        kind === "customer"
          ? customerRepository(
              new StubDiscoveryRpcClient([
                {
                  data: null,
                  error: {
                    code: "40001",
                    message: `agent_${namespace}_cursor_stale`,
                    details: validFence,
                  },
                },
              ])
            )
          : jobRepository(
              new StubDiscoveryRpcClient([
                {
                  data: null,
                  error: {
                    code: "40001",
                    message: `agent_${namespace}_cursor_stale`,
                    details: validFence,
                  },
                },
              ])
            );

      await expect(
        validRepository.read({ authorization } as never)
      ).rejects.toMatchObject({
        code:
          kind === "customer"
            ? "CUSTOMER_DISCOVERY_STALE"
            : "JOB_DISCOVERY_STALE",
        currentSourceVersion: validFence,
      });

      for (const details of [
        { ...validFence, source_domain: "customer_private_data" },
        { ...validFence, source_type: "email_address" },
        { ...validFence, source_id: "dispatch@example.com" },
        { ...validFence, version: "revision:01" },
      ]) {
        const repository =
          kind === "customer"
            ? customerRepository(
                new StubDiscoveryRpcClient([
                  {
                    data: null,
                    error: {
                      code: "40001",
                      message: `agent_${namespace}_cursor_stale`,
                      details,
                    },
                  },
                ])
              )
            : jobRepository(
                new StubDiscoveryRpcClient([
                  {
                    data: null,
                    error: {
                      code: "40001",
                      message: `agent_${namespace}_cursor_stale`,
                      details,
                    },
                  },
                ])
              );

        const caught = await repository
          .read({ authorization } as never)
          .catch((value: unknown) => value);
        expect(caught).toMatchObject({
          code:
            kind === "customer"
              ? "CUSTOMER_DISCOVERY_READ_FAILED"
              : "JOB_DISCOVERY_READ_FAILED",
          currentSourceVersion: null,
        });
        expect(JSON.stringify(caught)).not.toContain("dispatch@example.com");
      }
    }
  );

  it.each(["customer", "job"] as const)(
    "aborts %s before call, cooperatively in transport, and fail-closed after await",
    async (kind) => {
      const authorization =
        kind === "customer"
          ? await customerDiscoveryAuthorization()
          : await jobDiscoveryAuthorization();
      const aborted = new AbortController();
      aborted.abort();
      const beforeClient = new StubDiscoveryRpcClient([]);
      const beforeRepository =
        kind === "customer"
          ? customerRepository(beforeClient)
          : jobRepository(beforeClient);
      await expect(
        beforeRepository.read({
          authorization,
          signal: aborted.signal,
        } as never)
      ).rejects.toMatchObject({
        code:
          kind === "customer"
            ? "CUSTOMER_DISCOVERY_READ_FAILED"
            : "JOB_DISCOVERY_READ_FAILED",
      });
      expect(beforeClient.calls).toHaveLength(0);

      let resolve!: (value: { data: unknown; error: null }) => void;
      const deferred = new Promise<{ data: unknown; error: null }>((accept) => {
        resolve = accept;
      });
      const controller = new AbortController();
      const afterClient = new StubDiscoveryRpcClient([() => deferred]);
      const afterRepository =
        kind === "customer"
          ? customerRepository(afterClient)
          : jobRepository(afterClient);
      const pending = afterRepository.read({
        authorization,
        signal: controller.signal,
      } as never);
      await Promise.resolve();
      expect(afterClient.abortSignals).toEqual([controller.signal]);
      controller.abort();
      resolve({
        data:
          kind === "customer"
            ? customerDiscoverySnapshot(authorization as never)
            : jobDiscoverySnapshot(authorization as never),
        error: null,
      });
      await expect(pending).rejects.toMatchObject({
        code:
          kind === "customer"
            ? "CUSTOMER_DISCOVERY_READ_FAILED"
            : "JOB_DISCOVERY_READ_FAILED",
      });
    }
  );

  it.each(["customer", "job"] as const)(
    "maps %s not-found and forbidden identically without leaking database text",
    async (kind) => {
      const authorization =
        kind === "customer"
          ? await customerDiscoveryAuthorization()
          : await jobDiscoveryAuthorization();
      const namespace =
        kind === "customer" ? "customer_discovery" : "job_discovery";
      for (const error of [
        {
          code: "P0002",
          message: `agent_${namespace}_not_found_or_not_visible`,
          details: "private row 41",
        },
        {
          code: "42501",
          message: `agent_${namespace}_forbidden`,
          details: "private grant and SQL policy",
        },
      ]) {
        const repository =
          kind === "customer"
            ? customerRepository(
                new StubDiscoveryRpcClient([{ data: null, error }])
              )
            : jobRepository(
                new StubDiscoveryRpcClient([{ data: null, error }])
              );
        const caught = await repository
          .read({ authorization } as never)
          .catch((value: unknown) => value);
        expect(caught).toMatchObject({
          code:
            kind === "customer"
              ? "CUSTOMER_DISCOVERY_NOT_FOUND"
              : "JOB_DISCOVERY_NOT_FOUND",
        });
        expect(String(caught)).not.toContain("private");
        expect(String(caught)).not.toContain("SQL");
      }
    }
  );

  it.each(["customer", "job"] as const)(
    "contains hostile %s response getters inside a fixed failure",
    async (kind) => {
      const authorization =
        kind === "customer"
          ? await customerDiscoveryAuthorization()
          : await jobDiscoveryAuthorization();
      const response = Object.create(null) as { data: unknown; error: unknown };
      Object.defineProperty(response, "error", {
        get() {
          throw new Error("secret SQL error getter");
        },
      });
      const client = new StubDiscoveryRpcClient([
        response as unknown as { data: unknown; error: unknown },
      ]);
      const repository =
        kind === "customer"
          ? customerRepository(client)
          : jobRepository(client);

      const caught = await repository
        .read({ authorization } as never)
        .catch((value: unknown) => value);

      expect(caught).toBeInstanceOf(
        kind === "customer"
          ? CustomerDiscoveryRepositoryError
          : JobDiscoveryRepositoryError
      );
      expect(caught).toMatchObject({
        code:
          kind === "customer"
            ? "CUSTOMER_DISCOVERY_READ_FAILED"
            : "JOB_DISCOVERY_READ_FAILED",
      });
      expect(String(caught)).not.toContain("secret SQL");
    }
  );
});
