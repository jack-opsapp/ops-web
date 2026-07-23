import { normalizeReplySubject } from "@/lib/email/email-subject-policy";
import type {
  DraftSource,
  FollowUpDraftOrigin,
} from "@/lib/types/email-thread";

interface DraftSendInboundIdentity {
  from: string | null;
  providerMessageId: string | null;
}

export interface ResolveInboxDraftSendBindingInput {
  selectedInboxThreadId: string;
  selectedOpportunityId: string | null;
  selectedConnectionId: string;
  selectedSubject: string | null;
  lastInbound: DraftSendInboundIdentity | null;
  draft: InboxDraftSendCandidate | null;
}

export interface InboxDraftSendCandidate {
  id: string;
  source: DraftSource;
  subject?: string | null;
  threadId?: string | null;
  inboxThreadId?: string | null;
  connectionId?: string | null;
  opportunityId?: string | null;
  origin?: FollowUpDraftOrigin | null;
  recipientEmail?: string | null;
  sourceEventId?: string | null;
  sourceProviderMessageId?: string | null;
}

export type InboxDraftSendBinding =
  | {
      ok: true;
      connectionId: string;
      opportunityId: string | null;
      sourceEmailThreadId: string | null;
      recipient: string;
      inReplyTo: string | null;
      subject: string;
    }
  | {
      ok: false;
      reason: "recipient_unavailable" | "system_handoff_provenance_invalid";
    };

function normalized(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Resolves the immutable transport facts for an inbox send. System-handoff
 * drafts never inherit the currently open thread's sender or provider reply
 * identity: their persisted source event is the only authority.
 */
export function resolveInboxDraftSendBinding(
  input: ResolveInboxDraftSendBindingInput
): InboxDraftSendBinding {
  const draft = input.draft;
  if (draft?.source === "lifecycle" && draft.origin === "system_handoff") {
    const recipient = normalized(draft.recipientEmail)?.toLowerCase() ?? null;
    const connectionId = normalized(draft.connectionId);
    const opportunityId = normalized(draft.opportunityId);
    const sourceEventId = normalized(draft.sourceEventId);
    const sourceProviderMessageId = normalized(draft.sourceProviderMessageId);
    const subject = normalized(draft.subject);

    if (
      !recipient ||
      !connectionId ||
      !opportunityId ||
      !sourceEventId ||
      !sourceProviderMessageId ||
      !subject
    ) {
      return { ok: false, reason: "system_handoff_provenance_invalid" };
    }

    if (draft.threadId === null) {
      return {
        ok: true,
        connectionId,
        opportunityId,
        sourceEmailThreadId: null,
        recipient,
        inReplyTo: null,
        subject,
      };
    }

    const sourceEmailThreadId = normalized(draft.inboxThreadId);
    if (!sourceEmailThreadId) {
      return { ok: false, reason: "system_handoff_provenance_invalid" };
    }
    return {
      ok: true,
      connectionId,
      opportunityId,
      sourceEmailThreadId,
      recipient,
      inReplyTo: sourceProviderMessageId,
      subject,
    };
  }

  const recipient = normalized(input.lastInbound?.from);
  if (!recipient) return { ok: false, reason: "recipient_unavailable" };

  const draftSubject = normalized(draft?.subject);
  const selectedSubject = normalized(input.selectedSubject);
  return {
    ok: true,
    connectionId: input.selectedConnectionId,
    opportunityId: input.selectedOpportunityId,
    sourceEmailThreadId: input.selectedInboxThreadId,
    recipient,
    inReplyTo: normalized(input.lastInbound?.providerMessageId),
    subject: normalizeReplySubject(
      draftSubject || selectedSubject || "(no subject)"
    ),
  };
}
