import { describe, expect, it, vi } from "vitest";

import type { ActorAuthoritySnapshot } from "@/lib/agent-control-plane/actor/authority-repository";
import { StubAuthoritySupabaseRpcClient } from "@/lib/agent-control-plane/actor/__tests__/fixtures/trusted-repository-fixtures";
import { validatedMcpPrincipalFixture } from "@/lib/agent-control-plane/actor/__tests__/fixtures/verified-principal-fixtures";
import { resolveActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import { PROMISE_RECOVERY_CAPABILITY_MANIFEST_REVISION } from "@/lib/agent-control-plane/registry/capability-manifest";
import {
  createPromiseRecoveryRepository,
  type PromiseRecoveryRpcClient,
  type PromiseRecoverySnapshot,
} from "../promise-recovery-repository";
import {
  analyzePromiseRecoverySnapshot,
  createPromiseRecoveryService,
} from "../promise-recovery-service";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const COMPANY_ID = "22222222-2222-4222-8222-222222222222";
const GRANT_ID = "33333333-3333-4333-8333-333333333333";
const OAUTH_CLIENT_ID = "44444444-4444-4444-8444-444444444444";
const CUSTOMER_ID = "55555555-5555-4555-8555-555555555555";
const SCOPES = [
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
] as const;
const PERMISSIONS = ["clients.view", "email.view"] as const;

function source(
  index: number,
  input: Partial<PromiseRecoverySnapshot["sources"][number]> & {
    direction: "inbound" | "outbound";
    safeBody: string | null;
  }
): PromiseRecoverySnapshot["sources"][number] {
  const suffix = String(index).padStart(12, "0");
  return {
    id: input.id ?? `aaaaaaaa-aaaa-4aaa-8aaa-${suffix}`,
    deliveredAt:
      input.deliveredAt ??
      `2026-08-${String(20 + index).padStart(2, "0")}T10:00:00.000Z`,
    direction: input.direction,
    safeSubject: input.safeSubject ?? "Revised quote",
    safeBody: input.safeBody,
    bodyState: input.bodyState ?? "readable",
    normalizationRevision:
      input.normalizationRevision ?? "ops.correspondence.normalized-text.v2",
    sourceSha256: input.sourceSha256 ?? `sha256:${"c".repeat(64)}`,
    participantAttribution: input.participantAttribution ?? "exact",
    operatorAttribution:
      input.operatorAttribution ??
      (input.direction === "inbound" ? "not_applicable" : "exact"),
    attachmentEnumerationComplete: input.attachmentEnumerationComplete ?? true,
    attachmentEvidenceIds: input.attachmentEvidenceIds ?? [],
    turnId:
      input.turnId === undefined
        ? `bbbbbbbb-bbbb-4bbb-8bbb-${suffix}`
        : input.turnId,
  };
}

function snapshot(
  sources: readonly PromiseRecoverySnapshot["sources"][number][],
  input: Partial<PromiseRecoverySnapshot> = {}
): PromiseRecoverySnapshot {
  return {
    customerResolution: {
      state: "exact",
      candidateCount: 1,
      clientId: CUSTOMER_ID,
      displayName: "Baxter Homes",
      identityAvailable: true,
      identityAmbiguous: false,
    },
    populationCount: sources.length,
    sourceBoundReached: false,
    firstDeliveredAt: sources[0]?.deliveredAt ?? null,
    lastDeliveredAt: sources.at(-1)?.deliveredAt ?? null,
    sources,
    ...input,
  } as PromiseRecoverySnapshot;
}

function analyze(value: PromiseRecoverySnapshot, topic = "revised quote") {
  return analyzePromiseRecoverySnapshot({
    snapshot: value,
    topic,
    asOf: "2026-08-31T20:00:00.000Z",
  });
}

describe("promise-recovery definitions", () => {
  it("proves a request, explicit promise, later reply, and resolution in exact chronology", () => {
    const result = analyze(
      snapshot([
        source(1, {
          direction: "inbound",
          safeBody: "Can you send the revised quote?",
        }),
        source(2, {
          direction: "outbound",
          safeBody: "I will get back to you about the revised quote.",
        }),
        source(3, {
          direction: "outbound",
          safeBody: "I sent the revised quote. It is attached.",
          attachmentEvidenceIds: [
            "email_attachment:99999999-9999-4999-8999-999999999999",
          ],
        }),
      ])
    );

    expect(result.answer).toMatchObject({
      state: "replied",
      basis: "qualifying_reply_found",
      reply: "found",
      promise: "answered",
      resolution: "proven",
      trigger_source_ref:
        "provider_delivery_source:aaaaaaaa-aaaa-4aaa-8aaa-000000000002",
      reply_source_ref:
        "provider_delivery_source:aaaaaaaa-aaaa-4aaa-8aaa-000000000003",
    });
    expect(result.chronology.map((item) => item.role)).toEqual([
      "customer_request",
      "promise",
      "resolution",
    ]);
    expect(result.chronology[2]).toMatchObject({
      attachment_evidence_ids: [
        "email_attachment:99999999-9999-4999-8999-999999999999",
      ],
      operator_attribution: "exact",
      turn_evidence: {
        evidence_id:
          "job_conversation_turn:bbbbbbbb-bbbb-4bbb-8bbb-000000000003",
      },
    });
  });

  it("reports a direct reply without inventing a promise or resolution", () => {
    const result = analyze(
      snapshot([
        source(1, {
          direction: "inbound",
          safeBody: "Any update on the revised quote?",
        }),
        source(2, {
          direction: "outbound",
          safeBody: "The revised quote needs one more review.",
        }),
      ])
    );
    expect(result.answer).toMatchObject({
      state: "replied",
      promise: "not_found",
      resolution: "not_proven",
    });
    expect(result.chronology[1]!.role).toBe("reply");
  });

  it("does not prove resolution from a negated completion marker", () => {
    const result = analyze(
      snapshot([
        source(1, {
          direction: "inbound",
          safeBody: "Can you send the revised quote?",
        }),
        source(2, {
          direction: "outbound",
          safeBody: "The revised quote has not been sent yet.",
        }),
      ])
    );

    expect(result.answer).toMatchObject({
      state: "replied",
      resolution: "not_proven",
    });
    expect(result.chronology[1]!.role).toBe("reply");
  });

  it("does not turn a later customer acknowledgement into a new request", () => {
    const result = analyze(
      snapshot([
        source(1, {
          direction: "inbound",
          safeBody: "Can you send the revised quote?",
        }),
        source(2, {
          direction: "outbound",
          safeBody: "The revised quote is attached and sent.",
        }),
        source(3, {
          direction: "inbound",
          safeBody: "Thanks, the revised quote looks good.",
        }),
      ])
    );

    expect(result.answer).toMatchObject({
      state: "replied",
      reply: "found",
      resolution: "proven",
    });
    expect(result.chronology.map((item) => item.role)).toEqual([
      "customer_request",
      "resolution",
      "topic_mention",
    ]);
  });

  it("keeps the decisive request and reply citations when chronology is bounded", () => {
    const sources = [
      source(1, {
        deliveredAt: "2026-08-30T10:00:01.000Z",
        direction: "inbound",
        safeBody: "Can you send the revised quote?",
      }),
      source(2, {
        deliveredAt: "2026-08-30T10:00:02.000Z",
        direction: "outbound",
        safeBody: "The revised quote is attached and sent.",
      }),
      ...Array.from({ length: 20 }, (_, index) =>
        source(index + 3, {
          id: `cccccccc-cccc-4ccc-8ccc-${String(index).padStart(12, "0")}`,
          deliveredAt: `2026-08-30T10:00:${String(index + 3).padStart(
            2,
            "0"
          )}.000Z`,
          direction: "inbound",
          safeBody: "Thanks, the revised quote looks good.",
        })
      ),
    ];
    const result = analyze(snapshot(sources));

    expect(result.answer.state).toBe("replied");
    expect(result.chronology).toHaveLength(20);
    expect(result.chronology_omitted_count).toBe(2);
    expect(result.chronology.map((item) => item.source_ref)).toEqual(
      expect.arrayContaining([
        result.answer.trigger_source_ref,
        result.answer.reply_source_ref,
      ])
    );
  });

  it("reports the latest explicit promise as unanswered", () => {
    const result = analyze(
      snapshot([
        source(1, {
          direction: "outbound",
          safeBody: "We’ll follow up about the revised quote tomorrow.",
        }),
      ])
    );
    expect(result.answer).toMatchObject({
      state: "outstanding",
      basis: "unanswered_promise",
      reply: "not_found",
      promise: "unanswered",
    });
  });

  it("reports a customer request with no later reply as outstanding", () => {
    const result = analyze(
      snapshot([
        source(1, {
          direction: "inbound",
          safeBody: "Can you send the revised quote?",
        }),
      ])
    );
    expect(result.answer).toMatchObject({
      state: "outstanding",
      basis: "unanswered_request",
      promise: "not_found",
    });
  });

  it("returns not_found only for complete readable history with no body-level topic match", () => {
    const result = analyze(
      snapshot([
        source(1, {
          direction: "inbound",
          safeSubject: "Revised quote",
          safeBody: "Thanks for the call yesterday.",
        }),
        source(2, {
          direction: "outbound",
          safeSubject: "Re: Revised quote",
          safeBody: "Happy to help.",
        }),
      ])
    );
    expect(result.answer).toMatchObject({
      state: "not_found",
      basis: "no_qualifying_correspondence",
    });
    expect(result.chronology).toEqual([]);
  });

  it("requires every significant topic term as a whole body token", () => {
    const result = analyze(
      snapshot([
        source(1, {
          direction: "inbound",
          safeBody: "Can you send a quote revision?",
        }),
      ])
    );
    expect(result.answer.state).toBe("not_found");
  });

  it.each([
    {
      reason: "unreadable_correspondence",
      source: source(1, {
        direction: "inbound",
        safeBody: null,
        bodyState: "unreadable",
      }),
    },
    {
      reason: "unattributed_correspondence",
      source: source(1, {
        direction: "inbound",
        safeBody: "Can you send the revised quote?",
        participantAttribution: "thread_only",
      }),
    },
    {
      reason: "operator_attribution_unresolved",
      source: source(1, {
        direction: "outbound",
        safeBody: "The revised quote is attached and sent.",
        operatorAttribution: "unresolved",
      }),
    },
    {
      reason: "oversized_correspondence",
      source: source(1, {
        direction: "inbound",
        safeBody: null,
        bodyState: "oversized",
      }),
    },
    {
      reason: "source_payload_bound_reached",
      source: source(1, {
        direction: "inbound",
        safeBody: null,
        bodyState: "payload_bound",
      }),
    },
    {
      reason: "attachment_enumeration_incomplete",
      source: source(1, {
        direction: "inbound",
        safeBody: "Can you send the revised quote?",
        attachmentEnumerationComplete: false,
      }),
    },
  ])("fails closed for $reason", ({ reason, source: unsafeSource }) => {
    const result = analyze(snapshot([unsafeSource]));
    expect(result.answer).toMatchObject({
      state: "insufficient_evidence",
      basis: "evidence_gap",
      reply: "not_evaluated",
    });
    expect(result.coverage.missing_reasons).toContain(reason);
  });

  it("fails closed for duplicate customer identity or a bounded source population", () => {
    const unavailable = analyze(
      snapshot([], {
        customerResolution: {
          state: "exact",
          candidateCount: 1,
          clientId: CUSTOMER_ID,
          displayName: "Baxter Homes",
          identityAvailable: false,
          identityAmbiguous: false,
        },
      })
    );
    expect(unavailable.coverage.missing_reasons).toEqual([
      "customer_identity_unavailable",
    ]);

    const identity = analyze(
      snapshot([], {
        customerResolution: {
          state: "exact",
          candidateCount: 1,
          clientId: CUSTOMER_ID,
          displayName: "Baxter Homes",
          identityAvailable: true,
          identityAmbiguous: true,
        },
      })
    );
    expect(identity.coverage.missing_reasons).toEqual([
      "customer_identity_ambiguous",
    ]);

    const sources = Array.from({ length: 500 }, (_, index) =>
      source((index % 8) + 1, {
        id: `cccccccc-cccc-4ccc-8ccc-${String(index).padStart(12, "0")}`,
        deliveredAt: `2026-08-28T10:${String(Math.floor(index / 60)).padStart(
          2,
          "0"
        )}:${String(index % 60).padStart(2, "0")}.000Z`,
        direction: "outbound",
        safeBody: "Unrelated body.",
      })
    );
    const bounded = analyze(
      snapshot(sources, {
        populationCount: 501,
        sourceBoundReached: true,
        firstDeliveredAt: sources[0]!.deliveredAt,
        lastDeliveredAt: "2026-08-29T10:00:00.000Z",
      })
    );
    expect(bounded.coverage.missing_reasons).toContain("source_bound_reached");
    expect(bounded.answer.state).toBe("insufficient_evidence");
  });

  it.each([
    {
      state: "not_found" as const,
      candidateCount: 0,
      basis: "customer_not_found",
      reason: "customer_not_found",
    },
    {
      state: "ambiguous" as const,
      candidateCount: 2,
      basis: "customer_ambiguous",
      reason: "customer_ambiguous",
    },
  ])("returns explicit insufficient evidence for customer $state", (item) => {
    const result = analyze(
      snapshot([], {
        customerResolution: {
          state: item.state,
          candidateCount: item.candidateCount,
          clientId: null,
          displayName: null,
          identityAvailable: false,
          identityAmbiguous: false,
        },
      })
    );
    expect(result.answer).toMatchObject({
      state: "insufficient_evidence",
      basis: item.basis,
    });
    expect(result.coverage.missing_reasons).toEqual([item.reason]);
  });
});

function authority(
  permissions: readonly string[] = PERMISSIONS
): ActorAuthoritySnapshot {
  return {
    actorUserId: USER_ID,
    companyId: COMPANY_ID,
    isActive: true,
    isAdmin: false,
    roleIds: [],
    configuredPermissions: [...permissions],
    effectivePermissions: permissions.map((permission) => ({
      permission,
      scope: "all",
    })),
    permissionSnapshotRevision: `sha256:${"d".repeat(64)}`,
  };
}

function rawSnapshot() {
  const sources = [
    source(1, {
      direction: "inbound",
      safeBody: "Can you send the revised quote?",
    }),
    source(2, {
      direction: "outbound",
      safeBody: "The revised quote is attached and sent.",
    }),
  ];
  return {
    customer_resolution: {
      state: "exact",
      candidate_count: 1,
      client_id: CUSTOMER_ID,
      display_name: "Baxter Homes",
      identity_available: true,
      identity_ambiguous: false,
    },
    population_count: 2,
    source_bound_reached: false,
    first_delivered_at: sources[0]!.deliveredAt,
    last_delivered_at: sources[1]!.deliveredAt,
    sources: sources.map((item) => ({
      id: item.id,
      delivered_at: item.deliveredAt,
      direction: item.direction,
      safe_subject: item.safeSubject,
      safe_body: item.safeBody,
      body_state: item.bodyState,
      normalization_revision: item.normalizationRevision,
      source_sha256: item.sourceSha256,
      participant_attribution: item.participantAttribution,
      operator_attribution: item.operatorAttribution,
      attachment_enumeration_complete: item.attachmentEnumerationComplete,
      attachment_evidence_ids: item.attachmentEvidenceIds,
      turn_id: item.turnId,
    })),
  };
}

async function serviceFixture(
  capabilityManifestRevision = PROMISE_RECOVERY_CAPABILITY_MANIFEST_REVISION
) {
  const authorityClient = new StubAuthoritySupabaseRpcClient(authority());
  const actor = await resolveActorContext({
    principal: validatedMcpPrincipalFixture({
      actorUserId: USER_ID,
      companyId: COMPANY_ID,
      oauthGrantId: GRANT_ID,
      oauthClientId: OAUTH_CLIENT_ID,
      validatedScopes: SCOPES,
      tokenId: "token-promise-recovery",
      issuer: "https://app.opsapp.co",
      audience: "https://app.opsapp.co/api/mcp",
      grantRevision: "b".repeat(32),
      applicationId: "ops-mcp-test",
      protocolEra: "mcp-2025-11-25",
    }),
    authorityRepository: authorityClient.repository,
    requestId: "request-promise-recovery",
    policyRevision: "actor-policy:v1",
    capabilityManifestRevision,
  });
  const abortSignal = vi.fn(() =>
    Promise.resolve({ data: rawSnapshot(), error: null })
  );
  const rpc = vi.fn<PromiseRecoveryRpcClient["rpc"]>(() => {
    const result = Promise.resolve({ data: rawSnapshot(), error: null });
    return Object.assign(result, { abortSignal });
  });
  return {
    actor,
    authorityClient,
    abortSignal,
    rpc,
    service: createPromiseRecoveryService({
      repository: createPromiseRecoveryRepository({ rpc }),
      authorityRepository: authorityClient.repository,
      now: () => new Date("2026-08-31T20:00:00.000Z"),
    }),
  };
}

describe("promise-recovery service authority", () => {
  it("reauthorizes the current actor under v12 and threads cancellation to both reads", async () => {
    const { actor, authorityClient, abortSignal, service } =
      await serviceFixture();
    const signal = new AbortController().signal;
    const result = await service.checkCustomerReply(
      actor,
      { customer_query: "Baxter Homes", topic: "revised quote" },
      { signal }
    );

    expect(result.answer.state).toBe("replied");
    expect(authorityClient.actorSignals).toEqual([signal]);
    expect(abortSignal).toHaveBeenCalledWith(signal);
  });

  it("executes the inherited tool under a real v15 actor and v9 binding", async () => {
    const { actor, rpc, service } = await serviceFixture(
      "2026-09-01.capability-manifest.v15"
    );

    await expect(
      service.checkCustomerReply(actor, {
        customer_query: "Baxter Homes",
        topic: "revised quote",
      })
    ).resolves.toMatchObject({ answer: { state: "replied" } });
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({
      p_capability_manifest_revision: "2026-09-01.capability-manifest.v15",
      p_exposure_revision: "2026-09-01.mcp-exposure.v9",
    });
  });

  it("fails before correspondence access when current email authority was revoked", async () => {
    const { actor, authorityClient, rpc, service } = await serviceFixture();
    authorityClient.mcpResult = authority(["clients.view"]);

    await expect(
      service.checkCustomerReply(actor, {
        customer_query: "Baxter Homes",
        topic: "revised quote",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(rpc).not.toHaveBeenCalled();
  });
});
