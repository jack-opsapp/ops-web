/**
 * Agent Queue page — the rebuilt review surface.
 *
 * Covers the four states the operator can land in (loading is trivial), the
 * needs-you / history switch, and the type filter derived from the loaded
 * rows. The action card, reject dialog, and hooks are stubbed: this asserts
 * the page's own composition, not theirs.
 */

import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentAction,
  AgentActionStatus,
  AgentActionType,
} from "@/lib/types/approval-queue";

const useApprovalQueue = vi.fn();
const mutate = vi.fn();

vi.mock("@/lib/hooks", () => ({
  useApprovalQueue: (f: unknown) => useApprovalQueue(f),
  useApproveAction: () => ({ mutate, isPending: false }),
  useRejectAction: () => ({ mutate, isPending: false }),
  useBulkApprove: () => ({ mutate, isPending: false }),
  useBulkReject: () => ({ mutate, isPending: false }),
}));
vi.mock("@/lib/hooks/use-users", () => ({
  useTeamMembers: () => ({ data: { users: [] } }),
}));
vi.mock("@/lib/hooks/use-page-title", () => ({ usePageTitle: () => {} }));
// `t` echoes the key so assertions read as keys — except the interpolated
// batch strings, which return their real en templates so the page's
// interpolation is genuinely exercised rather than stubbed away.
vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (k: string) =>
      ({
        "batch.selectedCount": "{{count}} selected",
        "batch.approveCount": "Approve {{count}}",
        "batch.rejectCount": "Reject {{count}}",
      })[k] ?? k,
  }),
  useLocale: () => ({ locale: "en" }),
}));
vi.mock("@/components/ui/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/components/agent/action-card", () => ({
  ActionCard: ({ action }: { action: AgentAction }) => (
    <div data-testid="card">{action.actionType}</div>
  ),
}));
vi.mock("@/components/agent/reject-dialog", () => ({ RejectDialog: () => null }));
vi.mock("framer-motion", async () => {
  const actual = await vi.importActual<typeof import("framer-motion")>(
    "framer-motion"
  );
  return {
    ...actual,
    useReducedMotion: () => true,
    AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
  };
});

import AgentQueuePage from "../page";

function action(
  id: string,
  actionType: AgentActionType,
  status: AgentActionStatus = "pending"
): AgentAction {
  return {
    id,
    companyId: "co-1",
    userId: "u-1",
    actionType,
    actionData: {},
    contextSummary: "summary",
    contextSource: null,
    sourceId: null,
    confidence: 0.8,
    priority: "normal",
    status,
    reviewedBy: null,
    reviewedAt: null,
    reviewNotes: null,
    executedAt: null,
    executionResult: null,
    error: null,
    expiresAt: null,
    autoExecuteAt: null,
    createdAt: new Date("2026-09-01T00:00:00Z"),
    updatedAt: new Date("2026-09-01T00:00:00Z"),
  };
}

function queueResult(over: Partial<ReturnType<typeof baseResult>> = {}) {
  return { ...baseResult(), ...over };
}

function baseResult() {
  return {
    data: [] as AgentAction[],
    isPending: false,
    isError: false,
    error: null as Error | null,
    refetch: vi.fn(),
  };
}

describe("AgentQueuePage", () => {
  beforeEach(() => {
    useApprovalQueue.mockReset();
    mutate.mockReset();
  });

  it("renders the error state with retry when the query fails", () => {
    const refetch = vi.fn();
    useApprovalQueue.mockReturnValue(
      queueResult({
        data: undefined,
        isError: true,
        error: new Error("Permission required: agent.review"),
        refetch,
      })
    );

    render(<AgentQueuePage />);

    expect(screen.getByText("error.title")).toBeInTheDocument();
    expect(screen.getByText(/Permission required/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "error.retry" }));
    expect(refetch).toHaveBeenCalled();
    expect(screen.queryByText("empty.pendingNoun")).toBeNull();
  });

  it("renders the pending empty state", () => {
    useApprovalQueue.mockReturnValue(queueResult());
    render(<AgentQueuePage />);
    expect(screen.getByText("empty.pendingNoun")).toBeInTheDocument();
    expect(screen.getByText("empty.pendingHint")).toBeInTheDocument();
  });

  it("shows the skeleton, not the empty state, while the query is disabled or pending", () => {
    useApprovalQueue.mockReturnValue(
      queueResult({ data: undefined, isPending: true })
    );
    const { container } = render(<AgentQueuePage />);
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(3);
    expect(screen.queryByText("empty.pendingNoun")).toBeNull();
  });

  it("derives type chips from loaded rows and filters locally", () => {
    useApprovalQueue.mockReturnValue(
      queueResult({
        data: [
          action("1", "reassign_task"),
          action("2", "reassign_task"),
          action("3", "close_project"),
        ],
      })
    );

    render(<AgentQueuePage />);
    expect(screen.getAllByTestId("card")).toHaveLength(3);

    fireEvent.click(screen.getByRole("button", { name: /type\.close_project/ }));
    expect(screen.getAllByTestId("card")).toHaveLength(1);
  });

  it("hides type chips when only one type is present", () => {
    useApprovalQueue.mockReturnValue(
      queueResult({ data: [action("1", "reassign_task")] })
    );
    render(<AgentQueuePage />);
    expect(
      screen.queryByRole("button", { name: /filter\.allTypes/ })
    ).toBeNull();
  });

  it("switches to history statuses", () => {
    useApprovalQueue.mockReturnValue(queueResult());
    render(<AgentQueuePage />);

    fireEvent.click(screen.getByText("segment.history"));

    const last = useApprovalQueue.mock.calls.at(-1)?.[0] as {
      statuses?: string[];
    };
    expect(last.statuses).toEqual([
      "approved",
      "rejected",
      "executed",
      "failed",
      "expired",
      "cancelled",
    ]);
    expect(screen.getByText("empty.historyNoun")).toBeInTheDocument();
  });

  it("shows the batch bar once rows are selected", () => {
    useApprovalQueue.mockReturnValue(
      queueResult({
        data: [action("1", "reassign_task"), action("2", "close_project")],
      })
    );

    render(<AgentQueuePage />);
    expect(screen.queryByText("batch.clear")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /filter\.allTypes/ }));
    // Select every bulk-eligible row from the workbar toggle.
    fireEvent.click(screen.getByRole("button", { name: /select/i }));

    expect(screen.getByText("2 selected")).toBeInTheDocument();
    expect(screen.getByText("Approve 2")).toBeInTheDocument();
    expect(screen.getByText("Reject 2")).toBeInTheDocument();
    expect(screen.getByText("batch.clear")).toBeInTheDocument();
  });
});
