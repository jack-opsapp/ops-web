import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { ThreadList } from "../thread-list";
import type { ThreadListItem } from "../thread-list";
import type { StateTagResult } from "@/lib/inbox/format-wait";

const NOW = new Date("2026-05-06T15:00:00Z").getTime();

const FYI_STATE: StateTagResult = {
  kind: "fyi",
  tone: "neutral",
  prefix: "FYI",
  alarmStrip: false,
};

const make = (id: string, over: Partial<ThreadListItem> = {}): ThreadListItem => ({
  id,
  ts: NOW - 1000 * 60 * 30,
  labels: [],
  agent: { needsInput: false },
  phaseC: "none",
  closed: false,
  clientName: id.toUpperCase(),
  subject: `Subject ${id}`,
  snippet: "hello",
  aiSummary: null,
  unread: false,
  messageCount: 1,
  draftKind: null,
  state: FYI_STATE,
  lastInboundAt: null,
  ...over,
});

describe("<ThreadList>", () => {
  it("renders the active rail as a flat feed without state section headers", () => {
    const threads = [
      make("a", { agent: { needsInput: true } }),
      make("b", { labels: ["AWAITING_REPLY"] }),
      make("c", { phaseC: "ai_drafted" }),
    ];
    render(
      <ThreadList
        threads={threads}
        now={NOW}
        selectedThreadId={null}
        onSelect={() => {}}
      />,
    );
    expect(screen.queryByText(/\/\/ NEEDS INPUT/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\/\/ NEEDS REPLY/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\/\/ DRAFTS READY/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\/\/ AWAITING THEM/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\/\/ LATER/i)).not.toBeInTheDocument();
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument();
    expect(screen.getByText("C")).toBeInTheDocument();
    expect(screen.queryByText(/^Urgent$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Today$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^This week$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Earlier$/i)).not.toBeInTheDocument();
  });

  it("renders one row per visible thread", () => {
    const threads = [
      make("a", { agent: { needsInput: true }, clientName: "Acme" }),
      make("b", { labels: ["URGENT"], clientName: "Beta" }),
    ];
    render(
      <ThreadList
        threads={threads}
        now={NOW}
        selectedThreadId={null}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });

  it("renders obligations inside the thread-list scroll surface", () => {
    const threads = [make("a", { clientName: "Acme" })];
    render(
      <ThreadList
        threads={threads}
        now={NOW}
        selectedThreadId={null}
        onSelect={() => {}}
        obligations={[
          {
            id: "c1",
            threadId: "a",
            text: "Acme — send revised quote",
            clientName: "Acme Construction",
            waitingDays: 2,
            state: { tone: "accent", prefix: "YOURS", value: "2H" },
          },
        ]}
      />,
    );
    const scroll = screen.getByTestId("thread-list-scroll");
    const strip = screen.getByTestId("today-bar");
    expect(scroll).toContainElement(strip);
    expect(strip).toHaveAttribute("data-inbox-debug-id", "B2");
  });

  it("calls onSelect with thread id when row clicked", async () => {
    const onSelect = vi.fn();
    const threads = [make("xyz", { clientName: "Gamma" })];
    render(
      <ThreadList
        threads={threads}
        now={NOW}
        selectedThreadId={null}
        onSelect={onSelect}
      />,
    );
    screen.getByRole("link", { name: /Gamma.*Subject xyz/i }).click();
    expect(onSelect).toHaveBeenCalledWith("xyz");
  });

  it("passes quick-action handlers through to each row", async () => {
    const user = userEvent.setup();
    const onMarkReadChange = vi.fn();
    const onArchiveThread = vi.fn();
    const threads = [make("xyz", { clientName: "Gamma", unread: true })];
    render(
      <ThreadList
        threads={threads}
        now={NOW}
        selectedThreadId={null}
        onSelect={() => {}}
        onMarkReadChange={onMarkReadChange}
        onArchiveThread={onArchiveThread}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Mark read" }));
    await user.click(screen.getByRole("button", { name: "Archive thread" }));

    expect(onMarkReadChange).toHaveBeenCalledWith("xyz", true);
    expect(onArchiveThread).toHaveBeenCalledWith("xyz");
  });

  it("does not remove threads based on old state-group membership", () => {
    const threads = [
      make("a", { labels: ["AWAITING_REPLY"], clientName: "ReplyDebt" }),
      make("b", { phaseC: "ai_drafted", clientName: "DraftReady" }),
      make("c", { phaseC: "auto_sent", clientName: "AutoSent" }),
      make("d", { closed: true, clientName: "Archived" }),
    ];
    render(
      <ThreadList
        threads={threads}
        now={NOW}
        selectedThreadId={null}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText("ReplyDebt")).toBeInTheDocument();
    expect(screen.getByText("DraftReady")).toBeInTheDocument();
    expect(screen.getByText("AutoSent")).toBeInTheDocument();
    expect(screen.getByText("Archived")).toBeInTheDocument();
  });
});
