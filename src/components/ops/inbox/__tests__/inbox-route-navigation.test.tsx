import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/api/query-client";
import {
  DEFAULT_INBOX_LAYOUT,
  useInboxLayoutStore,
} from "@/stores/inbox-layout-store";
import type {
  ActionResponse,
  InboxThreadDetail,
  InboxThreadRow,
} from "@/lib/hooks/use-inbox-threads";

const push = vi.fn();
const setEntityName = vi.fn();
const clearEntityName = vi.fn();
const useInboxThreadsSpy = vi.fn();
const useInboxThreadSpy = vi.fn();
const archiveMutate = vi.fn();
const unarchiveMutate = vi.fn();
const archiveBatchMutateAsync = vi.fn();
const unarchiveBatchMutate = vi.fn();
const setLeadArchivePreferenceMutateAsync = vi.fn();
const markReadMutate = vi.fn();
const clipboardWriteText = vi.fn();
const messageListSpy = vi.fn();
let detailByThreadId = new Map<string, InboxThreadDetail>();

type ArchiveMutationOptions = {
  onSuccess?: (response: ActionResponse) => void;
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push,
    prefetch: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
    dict: {},
  }),
  useLocale: () => ({ locale: "en", setLocale: vi.fn() }),
}));

vi.mock("@/stores/breadcrumb-store", () => ({
  useBreadcrumbStore: (
    selector: (state: {
      setEntityName: typeof setEntityName;
      clearEntityName: typeof clearEntityName;
    }) => unknown
  ) => selector({ setEntityName, clearEntityName }),
}));

vi.mock("@/lib/store/auth-store", () => ({
  selectUserId: (state: { userId: string }) => state.userId,
  selectCompanyId: (state: { companyId: string }) => state.companyId,
  useAuthStore: (
    selector: (state: { userId: string; companyId: string }) => unknown
  ) => selector({ userId: "user-1", companyId: "company-1" }),
}));

vi.mock("@/stores/window-store", () => ({
  useWindowStore: (
    selector: (state: {
      openWindow: () => void;
      openProjectWindow: () => void;
    }) => unknown
  ) =>
    selector({
      openWindow: vi.fn(),
      openProjectWindow: vi.fn(),
    }),
}));

vi.mock("@/lib/hooks/use-inbox-threads", () => ({
  useInboxThreads: (params: unknown) => {
    useInboxThreadsSpy(params);
    return {
    data: {
      pages: [
        {
          threads: [
            makeThreadRow("thread-a", "Alpha"),
            makeThreadRow("thread-b", "Bravo"),
          ],
          nextCursor: null,
        },
      ],
    },
    isLoading: false,
    };
  },
  useInboxThread: (threadId: string | null) => {
    useInboxThreadSpy(threadId);
    return { data: threadId ? (detailByThreadId.get(threadId) ?? null) : null };
  },
  useInboxDrafts: () => ({ data: [] }),
  useSendReply: () => ({ mutate: vi.fn(), isPending: false }),
  useThreadActions: () => ({
    archive: { mutate: archiveMutate },
    unarchive: { mutate: unarchiveMutate },
    archiveBatch: { mutateAsync: archiveBatchMutateAsync },
    unarchiveBatch: { mutate: unarchiveBatchMutate },
    setLeadArchivePreference: {
      mutateAsync: setLeadArchivePreferenceMutateAsync,
    },
    markRead: { mutate: markReadMutate },
    dismissAwaitingReply: { mutate: vi.fn() },
    restoreAwaitingReply: { mutate: vi.fn() },
  }),
  useAnswerAgentQuestion: () => ({ mutate: vi.fn() }),
  useResolveCommitment: () => ({ mutate: vi.fn() }),
  useSaveDraft: () => ({ mutate: vi.fn() }),
}));

vi.mock("@/lib/hooks/use-client-opportunities", () => ({
  useClientOpportunities: () => ({ data: [] }),
  useClientOpportunitiesWon: () => ({ data: [] }),
}));

vi.mock("@/lib/hooks/use-client-projects", () => ({
  useClientProjects: () => ({ data: [] }),
}));

vi.mock("@/lib/hooks/use-client-tasks", () => ({
  useClientTasks: () => ({ data: [] }),
}));

vi.mock("@/lib/hooks/use-client-files", () => ({
  useClientFiles: () => ({
    data: { photos: [], documents: [], threadOnlyPhotos: [] },
  }),
}));

vi.mock("@/lib/hooks/use-clients", () => ({
  useClient: () => ({ data: null }),
  useSubClients: () => ({ data: [] }),
}));

vi.mock("@/lib/hooks/use-thread-opportunity-links", () => ({
  useThreadOpportunityLinks: () => ({ data: [] }),
}));

vi.mock("@/lib/hooks/use-client-threads", () => ({
  useClientThreads: () => ({ data: [] }),
}));

vi.mock("../thread-column-header", () => ({
  ThreadColumnHeader: ({
    filter,
    defaultFilter,
    onFilterChange,
    onDefaultFilterChange,
  }: {
    filter: string;
    defaultFilter: string;
    onFilterChange: (filter: string) => void;
    onDefaultFilterChange: (filter: string) => void;
  }) => (
    <div
      data-testid="thread-column-header"
      data-filter={filter}
      data-default-filter={defaultFilter}
    >
      <button type="button" onClick={() => onFilterChange("ALL")}>
        Show all
      </button>
      <button
        type="button"
        onClick={() => onDefaultFilterChange("EVERYTHING_ELSE")}
      >
        Set Everything Else default
      </button>
    </div>
  ),
}));

vi.mock("../today-bar", () => ({
  TodayBar: () => <div data-testid="today-bar" />,
}));

vi.mock("../thread-list", () => ({
  ThreadList: ({
    selectedThreadId,
    onSelect,
    onMarkReadChange,
    onArchiveThread,
  }: {
    selectedThreadId: string | null;
    onSelect: (id: string) => void;
    onMarkReadChange?: (id: string, isRead: boolean) => void;
    onArchiveThread?: (id: string) => void;
  }) => (
    <div
      data-testid="thread-list"
      data-selected-thread-id={selectedThreadId ?? ""}
    >
      <button type="button" onClick={() => onSelect("thread-b")}>
        Open Bravo
      </button>
      <button
        type="button"
        onClick={() => onMarkReadChange?.("thread-b", false)}
      >
        Row mark unread
      </button>
      <button type="button" onClick={() => onArchiveThread?.("thread-b")}>
        Row archive
      </button>
    </div>
  ),
}));

vi.mock("../responsive-inbox-shell", () => ({
  ResponsiveInboxShell: ({
    threadId,
    mobilePane,
    threadList,
    detail,
    contextRail,
  }: {
    threadId: string;
    mobilePane?: string;
    threadList: React.ReactNode;
    detail: React.ReactNode;
    contextRail: React.ReactNode;
  }) => (
    <div
      data-testid="responsive-shell"
      data-thread-id={threadId}
      data-mobile-pane={mobilePane ?? ""}
    >
      {threadList}
      {detail}
      {contextRail}
    </div>
  ),
}));

vi.mock("../context-rail/context-rail", () => ({
  ContextRail: () => <div data-testid="context-rail" />,
}));

vi.mock("../archive-confirm-modal", () => ({
  ArchiveConfirmModal: ({
    open,
    onConfirm,
  }: {
    open: boolean;
    onConfirm: (args: {
      threadIds: string[];
      archiveOpportunityId: string | null;
      saveLeadPreference: null;
    }) => Promise<void>;
  }) =>
    open ? (
      <button
        type="button"
        onClick={() =>
          void onConfirm({
            threadIds: ["thread-a", "thread-b"],
            archiveOpportunityId: "opp-1",
            saveLeadPreference: null,
          })
        }
      >
        Confirm archive batch
      </button>
    ) : null,
}));

vi.mock("../writeback-preference-modal", () => ({
  WritebackPreferenceModal: ({
    open,
    connectionId,
    onConfirmed,
  }: {
    open: boolean;
    connectionId: string | null;
    onConfirmed: () => void;
  }) =>
    open ? (
      <button type="button" onClick={onConfirmed}>
        Save writeback {connectionId}
      </button>
    ) : null,
}));

vi.mock("../command-palette", () => ({
  CommandPalette: ({ handlers }: { handlers: { onArchive?: () => void } }) => (
    <button type="button" onClick={() => handlers.onArchive?.()}>
      Palette Archive
    </button>
  ),
}));

vi.mock("../undo-toast", () => ({
  enqueueUndoToast: vi.fn(),
}));

vi.mock("../composer/draft-switcher", () => ({
  DraftSwitcher: () => null,
}));

vi.mock("../composer/ai-draft-banner", () => ({
  AiDraftBanner: () => null,
}));

vi.mock("../snooze-picker", () => ({
  SnoozePicker: () => null,
}));

vi.mock("../recategorize-menu", () => ({
  RecategorizeMenu: () => null,
}));

vi.mock("../thread-picker", () => ({
  ThreadPicker: () => null,
}));

vi.mock("../thread-detail", () => ({
  ThreadDetail: ({
    children,
    onArchive,
    moreSlot,
  }: {
    children?: React.ReactNode;
    onArchive?: () => void;
    moreSlot?: (button: React.ReactNode) => React.ReactNode;
  }) => (
    <div data-testid="thread-detail">
      <button type="button" aria-label="Archive thread" onClick={onArchive}>
        Archive
      </button>
      {moreSlot ? (
        moreSlot(
          <button type="button" aria-label="More actions">
            More
          </button>
        )
      ) : (
        <button type="button" aria-label="More actions">
          More
        </button>
      )}
      {children}
    </div>
  ),
}));

vi.mock("../commitment-pills", () => ({
  CommitmentPills: () => null,
}));

vi.mock("../detail-band", () => ({
  DetailBand: () => null,
}));

vi.mock("../message-list", () => ({
  MessageList: (props: { className?: string }) => {
    messageListSpy(props);
    return <div data-testid="message-list" className={props.className} />;
  },
}));

vi.mock("../composer/composer", () => ({
  Composer: () => null,
}));

vi.mock("../context-rail/work-view", () => ({
  WorkView: () => null,
}));

vi.mock("../context-rail/accounting-view", () => ({
  AccountingView: () => null,
}));

vi.mock("../context-rail/files-view-v3", () => ({
  FilesViewV3: () => null,
}));

vi.mock("../category-chip", () => ({
  categoryDotClassName: () => "",
  categoryLabel: () => "general",
}));

import { InboxRoute } from "../inbox-route";

function makeThreadRow(id: string, clientName: string): InboxThreadRow {
  return {
    id,
    providerThreadId: `provider-${id}`,
    connectionId: `connection-${id}`,
    primaryCategory: "CUSTOMER",
    categoryConfidence: 0.93,
    categoryManuallySet: false,
    labels: [],
    archivedAt: null,
    snoozedUntil: null,
    priorityScore: 0,
    clientName,
    clientId: null,
    latestSenderName: clientName,
    latestSenderEmail: `${id}@example.com`,
    subject: `${clientName} subject`,
    participants: [`${id}@example.com`],
    firstMessageAt: "2026-05-06T15:00:00Z",
    lastMessageAt: "2026-05-06T15:00:00Z",
    messageCount: 1,
    unreadCount: 0,
    latestDirection: "inbound",
    latestSnippet: `${clientName} snippet`,
    opportunityId: null,
    aiSummary: null,
    phaseC: "none",
    agentBlockingQuestion: null,
    hasUnresolvedCommitments: false,
    nextCommitmentDueAt: null,
    nextCommitmentId: null,
  };
}

function makeThreadDetail(id: string): InboxThreadDetail {
  return {
    thread: {
      id,
      primaryCategory: "CUSTOMER",
      categoryConfidence: 0.93,
      categoryManuallySet: false,
      labels: ["AWAITING_REPLY"],
      archivedAt: null,
      snoozedUntil: null,
      aiSummary: null,
      subject: `${id} subject`,
      participants: ["client@example.com"],
      messageCount: 1,
      unreadCount: 1,
      opportunityId: null,
      clientId: null,
      clientName: "Alpha",
      latestDirection: "inbound",
      phaseC: "none",
      agentBlockingQuestion: null,
    },
    messages: [
      {
        id: `msg-${id}`,
        from: "client@example.com",
        fromName: "Client",
        to: ["ops@example.com"],
        cc: [],
        subject: `${id} subject`,
        snippet: "Need a number.",
        bodyText: "Need a number.",
        cleanBodyText: "Need a number.",
        direction: "inbound",
        date: "2026-05-06T15:00:00Z",
        isRead: false,
        hasAttachments: false,
      },
    ],
    siblingThreads: [],
    commitments: [],
  };
}

function renderRoute(threadId?: string) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
  const utils = render(
    <QueryClientProvider client={qc}>
      <InboxRoute threadId={threadId} />
    </QueryClientProvider>
  );
  return { ...utils, invalidateSpy, queryClient: qc };
}

beforeEach(() => {
  push.mockReset();
  setEntityName.mockReset();
  clearEntityName.mockReset();
  useInboxThreadsSpy.mockReset();
  useInboxThreadSpy.mockReset();
  archiveMutate.mockReset();
  unarchiveMutate.mockReset();
  archiveBatchMutateAsync.mockReset();
  unarchiveBatchMutate.mockReset();
  setLeadArchivePreferenceMutateAsync.mockReset();
  markReadMutate.mockReset();
  clipboardWriteText.mockReset();
  messageListSpy.mockReset();
  clipboardWriteText.mockResolvedValue(undefined);
  if (window.navigator.clipboard) {
    vi.spyOn(window.navigator.clipboard, "writeText").mockImplementation(
      clipboardWriteText
    );
  } else {
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: clipboardWriteText,
      },
    });
  }
  detailByThreadId = new Map();
  useInboxLayoutStore.setState({ ...DEFAULT_INBOX_LAYOUT });
  window.history.replaceState(null, "", "/inbox");
});

describe("<InboxRoute> thread navigation", () => {
  it("defaults to the starred inbox rail from the inbox layout preference store", () => {
    useInboxLayoutStore.setState({
      ...DEFAULT_INBOX_LAYOUT,
      defaultRailFilter: "EVERYTHING_ELSE",
    });

    renderRoute();

    expect(screen.getByTestId("thread-column-header")).toHaveAttribute(
      "data-filter",
      "EVERYTHING_ELSE",
    );
    expect(useInboxThreadsSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ filter: "EVERYTHING_ELSE" }),
    );
  });

  it("persists the starred inbox rail through the existing inbox preference store", async () => {
    const user = userEvent.setup();
    renderRoute();

    await user.click(
      screen.getByRole("button", { name: "Set Everything Else default" }),
    );

    expect(useInboxLayoutStore.getState().defaultRailFilter).toBe(
      "EVERYTHING_ELSE",
    );
    expect(screen.getByTestId("thread-column-header")).toHaveAttribute(
      "data-default-filter",
      "EVERYTHING_ELSE",
    );
  });

  it("selects a thread in place and writes the deep-link URL without router.push", async () => {
    const user = userEvent.setup();
    renderRoute();

    await user.click(screen.getByRole("button", { name: "Open Bravo" }));

    expect(push).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/inbox/thread-b");
    expect(screen.getByTestId("responsive-shell")).toHaveAttribute(
      "data-thread-id",
      "thread-b"
    );
    expect(screen.getByTestId("responsive-shell")).toHaveAttribute(
      "data-mobile-pane",
      "detail"
    );
    expect(useInboxThreadSpy).toHaveBeenLastCalledWith("thread-b");
  });

  it("re-syncs selected thread state from popstate", () => {
    window.history.replaceState(null, "", "/inbox/thread-a");
    renderRoute("thread-a");

    act(() => {
      window.history.pushState(null, "", "/inbox/thread-b");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    expect(screen.getByTestId("responsive-shell")).toHaveAttribute(
      "data-thread-id",
      "thread-b"
    );
    expect(useInboxThreadSpy).toHaveBeenLastCalledWith("thread-b");
  });

  it("header Archive invokes the real archive mutation path for the selected thread", async () => {
    const user = userEvent.setup();
    detailByThreadId.set("thread-a", makeThreadDetail("thread-a"));
    renderRoute("thread-a");

    await user.click(screen.getByRole("button", { name: "Archive thread" }));

    expect(archiveMutate).toHaveBeenCalledTimes(1);
    expect(archiveMutate.mock.calls[0][0]).toBe("thread-a");
    expect(archiveMutate.mock.calls[0][1]).toMatchObject({
      onSuccess: expect.any(Function),
    });
  });

  it("pads the message list beyond the measured floating composer height", () => {
    detailByThreadId.set("thread-a", makeThreadDetail("thread-a"));
    renderRoute("thread-a");

    expect(messageListSpy).toHaveBeenCalled();
    const lastCall = messageListSpy.mock.calls[messageListSpy.mock.calls.length - 1];
    expect(lastCall?.[0].className).toContain(
      "pb-[calc(var(--inbox-floating-composer-height)_+_24px)]"
    );
  });

  it("thread row quick mark read/unread uses the real mutation path", async () => {
    const user = userEvent.setup();
    renderRoute();

    await user.click(screen.getByRole("button", { name: "Row mark unread" }));

    expect(markReadMutate).toHaveBeenCalledWith(
      { threadId: "thread-b", isRead: false },
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      }),
    );
  });

  it("thread row quick archive uses the real archive flow for that row", async () => {
    const user = userEvent.setup();
    renderRoute();

    await user.click(screen.getByRole("button", { name: "Row archive" }));

    expect(archiveMutate).toHaveBeenCalledTimes(1);
    expect(archiveMutate.mock.calls[0][0]).toBe("thread-b");
    expect(archiveMutate.mock.calls[0][1]).toMatchObject({
      onSuccess: expect.any(Function),
    });
  });

  it("moves selected-thread state after archiving out of an active rail", async () => {
    const user = userEvent.setup();
    detailByThreadId.set("thread-a", makeThreadDetail("thread-a"));
    archiveMutate.mockImplementation(
      (_threadId: string, options?: ArchiveMutationOptions) => {
        options?.onSuccess?.({ ok: true });
      }
    );
    renderRoute("thread-a");

    await user.click(screen.getByRole("button", { name: "Archive thread" }));

    await waitFor(() => {
      expect(screen.getByTestId("responsive-shell")).toHaveAttribute(
        "data-thread-id",
        "thread-b"
      );
    });
    expect(window.location.pathname).toBe("/inbox/thread-b");
  });

  it("resumes the same archive path after the first-archive writeback prompt", async () => {
    const user = userEvent.setup();
    detailByThreadId.set("thread-a", makeThreadDetail("thread-a"));
    archiveMutate.mockImplementation(
      (_threadId: string, options?: ArchiveMutationOptions) => {
        if (archiveMutate.mock.calls.length === 1) {
          options?.onSuccess?.({
            needsPreference: true,
            connectionId: "conn-1",
          });
          return;
        }
        options?.onSuccess?.({ ok: true });
      }
    );
    renderRoute("thread-a");

    await user.click(screen.getByRole("button", { name: "Archive thread" }));
    await user.click(
      screen.getByRole("button", { name: "Save writeback conn-1" })
    );

    expect(archiveMutate).toHaveBeenCalledTimes(2);
    expect(archiveMutate.mock.calls[0][0]).toBe("thread-a");
    expect(archiveMutate.mock.calls[1][0]).toBe("thread-a");
  });

  it("linked-opportunity confirmation commits through batch archive and updates selection", async () => {
    const user = userEvent.setup();
    const detail = makeThreadDetail("thread-a");
    detail.thread.opportunityId = "opp-1";
    detailByThreadId.set("thread-a", detail);
    archiveMutate.mockImplementation(
      (_threadId: string, options?: ArchiveMutationOptions) => {
        options?.onSuccess?.({
          needsConfirmation: true,
          connectionId: "conn-1",
          leadPreference: "ask",
          linkedOpportunity: { id: "opp-1", title: "Alpha lead" },
          siblingThreads: [
            {
              id: "thread-b",
              subject: "Sibling",
              lastMessageAt: "2026-05-06T15:00:00Z",
              latestSenderName: "Bravo",
              latestSenderEmail: "bravo@example.com",
              latestSnippet: "Follow up",
            },
          ],
        });
      }
    );
    archiveBatchMutateAsync.mockResolvedValue({
      ok: true,
      archivedThreadIds: ["thread-a", "thread-b"],
      failedThreadIds: [],
      leadArchivedOpportunityId: "opp-1",
    });
    renderRoute("thread-a");

    await user.click(screen.getByRole("button", { name: "Archive thread" }));
    await user.click(
      screen.getByRole("button", { name: "Confirm archive batch" })
    );

    expect(archiveBatchMutateAsync).toHaveBeenCalledWith({
      threadIds: ["thread-a", "thread-b"],
      archiveOpportunityId: "opp-1",
    });
    await waitFor(() => {
      expect(screen.getByTestId("responsive-shell")).toHaveAttribute(
        "data-thread-id",
        ""
      );
    });
    expect(window.location.pathname).toBe("/inbox");
  });

  it("command palette Archive uses the same selected-thread archive path", async () => {
    const user = userEvent.setup();
    detailByThreadId.set("thread-a", makeThreadDetail("thread-a"));
    renderRoute("thread-a");

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true })
      );
    });
    await user.click(screen.getByRole("button", { name: "Palette Archive" }));

    expect(archiveMutate).toHaveBeenCalledTimes(1);
    expect(archiveMutate.mock.calls[0][0]).toBe("thread-a");
  });

  it("quietly marks an unread thread read when opened", async () => {
    detailByThreadId.set("thread-a", makeThreadDetail("thread-a"));
    renderRoute("thread-a");

    await waitFor(() => {
      expect(markReadMutate).toHaveBeenCalledWith({
        threadId: "thread-a",
        isRead: true,
      });
    });
  });

  it("detail More actions call the real selected-thread handlers", async () => {
    const user = userEvent.setup();
    detailByThreadId.set("thread-a", makeThreadDetail("thread-a"));
    const { invalidateSpy } = renderRoute("thread-a");

    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "MARK READ" }));

    expect(markReadMutate).toHaveBeenCalledWith(
      { threadId: "thread-a", isRead: true },
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      })
    );

    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(
      await screen.findByRole("menuitem", { name: "COPY THREAD LINK" })
    );

    await waitFor(() => {
      expect(clipboardWriteText).toHaveBeenCalledWith(
        `${window.location.origin}/inbox/thread-a`
      );
    });

    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(
      await screen.findByRole("menuitem", { name: "REFRESH THREAD" })
    );

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.inbox.threadDetail("thread-a"),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.inbox.threadsAll(),
    });
  });

  it("detail More switches to mark unread when the thread is already read", async () => {
    const user = userEvent.setup();
    const detail = makeThreadDetail("thread-a");
    detail.thread.unreadCount = 0;
    detail.messages = detail.messages.map((message) => ({
      ...message,
      isRead: true,
    }));
    detailByThreadId.set("thread-a", detail);
    renderRoute("thread-a");

    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "MARK UNREAD" }));

    expect(markReadMutate).toHaveBeenCalledWith(
      { threadId: "thread-a", isRead: false },
      expect.any(Object)
    );
  });
});
