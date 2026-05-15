import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/api/query-client";
import {
  useThreadActions,
  type InboxThreadDetail,
  type InboxThreadRow,
  type InboxThreadsPage,
} from "../use-inbox-threads";

vi.mock("@/lib/firebase/auth", () => ({
  getIdToken: vi.fn(async () => "token-1"),
}));

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function wrapperFor(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

function makeThreadRow(): InboxThreadRow {
  return {
    id: "thread-a",
    connectionId: "conn-1",
    providerThreadId: "provider-thread-a",
    primaryCategory: "CUSTOMER",
    categoryConfidence: 0.9,
    categoryManuallySet: false,
    labels: ["AWAITING_REPLY"],
    archivedAt: null,
    snoozedUntil: null,
    priorityScore: 88,
    aiSummary: "Needs a response.",
    subject: "Quote follow-up",
    participants: ["client@example.com"],
    firstMessageAt: "2026-05-14T15:00:00Z",
    lastMessageAt: "2026-05-14T15:05:00Z",
    messageCount: 1,
    unreadCount: 1,
    latestDirection: "inbound",
    latestSenderEmail: "client@example.com",
    latestSenderName: "Goodway Homes",
    latestSnippet: "Can you send the number?",
    opportunityId: null,
    clientId: "client-1",
    clientName: "Goodway Homes",
    nextCommitmentDueAt: null,
    hasUnresolvedCommitments: false,
    nextCommitmentId: null,
    phaseC: "none",
    agentBlockingQuestion: null,
  };
}

function makeThreadDetail(): InboxThreadDetail {
  return {
    thread: {
      id: "thread-a",
      primaryCategory: "CUSTOMER",
      categoryConfidence: 0.9,
      categoryManuallySet: false,
      labels: ["AWAITING_REPLY"],
      archivedAt: null,
      snoozedUntil: null,
      aiSummary: "Needs a response.",
      subject: "Quote follow-up",
      participants: ["client@example.com"],
      messageCount: 1,
      unreadCount: 1,
      opportunityId: null,
      clientId: "client-1",
      clientName: "Goodway Homes",
      latestDirection: "inbound",
      phaseC: "none",
      agentBlockingQuestion: null,
    },
    messages: [
      {
        id: "message-a",
        from: "client@example.com",
        fromName: "Goodway Homes",
        to: ["ops@example.com"],
        cc: [],
        subject: "Quote follow-up",
        snippet: "Can you send the number?",
        bodyText: "Can you send the number?",
        cleanBodyText: "Can you send the number?",
        direction: "inbound",
        date: "2026-05-14T15:05:00Z",
        isRead: false,
        hasAttachments: false,
      },
    ],
    siblingThreads: [],
    commitments: [],
  };
}

describe("useThreadActions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("optimistically clears unread state while mark-read is still in flight", async () => {
    const qc = makeQueryClient();
    const listKey = queryKeys.inbox.threads({
      scope: "mine",
      filter: "needs-reply",
    });
    const detailKey = queryKeys.inbox.threadDetail("thread-a");
    qc.setQueryData<{
      pages: InboxThreadsPage[];
      pageParams: unknown[];
    }>(listKey, {
      pages: [{ threads: [makeThreadRow()], nextCursor: null }],
      pageParams: [null],
    });
    qc.setQueryData(detailKey, makeThreadDetail());

    let resolveFetch!: (response: Response) => void;
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    vi.spyOn(globalThis, "fetch").mockReturnValue(fetchPromise);

    const { result } = renderHook(() => useThreadActions(), {
      wrapper: wrapperFor(qc),
    });

    act(() => {
      result.current.markRead.mutate({
        threadId: "thread-a",
        isRead: true,
      });
    });

    await waitFor(() => {
      const list = qc.getQueryData<{
        pages: InboxThreadsPage[];
        pageParams: unknown[];
      }>(listKey);
      const detail = qc.getQueryData<InboxThreadDetail>(detailKey);
      expect(list?.pages[0]?.threads[0]?.unreadCount).toBe(0);
      expect(detail?.thread.unreadCount).toBe(0);
      expect(detail?.messages[0]?.isRead).toBe(true);
    });

    await act(async () => {
      resolveFetch(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
      await fetchPromise;
    });
  });
});
