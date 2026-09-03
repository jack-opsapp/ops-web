/**
 * Agent Queue page — the register surface.
 *
 * Covers the states an operator can land in (loading / error / empty), the
 * needs-you ⇄ history switch, and the three things the table added: derived
 * filters, search, sorting, and click-to-expand. The real `RegisterTable`
 * renders here on purpose — the column config IS the page's design, so a test
 * that mocked the table would assert nothing. Only the heavy per-type detail
 * is stubbed.
 */

import type { ReactNode } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentAction,
  AgentActionPriority,
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
// `t` echoes the key, except the interpolated strings, which return their real
// en templates so the page's interpolation is genuinely exercised.
vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (k: string) =>
      ({
        "batch.selectedCount": "{{count}} selected",
        "batch.approveCount": "Approve {{count}}",
        "batch.rejectCount": "Reject {{count}}",
        "count.rows": "{{count}} rows",
        "count.rowsOne": "1 row",
      })[k] ?? k,
  }),
  useLocale: () => ({ locale: "en" }),
}));
vi.mock("@/components/ui/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/components/agent/action-detail", () => ({
  ActionDetail: ({ action }: { action: AgentAction }) => (
    <div data-testid="detail">detail:{action.id}</div>
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
  over: Partial<AgentAction> = {}
): AgentAction {
  return {
    id,
    companyId: "co-1",
    userId: "u-1",
    actionType: "reassign_task" as AgentActionType,
    actionData: {},
    contextSummary: `summary ${id}`,
    contextSource: null,
    sourceId: null,
    confidence: 0.8,
    priority: "normal" as AgentActionPriority,
    status: "pending" as AgentActionStatus,
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
    ...over,
  } as AgentAction;
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
function queueResult(over: Partial<ReturnType<typeof baseResult>> = {}) {
  return { ...baseResult(), ...over };
}

/** Row order by the summary cell, ignoring the header row. */
function rowOrder(): string[] {
  return screen
    .getAllByRole("row")
    .slice(1)
    .map((r) => r.textContent ?? "")
    .filter((txt) => txt.includes("summary"))
    .map((txt) => (txt.match(/summary [a-z0-9]+/) ?? [""])[0]);
}

/**
 * Open a picker trigger. Radix popovers listen for pointer events, not a
 * synthetic `click`, so `fireEvent.click` renders nothing and the assertion
 * that follows fails on the portal, not the trigger.
 */
function openPicker(trigger: HTMLElement) {
  // Radix's popover trigger listens on click; the pointer pair is kept for the
  // builds that gate on it. Either way the portal must end up in the document.
  fireEvent.pointerDown(trigger, { bubbles: true, button: 0, ctrlKey: false });
  fireEvent.pointerUp(trigger, { bubbles: true });
  fireEvent.click(trigger, { bubbles: true });
}

/**
 * Pick an option inside the open picker. Scoped deliberately: the same label
 * also renders in the table's own type cell, and `findByText` would match the
 * row first — clicking that expands the row instead of filtering.
 */
async function pickOption(label: string) {
  const option = (await screen.findAllByRole("option")).find(
    (el) => el.textContent?.includes(label)
  );
  if (!option) throw new Error(`No picker option matching ${label}`);
  fireEvent.pointerDown(option, { bubbles: true, button: 0 });
  fireEvent.pointerUp(option, { bubbles: true });
  fireEvent.click(option, { bubbles: true });
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

  it("shows the skeleton, not the empty state, while the query is pending", () => {
    useApprovalQueue.mockReturnValue(
      queueResult({ data: undefined, isPending: true })
    );
    const { container } = render(<AgentQueuePage />);
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
    expect(screen.queryByText("empty.pendingNoun")).toBeNull();
  });

  it("renders the pending empty state", () => {
    useApprovalQueue.mockReturnValue(queueResult());
    render(<AgentQueuePage />);
    expect(screen.getByText("empty.pendingNoun")).toBeInTheDocument();
    expect(screen.getByText("empty.pendingHint")).toBeInTheDocument();
  });

  it("renders one table row per proposal with a live count", () => {
    useApprovalQueue.mockReturnValue(
      queueResult({ data: [action("a"), action("b"), action("c")] })
    );
    render(<AgentQueuePage />);
    expect(rowOrder()).toHaveLength(3);
    expect(screen.getByText("3 rows")).toBeInTheDocument();
  });

  it("derives the type filter from loaded rows and filters on pick", async () => {
    useApprovalQueue.mockReturnValue(
      queueResult({
        data: [
          action("a"),
          action("b"),
          action("c", { actionType: "close_project" as AgentActionType }),
        ],
      })
    );
    render(<AgentQueuePage />);
    expect(rowOrder()).toHaveLength(3);

    // The filters are picker triggers, not an inline chip row — two loose
    // chips per filter is what ballooned the toolbar to four rows.
    openPicker(screen.getByRole("button", { name: /filter\.allTypes/ }));
    await pickOption("type.close_project");

    expect(rowOrder()).toEqual(["summary c"]);
    expect(screen.getByText("1 row")).toBeInTheDocument();
  });

  it("offers only the types present in the loaded rows", async () => {
    useApprovalQueue.mockReturnValue(
      queueResult({
        data: [
          action("a"),
          action("b", { actionType: "create_task" as AgentActionType }),
        ],
      })
    );
    render(<AgentQueuePage />);

    openPicker(screen.getByRole("button", { name: /filter\.allTypes/ }));
    const labels = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(labels.some((l) => l?.includes("type.reassign_task"))).toBe(true);
    expect(labels.some((l) => l?.includes("type.create_task"))).toBe(true);
    // Never a type with nothing behind it.
    expect(labels.some((l) => l?.includes("type.close_project"))).toBe(false);
  });

  it("hides a filter that has only one value behind it", () => {
    useApprovalQueue.mockReturnValue(
      queueResult({ data: [action("a"), action("b")] })
    );
    render(<AgentQueuePage />);
    // One type, one priority — neither filter earns toolbar space.
    expect(screen.queryByRole("button", { name: /filter\.allTypes/ })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /filter\.allPriorities/ })
    ).toBeNull();
  });

  it("narrows the rows by search over the proposal text", () => {
    useApprovalQueue.mockReturnValue(
      queueResult({
        data: [
          action("a", { contextSummary: "Reassign the roof inspection" }),
          action("b", { contextSummary: "Close the Barksdale job" }),
        ],
      })
    );
    render(<AgentQueuePage />);
    expect(screen.getAllByRole("row")).toHaveLength(3); // header + 2

    fireEvent.change(screen.getByLabelText("search.placeholder"), {
      target: { value: "barksdale" },
    });
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("Close the Barksdale job");
  });

  it("sorts by a column header and toggles direction on a second click", () => {
    useApprovalQueue.mockReturnValue(
      queueResult({
        data: [
          action("mid", { confidence: 0.5 }),
          action("low", { confidence: 0.1 }),
          action("high", { confidence: 0.9 }),
        ],
      })
    );
    render(<AgentQueuePage />);

    const confHeader = screen.getByRole("button", { name: /column\.confidence/ });
    fireEvent.click(confHeader);
    expect(rowOrder()).toEqual(["summary high", "summary mid", "summary low"]);
    expect(
      screen.getByRole("columnheader", { name: /column\.confidence/ })
    ).toHaveAttribute("aria-sort", "descending");

    fireEvent.click(confHeader);
    expect(rowOrder()).toEqual(["summary low", "summary mid", "summary high"]);
    expect(
      screen.getByRole("columnheader", { name: /column\.confidence/ })
    ).toHaveAttribute("aria-sort", "ascending");
  });

  it("opens the detail under a row on click and closes it on a second click", () => {
    useApprovalQueue.mockReturnValue(
      queueResult({ data: [action("a"), action("b")] })
    );
    render(<AgentQueuePage />);
    expect(screen.queryByTestId("detail")).toBeNull();

    fireEvent.click(screen.getByText("summary a"));
    expect(screen.getByTestId("detail")).toHaveTextContent("detail:a");

    fireEvent.click(screen.getByText("summary a"));
    expect(screen.queryByTestId("detail")).toBeNull();
  });

  it("approves from the row without opening the detail", () => {
    useApprovalQueue.mockReturnValue(queueResult({ data: [action("a")] }));
    render(<AgentQueuePage />);

    const row = screen.getAllByRole("row")[1];
    fireEvent.click(within(row).getByRole("button", { name: "action.approve" }));

    expect(mutate).toHaveBeenCalledWith(
      { actionId: "a", editedActionData: undefined },
      expect.anything()
    );
    expect(screen.queryByTestId("detail")).toBeNull();
  });

  it("switches to history statuses and shows the status column", () => {
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
});
