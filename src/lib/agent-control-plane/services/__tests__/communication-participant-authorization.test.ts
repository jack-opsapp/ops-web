import { describe, expect, it } from "vitest";

import type { ActorAuthoritySnapshot } from "@/lib/agent-control-plane/actor/authority-repository";
import {
  authorizeCapability,
  type AuthorizedCapability,
} from "@/lib/agent-control-plane/actor/authorize-capability";
import { ActorAccessError } from "@/lib/agent-control-plane/actor/errors";
import { resolveActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import { trustedAuthorityRepositoryForSnapshot } from "@/lib/agent-control-plane/actor/__tests__/fixtures/trusted-repository-fixtures";
import {
  validatedMcpPrincipalFixture,
  verifiedInternalPrincipalFixture,
} from "@/lib/agent-control-plane/actor/__tests__/fixtures/verified-principal-fixtures";
import {
  CAPABILITY_MANIFEST_REVISION,
  resolveCapabilityAuthorization,
} from "@/lib/agent-control-plane/registry/capability-manifest";
import {
  authorizeJobCommunicationRead,
  isAuthorizedJobCommunicationRead,
} from "../job-communication-authorization";
import {
  authorizeJobParticipantsRead,
  isAuthorizedJobParticipantsRead,
} from "../job-participants-authorization";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const COMPANY_ID = "22222222-2222-4222-8222-222222222222";
const OPPORTUNITY_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID = "44444444-4444-4444-8444-444444444444";
const PERMISSION_REVISION = `sha256:${"a".repeat(64)}`;
const BASE_SCOPES = [
  "ops.correspondence.read",
  "ops.customer_contacts.read",
  "ops.customers.read",
  "ops.jobs.read",
] as const;
const ALL_SCOPES = [...BASE_SCOPES, "ops.photos.read", "ops.schedule.read"];

function authority(actorUserId = ACTOR_ID): ActorAuthoritySnapshot {
  return {
    actorUserId,
    companyId: COMPANY_ID,
    isActive: true,
    isAdmin: false,
    roleIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
    configuredPermissions: [
      "calendar.view",
      "clients.view",
      "inbox.view",
      "photos.view",
      "pipeline.view",
      "projects.view",
      "tasks.view",
    ],
    effectivePermissions: [
      { permission: "calendar.view", scope: "own" },
      { permission: "clients.view", scope: "assigned" },
      { permission: "inbox.view", scope: "own" },
      { permission: "photos.view", scope: "assigned" },
      { permission: "pipeline.view", scope: "assigned" },
      { permission: "projects.view", scope: "assigned" },
      { permission: "tasks.view", scope: "assigned" },
    ],
    permissionSnapshotRevision: PERMISSION_REVISION,
  };
}

async function actorContext(
  channel: "internal" | "ops_api" | "mcp",
  scopes: readonly string[] = ALL_SCOPES,
  actorUserId = ACTOR_ID
) {
  const principal =
    channel === "mcp"
      ? validatedMcpPrincipalFixture({
          actorUserId,
          companyId: COMPANY_ID,
          oauthGrantId: `grant-${actorUserId}`,
          oauthClientId: "client-task12",
          validatedScopes: scopes,
          tokenId: `token-${actorUserId}`,
          issuer: "https://app.opsapp.co",
          audience: "https://mcp.opsapp.co/mcp",
          grantRevision: "grant-revision:v1",
          applicationId: "external-assistant",
          protocolEra: "2026-08-13",
        })
      : verifiedInternalPrincipalFixture({
          channel,
          firebaseSubject: `firebase-task12-${channel}-${actorUserId}`,
          applicationId: channel === "internal" ? "phase-c" : "ops-api",
          protocolEra: "internal-v1",
        });
  return resolveActorContext({
    principal,
    authorityRepository: trustedAuthorityRepositoryForSnapshot(
      authority(actorUserId)
    ),
    requestId: `request-task12-${channel}-${actorUserId}`,
    policyRevision: "actor-policy:v1",
    capabilityManifestRevision: CAPABILITY_MANIFEST_REVISION,
  });
}

function authorizationSet(
  actor: Awaited<ReturnType<typeof actorContext>>,
  capabilityId: "get_job_communication_context" | "resolve_job_participants",
  rawInput: unknown
): AuthorizedCapability[] {
  const resolved = resolveCapabilityAuthorization(capabilityId, rawInput);
  return resolved.variants.map((variant) =>
    authorizeCapability({ actorContext: actor, policy: variant.policy })
  );
}

describe("communication and participant nominal authorization", () => {
  it.each(["internal", "ops_api", "mcp"] as const)(
    "authorizes the same project schedule communication query for %s",
    async (channel) => {
      const rawInput = {
        job_ref: { kind: "project", id: PROJECT_ID },
        purpose: "schedule_notice",
      };
      const actor = await actorContext(channel);
      const authorizations = authorizationSet(
        actor,
        "get_job_communication_context",
        rawInput
      );
      const proof = authorizeJobCommunicationRead({
        authorizations: [...authorizations].reverse(),
        rawInput,
      });

      expect(proof).toMatchObject({
        actorContext: actor,
        capabilityId: "get_job_communication_context",
        capabilityRevision: "get_job_communication_context:2026-08-13.v1",
        capabilityManifestRevision: CAPABILITY_MANIFEST_REVISION,
        requiredOAuthScopes: [
          "ops.correspondence.read",
          "ops.customer_contacts.read",
          "ops.customers.read",
          "ops.jobs.read",
          "ops.schedule.read",
        ],
        calendarScope: "own",
        clientsScope: "assigned",
        inboxScope: "own",
        photosScope: null,
        pipelineScope: null,
        projectsScope: "assigned",
        tasksScope: "assigned",
        query: rawInput,
      });
      expect(isAuthorizedJobCommunicationRead(proof)).toBe(true);
      expect(isAuthorizedJobCommunicationRead({ ...proof })).toBe(false);
      expect(Object.isFrozen(proof)).toBe(true);
      expect(Object.isFrozen(proof.query)).toBe(true);
      expect(Object.isFrozen(proof.query.job_ref)).toBe(true);
    }
  );

  it("requires schedule and photo authority together for a photo request", async () => {
    const rawInput = {
      job_ref: { kind: "opportunity", id: OPPORTUNITY_ID },
      purpose: "photo_request",
    };
    const actor = await actorContext("internal");
    const proof = authorizeJobCommunicationRead({
      authorizations: authorizationSet(
        actor,
        "get_job_communication_context",
        rawInput
      ),
      rawInput,
    });

    expect(proof).toMatchObject({
      requiredOAuthScopes: [
        "ops.correspondence.read",
        "ops.customer_contacts.read",
        "ops.customers.read",
        "ops.jobs.read",
        "ops.photos.read",
        "ops.schedule.read",
      ],
      calendarScope: "own",
      photosScope: "assigned",
      pipelineScope: "assigned",
      projectsScope: "assigned",
      tasksScope: "assigned",
    });
  });

  it("keeps general communication at the base authority surface", async () => {
    const rawInput = {
      job_ref: { kind: "opportunity", id: OPPORTUNITY_ID },
      purpose: "general",
    };
    const actor = await actorContext("internal");
    const proof = authorizeJobCommunicationRead({
      authorizations: authorizationSet(
        actor,
        "get_job_communication_context",
        rawInput
      ),
      rawInput,
    });

    expect(proof).toMatchObject({
      requiredOAuthScopes: BASE_SCOPES,
      calendarScope: null,
      photosScope: null,
      pipelineScope: "assigned",
      projectsScope: null,
      tasksScope: null,
    });
  });

  it.each(["schedule", "assignment"] as const)(
    "adds exact linked-project and task authority for opportunity participant %s",
    async (purpose) => {
      const rawInput = {
        job_ref: { kind: "opportunity", id: OPPORTUNITY_ID },
        purpose,
      };
      const actor = await actorContext("internal");
      const authorizations = authorizationSet(
        actor,
        "resolve_job_participants",
        rawInput
      );
      const proof = authorizeJobParticipantsRead({
        authorizations: [...authorizations].reverse(),
        rawInput,
      });

      expect(proof).toMatchObject({
        actorContext: actor,
        capabilityId: "resolve_job_participants",
        capabilityRevision: "resolve_job_participants:2026-08-13.v1",
        capabilityManifestRevision: CAPABILITY_MANIFEST_REVISION,
        requiredOAuthScopes: BASE_SCOPES,
        clientsScope: "assigned",
        inboxScope: "own",
        pipelineScope: "assigned",
        projectsScope: "assigned",
        tasksScope: "assigned",
        query: rawInput,
      });
      expect(proof).not.toHaveProperty("calendarScope");
      expect(isAuthorizedJobParticipantsRead(proof)).toBe(true);
      expect(isAuthorizedJobParticipantsRead({ ...proof })).toBe(false);
      expect(Object.isFrozen(proof.query.job_ref)).toBe(true);
    }
  );

  it("keeps participant communication and general purposes at base authority", async () => {
    for (const purpose of ["communication", "general"] as const) {
      const rawInput = {
        job_ref: { kind: "opportunity", id: OPPORTUNITY_ID },
        purpose,
      };
      const actor = await actorContext("internal");
      const proof = authorizeJobParticipantsRead({
        authorizations: authorizationSet(
          actor,
          "resolve_job_participants",
          rawInput
        ),
        rawInput,
      });
      expect(proof).toMatchObject({
        pipelineScope: "assigned",
        projectsScope: null,
        tasksScope: null,
      });
    }
  });

  it("rejects missing, duplicate, mismatched-actor, and wrong-purpose proof sets", async () => {
    const rawInput = {
      job_ref: { kind: "project", id: PROJECT_ID },
      purpose: "photo_request",
    };
    const firstActor = await actorContext("internal");
    const secondActor = await actorContext(
      "internal",
      ALL_SCOPES,
      "55555555-5555-4555-8555-555555555555"
    );
    const proofs = authorizationSet(
      firstActor,
      "get_job_communication_context",
      rawInput
    );
    const secondProofs = authorizationSet(
      secondActor,
      "get_job_communication_context",
      rawInput
    );

    for (const authorizations of [
      proofs.slice(0, 1),
      [proofs[0]!, proofs[0]!],
      [proofs[0]!, secondProofs[1]!],
    ]) {
      expect(() =>
        authorizeJobCommunicationRead({ authorizations, rawInput })
      ).toThrow(ActorAccessError);
    }
    expect(() =>
      authorizeJobCommunicationRead({
        authorizations: proofs,
        rawInput: { ...rawInput, purpose: "general" },
      })
    ).toThrow(ActorAccessError);
  });

  it("rejects stale replay fields and non-UUID job references before minting proof", async () => {
    const actor = await actorContext("internal");
    const validInput = {
      job_ref: { kind: "project", id: PROJECT_ID },
      purpose: "general",
    };
    const communication = authorizationSet(
      actor,
      "get_job_communication_context",
      validInput
    );
    const participants = authorizationSet(
      actor,
      "resolve_job_participants",
      validInput
    );

    expect(() =>
      authorizeJobCommunicationRead({
        authorizations: communication,
        rawInput: { ...validInput, as_of: "2026-08-13T00:00:00.000Z" },
      })
    ).toThrow(ActorAccessError);
    expect(() =>
      authorizeJobParticipantsRead({
        authorizations: participants,
        rawInput: {
          ...validInput,
          job_ref: { kind: "project", id: "legacy-project-id" },
        },
      })
    ).toThrow(ActorAccessError);
  });

  it("enforces the complete MCP OAuth ceiling before purpose authorization", async () => {
    const rawInput = {
      job_ref: { kind: "project", id: PROJECT_ID },
      purpose: "photo_request",
    };
    const actor = await actorContext(
      "mcp",
      ALL_SCOPES.filter((scope) => scope !== "ops.photos.read")
    );

    expect(() =>
      authorizationSet(actor, "get_job_communication_context", rawInput)
    ).toThrow(ActorAccessError);
  });

  it("captures caller-supplied authorization and query channels exactly once", async () => {
    const actor = await actorContext("internal");
    const communicationInput = {
      job_ref: { kind: "project", id: PROJECT_ID },
      purpose: "general",
    };
    const participantInput = {
      job_ref: { kind: "project", id: PROJECT_ID },
      purpose: "assignment",
    };
    const communicationProofs = authorizationSet(
      actor,
      "get_job_communication_context",
      communicationInput
    );
    const participantProofs = authorizationSet(
      actor,
      "resolve_job_participants",
      participantInput
    );
    let communicationAuthorizationReads = 0;
    let communicationInputReads = 0;
    let participantAuthorizationReads = 0;
    let participantInputReads = 0;

    expect(
      authorizeJobCommunicationRead({
        get authorizations() {
          communicationAuthorizationReads += 1;
          return communicationProofs;
        },
        get rawInput() {
          communicationInputReads += 1;
          return communicationInput;
        },
      })
    ).toMatchObject({ query: communicationInput });
    expect(
      authorizeJobParticipantsRead({
        get authorizations() {
          participantAuthorizationReads += 1;
          return participantProofs;
        },
        get rawInput() {
          participantInputReads += 1;
          return participantInput;
        },
      })
    ).toMatchObject({ query: participantInput });
    expect({
      communicationAuthorizationReads,
      communicationInputReads,
      participantAuthorizationReads,
      participantInputReads,
    }).toEqual({
      communicationAuthorizationReads: 1,
      communicationInputReads: 1,
      participantAuthorizationReads: 1,
      participantInputReads: 1,
    });
  });

  it("captures each generic authorization proof exactly once before validation", async () => {
    const actor = await actorContext("internal");
    const communicationInput = {
      job_ref: { kind: "project", id: PROJECT_ID },
      purpose: "general",
    };
    const participantInput = {
      job_ref: { kind: "project", id: PROJECT_ID },
      purpose: "assignment",
    };
    const communicationProofs = authorizationSet(
      actor,
      "get_job_communication_context",
      communicationInput
    );
    const participantProofs = authorizationSet(
      actor,
      "resolve_job_participants",
      participantInput
    );
    let communicationProofReads = 0;
    let participantProofReads = 0;
    const communicationChannel = new Array<AuthorizedCapability>(1);
    Object.defineProperty(communicationChannel, "0", {
      enumerable: true,
      get() {
        communicationProofReads += 1;
        return communicationProofs[0]!;
      },
    });
    const participantChannel = new Array<AuthorizedCapability>(
      participantProofs.length
    );
    participantProofs.forEach((proof, index) => {
      Object.defineProperty(participantChannel, String(index), {
        enumerable: true,
        get() {
          participantProofReads += 1;
          return proof;
        },
      });
    });

    expect(
      authorizeJobCommunicationRead({
        authorizations: communicationChannel,
        rawInput: communicationInput,
      })
    ).toMatchObject({ query: communicationInput });
    expect(
      authorizeJobParticipantsRead({
        authorizations: participantChannel,
        rawInput: participantInput,
      })
    ).toMatchObject({ query: participantInput });
    expect(communicationProofReads).toBe(1);
    expect(participantProofReads).toBe(participantProofs.length);
  });

  it("rejects structurally forged nominal proof objects", async () => {
    const actor = await actorContext("internal");
    const rawInput = {
      job_ref: { kind: "project", id: PROJECT_ID },
      purpose: "general",
    };
    const [authorization] = authorizationSet(
      actor,
      "get_job_communication_context",
      rawInput
    );

    expect(() =>
      authorizeJobCommunicationRead({
        authorizations: [{ ...authorization! } as AuthorizedCapability],
        rawInput,
      })
    ).toThrow(ActorAccessError);
  });
});
