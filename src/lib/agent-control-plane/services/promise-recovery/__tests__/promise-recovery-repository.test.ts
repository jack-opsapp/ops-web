import { describe, expect, it, vi } from "vitest";

import type { ActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import {
  createPromiseRecoveryRepository,
  type PromiseRecoveryRpcClient,
} from "../promise-recovery-repository";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const COMPANY_ID = "22222222-2222-4222-8222-222222222222";
const GRANT_ID = "33333333-3333-4333-8333-333333333333";
const OAUTH_CLIENT_ID = "44444444-4444-4444-8444-444444444444";
const CUSTOMER_ID = "55555555-5555-4555-8555-555555555555";
const SOURCE_ID = "66666666-6666-4666-8666-666666666666";
const TURN_ID = "77777777-7777-4777-8777-777777777777";
const MANIFEST_REVISION = "2026-09-01.capability-manifest.v12";

function actor(manifestRevision = MANIFEST_REVISION): ActorContext {
  return {
    actorUserId: USER_ID,
    companyId: COMPANY_ID,
    permissionSnapshotRevision: `sha256:${"a".repeat(64)}`,
    capabilityManifestRevision: manifestRevision,
    auth: {
      channel: "mcp",
      oauthGrantId: GRANT_ID,
      oauthClientId: OAUTH_CLIENT_ID,
      grantRevision: "b".repeat(32),
      scopeCeiling: [
        "ops.company.read",
        "ops.correspondence.read",
        "ops.customer_contacts.read",
        "ops.customers.read",
        "ops.expenses.read",
        "ops.financial_documents.read",
        "ops.financials.read",
        "ops.jobs.read",
        "ops.payments.read",
        "ops.schedule.read",
        "ops.site_visits.read",
        "ops.tasks.read",
        "ops.team.read",
      ],
      tokenId: "token-promise-recovery",
      issuer: "https://app.opsapp.co",
      audience: "https://app.opsapp.co/api/mcp",
    },
  } as unknown as ActorContext;
}

function rawSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    customer_resolution: {
      state: "exact",
      candidate_count: 1,
      client_id: CUSTOMER_ID,
      display_name: "Baxter Homes",
      identity_available: true,
      identity_ambiguous: false,
    },
    population_count: 1,
    source_bound_reached: false,
    first_delivered_at: "2026-08-30T10:00:00.000Z",
    last_delivered_at: "2026-08-30T10:00:00.000Z",
    sources: [
      {
        id: SOURCE_ID,
        delivered_at: "2026-08-30T10:00:00.000Z",
        direction: "outbound",
        safe_subject: "Revised quote",
        safe_body: "I will get back to you about the revised quote.",
        body_state: "readable",
        normalization_revision: "ops.correspondence.normalized-text.v2",
        source_sha256: `sha256:${"c".repeat(64)}`,
        participant_attribution: "exact",
        operator_attribution: "exact",
        attachment_enumeration_complete: true,
        attachment_evidence_ids: [
          "email_attachment:99999999-9999-4999-8999-999999999999",
        ],
        turn_id: TURN_ID,
      },
    ],
    ...overrides,
  };
}

function rpcWith(data: unknown) {
  return vi.fn<PromiseRecoveryRpcClient["rpc"]>(() =>
    Promise.resolve({ data, error: null })
  );
}

describe("promise-recovery repository", () => {
  it("binds one read to the exact current MCP actor, v11 manifest, and dormant v5 exposure", async () => {
    const rpc = rpcWith(rawSnapshot());
    const repository = createPromiseRecoveryRepository({ rpc });

    const result = await repository.read({
      actorContext: actor(),
      customerQuery: "Baxter Homes",
      asOf: "2026-08-31T20:00:00.000Z",
    });

    expect(result.sources[0]).toMatchObject({
      id: SOURCE_ID,
      safeBody: "I will get back to you about the revised quote.",
      turnId: TURN_ID,
      operatorAttribution: "exact",
      attachmentEvidenceIds: [
        "email_attachment:99999999-9999-4999-8999-999999999999",
      ],
    });
    expect(rpc).toHaveBeenCalledWith("read_agent_promise_recovery_as_system", {
      p_actor_user_id: USER_ID,
      p_company_id: COMPANY_ID,
      p_oauth_grant_id: GRANT_ID,
      p_oauth_client_id: OAUTH_CLIENT_ID,
      p_grant_revision: "b".repeat(32),
      p_granted_scope_ceiling: [
        "ops.company.read",
        "ops.correspondence.read",
        "ops.customer_contacts.read",
        "ops.customers.read",
        "ops.expenses.read",
        "ops.financial_documents.read",
        "ops.financials.read",
        "ops.jobs.read",
        "ops.payments.read",
        "ops.schedule.read",
        "ops.site_visits.read",
        "ops.tasks.read",
        "ops.team.read",
      ],
      p_permission_snapshot_revision: `sha256:${"a".repeat(64)}`,
      p_capability_manifest_revision: MANIFEST_REVISION,
      p_exposure_revision: "2026-09-01.mcp-exposure.v6",
      p_capability_id: "check_customer_reply",
      p_capability_revision: "check_customer_reply:2026-08-31.v1",
      p_customer_query: "Baxter Homes",
      p_as_of: "2026-08-31T20:00:00.000Z",
    });
  });

  it("binds a v15 actor to the exact dormant v9 exposure", async () => {
    const rpc = vi.fn<PromiseRecoveryRpcClient["rpc"]>(() =>
      Promise.resolve({ data: rawSnapshot(), error: null })
    );

    await createPromiseRecoveryRepository({ rpc }).read({
      actorContext: actor("2026-09-01.capability-manifest.v15"),
      customerQuery: "Baxter Homes",
      asOf: "2026-08-31T20:00:00.000Z",
    });

    expect(rpc.mock.calls[0]?.[1]).toMatchObject({
      p_capability_manifest_revision: "2026-09-01.capability-manifest.v15",
      p_exposure_revision: "2026-09-01.mcp-exposure.v9",
    });
  });

  it("preserves cancellation at the RPC boundary", async () => {
    const abortSignal = vi.fn(() =>
      Promise.resolve({ data: rawSnapshot(), error: null })
    );
    const rpc = vi.fn<PromiseRecoveryRpcClient["rpc"]>(() => ({
      then: Promise.resolve({ data: rawSnapshot(), error: null }).then.bind(
        Promise.resolve({ data: rawSnapshot(), error: null })
      ),
      abortSignal,
    }));
    const signal = new AbortController().signal;

    await createPromiseRecoveryRepository({ rpc }).read({
      actorContext: actor(),
      customerQuery: "Baxter Homes",
      asOf: "2026-08-31T20:00:00.000Z",
      signal,
    });

    expect(abortSignal).toHaveBeenCalledWith(signal);
  });

  it("rejects an actor from any other manifest before reading", async () => {
    const rpc = rpcWith(rawSnapshot());
    await expect(
      createPromiseRecoveryRepository({ rpc }).read({
        actorContext: actor("2026-08-31.capability-manifest.v10"),
        customerQuery: "Baxter Homes",
        asOf: "2026-08-31T20:00:00.000Z",
      })
    ).rejects.toThrow("Promise recovery requires a supported MCP actor");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects copied-turn content at the repository boundary", async () => {
    const raw = rawSnapshot();
    const source = (raw.sources as Array<Record<string, unknown>>)[0]!;
    source.normalized_plain_text = "[CONTENT OMITTED: UNSAFE SOURCE]";
    await expect(
      createPromiseRecoveryRepository({ rpc: rpcWith(raw) }).read({
        actorContext: actor(),
        customerQuery: "Baxter Homes",
        asOf: "2026-08-31T20:00:00.000Z",
      })
    ).rejects.toThrow("normalized_plain_text");
  });

  it("preserves an aggregate body-budget gap as an unread source instead of accepting a partial body", async () => {
    const raw = rawSnapshot();
    const source = (raw.sources as Array<Record<string, unknown>>)[0]!;
    source.safe_body = null;
    source.body_state = "payload_bound";
    const result = await createPromiseRecoveryRepository({
      rpc: rpcWith(raw),
    }).read({
      actorContext: actor(),
      customerQuery: "Baxter Homes",
      asOf: "2026-08-31T20:00:00.000Z",
    });
    expect(result.sources[0]).toMatchObject({
      safeBody: null,
      bodyState: "payload_bound",
    });
  });

  it("rejects a malformed snapshot whose returned safe bodies exceed the aggregate budget", async () => {
    const raw = rawSnapshot();
    const template = raw.sources[0]!;
    raw.population_count = 21;
    raw.first_delivered_at = "2026-08-30T10:00:00.000Z";
    raw.last_delivered_at = "2026-08-30T10:00:20.000Z";
    raw.sources = Array.from({ length: 21 }, (_, index) => ({
      ...template,
      id: `66666666-6666-4666-8666-${String(index).padStart(12, "0")}`,
      delivered_at: `2026-08-30T10:00:${String(index).padStart(2, "0")}.000Z`,
      safe_body: "x".repeat(100_000),
    }));
    await expect(
      createPromiseRecoveryRepository({ rpc: rpcWith(raw) }).read({
        actorContext: actor(),
        customerQuery: "Baxter Homes",
        asOf: "2026-08-31T20:00:00.000Z",
      })
    ).rejects.toThrow("PROMISE_RECOVERY_SNAPSHOT_INVALID");
  });

  it("rejects a malformed snapshot whose attachment references exceed the global budget", async () => {
    const raw = rawSnapshot();
    const template = raw.sources[0]!;
    raw.population_count = 2;
    raw.last_delivered_at = "2026-08-30T10:00:01.000Z";
    raw.sources = [0, 1].map((index) => ({
      ...template,
      id: `66666666-6666-4666-8666-${String(index).padStart(12, "0")}`,
      delivered_at: `2026-08-30T10:00:0${index}.000Z`,
      attachment_evidence_ids: Array.from(
        { length: index === 0 ? 51 : 50 },
        (_, attachmentIndex) =>
          `email_attachment:99999999-9999-4999-8999-${String(
            index * 100 + attachmentIndex
          ).padStart(12, "0")}`
      ),
    }));
    await expect(
      createPromiseRecoveryRepository({ rpc: rpcWith(raw) }).read({
        actorContext: actor(),
        customerQuery: "Baxter Homes",
        asOf: "2026-08-31T20:00:00.000Z",
      })
    ).rejects.toThrow("PROMISE_RECOVERY_SNAPSHOT_INVALID");
  });

  it.each([
    {
      name: "readable row without a body",
      mutate: (raw: ReturnType<typeof rawSnapshot>) => {
        (raw.sources as Array<Record<string, unknown>>)[0]!.safe_body = null;
      },
    },
    {
      name: "unreadable row with a body",
      mutate: (raw: ReturnType<typeof rawSnapshot>) => {
        const row = (raw.sources as Array<Record<string, unknown>>)[0]!;
        row.body_state = "unreadable";
      },
    },
    {
      name: "non-canonical chronology",
      mutate: (raw: ReturnType<typeof rawSnapshot>) => {
        raw.population_count = 2;
        raw.first_delivered_at = "2026-08-29T10:00:00.000Z";
        (raw.sources as Array<Record<string, unknown>>).push({
          ...(raw.sources as Array<Record<string, unknown>>)[0]!,
          id: "88888888-8888-4888-8888-888888888888",
          delivered_at: "2026-08-29T10:00:00.000Z",
        });
      },
    },
    {
      name: "turn id without source hash",
      mutate: (raw: ReturnType<typeof rawSnapshot>) => {
        (raw.sources as Array<Record<string, unknown>>)[0]!.source_sha256 =
          "not-a-hash";
      },
    },
    {
      name: "unstable attachment reference",
      mutate: (raw: ReturnType<typeof rawSnapshot>) => {
        (
          raw.sources as Array<Record<string, unknown>>
        )[0]!.attachment_evidence_ids = ["attachment:gmail:unstable"];
      },
    },
  ])("rejects malformed source authority: $name", async ({ mutate }) => {
    const raw = rawSnapshot();
    mutate(raw);
    await expect(
      createPromiseRecoveryRepository({ rpc: rpcWith(raw) }).read({
        actorContext: actor(),
        customerQuery: "Baxter Homes",
        asOf: "2026-08-31T20:00:00.000Z",
      })
    ).rejects.toThrow();
  });

  it("returns only a generic storage failure when the RPC is unavailable", async () => {
    const rpc = vi.fn<PromiseRecoveryRpcClient["rpc"]>(() =>
      Promise.resolve({
        data: null,
        error: { message: "secret table name and grant id" },
      })
    );
    await expect(
      createPromiseRecoveryRepository({ rpc }).read({
        actorContext: actor(),
        customerQuery: "Baxter Homes",
        asOf: "2026-08-31T20:00:00.000Z",
      })
    ).rejects.toThrow("Promise-recovery storage is unavailable");
  });
});
