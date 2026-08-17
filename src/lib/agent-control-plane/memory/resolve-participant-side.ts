export type ConversationSide = "user" | "assistant";
export type ParticipantResolutionStatus =
  | "resolved"
  | "unresolved"
  | "ambiguous";

export type ConfirmedCustomerParticipant = {
  readonly kind:
    | "client"
    | "sub_client"
    | "related_contact"
    | "high_confidence_related_contact";
  readonly id: string;
};

export interface ParticipantSideEvidence {
  readonly direction: "inbound" | "outbound";
  readonly partyRole: string | null;
  readonly deliverySourceKind?:
    | "gmail_mime_part"
    | "microsoft_graph_body"
    | "ops_rendered_outbound";
  readonly sourceActivityId: string;
  readonly senderEmail: string | null;
  readonly actorUserId: string | null;
  readonly confirmedCustomerParticipants: readonly ConfirmedCustomerParticipant[];
}

export interface ParticipantSideResolution {
  readonly side: ConversationSide | null;
  readonly participantId: string;
  readonly status: ParticipantResolutionStatus;
  readonly revision: string;
}

const PARTICIPANT_RESOLUTION_REVISION = "job-participant-side:v1";

function normalizedEmail(value: string | null): string | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  return /^[^\s@]+@[^\s@]+$/.test(normalized) ? normalized : null;
}

function unresolvedParticipant(
  input: ParticipantSideEvidence
): ParticipantSideResolution {
  const email = normalizedEmail(input.senderEmail);
  return Object.freeze({
    side: null,
    participantId: email
      ? `ambiguous:email:${email}`
      : `unresolved:activity:${input.sourceActivityId}`,
    status: email ? "ambiguous" : "unresolved",
    revision: PARTICIPANT_RESOLUTION_REVISION,
  });
}

export function resolveParticipantSide(
  input: ParticipantSideEvidence
): ParticipantSideResolution {
  if (input.direction === "outbound") {
    const isProvenOpsDelivery =
      input.partyRole === "ops" ||
      input.deliverySourceKind === "ops_rendered_outbound" ||
      Boolean(input.actorUserId?.trim());
    if (!isProvenOpsDelivery) return unresolvedParticipant(input);
    const actorUserId = input.actorUserId?.trim() ?? "";
    return Object.freeze({
      side: "assistant",
      participantId: actorUserId ? `ops_user:${actorUserId}` : "ops:system",
      status: "resolved",
      revision: PARTICIPANT_RESOLUTION_REVISION,
    });
  }

  if (input.partyRole !== "customer") return unresolvedParticipant(input);

  const uniqueParticipants = new Map<string, ConfirmedCustomerParticipant>();
  for (const participant of input.confirmedCustomerParticipants) {
    if (participant.kind === "high_confidence_related_contact") continue;
    const id = participant.id.trim();
    if (!id) continue;
    uniqueParticipants.set(`${participant.kind}:${id}`, {
      kind: participant.kind,
      id,
    });
  }
  if (uniqueParticipants.size !== 1) return unresolvedParticipant(input);

  const participant = Array.from(uniqueParticipants.values())[0];
  return Object.freeze({
    side: "user",
    participantId: `${participant.kind}:${participant.id}`,
    status: "resolved",
    revision: PARTICIPANT_RESOLUTION_REVISION,
  });
}
