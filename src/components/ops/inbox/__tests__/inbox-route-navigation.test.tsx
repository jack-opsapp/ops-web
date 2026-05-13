import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const setEntityName = vi.fn();
const clearEntityName = vi.fn();
const useInboxThreadSpy = vi.fn();

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

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
    dict: {},
  }),
  useLocale: () => ({ locale: "en", setLocale: vi.fn() }),
}));

vi.mock("@/stores/breadcrumb-store", () => ({
  useBreadcrumbStore: (selector: (state: {
    setEntityName: typeof setEntityName;
    clearEntityName: typeof clearEntityName;
  }) => unknown) => selector({ setEntityName, clearEntityName }),
}));

vi.mock("@/lib/store/auth-store", () => ({
  selectUserId: (state: { userId: string }) => state.userId,
  selectCompanyId: (state: { companyId: string }) => state.companyId,
  useAuthStore: (selector: (state: { userId: string; companyId: string }) => unknown) =>
    selector({ userId: "user-1", companyId: "company-1" }),
}));

vi.mock("@/stores/window-store", () => ({
  useWindowStore: (selector: (state: {
    openWindow: () => void;
    openProjectWindow: () => void;
  }) => unknown) =>
    selector({
      openWindow: vi.fn(),
      openProjectWindow: vi.fn(),
    }),
}));

vi.mock("@/lib/hooks/use-inbox-threads", () => ({
  useInboxThreads: () => ({
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
  }),
  useInboxThread: (threadId: string | null) => {
    useInboxThreadSpy(threadId);
    return { data: null };
  },
  useInboxDrafts: () => ({ data: [] }),
  useSendReply: () => ({ mutate: vi.fn(), isPending: false }),
  useThreadActions: () => ({
    archive: { mutate: vi.fn() },
    unarchive: { mutate: vi.fn() },
    archiveBatch: { mutateAsync: vi.fn() },
    unarchiveBatch: { mutate: vi.fn() },
    setLeadArchivePreference: { mutateAsync: vi.fn() },
    dismissAwaitingReply: { mutate: vi.fn() },
    restoreAwaitingReply: { mutate: vi.fn() },
  }),
  useAnswerAgentQuestion: () => ({ mutate: vi.fn() }),
  useResolveCommitment: () => ({ mutate: vi.fn() }),
  useSaveDraft: () => ({ mutate: vi.fn() }),
}));

vi.mock("@/lib/hooks/use-client-opportunities", () => ({
  useClientOpportunities: () => ({ data: [] }),
}));

vi.mock("@/lib/hooks/use-client-projects", () => ({
  useClientProjects: () => ({ data: [] }),
}));

vi.mock("@/lib/hooks/use-client-tasks", () => ({
  useClientTasks: () => ({ data: [] }),
}));

vi.mock("@/lib/hooks/use-client-files", () => ({
  useClientFiles: () => ({ data: { photos: [], documents: [], threadOnlyPhotos: [] } }),
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
  ThreadColumnHeader: () => <div data-testid="thread-column-header" />,
}));

vi.mock("../today-bar", () => ({
  TodayBar: () => <div data-testid="today-bar" />,
}));

vi.mock("../thread-list", () => ({
  ThreadList: ({
    selectedThreadId,
    onSelect,
  }: {
    selectedThreadId: string | null;
    onSelect: (id: string) => void;
  }) => (
    <div data-testid="thread-list" data-selected-thread-id={selectedThreadId ?? ""}>
      <button type="button" onClick={() => onSelect("thread-b")}>
        Open Bravo
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
  ArchiveConfirmModal: () => null,
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
  ThreadDetail: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="thread-detail">{children}</div>
  ),
}));

vi.mock("../commitment-pills", () => ({
  CommitmentPills: () => null,
}));

vi.mock("../detail-band", () => ({
  DetailBand: () => null,
}));

vi.mock("../message-list", () => ({
  MessageList: () => null,
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

function makeThreadRow(id: string, clientName: string) {
  return {
    id,
    providerThreadId: `provider-${id}`,
    connectionId: `connection-${id}`,
    clientName,
    latestSenderName: clientName,
    subject: `${clientName} subject`,
    latestSnippet: `${clientName} snippet`,
    aiSummary: null,
    labels: [],
    agentBlockingQuestion: null,
    phaseC: "none",
    archivedAt: null,
    lastMessageAt: "2026-05-06T15:00:00Z",
    latestDirection: "inbound",
    unreadCount: 0,
    messageCount: 1,
    hasUnresolvedCommitments: false,
    nextCommitmentDueAt: null,
    nextCommitmentId: null,
    primaryCategory: "general",
  };
}

function renderRoute(threadId?: string) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <InboxRoute threadId={threadId} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  push.mockReset();
  setEntityName.mockReset();
  clearEntityName.mockReset();
  useInboxThreadSpy.mockReset();
  window.history.replaceState(null, "", "/inbox");
});

describe("<InboxRoute> thread navigation", () => {
  it("selects a thread in place and writes the deep-link URL without router.push", async () => {
    const user = userEvent.setup();
    renderRoute();

    await user.click(screen.getByRole("button", { name: "Open Bravo" }));

    expect(push).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/inbox/thread-b");
    expect(screen.getByTestId("responsive-shell")).toHaveAttribute(
      "data-thread-id",
      "thread-b",
    );
    expect(screen.getByTestId("responsive-shell")).toHaveAttribute(
      "data-mobile-pane",
      "detail",
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
      "thread-b",
    );
    expect(useInboxThreadSpy).toHaveBeenLastCalledWith("thread-b");
  });
});
