import { afterEach, describe, expect, it, vi } from "vitest";

import { GmailProvider } from "@/lib/api/services/providers/gmail-provider";
import { Microsoft365Provider } from "@/lib/api/services/providers/microsoft365-provider";
import type { EmailConnection } from "@/lib/types/email-connection";

function connection(provider: "gmail" | "microsoft365"): EmailConnection {
  const now = new Date();
  return {
    id: "00000000-0000-4000-8000-000000000002",
    companyId: "00000000-0000-4000-8000-000000000001",
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

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("provider-delivered content provenance", () => {
  it("fetches and preserves Gmail's selected attachment-backed text MIME part", async () => {
    const exactBody = "Exact plain body\r\nwith provider whitespace.  ";
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/attachments/body-attachment-1")) {
        return json({ data: Buffer.from(exactBody).toString("base64url") });
      }
      return json({
        messages: [
          {
            id: "gmail-message-1",
            threadId: "gmail-thread-1",
            internalDate: "1786140000000",
            labelIds: ["INBOX"],
            payload: {
              mimeType: "multipart/alternative",
              headers: [
                {
                  name: "From",
                  value: '"Doe, Jane" <Jane.Doe@example.com>',
                },
                {
                  name: "To",
                  value:
                    'OPS <Operator@example.com>, "Crew, North" <North@example.com>',
                },
                { name: "Cc", value: "Estimator <Estimate@example.com>" },
                { name: "Subject", value: "Re:  Exact subject  " },
              ],
              parts: [
                {
                  partId: "0.1",
                  mimeType: "text/plain",
                  body: {
                    attachmentId: "body-attachment-1",
                    size: exactBody.length,
                  },
                },
                {
                  partId: "0.2",
                  mimeType: "text/html",
                  body: {
                    data: Buffer.from(
                      "<p>Different HTML alternative</p>"
                    ).toString("base64url"),
                  },
                },
              ],
            },
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const [email] = await new GmailProvider(connection("gmail")).fetchThread(
      "gmail-thread-1"
    );

    expect(email.bodyText).toBe(exactBody);
    expect(email.to).toEqual([
      "OPS <Operator@example.com>",
      '"Crew, North" <North@example.com>',
    ]);
    expect(email.providerDeliverySource).toEqual({
      mediaType: "text/plain",
      value: exactBody,
      sourceKind: "gmail_mime_part",
      selectionRevision: "gmail.mime.text-plain-first.charset-decoded.v2",
      providerPartId: "0.1",
      providerBodyAttachmentId: "body-attachment-1",
      contentCharset: "us-ascii",
      senderIdentity: '"Doe, Jane" <Jane.Doe@example.com>',
      recipientIdentities: [
        "OPS <Operator@example.com>",
        '"Crew, North" <North@example.com>',
      ],
      ccRecipientIdentities: ["Estimator <Estimate@example.com>"],
      subject: "Re:  Exact subject  ",
      deliveredAt: new Date("2026-08-07T22:00:00.000Z"),
    });
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).includes("/attachments/body-attachment-1")
      )
    ).toBe(true);
  });

  it("canonically decodes a non-UTF-8 Gmail MIME body without replacement loss", async () => {
    const windows1252Body = Buffer.from([0x63, 0x61, 0x66, 0xe9]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({
          messages: [
            {
              id: "gmail-message-windows-1252",
              threadId: "gmail-thread-windows-1252",
              internalDate: "1786140000000",
              labelIds: ["INBOX"],
              payload: {
                mimeType: "text/plain",
                headers: [
                  { name: "From", value: "customer@example.com" },
                  { name: "To", value: "operator@example.com" },
                  { name: "Subject", value: "Encoded conditions" },
                  {
                    name: "Content-Type",
                    value: "text/plain; charset=iso-8859-1",
                  },
                ],
                body: { data: windows1252Body.toString("base64url") },
              },
            },
          ],
        })
      )
    );

    const [email] = await new GmailProvider(connection("gmail")).fetchThread(
      "gmail-thread-windows-1252"
    );

    expect(email.bodyText).toBe("café");
    expect(email.bodyText).not.toContain("�");
    expect(email.providerDeliverySource).toMatchObject({
      value: "café",
      contentCharset: "windows-1252",
      selectionRevision: "gmail.mime.text-plain-first.charset-decoded.v2",
    });
  });

  it("rejects Gmail messages without an exact provider occurrence timestamp", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({
          messages: [
            {
              id: "gmail-message-without-time",
              threadId: "gmail-thread-without-time",
              labelIds: ["INBOX"],
              payload: {
                mimeType: "text/plain",
                headers: [
                  { name: "From", value: "customer@example.com" },
                  { name: "To", value: "operator@example.com" },
                  { name: "Subject", value: "Conditions" },
                ],
                body: {
                  data: Buffer.from("Current conditions").toString("base64url"),
                },
              },
            },
          ],
        })
      )
    );

    await expect(
      new GmailProvider(connection("gmail")).fetchThread(
        "gmail-thread-without-time"
      )
    ).rejects.toThrow("did not contain an exact internalDate");
  });

  it("rejects non-ASCII Gmail body bytes when MIME omits the charset", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({
          messages: [
            {
              id: "gmail-message-ambiguous-charset",
              threadId: "gmail-thread-ambiguous-charset",
              internalDate: "1786140000000",
              labelIds: ["INBOX"],
              payload: {
                mimeType: "text/plain",
                headers: [
                  { name: "From", value: "customer@example.com" },
                  { name: "To", value: "operator@example.com" },
                  { name: "Subject", value: "Conditions" },
                ],
                body: {
                  data: Buffer.from([0x63, 0x61, 0x66, 0xe9]).toString(
                    "base64url"
                  ),
                },
              },
            },
          ],
        })
      )
    );

    await expect(
      new GmailProvider(connection("gmail")).fetchThread(
        "gmail-thread-ambiguous-charset"
      )
    ).rejects.toThrow("non-ASCII bytes without a declared charset");
  });

  it("never selects a text-file attachment as Gmail's delivered message body", async () => {
    const messageBody = "The actual message body.";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({
          messages: [
            {
              id: "gmail-message-text-attachment",
              threadId: "gmail-thread-text-attachment",
              internalDate: "1786140000000",
              labelIds: ["INBOX"],
              payload: {
                mimeType: "multipart/mixed",
                headers: [
                  { name: "From", value: "customer@example.com" },
                  { name: "To", value: "operator@example.com" },
                  { name: "Subject", value: "Conditions" },
                ],
                parts: [
                  {
                    partId: "0",
                    mimeType: "text/plain",
                    filename: "site-notes.txt",
                    headers: [
                      {
                        name: "Content-Disposition",
                        value: 'attachment; filename="site-notes.txt"',
                      },
                    ],
                    body: {
                      data: Buffer.from("Attachment contents").toString(
                        "base64url"
                      ),
                    },
                  },
                  {
                    partId: "1",
                    mimeType: "text/plain",
                    filename: "",
                    body: {
                      data: Buffer.from(messageBody).toString("base64url"),
                    },
                  },
                ],
              },
            },
          ],
        })
      )
    );

    const [email] = await new GmailProvider(connection("gmail")).fetchThread(
      "gmail-thread-text-attachment"
    );

    expect(email.bodyText).toBe(messageBody);
    expect(email.providerDeliverySource).toMatchObject({
      value: messageBody,
      providerPartId: "1",
    });
    expect(email.hasAttachments).toBe(true);
  });

  it("preserves Microsoft Graph body content while uniqueBody remains display-only", async () => {
    const graphBody =
      "<html><body><p>Exact&nbsp;body</p><!--[if mso]><p>Outlook only</p><![endif]--></body></html>";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({
          value: [
            {
              id: "m365-message-1",
              conversationId: "m365-thread-1",
              from: {
                emailAddress: {
                  address: "Jane.Doe@example.com",
                  name: "Jane Doe",
                },
              },
              toRecipients: [
                {
                  emailAddress: {
                    address: "Operator@example.com",
                    name: "OPS",
                  },
                },
              ],
              ccRecipients: [],
              subject: "Exact subject",
              bodyPreview: "Exact body",
              body: { contentType: "html", content: graphBody },
              uniqueBody: {
                contentType: "text",
                content: "Display-only excerpt",
              },
              sentDateTime: "2026-08-07T21:58:00.000Z",
              receivedDateTime: "2026-08-07T22:00:00.000Z",
              categories: [],
              isDraft: false,
              isRead: false,
              hasAttachments: false,
            },
          ],
        })
      )
    );

    const [email] = await new Microsoft365Provider(
      connection("microsoft365")
    ).fetchThread("m365-thread-1");

    expect(email.bodyTextClean).toBe("Display-only excerpt");
    expect(email.providerDeliverySource).toEqual({
      mediaType: "text/html",
      value: graphBody,
      sourceKind: "microsoft_graph_body",
      selectionRevision: "microsoft.graph.body.v1",
      providerPartId: null,
      providerBodyAttachmentId: null,
      contentCharset: null,
      senderIdentity: "Jane.Doe@example.com",
      recipientIdentities: ["Operator@example.com"],
      ccRecipientIdentities: [],
      subject: "Exact subject",
      deliveredAt: new Date("2026-08-07T22:00:00.000Z"),
      providerSentAt: new Date("2026-08-07T21:58:00.000Z"),
      providerReceivedAt: new Date("2026-08-07T22:00:00.000Z"),
    });
  });

  it("uses sentDateTime for Microsoft 365 messages sent by a connected mailbox identity", async () => {
    const sentAt = "2026-08-07T22:00:00.000Z";
    const receivedAt = "2026-08-07T22:04:00.000Z";
    const fetchMock = vi.fn(async (_input: string | URL | Request) =>
      json({
        value: [
          {
            id: "m365-sent-message-1",
            conversationId: "m365-sent-thread-1",
            from: {
              emailAddress: {
                address: "Alias@Example.com",
                name: "OPS",
              },
            },
            toRecipients: [
              {
                emailAddress: {
                  address: "Jane.Doe@example.com",
                  name: "Jane Doe",
                },
              },
            ],
            ccRecipients: [],
            subject: "Scheduled date",
            bodyPreview: "We are scheduled",
            body: { contentType: "text", content: "We are scheduled." },
            sentDateTime: sentAt,
            receivedDateTime: receivedAt,
            categories: [],
            isDraft: false,
            isRead: true,
            hasAttachments: false,
          },
        ],
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const m365Connection = connection("microsoft365");
    m365Connection.syncFilters.userEmailAddresses = ["alias@example.com"];
    const [email] = await new Microsoft365Provider(m365Connection).fetchThread(
      "m365-sent-thread-1"
    );

    expect(email.date).toEqual(new Date(sentAt));
    expect(email.providerDeliverySource?.deliveredAt).toEqual(new Date(sentAt));
    expect(decodeURIComponent(String(fetchMock.mock.calls[0]?.[0]))).toContain(
      "sentDateTime"
    );
  });
});
