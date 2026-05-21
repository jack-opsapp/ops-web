import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import {
  resolveThreadRowPreview,
  ThreadRow,
  type ThreadRowData,
} from "../thread-row";
import type { StateTagResult } from "@/lib/inbox/format-wait";
import { shouldHandleInPlaceThreadNavigation } from "../inbox-navigation";

const NOW = new Date("2026-05-06T15:00:00Z").getTime();

const yoursState: StateTagResult = {
  kind: "yours",
  tone: "accent",
  prefix: "YOURS",
  value: "30M",
  alarmStrip: false,
};

const make = (over: Partial<ThreadRowData> = {}): ThreadRowData => ({
  id: "t1",
  ts: NOW - 1000 * 60 * 30,
  clientName: "Calloway",
  subject: "Roof RFQ — revised quote",
  snippet: "Reviewing the revised quote",
  aiSummary: null,
  labels: [],
  agent: { needsInput: false },
  phaseC: "none",
  unread: false,
  closed: false,
  messageCount: 1,
  draftKind: null,
  state: yoursState,
  lastInboundAt: NOW - 1000 * 60 * 30,
  ...over,
});

describe("<ThreadRow>", () => {
  it("renders client name, subject, snippet, and inline state tag", () => {
    render(<ThreadRow thread={make()} selected={false} now={NOW} onSelect={() => {}} />);
    expect(screen.getByText("Calloway")).toBeInTheDocument();
    expect(screen.getByText("Roof RFQ — revised quote")).toBeInTheDocument();
    expect(screen.getByText(/Reviewing the revised quote/)).toBeInTheDocument();
    expect(screen.getByText("YOURS · 30M")).toBeInTheDocument();
  });

  it("renders message count when greater than 1", () => {
    render(<ThreadRow thread={make({ messageCount: 5 })} selected={false} now={NOW} onSelect={() => {}} />);
    expect(screen.getByText("· 5")).toBeInTheDocument();
  });

  it("hides message count when only one message", () => {
    render(<ThreadRow thread={make({ messageCount: 1 })} selected={false} now={NOW} onSelect={() => {}} />);
    expect(screen.queryByText("· 1")).not.toBeInTheDocument();
  });

  it("snippet prefers aiSummary when present", () => {
    render(
      <ThreadRow
        thread={make({ aiSummary: "Operator owes a revised quote.", snippet: "raw provider snippet" })}
        selected={false}
        now={NOW}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText(/Operator owes a revised quote/)).toBeInTheDocument();
    expect(screen.queryByText(/raw provider snippet/)).toBeNull();
  });

  it("preview helper trims aiSummary before falling back to raw snippet", () => {
    expect(
      resolveThreadRowPreview(
        make({
          aiSummary: "  Operator owes a revised quote.  ",
          snippet: "raw provider snippet",
        }),
      ),
    ).toBe("Operator owes a revised quote.");
    expect(
      resolveThreadRowPreview(
        make({ aiSummary: "   ", snippet: " raw provider snippet " }),
      ),
    ).toBe("raw provider snippet");
  });

  it("snippet falls back to raw snippet when aiSummary is null", () => {
    render(
      <ThreadRow
        thread={make({ aiSummary: null, snippet: "raw provider snippet" })}
        selected={false}
        now={NOW}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText(/raw provider snippet/)).toBeInTheDocument();
  });

  it("snippet falls back to raw snippet when aiSummary is empty", () => {
    render(
      <ThreadRow
        thread={make({ aiSummary: "", snippet: "raw provider snippet" })}
        selected={false}
        now={NOW}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText(/raw provider snippet/)).toBeInTheDocument();
  });

  it("renders the outbound latest preview when the latest activity is from the operator", () => {
    render(
      <ThreadRow
        thread={make({
          aiSummary: null,
          snippet: "I sent the revised number. Can start Monday.",
          state: {
            kind: "theirs",
            tone: "neutral",
            prefix: "THEIRS",
            value: "2M",
            alarmStrip: false,
          },
          lastInboundAt: null,
        })}
        selected={false}
        now={NOW}
        onSelect={() => {}}
      />,
    );

    expect(screen.getByText(/I sent the revised number/)).toBeInTheDocument();
  });

  it("does not render the fallback FYI tag on the row", () => {
    render(
      <ThreadRow
        thread={make({
          state: {
            kind: "fyi",
            tone: "neutral",
            prefix: "FYI",
            alarmStrip: false,
          },
        })}
        selected={false}
        now={NOW}
        onSelect={() => {}}
      />,
    );

    expect(screen.queryByText("FYI")).not.toBeInTheDocument();
  });

  it("unread state uses font-semibold + text-text on the client name", () => {
    render(<ThreadRow thread={make({ unread: true })} selected={false} now={NOW} onSelect={() => {}} />);
    const name = screen.getByText("Calloway");
    expect(name.className).toMatch(/font-semibold/);
    expect(name.className).toMatch(/text-text\b/);
    expect(screen.getByTestId("thread-row-new-badge")).toHaveTextContent("NEW");
    expect(screen.getByTestId("thread-row").className).toContain(
      "bg-inbox-elev/45",
    );
    expect(screen.getByTestId("thread-row-stripe").className).toMatch(
      /bg-line-hi/,
    );
  });

  it("read state reduces weight and contrast on title + subject", () => {
    render(<ThreadRow thread={make({ unread: false })} selected={false} now={NOW} onSelect={() => {}} />);
    const name = screen.getByText("Calloway");
    const subject = screen.getByText("Roof RFQ — revised quote");
    expect(name.className).toMatch(/font-normal/);
    expect(name.className).toMatch(/text-text-mute\b/);
    expect(subject.className).toMatch(/font-normal/);
    expect(subject.className).toMatch(/text-text-mute\b/);
    expect(screen.queryByTestId("thread-row-new-badge")).toBeNull();
    expect(screen.getByTestId("thread-row").className).not.toContain(
      "bg-inbox-elev/45",
    );
  });

  it("AI-drafted snippet carries // PHASE C DRAFT · prefix in lavender", () => {
    const draftReady: StateTagResult = {
      kind: "draft_ready",
      tone: "lavender",
      prefix: "DRAFT READY",
      alarmStrip: false,
    };
    render(
      <ThreadRow
        thread={make({ phaseC: "ai_drafted", state: draftReady })}
        selected={false}
        now={NOW}
        onSelect={() => {}}
      />,
    );
    const tag = screen.getByText("// PHASE C DRAFT ·");
    expect(tag.className).toMatch(/text-agent\b/);
  });

  it("operator-drafted (non-AI) snippet carries DRAFT · prefix", () => {
    render(
      <ThreadRow
        thread={make({ draftKind: "user" })}
        selected={false}
        now={NOW}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText("DRAFT ·")).toBeInTheDocument();
  });

  it("overdue (state.kind=overdue) paints stripe + body rose, no alarm strip", () => {
    const overdueState: StateTagResult = {
      kind: "overdue",
      tone: "rose",
      prefix: "+8D",
      value: "WAITING",
      alarmStrip: false,
    };
    render(
      <ThreadRow
        thread={make({ state: overdueState })}
        selected={false}
        now={NOW}
        onSelect={() => {}}
      />,
    );
    const stripe = screen.getByTestId("thread-row-stripe");
    expect(stripe.className).toMatch(/bg-rose/);
    expect(screen.queryByText(/UNANSWERED/)).toBeNull();
    expect(screen.getByText("+8D · WAITING")).toBeInTheDocument();
  });

  it("alarmed (state.kind=alarmed, alarmStrip=true) renders the row alarm strip", () => {
    const alarmedState: StateTagResult = {
      kind: "alarmed",
      tone: "rose",
      prefix: "+38D",
      value: "WAITING",
      alarmStrip: true,
    };
    const lastInbound = NOW - 38 * 86_400_000;
    render(
      <ThreadRow
        thread={make({ state: alarmedState, lastInboundAt: lastInbound })}
        selected={false}
        now={NOW}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText("// 38D · UNANSWERED")).toBeInTheDocument();
  });

  it("AI-drafted (unselected) paints the stripe lavender", () => {
    const draftReady: StateTagResult = {
      kind: "draft_ready",
      tone: "lavender",
      prefix: "DRAFT READY",
      alarmStrip: false,
    };
    render(
      <ThreadRow
        thread={make({ phaseC: "ai_drafted", state: draftReady })}
        selected={false}
        now={NOW}
        onSelect={() => {}}
      />,
    );
    const stripe = screen.getByTestId("thread-row-stripe");
    expect(stripe.className).toMatch(/bg-agent\b/);
  });

  it("selected state overrides everything with the accent stripe", () => {
    const draftReady: StateTagResult = {
      kind: "draft_ready",
      tone: "lavender",
      prefix: "DRAFT READY",
      alarmStrip: false,
    };
    render(
      <ThreadRow
        thread={make({ phaseC: "ai_drafted", state: draftReady })}
        selected={true}
        now={NOW}
        onSelect={() => {}}
      />,
    );
    const stripe = screen.getByTestId("thread-row-stripe");
    expect(stripe.className).toMatch(/bg-ops-accent/);
  });

  it("URGENT label no longer surfaces a bottom URGENT pill (state tag carries the urgency)", () => {
    const overdueState: StateTagResult = {
      kind: "overdue",
      tone: "rose",
      prefix: "+8D",
      value: "WAITING",
      alarmStrip: false,
    };
    render(
      <ThreadRow
        thread={make({ labels: ["URGENT"], state: overdueState })}
        selected={false}
        now={NOW}
        onSelect={() => {}}
      />,
    );
    expect(screen.queryByTestId("thread-row-urgent")).toBeNull();
  });

  it("renders attachment / quote / invoice icons in the bottom signal row", () => {
    const { container } = render(
      <ThreadRow
        thread={make({ labels: ["HAS_ATTACHMENT", "HAS_QUOTE", "HAS_INVOICE"] })}
        selected={false}
        now={NOW}
        onSelect={() => {}}
      />,
    );
    const icons = container.querySelectorAll("svg");
    expect(icons.length).toBeGreaterThanOrEqual(3);
  });

  it("renders unknown sender as a question mark next to the sender name", () => {
    render(
      <ThreadRow
        thread={make({ labels: ["FROM_NEW_SENDER"] })}
        selected={false}
        now={NOW}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByTestId("thread-row-unknown-sender")).toHaveAttribute(
      "aria-label",
      "Unconfirmed sender",
    );
    expect(screen.getByTestId("thread-row-unknown-sender")).toHaveTextContent(
      "?",
    );
  });

  it("renders compact quick actions that reveal on hover and focus", async () => {
    const user = userEvent.setup();
    const onMarkReadChange = vi.fn();
    const onArchive = vi.fn();
    render(
      <ThreadRow
        thread={make({ unread: false })}
        selected={false}
        now={NOW}
        onSelect={() => {}}
        onMarkReadChange={onMarkReadChange}
        onArchive={onArchive}
      />,
    );

    const actions = screen.getByTestId("thread-row-quick-actions");
    expect(actions.className).toContain("opacity-0");
    expect(actions.className).toContain("group-hover:opacity-100");
    expect(actions.className).toContain("group-focus-within:opacity-100");

    await user.tab();
    await user.tab();
    expect(screen.getByRole("button", { name: "Mark unread" })).toHaveFocus();
  });

  it("wires mark read/unread and archive quick actions without selecting the row", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onMarkReadChange = vi.fn();
    const onArchive = vi.fn();
    render(
      <ThreadRow
        thread={make({ unread: true })}
        selected={false}
        now={NOW}
        onSelect={onSelect}
        onMarkReadChange={onMarkReadChange}
        onArchive={onArchive}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Mark read" }));
    await user.click(screen.getByRole("button", { name: "Archive thread" }));

    expect(onMarkReadChange).toHaveBeenCalledWith("t1", true);
    expect(onArchive).toHaveBeenCalledWith("t1");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("calls onSelect on click", () => {
    const onSelect = vi.fn();
    render(<ThreadRow thread={make()} selected={false} now={NOW} onSelect={onSelect} />);
    screen.getByRole("link", { name: /Calloway.*Roof RFQ/i }).click();
    expect(onSelect).toHaveBeenCalledWith("t1");
  });

  it("renders a deep-link href for native new-tab gestures", () => {
    render(<ThreadRow thread={make()} selected={false} now={NOW} onSelect={() => {}} />);
    expect(screen.getByRole("link", { name: /Calloway.*Roof RFQ/i })).toHaveAttribute(
      "href",
      "/inbox/t1",
    );
  });

  it("classifies modified and auxiliary clicks as native link gestures", () => {
    const base = {
      defaultPrevented: false,
      button: 0,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
    };

    expect(shouldHandleInPlaceThreadNavigation(base)).toBe(true);
    expect(shouldHandleInPlaceThreadNavigation({ ...base, metaKey: true })).toBe(false);
    expect(shouldHandleInPlaceThreadNavigation({ ...base, button: 1 })).toBe(false);
  });
});
