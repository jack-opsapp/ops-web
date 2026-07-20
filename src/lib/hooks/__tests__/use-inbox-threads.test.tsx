import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/api/query-client";
import {
  useThreadActions,
  useResolveCommitment,
  useSendReply,
  type InboxThreadDetail,
  type InboxThreadRow,
  type InboxThreadsPage,
} from "../use-inbox-threads";
import { classifyThreadState } from "@/lib/inbox/rail-predicates";

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

function makeThreadRow(
  overrides: Partial<InboxThreadRow> = {}
): InboxThreadRow {
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
    opportunityNeedsReply: null,
    clientId: "client-1",
    clientName: "Goodway Homes",
    nextCommitmentDueAt: null,
    hasUnresolvedCommitments: false,
    nextCommitmentId: null,
    phaseC: "none",
    agentBlockingQuestion: null,
    routing: null,
    routingReasons: null,
    routerConfidence: null,
    ...overrides,
  };
}

function makeThreadDetail(
  overrides: Partial<InboxThreadDetail["thread"]> = {},
  detailOverrides: Partial<Omit<InboxThreadDetail, "thread">> = {}
): InboxThreadDetail {
  return {
    thread: {
      id: "thread-a",
      connectionId: "conn-1",
      providerThreadId: "provider-thread-a",
      pipelineScope: "all",
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
      opportunityNeedsReply: null,
      clientId: "client-1",
      clientName: "Goodway Homes",
      latestDirection: "inbound",
      phaseC: "none",
      agentBlockingQuestion: null,
      routing: null,
      routingReasons: null,
      routerConfidence: null,
      ...overrides,
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
    ...detailOverrides,
    linkedOpportunity: detailOverrides.linkedOpportunity ?? null,
    clientContext: detailOverrides.clientContext ?? null,
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
        })
      );
      await fetchPromise;
    });
  });
});

describe("useResolveCommitment", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("optimistically removes the resolved obligation and moves the queued obligation into the visible cap", async () => {
    const qc = makeQueryClient();
    const listKey = queryKeys.inbox.threads({
      scope: "own",
      filter: "CLIENTS",
      category: null,
      search: null,
      limit: null,
    });
    const detailKey = queryKeys.inbox.threadDetail("thread-1");
    const makeCommittedRow = (index: number) =>
      makeThreadRow({
        id: `thread-${index}`,
        labels: [],
        unreadCount: 0,
        latestDirection: "outbound",
        hasUnresolvedCommitments: true,
        nextCommitmentId: `commit-${index}`,
        nextCommitmentDueAt: `2026-05-1${index}T15:00:00Z`,
      });
    qc.setQueryData<{
      pages: InboxThreadsPage[];
      pageParams: unknown[];
    }>(listKey, {
      pages: [
        {
          threads: [1, 2, 3, 4].map(makeCommittedRow),
          nextCursor: null,
        },
      ],
      pageParams: [null],
    });
    qc.setQueryData(
      detailKey,
      makeThreadDetail(
        { id: "thread-1" },
        {
          commitments: [
            {
              id: "commit-1",
              content: "Send revised quote",
              dueDate: "2026-05-11T15:00:00Z",
              confidence: 0.9,
              createdAt: "2026-05-10T15:00:00Z",
            },
          ],
        }
      )
    );

    let resolveFetch!: (response: Response) => void;
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    vi.spyOn(globalThis, "fetch").mockReturnValue(fetchPromise);

    const { result } = renderHook(() => useResolveCommitment(), {
      wrapper: wrapperFor(qc),
    });

    const visibleCommitments = () => {
      const list = qc.getQueryData<{
        pages: InboxThreadsPage[];
        pageParams: unknown[];
      }>(listKey);
      return (
        list?.pages
          .flatMap((page) => page.threads)
          .filter(
            (thread) =>
              thread.hasUnresolvedCommitments && thread.nextCommitmentId
          )
          .map((thread) => thread.nextCommitmentId)
          .slice(0, 3) ?? []
      );
    };

    expect(visibleCommitments()).toEqual(["commit-1", "commit-2", "commit-3"]);

    act(() => {
      result.current.mutate({
        id: "commit-1",
        resolvedAt: "2026-05-14T16:00:00Z",
        threadId: "thread-1",
      });
    });

    await waitFor(() => {
      expect(visibleCommitments()).toEqual([
        "commit-2",
        "commit-3",
        "commit-4",
      ]);
      const detail = qc.getQueryData<InboxThreadDetail>(detailKey);
      expect(detail?.commitments).toEqual([]);
    });

    await act(async () => {
      resolveFetch(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
      await fetchPromise;
    });
  });

  it("rolls back the obligation row when resolve fails", async () => {
    const qc = makeQueryClient();
    const listKey = queryKeys.inbox.threads({
      scope: "own",
      filter: "CLIENTS",
      category: null,
      search: null,
      limit: null,
    });
    const detailKey = queryKeys.inbox.threadDetail("thread-a");
    qc.setQueryData<{
      pages: InboxThreadsPage[];
      pageParams: unknown[];
    }>(listKey, {
      pages: [
        {
          threads: [
            makeThreadRow({
              id: "thread-a",
              labels: [],
              unreadCount: 0,
              latestDirection: "outbound",
              hasUnresolvedCommitments: true,
              nextCommitmentId: "commit-a",
              nextCommitmentDueAt: "2026-05-14T15:00:00Z",
            }),
          ],
          nextCursor: null,
        },
      ],
      pageParams: [null],
    });
    qc.setQueryData(
      detailKey,
      makeThreadDetail(
        { id: "thread-a" },
        {
          commitments: [
            {
              id: "commit-a",
              content: "Confirm install date",
              dueDate: "2026-05-14T15:00:00Z",
              confidence: 0.9,
              createdAt: "2026-05-13T15:00:00Z",
            },
          ],
        }
      )
    );
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Update failed" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      })
    );

    const { result } = renderHook(() => useResolveCommitment(), {
      wrapper: wrapperFor(qc),
    });

    act(() => {
      result.current.mutate({
        id: "commit-a",
        resolvedAt: "2026-05-14T16:00:00Z",
        threadId: "thread-a",
      });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    const list = qc.getQueryData<{
      pages: InboxThreadsPage[];
      pageParams: unknown[];
    }>(listKey);
    const row = list?.pages[0]?.threads[0];
    expect(row?.hasUnresolvedCommitments).toBe(true);
    expect(row?.nextCommitmentId).toBe("commit-a");
    expect(row?.nextCommitmentDueAt).toBe("2026-05-14T15:00:00Z");
    const detail = qc.getQueryData<InboxThreadDetail>(detailKey);
    expect(detail?.commitments.map((commitment) => commitment.id)).toEqual([
      "commit-a",
    ]);
  });
});

describe("useSendReply", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps a reply-debt thread in CLIENTS after outbound send while clearing reply debt", async () => {
    const qc = makeQueryClient();
    const listKey = queryKeys.inbox.threads({
      scope: "own",
      filter: "CLIENTS",
      category: null,
      search: null,
      limit: null,
    });
    const detailKey = queryKeys.inbox.threadDetail("thread-a");
    qc.setQueryData<{
      pages: InboxThreadsPage[];
      pageParams: unknown[];
    }>(listKey, {
      pages: [
        {
          threads: [
            makeThreadRow({
              labels: ["AWAITING_REPLY"],
              unreadCount: 1,
              latestDirection: "inbound",
              hasUnresolvedCommitments: false,
              nextCommitmentId: null,
              nextCommitmentDueAt: null,
            }),
          ],
          nextCursor: null,
        },
      ],
      pageParams: [null],
    });
    qc.setQueryData(detailKey, makeThreadDetail({ unreadCount: 1 }));
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          messageId: "sent-message-1",
          threadId: "provider-thread-a",
          sentAt: "2026-05-14T16:00:00Z",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      )
    );

    const { result } = renderHook(() => useSendReply(), {
      wrapper: wrapperFor(qc),
    });

    await act(async () => {
      await result.current.mutateAsync({
        payload: {
          idempotencyKey: "attempt-1",
          threadId: "thread-a",
          to: ["client@example.com"],
          subject: "Re: Quote follow-up",
          body: "I sent the revised number.",
        },
      });
    });

    const list = qc.getQueryData<{
      pages: InboxThreadsPage[];
      pageParams: unknown[];
    }>(listKey);
    expect(list?.pages[0]?.threads).toHaveLength(1);
    expect(list?.pages[0]?.threads[0]?.labels).not.toContain("AWAITING_REPLY");
    expect(list?.pages[0]?.threads[0]?.primaryCategory).toBe("CUSTOMER");
    expect(list?.pages[0]?.threads[0]?.clientId).toBe("client-1");

    const detail = qc.getQueryData<InboxThreadDetail>(detailKey);
    expect(detail?.thread.labels).not.toContain("AWAITING_REPLY");
    expect(detail?.thread.latestDirection).toBe("outbound");
    expect(detail?.thread.unreadCount).toBe(1);
    expect(
      classifyThreadState(
        {
          archived_at: detail?.thread.archivedAt ?? null,
          snoozed_until: detail?.thread.snoozedUntil ?? null,
          has_unresolved_commitments: false,
          labels: detail?.thread.labels ?? [],
          latest_direction: detail?.thread.latestDirection ?? null,
          unread_count: detail?.thread.unreadCount ?? 0,
          agent_blocking_question: detail?.thread.agentBlockingQuestion ?? null,
        },
        new Date("2026-05-14T16:00:01Z").getTime()
      )
    ).toBe("WAITING");
  });

  it("surfaces the signature setup instruction when delivery is blocked", async () => {
    const qc = makeQueryClient();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "EMAIL_SIGNATURE_REQUIRED",
          message: "Add your email signature in Settings before sending.",
        }),
        {
          status: 409,
          headers: { "Content-Type": "application/json" },
        }
      )
    );

    const { result } = renderHook(() => useSendReply(), {
      wrapper: wrapperFor(qc),
    });
    let rejection: unknown;

    await act(async () => {
      try {
        await result.current.mutateAsync({
          payload: {
            idempotencyKey: "attempt-signature",
            threadId: "thread-a",
            to: ["client@example.com"],
            subject: "Re: Quote",
            body: "Here is the update.",
          },
        });
      } catch (error) {
        rejection = error;
      }
    });

    expect(rejection).toEqual(
      new Error("Add your email signature in Settings before sending.")
    );
  });
});
