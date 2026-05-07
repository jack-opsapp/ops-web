import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ThreadRow, type ThreadRowData } from "../thread-row";

const NOW = new Date("2026-05-06T15:00:00Z").getTime();

const make = (over: Partial<ThreadRowData> = {}): ThreadRowData => ({
  id: "t1",
  ts: NOW - 1000 * 60 * 30,
  clientName: "Calloway",
  subject: "Roof RFQ — revised quote",
  snippet: "Reviewing the revised quote",
  labels: [],
  agent: { needsInput: false },
  phaseC: "none",
  unread: false,
  closed: false,
  messageCount: 1,
  draftKind: null,
  ...over,
});

describe("<ThreadRow>", () => {
  it("renders client name, subject, and snippet on three rows", () => {
    render(<ThreadRow thread={make()} selected={false} now={NOW} onSelect={() => {}} />);
    expect(screen.getByText("Calloway")).toBeInTheDocument();
    expect(screen.getByText("Roof RFQ — revised quote")).toBeInTheDocument();
    expect(screen.getByText(/Reviewing the revised quote/)).toBeInTheDocument();
  });

  it("renders message count when greater than 1", () => {
    render(
      <ThreadRow
        thread={make({ messageCount: 5 })}
        selected={false}
        now={NOW}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText("· 5")).toBeInTheDocument();
  });

  it("hides message count when only one message", () => {
    render(
      <ThreadRow
        thread={make({ messageCount: 1 })}
        selected={false}
        now={NOW}
        onSelect={() => {}}
      />,
    );
    expect(screen.queryByText("· 1")).not.toBeInTheDocument();
  });

  it("unread state uses font-semibold + text-text on the client name", () => {
    render(
      <ThreadRow thread={make({ unread: true })} selected={false} now={NOW} onSelect={() => {}} />,
    );
    const name = screen.getByText("Calloway");
    expect(name.className).toMatch(/font-semibold/);
    expect(name.className).toMatch(/text-text\b/);
  });

  it("read state uses font-normal + text-text-2 on the client name", () => {
    render(
      <ThreadRow thread={make({ unread: false })} selected={false} now={NOW} onSelect={() => {}} />,
    );
    const name = screen.getByText("Calloway");
    expect(name.className).toMatch(/font-normal/);
    expect(name.className).toMatch(/text-text-2\b/);
  });

  it("snippet carries an AI DRAFT prefix when phaseC === 'ai_drafted'", () => {
    render(
      <ThreadRow
        thread={make({ phaseC: "ai_drafted" })}
        selected={false}
        now={NOW}
        onSelect={() => {}}
      />,
    );
    const tag = screen.getByText("AI DRAFT ·");
    expect(tag.className).toMatch(/text-agent\b/);
  });

  it("snippet carries a DRAFT prefix when draftKind === 'user' (non-ai)", () => {
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

  it("URGENT label paints the stripe rose and surfaces a bottom URGENT pill", () => {
    render(
      <ThreadRow
        thread={make({ labels: ["URGENT"] })}
        selected={false}
        now={NOW}
        onSelect={() => {}}
      />,
    );
    const stripe = screen.getByTestId("thread-row-stripe");
    expect(stripe.className).toMatch(/bg-rose/);
    expect(screen.getByTestId("thread-row-urgent")).toBeInTheDocument();
  });

  it("AI-drafted (unselected) paints the stripe lavender", () => {
    render(
      <ThreadRow
        thread={make({ phaseC: "ai_drafted" })}
        selected={false}
        now={NOW}
        onSelect={() => {}}
      />,
    );
    const stripe = screen.getByTestId("thread-row-stripe");
    expect(stripe.className).toMatch(/bg-agent\b/);
  });

  it("selected state overrides everything with the accent stripe", () => {
    render(
      <ThreadRow
        thread={make({ phaseC: "ai_drafted", labels: ["URGENT"] })}
        selected={true}
        now={NOW}
        onSelect={() => {}}
      />,
    );
    const stripe = screen.getByTestId("thread-row-stripe");
    expect(stripe.className).toMatch(/bg-ops-accent/);
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
    // Three lucide icons inside the signal row container.
    const icons = container.querySelectorAll("svg");
    expect(icons.length).toBeGreaterThanOrEqual(3);
  });

  it("calls onSelect on click", () => {
    const onSelect = vi.fn();
    render(<ThreadRow thread={make()} selected={false} now={NOW} onSelect={onSelect} />);
    screen.getByRole("button").click();
    expect(onSelect).toHaveBeenCalledWith("t1");
  });
});
