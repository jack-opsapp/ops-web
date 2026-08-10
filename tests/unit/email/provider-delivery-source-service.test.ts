import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  captureAcceptedOutboundProviderDeliverySource,
  captureProviderDeliveredEmailSource,
  ProviderDeliverySourceError,
  readProviderDeliverySource,
} from "@/lib/api/services/provider-delivery-source-service";
import { resolveParticipantSide } from "@/lib/agent-control-plane/memory/resolve-participant-side";
import type { NormalizedEmail } from "@/lib/api/services/email-provider";
import type { EmailConnection } from "@/lib/types/email-connection";
import { isDatabasePressureError } from "@/lib/api/services/cron-workload-control-service";

const COMPANY_ID = "00000000-0000-4000-8000-000000000001";
const CONNECTION_ID = "00000000-0000-4000-8000-000000000002";
const SOURCE_ID = "00000000-0000-4000-8000-000000000003";
const ACTIVITY_ID = "00000000-0000-4000-8000-000000000004";
const INTENT_ID = "00000000-0000-4000-8000-000000000005";

function connection(
  provider: "gmail" | "microsoft365" = "gmail"
): EmailConnection {
  const now = new Date();
  return {
    id: CONNECTION_ID,
    companyId: COMPANY_ID,
    provider,
    type: "company",
    userId: null,
    email: "operator@example.com",
    accessToken: "token",
    refreshToken: "refresh",
    expiresAt: new Date(now.getTime() + 60 * 60_000),
    historyId: null,
    syncEnabled: true,
    lastSyncedAt: null,
    syncIntervalMinutes: 5,
    syncFilters: {},
    webhookSubscriptionId: null,
    webhookExpiresAt: null,
    opsLabelId: null,
    aiReviewEnabled: false,
    aiMemoryEnabled: false,
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
}

function email(): NormalizedEmail {
  const deliveredAt = new Date("2026-08-07T22:00:00.000Z");
  return {
    id: "provider-message-1",
    threadId: "provider-thread-1",
    from: "Jane Doe <Jane.Doe@example.com>",
    fromName: "Jane Doe",
    to: ["OPS <Operator@example.com>"],
    cc: ["Estimator <Estimate@example.com>"],
    subject: "Exact subject",
    snippet: "Exact body",
    bodyText: "Exact body",
    date: deliveredAt,
    labelIds: ["INBOX"],
    isRead: false,
    hasAttachments: true,
    sizeEstimate: 512,
    providerDeliverySource: {
      mediaType: "text/plain",
      value: "Exact body\r\n",
      sourceKind: "gmail_mime_part",
      selectionRevision: "gmail.mime.text-plain-first.charset-decoded.v2",
      providerPartId: "0.1",
      providerBodyAttachmentId: null,
      contentCharset: "utf-8",
      senderIdentity: "Jane Doe <Jane.Doe@example.com>",
      recipientIdentities: ["OPS <Operator@example.com>"],
      ccRecipientIdentities: ["Estimator <Estimate@example.com>"],
      subject: "Exact subject",
      deliveredAt,
    },
  };
}

function supabaseRpc() {
  const rpc = vi.fn(async (functionName: string) =>
    functionName === "preflight_agent_provider_delivery_source_as_system"
      ? { data: [], error: null }
      : { data: [captureReceipt()], error: null }
  );
  return { supabase: { rpc } as never, rpc };
}

function captureReceipt(inserted = true) {
  return {
    source_id: SOURCE_ID,
    source_sha256: `sha256:${"a".repeat(64)}`,
    inserted,
  };
}

function preflightReceipt(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    source_id: SOURCE_ID,
    company_id: COMPANY_ID,
    connection_id: CONNECTION_ID,
    provider: "gmail",
    provider_message_id: "provider-message-1",
    provider_thread_id: "provider-thread-1",
    direction: "inbound",
    source_sha256: `sha256:${"a".repeat(64)}`,
    ...overrides,
  };
}

function readReceipt() {
  return {
    source_id: SOURCE_ID,
    company_id: COMPANY_ID,
    connection_id: CONNECTION_ID,
    provider: "gmail",
    provider_message_id: "provider-message-1",
    provider_thread_id: "provider-thread-1",
    direction: "inbound",
    delivered_at: "2026-08-07T22:00:00.000Z",
    subject: "Exact subject",
    sender_identity: "jane.doe@example.com",
    recipient_identities: ["operator@example.com"],
    cc_recipient_identities: ["estimate@example.com"],
    content_media_type: "text/plain",
    content_value: "Exact body\r\n",
    content_charset: "utf-8",
    content_source_kind: "gmail_mime_part",
    content_selection_revision:
      "gmail.mime.text-plain-first.charset-decoded.v2",
    provider_part_id: "0.1",
    provider_body_attachment_id: null,
    attachment_enumeration_complete: true,
    attachment_evidence_ids: [],
    source_sha256: `sha256:${"a".repeat(64)}`,
    captured_at: "2026-08-07T22:00:01.000Z",
  };
}

describe("provider delivery source capture", () => {
  it("preserves database pressure evidence from the service-only preflight RPC", async () => {
    const error = {
      code: "",
      message: "Web server is down",
      details: "",
      hint: "",
    };
    const rpc = vi.fn(async () => ({
      data: null,
      error,
      status: 521,
      statusText: "Web Server Is Down",
    }));

    const failure = await captureProviderDeliveredEmailSource({
      supabase: { rpc } as never,
      connection: connection(),
      provider: {
        providerType: "gmail",
        getAttachmentsFromMessage: vi.fn(async () => []),
      },
      email: email(),
      direction: "inbound",
    }).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      name: "CronDatabaseOperationError",
      cause: {
        error,
        status: 521,
        statusText: "Web Server Is Down",
      },
    });
    expect(isDatabasePressureError(failure)).toBe(true);
  });

  it.each([
    ["a bare object", captureReceipt()],
    ["more than one row", [captureReceipt(), captureReceipt(false)]],
  ])("rejects a capture response containing %s", async (_label, data) => {
    const rpc = vi.fn(async (functionName: string) =>
      functionName === "preflight_agent_provider_delivery_source_as_system"
        ? { data: [], error: null }
        : { data, error: null }
    );

    await expect(
      captureProviderDeliveredEmailSource({
        supabase: { rpc } as never,
        connection: connection(),
        provider: {
          providerType: "gmail",
          getAttachmentsFromMessage: vi.fn(async () => []),
        },
        email: email(),
        direction: "inbound",
      })
    ).rejects.toThrow("PROVIDER_DELIVERY_SOURCE_CAPTURE_RECEIPT_INVALID");
  });

  it("returns the existing service-only source receipt before attachment enumeration on replay", async () => {
    const rpc = vi.fn(async (functionName: string) => {
      if (
        functionName === "preflight_agent_provider_delivery_source_as_system"
      ) {
        return { data: [preflightReceipt()], error: null };
      }
      throw new Error(`unexpected RPC: ${functionName}`);
    });
    const getAttachmentsFromMessage = vi.fn(async () => []);

    await expect(
      captureProviderDeliveredEmailSource({
        supabase: { rpc } as never,
        connection: connection(),
        provider: {
          providerType: "gmail",
          getAttachmentsFromMessage,
        },
        email: email(),
        direction: "inbound",
      })
    ).resolves.toEqual({
      sourceId: SOURCE_ID,
      sourceSha256: `sha256:${"a".repeat(64)}`,
      inserted: false,
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      "preflight_agent_provider_delivery_source_as_system",
      {
        p_company_id: COMPANY_ID,
        p_connection_id: CONNECTION_ID,
        p_provider: "gmail",
        p_provider_message_id: "provider-message-1",
        p_provider_thread_id: "provider-thread-1",
        p_direction: "inbound",
      }
    );
    expect(getAttachmentsFromMessage).not.toHaveBeenCalled();
  });

  it.each([
    ["provider", { provider: "microsoft365" }],
    ["thread", { provider_thread_id: "other-thread" }],
    ["direction", { direction: "outbound" }],
  ])(
    "fails closed when the preflight %s conflicts",
    async (_label, conflict) => {
      const rpc = vi.fn(async (functionName: string) => {
        if (
          functionName === "preflight_agent_provider_delivery_source_as_system"
        ) {
          return { data: [preflightReceipt(conflict)], error: null };
        }
        throw new Error(`unexpected RPC: ${functionName}`);
      });
      const getAttachmentsFromMessage = vi.fn(async () => []);

      await expect(
        captureProviderDeliveredEmailSource({
          supabase: { rpc } as never,
          connection: connection(),
          provider: {
            providerType: "gmail",
            getAttachmentsFromMessage,
          },
          email: email(),
          direction: "inbound",
        })
      ).rejects.toThrow("PROVIDER_DELIVERY_SOURCE_PREFLIGHT_CONFLICT");
      expect(getAttachmentsFromMessage).not.toHaveBeenCalled();
    }
  );

  it("enumerates attachments completely and sends a canonical immutable envelope", async () => {
    const { supabase, rpc } = supabaseRpc();
    const provider = {
      providerType: "gmail" as const,
      getAttachmentsFromMessage: vi.fn(async () => [
        {
          messageId: "provider-message-1",
          attachmentId: "file-z",
          filename: "z.pdf",
          mimeType: "application/pdf",
          size: 100,
          fromEmail: "jane.doe@example.com",
          date: new Date("2026-08-07T22:00:00.000Z"),
          providerKind: "file" as const,
          providerPartId: "2",
          contentId: null,
          isInline: false,
          downloadSupported: true,
          sourceUrl: null,
        },
        {
          messageId: "provider-message-1",
          attachmentId: "file-a",
          filename: "a.jpg",
          mimeType: "image/jpeg",
          size: 50,
          fromEmail: "jane.doe@example.com",
          date: new Date("2026-08-07T22:00:00.000Z"),
          providerKind: "inline" as const,
          providerPartId: "1",
          contentId: "photo-a",
          isInline: true,
          downloadSupported: true,
          sourceUrl: null,
        },
      ]),
    };

    const receipt = await captureProviderDeliveredEmailSource({
      supabase,
      connection: connection(),
      provider,
      email: email(),
      direction: "inbound",
    });

    expect(receipt.sourceId).toBe(SOURCE_ID);
    expect(provider.getAttachmentsFromMessage).toHaveBeenCalledWith(
      "provider-message-1",
      {
        fromEmail: "Jane Doe <Jane.Doe@example.com>",
        date: new Date("2026-08-07T22:00:00.000Z"),
      }
    );
    expect(rpc).toHaveBeenCalledWith(
      "capture_agent_provider_delivery_source_as_system",
      expect.objectContaining({
        p_company_id: COMPANY_ID,
        p_connection_id: CONNECTION_ID,
        p_provider: "gmail",
        p_provider_message_id: "provider-message-1",
        p_direction: "inbound",
        p_subject: "Exact subject",
        p_sender_identity: "jane.doe@example.com",
        p_recipient_identities: ["operator@example.com"],
        p_cc_recipient_identities: ["estimate@example.com"],
        p_content_media_type: "text/plain",
        p_content_value: "Exact body\r\n",
        p_content_source_kind: "gmail_mime_part",
        p_content_selection_revision:
          "gmail.mime.text-plain-first.charset-decoded.v2",
        p_provider_part_id: "0.1",
        p_provider_body_attachment_id: null,
        p_attachment_enumeration_complete: true,
        p_attachment_descriptors: [
          {
            attachment_id: "file-a",
            filename: "a.jpg",
            mime_type: "image/jpeg",
            size_bytes: 50,
            provider_kind: "inline",
            provider_part_id: "1",
            content_id: "photo-a",
            is_inline: true,
            source_url: null,
            occurred_at: "2026-08-07T22:00:00.000Z",
            from_email: "jane.doe@example.com",
          },
          {
            attachment_id: "file-z",
            filename: "z.pdf",
            mime_type: "application/pdf",
            size_bytes: 100,
            provider_kind: "file",
            provider_part_id: "2",
            content_id: null,
            is_inline: false,
            source_url: null,
            occurred_at: "2026-08-07T22:00:00.000Z",
            from_email: "jane.doe@example.com",
          },
        ],
      })
    );
  });

  it("fails closed instead of persisting a truncated attachment enumeration", async () => {
    const { supabase, rpc } = supabaseRpc();

    await expect(
      captureProviderDeliveredEmailSource({
        supabase,
        connection: connection(),
        provider: {
          providerType: "gmail",
          getAttachmentsFromMessage: vi.fn(async () => [
            {
              messageId: "provider-message-1",
              attachmentId: "ops-enumeration-budget",
            } as never,
          ]),
        },
        email: email(),
        direction: "inbound",
      })
    ).rejects.toBeInstanceOf(ProviderDeliverySourceError);
    expect(rpc).not.toHaveBeenCalledWith(
      "capture_agent_provider_delivery_source_as_system",
      expect.anything()
    );
  });

  it("fails closed when recipient or attachment counts exceed the durable-turn contract", async () => {
    const { supabase, rpc } = supabaseRpc();
    const overBoundEmail = email();
    overBoundEmail.providerDeliverySource = {
      ...overBoundEmail.providerDeliverySource!,
      recipientIdentities: Array.from(
        { length: 101 },
        (_, index) => `recipient-${index}@example.com`
      ),
    };
    await expect(
      captureProviderDeliveredEmailSource({
        supabase,
        connection: connection(),
        provider: {
          providerType: "gmail",
          getAttachmentsFromMessage: vi.fn(async () => []),
        },
        email: overBoundEmail,
        direction: "inbound",
      })
    ).rejects.toBeInstanceOf(ProviderDeliverySourceError);

    const attachment = {
      messageId: "provider-message-1",
      attachmentId: "",
      filename: "file.pdf",
      mimeType: "application/pdf",
      size: 1,
      fromEmail: "jane.doe@example.com",
      date: new Date("2026-08-07T22:00:00.000Z"),
      providerKind: "file" as const,
      providerPartId: null,
      contentId: null,
      isInline: false,
      downloadSupported: true,
      sourceUrl: null,
    };
    await expect(
      captureProviderDeliveredEmailSource({
        supabase,
        connection: connection(),
        provider: {
          providerType: "gmail",
          getAttachmentsFromMessage: vi.fn(async () =>
            Array.from({ length: 101 }, (_, index) => ({
              ...attachment,
              attachmentId: `attachment-${index}`,
            }))
          ),
        },
        email: email(),
        direction: "inbound",
      })
    ).rejects.toBeInstanceOf(ProviderDeliverySourceError);
    expect(rpc).not.toHaveBeenCalledWith(
      "capture_agent_provider_delivery_source_as_system",
      expect.anything()
    );
  });

  it("rejects hidden Unicode controls in provider email identities", async () => {
    const { supabase, rpc } = supabaseRpc();
    const unsafeEmail = email();
    unsafeEmail.providerDeliverySource = {
      ...unsafeEmail.providerDeliverySource!,
      senderIdentity: "jane\u202e@example.com",
    };

    await expect(
      captureProviderDeliveredEmailSource({
        supabase,
        connection: connection(),
        provider: {
          providerType: "gmail",
          getAttachmentsFromMessage: vi.fn(async () => []),
        },
        email: unsafeEmail,
        direction: "inbound",
      })
    ).rejects.toBeInstanceOf(ProviderDeliverySourceError);
    expect(rpc).not.toHaveBeenCalledWith(
      "capture_agent_provider_delivery_source_as_system",
      expect.anything()
    );
  });

  it("rejects an oversized exact body without truncating or persisting it", async () => {
    const { supabase, rpc } = supabaseRpc();
    const getAttachmentsFromMessage = vi.fn(async () => []);
    const oversizedEmail = email();
    oversizedEmail.providerDeliverySource = {
      ...oversizedEmail.providerDeliverySource!,
      value: "x".repeat(8 * 1024 * 1024 + 1),
    };

    await expect(
      captureProviderDeliveredEmailSource({
        supabase,
        connection: connection(),
        provider: {
          providerType: "gmail",
          getAttachmentsFromMessage,
        },
        email: oversizedEmail,
        direction: "inbound",
      })
    ).rejects.toThrow("PROVIDER_DELIVERY_CONTENT_TOO_LARGE");
    expect(rpc).not.toHaveBeenCalledWith(
      "capture_agent_provider_delivery_source_as_system",
      expect.anything()
    );
    expect(getAttachmentsFromMessage).not.toHaveBeenCalled();
  });

  it("captures only provider-accepted outbound rendered content", async () => {
    const { supabase, rpc } = supabaseRpc();
    const renderedBody = "<p>Hello Jane</p><p>OPS signature</p>";

    await captureAcceptedOutboundProviderDeliverySource({
      supabase,
      connection: connection("microsoft365"),
      intent: {
        outboundIntentKind: "email_send_intent",
        outboundIntentId: INTENT_ID,
        status: "reconciling",
        companyId: COMPANY_ID,
        connectionId: CONNECTION_ID,
        providerMessageId: "accepted-message-1",
        providerThreadId: "accepted-thread-1",
        providerAcceptedAt: "2026-08-07T22:00:00.000Z",
        senderIdentity: "Operator@example.com",
        recipientIdentities: ["Jane.Doe@example.com"],
        ccRecipientIdentities: [],
        subject: "Exact outbound subject",
        renderedBody,
        renderedBodyHash: createHash("sha256")
          .update(renderedBody)
          .digest("hex"),
        contentType: "html",
      },
    });

    expect(rpc).toHaveBeenCalledWith(
      "capture_agent_provider_delivery_source_as_system",
      expect.objectContaining({
        p_direction: "outbound",
        p_content_media_type: "text/html",
        p_content_value: renderedBody,
        p_content_source_kind: "ops_rendered_outbound",
        p_content_selection_revision: "ops.accepted-send.rendered-body.v1",
        p_outbound_intent_kind: "email_send_intent",
        p_outbound_intent_id: INTENT_ID,
        p_attachment_enumeration_complete: true,
        p_attachment_descriptors: [],
      })
    );

    rpc.mockClear();
    await expect(
      captureAcceptedOutboundProviderDeliverySource({
        supabase,
        connection: connection("microsoft365"),
        intent: {
          outboundIntentKind: "email_send_intent",
          outboundIntentId: INTENT_ID,
          status: "prepared",
          companyId: COMPANY_ID,
          connectionId: CONNECTION_ID,
          providerMessageId: null,
          providerThreadId: null,
          providerAcceptedAt: null,
          senderIdentity: "operator@example.com",
          recipientIdentities: ["jane.doe@example.com"],
          ccRecipientIdentities: [],
          subject: "Draft",
          renderedBody: "Rendered draft",
          renderedBodyHash: createHash("sha256")
            .update("Rendered draft")
            .digest("hex"),
          contentType: "text",
        },
      })
    ).rejects.toBeInstanceOf(ProviderDeliverySourceError);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("always enters the atomic capture RPC so a provider-native first writer can receive accepted authority", async () => {
    const renderedBody = "Exact accepted body";
    const rpc = vi.fn(async (functionName: string) => {
      if (
        functionName === "preflight_agent_provider_delivery_source_as_system"
      ) {
        throw new Error(
          "accepted outbound must never preflight away attestation"
        );
      }
      return { data: [captureReceipt(false)], error: null };
    });

    await expect(
      captureAcceptedOutboundProviderDeliverySource({
        supabase: { rpc } as never,
        connection: connection(),
        intent: {
          outboundIntentKind: "approved_action_email_intent",
          outboundIntentId: INTENT_ID,
          status: "provider_accepted",
          companyId: COMPANY_ID,
          connectionId: CONNECTION_ID,
          providerMessageId: "provider-message-1",
          providerThreadId: "provider-thread-1",
          providerAcceptedAt: "2026-08-07T22:00:00.000Z",
          senderIdentity: "operator@example.com",
          recipientIdentities: ["jane.doe@example.com"],
          ccRecipientIdentities: [],
          subject: "Exact outbound subject",
          renderedBody,
          renderedBodyHash: createHash("sha256")
            .update(renderedBody)
            .digest("hex"),
          contentType: "text",
        },
      })
    ).resolves.toEqual({
      sourceId: SOURCE_ID,
      sourceSha256: `sha256:${"a".repeat(64)}`,
      inserted: false,
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      "capture_agent_provider_delivery_source_as_system",
      expect.objectContaining({
        p_provider_message_id: "provider-message-1",
        p_provider_thread_id: "provider-thread-1",
        p_direction: "outbound",
        p_outbound_intent_kind: "approved_action_email_intent",
        p_outbound_intent_id: INTENT_ID,
      })
    );
  });

  it("lets provider sync retain an OPS first writer without re-enumerating or replacing its exact content", async () => {
    const outboundEmail = email();
    outboundEmail.from = "Operator <operator@example.com>";
    outboundEmail.to = ["Jane <jane.doe@example.com>"];
    outboundEmail.cc = [];
    outboundEmail.providerDeliverySource = {
      ...outboundEmail.providerDeliverySource!,
      senderIdentity: outboundEmail.from,
      recipientIdentities: outboundEmail.to,
      ccRecipientIdentities: [],
    };
    const rpc = vi.fn(async (functionName: string) => {
      if (
        functionName === "preflight_agent_provider_delivery_source_as_system"
      ) {
        return {
          data: [preflightReceipt({ direction: "outbound" })],
          error: null,
        };
      }
      throw new Error(`unexpected RPC: ${functionName}`);
    });
    const getAttachmentsFromMessage = vi.fn(async () => []);

    await expect(
      captureProviderDeliveredEmailSource({
        supabase: { rpc } as never,
        connection: connection(),
        provider: {
          providerType: "gmail",
          getAttachmentsFromMessage,
        },
        email: outboundEmail,
        direction: "outbound",
      })
    ).resolves.toEqual({
      sourceId: SOURCE_ID,
      sourceSha256: `sha256:${"a".repeat(64)}`,
      inserted: false,
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(getAttachmentsFromMessage).not.toHaveBeenCalled();
  });

  it("selects the Microsoft sent timestamp from authoritative outbound direction even when alias heuristics chose received time", async () => {
    const { supabase, rpc } = supabaseRpc();
    const sentAt = new Date("2026-08-07T21:58:00.000Z");
    const receivedAt = new Date("2026-08-07T22:00:00.000Z");
    const outboundEmail = email();
    outboundEmail.date = receivedAt;
    outboundEmail.providerDeliverySource = {
      ...outboundEmail.providerDeliverySource!,
      sourceKind: "microsoft_graph_body",
      selectionRevision: "microsoft.graph.body.v1",
      contentCharset: null,
      deliveredAt: receivedAt,
    };
    const providerTimestamps =
      outboundEmail.providerDeliverySource as unknown as {
        providerSentAt: Date;
        providerReceivedAt: Date;
      };
    providerTimestamps.providerSentAt = sentAt;
    providerTimestamps.providerReceivedAt = receivedAt;

    await captureProviderDeliveredEmailSource({
      supabase,
      connection: connection("microsoft365"),
      provider: {
        providerType: "microsoft365",
        getAttachmentsFromMessage: vi.fn(async () => []),
      },
      email: outboundEmail,
      direction: "outbound",
    });

    expect(rpc).toHaveBeenCalledWith(
      "capture_agent_provider_delivery_source_as_system",
      expect.objectContaining({
        p_direction: "outbound",
        p_delivered_at: sentAt.toISOString(),
      })
    );
  });

  it("retains an exact provider-native manual outbound as ops:system without accepted authority", () => {
    expect(
      resolveParticipantSide({
        direction: "outbound",
        partyRole: "ops",
        deliverySourceKind: "gmail_mime_part",
        sourceActivityId: ACTIVITY_ID,
        senderEmail: "operator@example.com",
        actorUserId: null,
        confirmedCustomerParticipants: [],
      })
    ).toEqual({
      side: "assistant",
      participantId: "ops:system",
      status: "resolved",
      revision: "job-participant-side:v1",
    });
  });
});

describe("provider delivery source read", () => {
  it.each([
    ["a bare object", readReceipt()],
    ["more than one row", [readReceipt(), readReceipt()]],
  ])("rejects a read response containing %s", async (_label, data) => {
    const rpc = vi.fn(async () => ({
      data,
      error: null,
    }));

    await expect(
      readProviderDeliverySource({
        supabase: { rpc } as never,
        companyId: COMPANY_ID,
        connectionId: CONNECTION_ID,
        providerMessageId: "provider-message-1",
        sourceActivityId: ACTIVITY_ID,
      })
    ).rejects.toThrow("PROVIDER_DELIVERY_SOURCE_READ_RECEIPT_INVALID");
  });
});
