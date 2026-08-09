import type { ActorAuthoritySnapshot } from "@/lib/agent-control-plane/actor/authority-repository";
import { authorizeCapability } from "@/lib/agent-control-plane/actor/authorize-capability";
import { defineCapabilityPolicyForManifest } from "@/lib/agent-control-plane/actor/capability-policy-boundary";
import { resolveActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import { verifiedInternalPrincipalFixture } from "@/lib/agent-control-plane/actor/__tests__/fixtures/verified-principal-fixtures";
import { trustedAuthorityRepositoryForSnapshot } from "@/lib/agent-control-plane/actor/__tests__/fixtures/trusted-repository-fixtures";
import { authorizeCorrespondenceEvidenceRead } from "@/lib/agent-control-plane/evidence/evidence-read-authorization";
import {
  createCorrespondenceEvidenceRepository,
  createSupabaseAuthorizedEvidenceLookupAdapter,
  type AuthorizedEvidenceLookupRpcClient,
} from "@/lib/agent-control-plane/evidence/repository";
import type {
  NormalizedCorrespondenceEvidence,
  PromptSafeCorrespondenceEvidenceResult,
} from "@/lib/agent-control-plane/evidence/types";
import {
  CAPABILITY_MANIFEST_REVISION,
  getCapabilityManifestEntry,
} from "@/lib/agent-control-plane/registry/capability-manifest";

export const EVIDENCE_ACTOR_ID = "11111111-1111-4111-8111-111111111111";
export const EVIDENCE_COMPANY_ID = "22222222-2222-4222-8222-222222222222";
const AUTHORITY_REVISION = `sha256:${"a".repeat(64)}`;

class StubEvidenceLookupRpcClient implements AuthorizedEvidenceLookupRpcClient {
  constructor(private readonly rows: unknown) {}

  async rpc(
    _functionName: "read_agent_correspondence_evidence_as_system",
    _args: Readonly<Record<string, unknown>>
  ): Promise<{ data: unknown; error: unknown }> {
    return { data: this.rows, error: null };
  }
}

function authority(): ActorAuthoritySnapshot {
  return {
    actorUserId: EVIDENCE_ACTOR_ID,
    companyId: EVIDENCE_COMPANY_ID,
    isActive: true,
    isAdmin: false,
    roleIds: ["33333333-3333-4333-8333-333333333333"],
    configuredPermissions: ["inbox.view"],
    effectivePermissions: [{ permission: "inbox.view", scope: "all" }],
    permissionSnapshotRevision: AUTHORITY_REVISION,
  };
}

async function authorization() {
  const actorContext = await resolveActorContext({
    principal: verifiedInternalPrincipalFixture({
      channel: "internal",
      firebaseSubject: "firebase-evidence-prompt-test",
    }),
    authorityRepository: trustedAuthorityRepositoryForSnapshot(authority()),
    requestId: "request-evidence-prompt-test",
    policyRevision: "actor-policy:v1",
    capabilityManifestRevision: CAPABILITY_MANIFEST_REVISION,
  });
  const manifestPolicy = getCapabilityManifestEntry(
    "get_correspondence_evidence"
  ).authorization.variants[0]!.policy;
  return authorizeCorrespondenceEvidenceRead(
    authorizeCapability({
      actorContext,
      policy: defineCapabilityPolicyForManifest({
        capabilityId: manifestPolicy.capabilityId,
        capabilityRevision: manifestPolicy.capabilityRevision,
        capabilityManifestRevision: CAPABILITY_MANIFEST_REVISION,
        requiredOAuthScopes: manifestPolicy.requiredOAuthScopes,
        permissionRequirementGroups: [
          [
            {
              permission: "inbox.view",
              allowedScopes: ["all", "assigned", "own"],
            },
          ],
        ],
      }),
    })
  );
}

export function evidenceRpcRow(value: NormalizedCorrespondenceEvidence) {
  return {
    evidence_id: value.evidenceId,
    company_id: value.companyId,
    source_id: value.sourceId,
    occurred_at: value.occurredAt,
    subject: value.subject,
    side: "user",
    participant_id: "client:44444444-4444-4444-8444-444444444444",
    participant_resolution_status: "resolved",
    direction: "inbound",
    source_activity_id: "55555555-5555-4555-8555-555555555555",
    source_correspondence_event_id: "66666666-6666-4666-8666-666666666666",
    recipient_identities: ["ops_mailbox:77777777-7777-4777-8777-777777777777"],
    cc_recipient_identities: [],
    redaction_kinds: [] as string[],
    normalized_plain_text: value.normalizedPlainText,
    original_content_hash: value.originalContentHash,
    attachments: value.attachments.map((attachment) => ({
      attachment_id: attachment.attachmentId,
      filename: attachment.filename,
      mime_type: attachment.mimeType,
      size_bytes: attachment.sizeBytes,
      inline: attachment.inline,
      content_hash: attachment.contentHash,
    })),
  };
}

export async function promptSafeResultForRows(
  rows: unknown,
  evidenceIds: readonly string[]
): Promise<PromptSafeCorrespondenceEvidenceResult> {
  const client = new StubEvidenceLookupRpcClient(rows);
  const repository = createCorrespondenceEvidenceRepository(
    createSupabaseAuthorizedEvidenceLookupAdapter(client)
  );
  return repository.getCorrespondenceEvidence({
    authorization: await authorization(),
    evidenceIds,
  });
}
