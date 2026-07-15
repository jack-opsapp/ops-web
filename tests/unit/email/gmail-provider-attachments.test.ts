import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ProviderApiError,
  ProviderAttachmentTooLargeError,
} from "@/lib/api/services/email-provider";
import { GmailProvider } from "@/lib/api/services/providers/gmail-provider";
import type { EmailConnection } from "@/lib/types/email-connection";

function connection(): EmailConnection {
  const now = new Date();
  return {
    id: "gmail-connection",
    companyId: "company-1",
    provider: "gmail",
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

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function messageFixture() {
  return {
    id: "message-1",
    threadId: "thread-1",
    internalDate: "1710000000000",
    labelIds: ["INBOX"],
    payload: {
      mimeType: "multipart/mixed",
      headers: [
        { name: "From", value: "Corinne <corinne@example.com>" },
        { name: "To", value: "operator@example.com" },
        { name: "Subject", value: "Photos" },
      ],
      parts: [
        {
          partId: "0",
          mimeType: "text/plain",
          body: { data: Buffer.from("Photos attached").toString("base64url") },
        },
        {
          partId: "1",
          mimeType: "multipart/related",
          parts: [
            {
              partId: "1.1",
              mimeType: "image/jpeg",
              filename: "site-photo.jpg",
              headers: [
                { name: "Content-Disposition", value: "inline" },
                { name: "Content-ID", value: "<photo-1>" },
              ],
              body: { attachmentId: "provider-attachment-1", size: 2_048 },
            },
            {
              partId: "1.2",
              mimeType: "image/jpeg",
              filename: "",
              headers: [{ name: "Content-ID", value: "<photo-2>" }],
              body: {
                data: Buffer.from("inline-photo-bytes").toString("base64url"),
                size: 18,
              },
            },
            {
              partId: "1.3",
              mimeType: "image/png",
              filename: "",
              headers: [],
              body: {
                data: Buffer.from("metadata-free-inline-photo").toString(
                  "base64url"
                ),
                size: 26,
              },
            },
          ],
        },
        {
          partId: "2",
          mimeType: "application/octet-stream",
          filename: "estimate.pdf",
          headers: [{ name: "Content-Disposition", value: "attachment" }],
          body: { attachmentId: "provider-attachment-2", size: 4_096 },
        },
      ],
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("GmailProvider attachments", () => {
  it("bounds exact-message attachment enumeration with an abort signal", async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) => {
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        return response(messageFixture());
      }
    );
    vi.stubGlobal("fetch", fetchMock);

    await new GmailProvider(connection()).getAttachmentsFromMessage(
      "message-1"
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("finds nested, small, filename-less, body-data, and document parts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response(messageFixture()))
    );

    const provider = new GmailProvider(connection());
    const attachments = await provider.getAttachmentsFromMessage("message-1");

    expect(attachments).toEqual([
      expect.objectContaining({
        attachmentId: "provider-attachment-1",
        providerPartId: "1.1",
        filename: "site-photo.jpg",
        isInline: true,
        contentId: "photo-1",
        downloadSupported: true,
      }),
      expect.objectContaining({
        attachmentId: "inline:1.2",
        providerPartId: "1.2",
        filename: "inline-photo-1.2.jpg",
        isInline: true,
        contentId: "photo-2",
        downloadSupported: true,
      }),
      expect.objectContaining({
        attachmentId: "inline:1.3",
        providerPartId: "1.3",
        filename: "inline-photo-1.3.png",
        isInline: true,
        contentId: null,
        downloadSupported: true,
      }),
      expect.objectContaining({
        attachmentId: "provider-attachment-2",
        providerPartId: "2",
        filename: "estimate.pdf",
        mimeType: "application/octet-stream",
      }),
    ]);
  });

  it("downloads inline body-data through its synthetic immutable part id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response(messageFixture()))
    );

    const bytes = await new GmailProvider(connection()).fetchAttachment(
      "message-1",
      "inline:1.2"
    );

    expect(bytes.toString()).toBe("inline-photo-bytes");
  });

  it("reuses exact-message inline data instead of downloading the message twice", async () => {
    const fetchMock = vi.fn(async () => response(messageFixture()));
    vi.stubGlobal("fetch", fetchMock);

    const provider = new GmailProvider(connection());
    await provider.getAttachmentsFromMessage("message-1");
    const bytes = await provider.fetchAttachment("message-1", "inline:1.2");

    expect(bytes.toString()).toBe("inline-photo-bytes");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("marks nested inline data as an attachment during normal message sync", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response({ messages: [messageFixture()] }))
    );

    const emails = await new GmailProvider(connection()).fetchThread(
      "thread-1"
    );
    expect(emails).toHaveLength(1);
    expect(emails[0].hasAttachments).toBe(true);
  });

  it("marks a metadata-free inline image as an attachment during normal sync", async () => {
    const base = messageFixture();
    const fixture = {
      ...base,
      payload: {
        ...base.payload,
        parts: [
          base.payload.parts[0],
          {
            partId: "1",
            mimeType: "image/png",
            filename: "",
            headers: [],
            body: {
              data: Buffer.from("metadata-free-inline-photo").toString(
                "base64url"
              ),
              size: 26,
            },
          },
        ] as Array<Record<string, unknown>>,
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response({ messages: [fixture] }))
    );

    const emails = await new GmailProvider(connection()).fetchThread(
      "thread-1"
    );
    expect(emails).toHaveLength(1);
    expect(emails[0].hasAttachments).toBe(true);
  });

  it("does not mistake a separately stored text or HTML message body for a file", async () => {
    const bodyOnly = {
      ...messageFixture(),
      payload: {
        mimeType: "multipart/alternative",
        headers: [
          { name: "From", value: "Corinne <corinne@example.com>" },
          { name: "To", value: "operator@example.com" },
          { name: "Subject", value: "Long message" },
        ],
        parts: [
          {
            partId: "0",
            mimeType: "text/plain",
            filename: "",
            headers: [],
            body: { attachmentId: "large-plain-body", size: 500_000 },
          },
          {
            partId: "1",
            mimeType: "text/html",
            filename: "",
            headers: [],
            body: { attachmentId: "large-html-body", size: 700_000 },
          },
        ],
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) =>
        String(input).includes("/threads/")
          ? response({ messages: [bodyOnly] })
          : response(bodyOnly)
      )
    );

    const provider = new GmailProvider(connection());
    await expect(
      provider.getAttachmentsFromMessage("message-1")
    ).resolves.toEqual([]);
    const emails = await provider.fetchThread("thread-1");
    expect(emails[0]?.hasAttachments).toBe(false);
  });

  it("aborts an attachment JSON response before buffering past its encoded limit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response({ data: "A".repeat(70_000) }))
    );

    await expect(
      new GmailProvider(connection()).fetchAttachment(
        "message-1",
        "provider-attachment-1",
        8
      )
    ).rejects.toBeInstanceOf(ProviderAttachmentTooLargeError);
  });

  it("bounds provider-byte downloads with an abort signal", async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) => {
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        return response({ data: Buffer.from("photo").toString("base64url") });
      }
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new GmailProvider(connection()).fetchAttachment(
        "message-1",
        "provider-attachment-1"
      )
    ).resolves.toEqual(Buffer.from("photo"));
  });

  it("throws a typed provider error instead of parsing a failed message response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response({ error: "down" }, 503))
    );

    await expect(
      new GmailProvider(connection()).getAttachmentsFromMessage("message-1")
    ).rejects.toBeInstanceOf(ProviderApiError);
  });

  it("does not surface attachment bytes from draft, spam, or trash messages", async () => {
    const delivered = messageFixture();
    const spam = {
      ...messageFixture(),
      id: "message-spam",
      labelIds: ["SPAM"],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response({ messages: [delivered, spam] }))
    );

    const attachments = await new GmailProvider(
      connection()
    ).getAttachmentsFromThread("thread-1");
    expect(new Set(attachments.map((item) => item.messageId))).toEqual(
      new Set(["message-1"])
    );
  });

  it("throws instead of converting missing provider bytes into an empty file", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response({}))
    );

    await expect(
      new GmailProvider(connection()).fetchAttachment(
        "message-1",
        "provider-attachment-1"
      )
    ).rejects.toBeInstanceOf(ProviderApiError);
  });

  it("caps pathological MIME part counts and returns an explicit review marker", async () => {
    const base = messageFixture();
    const manyParts = Array.from({ length: 501 }, (_, index) => ({
      partId: String(index),
      mimeType: "image/jpeg",
      filename: `photo-${index}.jpg`,
      headers: [{ name: "Content-Disposition", value: "attachment" }],
      body: { attachmentId: `attachment-${index}`, size: 10 },
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response({
          ...base,
          payload: { ...base.payload, parts: manyParts },
        })
      )
    );

    const attachments = await new GmailProvider(
      connection()
    ).getAttachmentsFromMessage("message-1");

    expect(attachments).toHaveLength(501);
    expect(attachments.at(-1)).toEqual(
      expect.objectContaining({
        attachmentId: "ops-enumeration-budget",
        providerKind: "reference",
        downloadSupported: false,
      })
    );
  });
});
