import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ProviderApiError,
  ProviderAttachmentTooLargeError,
  ProviderScopeError,
} from "@/lib/api/services/email-provider";
import { Microsoft365Provider } from "@/lib/api/services/providers/microsoft365-provider";
import type { EmailConnection } from "@/lib/types/email-connection";

function connection(): EmailConnection {
  const now = new Date();
  return {
    id: "m365-connection",
    companyId: "company-1",
    provider: "microsoft365",
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

afterEach(() => vi.unstubAllGlobals());

describe("Microsoft365Provider attachments", () => {
  it("enumerates inline-only, file, item, reference, and paginated attachments", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/attachments/reference-1")) {
        return json({
          "@odata.type": "#microsoft.graph.referenceAttachment",
          id: "reference-1",
          sourceUrl: "https://example.sharepoint.com/plans",
        });
      }
      if (url.includes("page=2")) {
        return json({
          value: [
            {
              "@odata.type": "#microsoft.graph.referenceAttachment",
              id: "reference-1",
              name: "Plans",
              contentType: "application/vnd.microsoft.reference",
              size: 0,
            },
          ],
        });
      }
      return json({
        value: [
          {
            "@odata.type": "#microsoft.graph.fileAttachment",
            id: "inline-1",
            name: "photo.jpg",
            contentType: "image/jpeg",
            size: 1_024,
            isInline: true,
            contentId: "photo-cid",
          },
          {
            "@odata.type": "#microsoft.graph.itemAttachment",
            id: "item-1",
            name: "appointment.ics",
            contentType: "text/calendar",
            size: 512,
            isInline: false,
          },
        ],
        "@odata.nextLink":
          "https://graph.microsoft.com/v1.0/me/messages/message-1/attachments?page=2",
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const attachments = await new Microsoft365Provider(
      connection()
    ).getAttachmentsFromMessage("message-1", {
      fromEmail: "customer@example.com",
      date: new Date("2026-07-14T12:00:00Z"),
    });

    expect(attachments).toEqual([
      expect.objectContaining({
        attachmentId: "inline-1",
        providerKind: "inline",
        isInline: true,
        contentId: "photo-cid",
        downloadSupported: true,
      }),
      expect.objectContaining({
        attachmentId: "item-1",
        providerKind: "item",
        downloadSupported: true,
      }),
      expect.objectContaining({
        attachmentId: "reference-1",
        providerKind: "reference",
        downloadSupported: false,
        sourceUrl: "https://example.sharepoint.com/plans",
      }),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "$select=id,name,contentType,size,isInline,contentId"
    );
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain("contentBytes");
  });

  it("downloads file and item bytes through the raw-value endpoint", async () => {
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        expect(String(input)).toContain(
          "/me/messages/message-1/attachments/item-1/$value"
        );
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        return new Response("raw-mime-bytes", { status: 200 });
      }
    );
    vi.stubGlobal("fetch", fetchMock);

    const bytes = await new Microsoft365Provider(connection()).fetchAttachment(
      "message-1",
      "item-1"
    );
    expect(bytes.toString()).toBe("raw-mime-bytes");
  });

  it("fails closed when an attachment page repeats forever", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({
          value: [],
          "@odata.nextLink":
            "https://graph.microsoft.com/v1.0/me/messages/message-1/attachments?page=same",
        })
      )
    );

    await expect(
      new Microsoft365Provider(connection()).getAttachmentsFromMessage(
        "message-1",
        { fromEmail: "customer@example.com", date: new Date() }
      )
    ).rejects.toBeInstanceOf(ProviderApiError);
  });

  it("rejects a next page that escapes the requested exact message", async () => {
    const fetchMock = vi.fn(async () =>
      json({
        value: [],
        "@odata.nextLink":
          "https://graph.microsoft.com/v1.0/me/messages/different-message/attachments?$skiptoken=escape",
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new Microsoft365Provider(connection()).getAttachmentsFromMessage(
        "message-1",
        { fromEmail: "customer@example.com", date: new Date() }
      )
    ).rejects.toBeInstanceOf(ProviderApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("validates exact message metadata before enumerating attachments", async () => {
    const fetchMock = vi.fn(async () =>
      json({
        id: "different-message",
        from: { emailAddress: { address: "customer@example.com" } },
        receivedDateTime: "2026-07-14T12:00:00Z",
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new Microsoft365Provider(connection()).getAttachmentsFromMessage(
        "message-1"
      )
    ).rejects.toBeInstanceOf(ProviderApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("aborts a raw attachment response before buffering past the byte limit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new Uint8Array(32), {
            status: 200,
            headers: { "content-length": "32" },
          })
      )
    );

    await expect(
      new Microsoft365Provider(connection()).fetchAttachment(
        "message-1",
        "file-1",
        8
      )
    ).rejects.toBeInstanceOf(ProviderAttachmentTooLargeError);
  });

  it("fails the whole enumeration when a later attachment page fails", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        if (calls === 1) {
          return json({
            value: [],
            "@odata.nextLink":
              "https://graph.microsoft.com/v1.0/me/messages/message-1/attachments?page=2",
          });
        }
        return new Response("backend unavailable", { status: 503 });
      })
    );

    await expect(
      new Microsoft365Provider(connection()).getAttachmentsFromMessage(
        "message-1",
        { fromEmail: "customer@example.com", date: new Date() }
      )
    ).rejects.toBeInstanceOf(ProviderApiError);
  });

  it("does not pause a healthy mailbox for resource-specific Graph access denial", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: {
                code: "ErrorAccessDenied",
                message: "Access to this attachment is denied.",
              },
            }),
            { status: 403 }
          )
      )
    );

    const promise = new Microsoft365Provider(
      connection()
    ).getAttachmentsFromMessage("message-1", {
      fromEmail: "customer@example.com",
      date: new Date(),
    });

    await expect(promise).rejects.toBeInstanceOf(ProviderApiError);
    await expect(promise).rejects.not.toBeInstanceOf(ProviderScopeError);
  });

  it("caps attachment-list requests and returns an explicit review marker", async () => {
    let page = 0;
    const fetchMock = vi.fn(async () => {
      page += 1;
      return json({
        value: [],
        "@odata.nextLink": `https://graph.microsoft.com/v1.0/me/messages/message-1/attachments?page=${page + 1}`,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const attachments = await new Microsoft365Provider(
      connection()
    ).getAttachmentsFromMessage("message-1", {
      fromEmail: "customer@example.com",
      date: new Date(),
    });

    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(5);
    expect(attachments).toContainEqual(
      expect.objectContaining({
        attachmentId: "ops-enumeration-budget",
        providerKind: "reference",
        downloadSupported: false,
      })
    );
  });

  it("caps reference metadata requests while retaining every reference descriptor", async () => {
    const references = Array.from({ length: 25 }, (_, index) => ({
      "@odata.type": "#microsoft.graph.referenceAttachment",
      id: `reference-${index}`,
      name: `Reference ${index}`,
      contentType: "application/vnd.microsoft.reference",
      size: 0,
    }));
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/attachments/reference-")) {
        const id = url.split("/").at(-1) ?? "";
        return json({
          "@odata.type": "#microsoft.graph.referenceAttachment",
          id,
          sourceUrl: `https://example.sharepoint.com/${id}`,
        });
      }
      return json({ value: references });
    });
    vi.stubGlobal("fetch", fetchMock);

    const attachments = await new Microsoft365Provider(
      connection()
    ).getAttachmentsFromMessage("message-1", {
      fromEmail: "customer@example.com",
      date: new Date(),
    });

    expect(attachments).toHaveLength(25);
    expect(fetchMock).toHaveBeenCalledTimes(21);
    expect(attachments.filter((item) => item.sourceUrl === null)).toHaveLength(
      5
    );
  });
});
