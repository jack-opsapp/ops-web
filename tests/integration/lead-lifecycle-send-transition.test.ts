import { describe, expect, it, vi } from "vitest";

import {
  EmailSendIntentService,
  buildEmailSendRequestFingerprint,
  type PrepareEmailSendIntentInput,
} from "@/lib/api/services/email-send-intent-service";

const BASE: PrepareEmailSendIntentInput = {
  idempotencyKey: "attempt-1",
  companyId: "company-1",
  actorUserId: "actor-1",
  initiatedBy: "operator",
  connectionId: "connection-1",
  opportunityId: "opp-1",
  sourceEmailThreadId: "email-thread-1",
  replyProviderThreadId: "provider-thread-1",
  inReplyTo: "provider-message-1",
  senderSwitched: false,
  toEmails: ["client@example.com"],
  ccEmails: [],
  subject: "Follow-up",
  authoredBody: "Checking in.",
  renderedBody: "Checking in.\n\n-- \nJason",
  contentType: "text",
  draftHistoryId: "ai-draft-1",
  followUpDraftId: "follow-up-draft-1",
  learningAuthority: "operator_approved",
  signatureId: "signature-1",
  signatureContentHash: "a".repeat(64),
  renderedBodyHash: "b".repeat(64),
  pendingAutoSendId: null,
};

function row() {
  return {
    id: "intent-1",
    company_id: "company-1",
    idempotency_key: "attempt-1",
    request_fingerprint: buildEmailSendRequestFingerprint(BASE),
    actor_user_id: "actor-1",
    initiated_by: "operator",
    connection_id: "connection-1",
    opportunity_id: "opp-1",
    assignment_version: 3,
    assignment_event_id: "assignment-event-3",
    actor_name_snapshot: "Jason Zavarella",
    actor_email_snapshot: "jason@example.com",
    client_from_address_snapshot: "info@example.com",
    source_email_thread_id: "email-thread-1",
    reply_provider_thread_id: "provider-thread-1",
    in_reply_to: "provider-message-1",
    sender_switched: false,
    to_emails: ["client@example.com"],
    cc_emails: [],
    subject: "Follow-up",
    authored_body: "Checking in.",
    rendered_body: "Checking in.\n\n-- \nJason",
    content_type: "text",
    draft_history_id: "ai-draft-1",
    follow_up_draft_id: "follow-up-draft-1",
    learning_authority: "operator_approved",
    signature_id: "signature-1",
    signature_content_hash: "a".repeat(64),
    rendered_body_hash: "b".repeat(64),
    pending_auto_send_id: null,
    profile_type_snapshot: "client_followup",
    status: "prepared",
    provider_message_id: null,
    accepted_provider_thread_id: null,
    provider_accepted_at: null,
    reconciliation_attempts: 0,
    reconciliation_lease_token: null,
    reconciliation_lease_expires_at: null,
    reconciled_activity_id: null,
    reconciled_at: null,
    last_error: null,
    created_at: "2026-07-15T18:00:00.000Z",
    updated_at: "2026-07-15T18:00:00.000Z",
  };
}

describe("lifecycle draft send provenance", () => {
  it("binds explicit AI and follow-up draft identities into idempotency", () => {
    const fingerprint = buildEmailSendRequestFingerprint(BASE);

    expect(
      buildEmailSendRequestFingerprint({ ...BASE, draftHistoryId: null })
    ).not.toBe(fingerprint);
    expect(
      buildEmailSendRequestFingerprint({ ...BASE, followUpDraftId: null })
    ).not.toBe(fingerprint);
    expect(
      buildEmailSendRequestFingerprint({
        ...BASE,
        sourceEmailThreadId: "same-thread-but-no-draft-guess",
        draftHistoryId: null,
        followUpDraftId: null,
      })
    ).not.toBe(fingerprint);
  });

  it("passes only explicit draft identities to the guarded prepare RPC", async () => {
    const db = { rpc: vi.fn().mockResolvedValue({ data: row(), error: null }) };
    const service = new EmailSendIntentService(db as never);

    const prepared = await service.prepare(BASE);

    expect(prepared).toMatchObject({
      draftHistoryId: "ai-draft-1",
      followUpDraftId: "follow-up-draft-1",
      profileTypeSnapshot: "client_followup",
    });
    expect(db.rpc).toHaveBeenCalledWith(
      "prepare_email_send_intent_guarded",
      expect.objectContaining({
        p_draft_history_id: "ai-draft-1",
        p_follow_up_draft_id: "follow-up-draft-1",
      })
    );
  });

  it("does not infer a lifecycle draft when the caller supplies none", async () => {
    const noDraft = {
      ...BASE,
      draftHistoryId: null,
      followUpDraftId: null,
      learningAuthority: "operator_authored" as const,
    };
    const noDraftRow = {
      ...row(),
      request_fingerprint: buildEmailSendRequestFingerprint(noDraft),
      draft_history_id: null,
      follow_up_draft_id: null,
      learning_authority: "operator_authored",
      profile_type_snapshot: "general",
    };
    const db = {
      rpc: vi.fn().mockResolvedValue({ data: noDraftRow, error: null }),
    };

    const prepared = await new EmailSendIntentService(db as never).prepare(
      noDraft
    );

    expect(prepared.draftHistoryId).toBeNull();
    expect(prepared.followUpDraftId).toBeNull();
    expect(prepared.profileTypeSnapshot).toBe("general");
  });
});
