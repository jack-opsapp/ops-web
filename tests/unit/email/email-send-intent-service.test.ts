import { describe, expect, it, vi } from "vitest";

import {
  EmailSendIntentService,
  buildEmailSendRequestFingerprint,
} from "@/lib/api/services/email-send-intent-service";

const BASE_INPUT = {
  idempotencyKey: "7ae57144-cf56-493e-bc27-6b91bcf3a0cb",
  companyId: "f739fdc2-16b0-434d-9f31-3c58ee795865",
  actorUserId: "89516663-bb16-4743-aa76-ec68a19d0b3b",
  initiatedBy: "operator" as const,
  connectionId: "22538067-7acc-4799-b912-5edb74e0d3e8",
  opportunityId: "b00f706f-249d-4cd4-8680-076c310b87ad",
  sourceEmailThreadId: "5d87ee76-88c3-4682-963b-1f443c60f308",
  replyProviderThreadId: "provider-thread-1",
  inReplyTo: "provider-message-1",
  senderSwitched: false,
  toEmails: ["Lead@Example.com"],
  ccEmails: ["Office@Example.com"],
  subject: "Deck quote follow-up",
  authoredBody: "Checking in on the quote.",
  renderedBody: "Checking in on the quote.\n\n-- \nJason Zavarella",
  contentType: "text" as const,
  draftHistoryId: "4d16ed89-5bf5-438c-9388-62c345ab6d55",
  followUpDraftId: null,
  learningAuthority: "operator_approved" as const,
  signatureId: "d775371c-b0ed-4f1a-ac3f-c3dd962ad09c",
  signatureContentHash:
    "f5b4801a24f71d74120d10e246048b983534031fb38f9c0c7663f1c6de9a6aa7",
  renderedBodyHash:
    "947f187506f7629c81c81879a1cb1124844fc4583a0bb427d6b8160c7c4cab80",
  pendingAutoSendId: null,
  pendingAutoSendLeaseToken: null,
};

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "0ab9bcef-16e5-4451-8e4e-9dd4dbf72115",
    company_id: BASE_INPUT.companyId,
    idempotency_key: BASE_INPUT.idempotencyKey,
    request_fingerprint: buildEmailSendRequestFingerprint(BASE_INPUT),
    actor_user_id: BASE_INPUT.actorUserId,
    initiated_by: BASE_INPUT.initiatedBy,
    connection_id: BASE_INPUT.connectionId,
    opportunity_id: BASE_INPUT.opportunityId,
    assignment_version: 7,
    assignment_event_id: "c23dc605-dad6-48f7-8a30-837779db41bb",
    source_email_thread_id: BASE_INPUT.sourceEmailThreadId,
    reply_provider_thread_id: BASE_INPUT.replyProviderThreadId,
    in_reply_to: BASE_INPUT.inReplyTo,
    sender_switched: false,
    to_emails: ["lead@example.com"],
    cc_emails: ["office@example.com"],
    subject: BASE_INPUT.subject,
    authored_body: BASE_INPUT.authoredBody,
    rendered_body: BASE_INPUT.renderedBody,
    content_type: BASE_INPUT.contentType,
    draft_history_id: BASE_INPUT.draftHistoryId,
    follow_up_draft_id: null,
    follow_up_source_event_id: null,
    follow_up_recipient_email: null,
    learning_authority: BASE_INPUT.learningAuthority,
    actor_name_snapshot: "Jason Zavarella",
    actor_email_snapshot: "jason@ops-login.example",
    client_from_address_snapshot: "info@canprodeckandrail.com",
    signature_id: BASE_INPUT.signatureId,
    signature_content_hash: BASE_INPUT.signatureContentHash,
    rendered_body_hash: BASE_INPUT.renderedBodyHash,
    pending_auto_send_id: null,
    pending_auto_send_lease_token: null,
    profile_type_snapshot: "sales_lead",
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
    ...overrides,
  };
}

function dbMock() {
  return { rpc: vi.fn() };
}

describe("email send intent fingerprint", () => {
  it("is deterministic and canonicalizes recipient addresses", () => {
    const first = buildEmailSendRequestFingerprint(BASE_INPUT);
    const second = buildEmailSendRequestFingerprint({
      ...BASE_INPUT,
      toEmails: [" lead@example.com "],
      ccEmails: ["OFFICE@example.com"],
    });

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(second).toBe(first);
  });

  it("binds the exact mailbox, lead, thread mode, recipients, subject, and body", () => {
    const original = buildEmailSendRequestFingerprint(BASE_INPUT);
    for (const changed of [
      { connectionId: "3d6639c4-d706-4d91-95dd-553c69e3440e" },
      { opportunityId: "d0059b79-8a7b-42bc-b4c5-85be6221f97d" },
      { senderSwitched: true, replyProviderThreadId: null, inReplyTo: null },
      { toEmails: ["other@example.com"] },
      { subject: "Different subject" },
      { authoredBody: "Different body" },
    ]) {
      expect(
        buildEmailSendRequestFingerprint({ ...BASE_INPUT, ...changed })
      ).not.toBe(original);
    }
  });

  it("binds a Phase C request to the exact claimed queue lease", () => {
    const original = buildEmailSendRequestFingerprint({
      ...BASE_INPUT,
      initiatedBy: "phase_c_auto_send",
      pendingAutoSendId: "930b42c2-59da-446f-b59f-bfe274c48bad",
      pendingAutoSendLeaseToken: "5cd9be25-bb6c-4b60-a159-c683c79a0b04",
    });
    const reclaimed = buildEmailSendRequestFingerprint({
      ...BASE_INPUT,
      initiatedBy: "phase_c_auto_send",
      pendingAutoSendId: "930b42c2-59da-446f-b59f-bfe274c48bad",
      pendingAutoSendLeaseToken: "8eb2ed31-30af-4aef-9d33-ec0a4e418874",
    });

    expect(reclaimed).not.toBe(original);
  });
});

describe("EmailSendIntentService", () => {
  it("prepares one durable intent with only canonical server-derived identities", async () => {
    const db = dbMock();
    db.rpc.mockResolvedValue({ data: row(), error: null });
    const service = new EmailSendIntentService(db as never);

    const intent = await service.prepare(BASE_INPUT);

    expect(db.rpc).toHaveBeenCalledWith("prepare_email_send_intent_guarded", {
      p_idempotency_key: BASE_INPUT.idempotencyKey,
      p_request_fingerprint: buildEmailSendRequestFingerprint(BASE_INPUT),
      p_company_id: BASE_INPUT.companyId,
      p_actor_user_id: BASE_INPUT.actorUserId,
      p_initiated_by: "operator",
      p_connection_id: BASE_INPUT.connectionId,
      p_opportunity_id: BASE_INPUT.opportunityId,
      p_source_email_thread_id: BASE_INPUT.sourceEmailThreadId,
      p_reply_provider_thread_id: BASE_INPUT.replyProviderThreadId,
      p_in_reply_to: BASE_INPUT.inReplyTo,
      p_sender_switched: false,
      p_to_emails: ["lead@example.com"],
      p_cc_emails: ["office@example.com"],
      p_subject: BASE_INPUT.subject,
      p_authored_body: BASE_INPUT.authoredBody,
      p_rendered_body: BASE_INPUT.renderedBody,
      p_content_type: "text",
      p_draft_history_id: BASE_INPUT.draftHistoryId,
      p_follow_up_draft_id: null,
      p_learning_authority: "operator_approved",
      p_signature_id: BASE_INPUT.signatureId,
      p_signature_content_hash: BASE_INPUT.signatureContentHash,
      p_rendered_body_hash: BASE_INPUT.renderedBodyHash,
      p_pending_auto_send_id: null,
      p_pending_auto_send_lease_token: null,
    });
    expect(intent).toMatchObject({
      id: "0ab9bcef-16e5-4451-8e4e-9dd4dbf72115",
      actorUserId: BASE_INPUT.actorUserId,
      connectionId: BASE_INPUT.connectionId,
      opportunityId: BASE_INPUT.opportunityId,
      assignmentVersion: 7,
      assignmentEventId: "c23dc605-dad6-48f7-8a30-837779db41bb",
      actorNameSnapshot: "Jason Zavarella",
      clientFromAddressSnapshot: "info@canprodeckandrail.com",
      signatureId: BASE_INPUT.signatureId,
      signatureContentHash: BASE_INPUT.signatureContentHash,
      renderedBodyHash: BASE_INPUT.renderedBodyHash,
      renderedBody: BASE_INPUT.renderedBody,
      profileTypeSnapshot: "sales_lead",
      status: "prepared",
    });
  });

  it("fails closed when a reused idempotency key has a different request fingerprint", async () => {
    const db = dbMock();
    db.rpc.mockResolvedValue({
      data: null,
      error: { message: "EMAIL_SEND_IDEMPOTENCY_CONFLICT" },
    });
    const service = new EmailSendIntentService(db as never);

    await expect(service.prepare(BASE_INPUT)).rejects.toThrow(
      "EMAIL_SEND_IDEMPOTENCY_CONFLICT"
    );
  });

  it("claims provider delivery once and does not interpret an unclaimed row as permission to resend", async () => {
    const db = dbMock();
    db.rpc.mockResolvedValueOnce({
      data: row({ status: "sending" }),
      error: null,
    });
    const service = new EmailSendIntentService(db as never);

    const claimed = await service.claimProviderDelivery(
      "0ab9bcef-16e5-4451-8e4e-9dd4dbf72115"
    );

    expect(db.rpc).toHaveBeenCalledWith("claim_email_send_provider_delivery", {
      p_intent_id: "0ab9bcef-16e5-4451-8e4e-9dd4dbf72115",
    });
    expect(claimed?.status).toBe("sending");
    expect(claimed?.assignmentVersion).toBe(7);

    db.rpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(
      service.claimProviderDelivery("0ab9bcef-16e5-4451-8e4e-9dd4dbf72115")
    ).resolves.toBeNull();
  });

  it("persists provider acceptance before any reconciliation claim", async () => {
    const db = dbMock();
    db.rpc.mockResolvedValue({
      data: row({
        status: "provider_accepted",
        provider_message_id: "provider-message-sent",
        accepted_provider_thread_id: "provider-thread-sent",
        provider_accepted_at: "2026-07-15T18:01:00.000Z",
      }),
      error: null,
    });
    const service = new EmailSendIntentService(db as never);

    const accepted = await service.markProviderAccepted({
      intentId: "0ab9bcef-16e5-4451-8e4e-9dd4dbf72115",
      providerMessageId: "provider-message-sent",
      providerThreadId: "provider-thread-sent",
      acceptedAt: "2026-07-15T18:01:00.000Z",
    });

    expect(db.rpc).toHaveBeenCalledWith("mark_email_send_provider_accepted", {
      p_intent_id: "0ab9bcef-16e5-4451-8e4e-9dd4dbf72115",
      p_provider_message_id: "provider-message-sent",
      p_provider_thread_id: "provider-thread-sent",
      p_provider_accepted_at: "2026-07-15T18:01:00.000Z",
    });
    expect(accepted.status).toBe("provider_accepted");
  });

  it("retries provider-acceptance persistence exactly once without a second provider claim", async () => {
    const db = dbMock();
    db.rpc
      .mockResolvedValueOnce({
        data: null,
        error: { message: "transient persistence failure" },
      })
      .mockResolvedValueOnce({
        data: row({
          status: "provider_accepted",
          provider_message_id: "provider-message-sent",
          accepted_provider_thread_id: "provider-thread-sent",
          provider_accepted_at: "2026-07-15T18:01:00.000Z",
        }),
        error: null,
      });
    const service = new EmailSendIntentService(db as never);

    const accepted = await service.persistProviderAcceptance({
      intentId: "0ab9bcef-16e5-4451-8e4e-9dd4dbf72115",
      providerMessageId: "provider-message-sent",
      providerThreadId: "provider-thread-sent",
      acceptedAt: "2026-07-15T18:01:00.000Z",
    });

    expect(accepted.status).toBe("provider_accepted");
    expect(db.rpc).toHaveBeenCalledTimes(2);
    expect(db.rpc).toHaveBeenNthCalledWith(
      1,
      "mark_email_send_provider_accepted",
      expect.any(Object)
    );
    expect(db.rpc).toHaveBeenNthCalledWith(
      2,
      "mark_email_send_provider_accepted",
      expect.any(Object)
    );
  });

  it("leases, completes, and retries reconciliation by lease token", async () => {
    const db = dbMock();
    const leaseToken = "0771d84d-69f2-4c52-bc24-b8f3d8d24812";
    db.rpc
      .mockResolvedValueOnce({
        data: row({
          status: "reconciling",
          reconciliation_attempts: 1,
          reconciliation_lease_token: leaseToken,
        }),
        error: null,
      })
      .mockResolvedValueOnce({
        data: row({
          status: "reconciled",
          reconciliation_attempts: 1,
          reconciled_activity_id: "93140450-0598-41ee-ae70-c2f9286f3537",
        }),
        error: null,
      })
      .mockResolvedValueOnce({
        data: row({
          status: "reconciliation_failed",
          reconciliation_attempts: 1,
          last_error: "activity insert failed",
        }),
        error: null,
      });
    const service = new EmailSendIntentService(db as never);

    const leased = await service.claimReconciliation(
      "0ab9bcef-16e5-4451-8e4e-9dd4dbf72115"
    );
    expect(leased?.reconciliationLeaseToken).toBe(leaseToken);

    const completed = await service.completeReconciliation({
      intentId: leased!.id,
      leaseToken,
      activityId: "93140450-0598-41ee-ae70-c2f9286f3537",
    });
    expect(completed.status).toBe("reconciled");

    const failed = await service.failReconciliation({
      intentId: leased!.id,
      leaseToken,
      error: "activity insert failed",
    });
    expect(failed.status).toBe("reconciliation_failed");
    expect(db.rpc).toHaveBeenNthCalledWith(
      2,
      "complete_email_send_reconciliation",
      {
        p_intent_id: leased!.id,
        p_lease_token: leaseToken,
        p_activity_id: "93140450-0598-41ee-ae70-c2f9286f3537",
      }
    );
    expect(db.rpc).toHaveBeenNthCalledWith(
      3,
      "fail_email_send_reconciliation",
      {
        p_intent_id: leased!.id,
        p_lease_token: leaseToken,
        p_error: "activity insert failed",
      }
    );
  });

  it("claims the next due reconciliation without selecting an intent in application code", async () => {
    const db = dbMock();
    const leaseToken = "0771d84d-69f2-4c52-bc24-b8f3d8d24812";
    db.rpc.mockResolvedValueOnce({
      data: row({
        status: "reconciling",
        reconciliation_attempts: 2,
        reconciliation_lease_token: leaseToken,
      }),
      error: null,
    });
    const service = new EmailSendIntentService(db as never);

    const leased = await service.claimNextReconciliation({
      failedBefore: "2026-07-15T18:05:00.000Z",
      leaseSeconds: 240,
    });

    expect(db.rpc).toHaveBeenCalledWith(
      "claim_next_email_send_reconciliation",
      {
        p_failed_before: "2026-07-15T18:05:00.000Z",
        p_lease_seconds: 240,
      }
    );
    expect(leased?.reconciliationLeaseToken).toBe(leaseToken);
  });

  it("treats an all-null reconciliation composite as an empty queue", async () => {
    const db = dbMock();
    const allNullComposite = Object.fromEntries(
      Object.keys(row()).map((key) => [key, null])
    );
    db.rpc.mockResolvedValueOnce({
      data: allNullComposite,
      error: null,
    });
    const service = new EmailSendIntentService(db as never);

    await expect(
      service.claimNextReconciliation({
        failedBefore: "2026-07-15T18:05:00.000Z",
        leaseSeconds: 240,
      })
    ).resolves.toBeNull();
  });
});
