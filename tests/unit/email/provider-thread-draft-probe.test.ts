/**
 * Unit tests — findDraftsOnThread (per-thread provider draft probe)
 *
 * This is the ONLY admissible positive read for resolving a quarantined
 * `draft_create` attempt that never recorded a provider resource id. The
 * bounded `listDrafts()` snapshot cannot do the job: it is capped and its
 * truncation is invisible, so a miss there is absence of evidence, not
 * evidence of absence.
 *
 * The probe must therefore answer, for one exact conversation:
 *   - `present: false` — the provider positively reported no draft pinned to
 *     this thread. This is the verdict that licenses an automated rejection.
 *   - `present: true` with ids — a draft exists and can be named.
 *   - `present: true` with no ids — a draft exists but could not be named. The
 *     caller must leave the attempt quarantined rather than guess.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { ProviderApiError } from "@/lib/api/services/email-provider";
import { GmailProvider } from "@/lib/api/services/providers/gmail-provider";
import { Microsoft365Provider } from "@/lib/api/services/providers/microsoft365-provider";
import type { EmailConnection } from "@/lib/types/email-connection";

function makeConnection(provider: "gmail" | "microsoft365"): EmailConnection {
  const now = new Date();
  return {
    id: "connection-1",
    companyId: "company-1",
    provider,
    type: "company",
    userId: null,
    email: "operator@example.com",
    accessToken: "access-token",
    refreshToken: "refresh-token",
    expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    historyId: "history-start",
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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("GmailProvider.findDraftsOnThread", () => {
  it("reports a positive absence when the thread carries no DRAFT-labelled message", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.includes("/threads/")) {
        return jsonResponse({
          id: "thread-1",
          messages: [
            { id: "message-1", labelIds: ["INBOX"] },
            { id: "message-2", labelIds: ["SENT"] },
          ],
        });
      }
      throw new Error(`Unexpected Gmail request: ${url.toString()}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const probe = await new GmailProvider(
      makeConnection("gmail")
    ).findDraftsOnThread("thread-1");

    expect(probe).toEqual({ present: false, draftIds: [] });
    // Absence is settled by the thread read alone — the bounded drafts list is
    // never consulted, because its silence would prove nothing.
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).includes("/drafts")
      )
    ).toBe(false);
  });

  it("treats a thread the provider no longer holds as carrying no draft", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ error: { message: "Not Found" } }, 404)
    );
    vi.stubGlobal("fetch", fetchMock);

    const probe = await new GmailProvider(
      makeConnection("gmail")
    ).findDraftsOnThread("thread-gone");

    expect(probe).toEqual({ present: false, draftIds: [] });
  });

  it("names the draft when the thread holds one", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.includes("/threads/")) {
        return jsonResponse({
          id: "thread-1",
          messages: [
            { id: "message-1", labelIds: ["INBOX"] },
            { id: "draft-message-1", labelIds: ["DRAFT"] },
          ],
        });
      }
      if (url.pathname.endsWith("/drafts")) {
        return jsonResponse({
          drafts: [
            {
              id: "r-99",
              message: { id: "draft-message-1", threadId: "thread-1" },
            },
            {
              id: "r-100",
              message: { id: "unrelated-draft", threadId: "thread-2" },
            },
          ],
        });
      }
      throw new Error(`Unexpected Gmail request: ${url.toString()}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const probe = await new GmailProvider(
      makeConnection("gmail")
    ).findDraftsOnThread("thread-1");

    expect(probe).toEqual({ present: true, draftIds: ["r-99"] });
  });

  it("reports an unnameable draft rather than inventing one", async () => {
    // The thread proves a draft exists; the drafts list page does not contain
    // it. Existence stands, identity does not — the caller must not resolve.
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.includes("/threads/")) {
        return jsonResponse({
          id: "thread-1",
          messages: [{ id: "draft-message-1", labelIds: ["DRAFT"] }],
        });
      }
      if (url.pathname.endsWith("/drafts")) {
        return jsonResponse({
          drafts: [
            {
              id: "r-100",
              message: { id: "unrelated-draft", threadId: "thread-2" },
            },
          ],
        });
      }
      throw new Error(`Unexpected Gmail request: ${url.toString()}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const probe = await new GmailProvider(
      makeConnection("gmail")
    ).findDraftsOnThread("thread-1");

    expect(probe).toEqual({ present: true, draftIds: [] });
  });

  it("raises provider failures instead of reporting a false absence", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ error: { message: "Bad Request" } }, 400)
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new GmailProvider(makeConnection("gmail")).findDraftsOnThread("thread-1")
    ).rejects.toBeInstanceOf(ProviderApiError);
  });
});

describe("Microsoft365Provider.findDraftsOnThread", () => {
  it("reports a positive absence when the Drafts folder holds nothing on the conversation", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/oauth2/") || url.includes("/token")) {
        return jsonResponse({ access_token: "graph-token", expires_in: 3600 });
      }
      if (url.includes("/mailFolders/drafts/messages")) {
        expect(decodeURIComponent(url)).toContain(
          "conversationId eq 'conversation-1'"
        );
        return jsonResponse({ value: [] });
      }
      throw new Error(`Unexpected Graph request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const probe = await new Microsoft365Provider(
      makeConnection("microsoft365")
    ).findDraftsOnThread("conversation-1");

    expect(probe).toEqual({ present: false, draftIds: [] });
  });

  it("names every draft the Drafts folder holds on the conversation", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/oauth2/") || url.includes("/token")) {
        return jsonResponse({ access_token: "graph-token", expires_in: 3600 });
      }
      if (url.includes("/mailFolders/drafts/messages")) {
        return jsonResponse({
          value: [
            {
              id: "graph-draft-1",
              conversationId: "conversation-1",
              isDraft: true,
            },
          ],
        });
      }
      throw new Error(`Unexpected Graph request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const probe = await new Microsoft365Provider(
      makeConnection("microsoft365")
    ).findDraftsOnThread("conversation-1");

    expect(probe).toEqual({ present: true, draftIds: ["graph-draft-1"] });
  });
});
