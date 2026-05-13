import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ThreadRow, type ThreadRowData } from "../thread-row";
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

  it("unread state uses font-semibold + text-text on the client name", () => {
    render(<ThreadRow thread={make({ unread: true })} selected={false} now={NOW} onSelect={() => {}} />);
    const name = screen.getByText("Calloway");
    expect(name.className).toMatch(/font-semibold/);
    expect(name.className).toMatch(/text-text\b/);
  });

  it("read state uses font-normal + text-text-2", () => {
    render(<ThreadRow thread={make({ unread: false })} selected={false} now={NOW} onSelect={() => {}} />);
    const name = screen.getByText("Calloway");
    expect(name.className).toMatch(/font-normal/);
    expect(name.className).toMatch(/text-text-2\b/);
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
