import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ThreadRow, type ThreadRowData } from "../thread-row";

const NOW = new Date("2026-05-06T15:00:00Z").getTime();

const make = (over: Partial<ThreadRowData> = {}): ThreadRowData => ({
  id: "t1",
  ts: NOW - 1000 * 60 * 30,
  clientName: "Calloway",
  snippet: "Reviewing the revised quote",
  labels: [],
  agent: { needsInput: false },
  phaseC: "none",
  unread: false,
  closed: false,
  ...over,
});

describe("<ThreadRow>", () => {
  it("renders client name and snippet", () => {
    render(<ThreadRow thread={make()} selected={false} now={NOW} onSelect={() => {}} />);
    expect(screen.getByText("Calloway")).toBeInTheDocument();
    expect(screen.getByText(/Reviewing the revised quote/)).toBeInTheDocument();
  });

  it("renders unread state with bolder client name", () => {
    render(
      <ThreadRow thread={make({ unread: true })} selected={false} now={NOW} onSelect={() => {}} />,
    );
    const name = screen.getByText("Calloway");
    expect(name.className).toMatch(/font-semibold/);
    expect(name.className).toMatch(/text-text\b/);
  });

  it("renders read state with lighter weight + muted color", () => {
    render(
      <ThreadRow thread={make({ unread: false })} selected={false} now={NOW} onSelect={() => {}} />,
    );
    const name = screen.getByText("Calloway");
    expect(name.className).toMatch(/font-medium/);
    expect(name.className).toMatch(/text-text-2\b/);
  });

  it("shows AI-DRAFT chevron tag when phaseC === 'ai_drafted'", () => {
    render(
      <ThreadRow
        thread={make({ phaseC: "ai_drafted" })}
        selected={false}
        now={NOW}
        onSelect={() => {}}
      />,
    );
    const tag = screen.getByText(/AI[‒-]DRAFT/i);
    expect(tag).toBeInTheDocument();
    expect(tag.className).toMatch(/text-agent\b/);
  });

  it("shows ? pill when agent.needsInput", () => {
    render(
      <ThreadRow
        thread={make({ agent: { needsInput: true } })}
        selected={false}
        now={NOW}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByTestId("thread-row-needs-input")).toBeInTheDocument();
  });

  it("renders urgent stripe when labels include URGENT", () => {
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
  });

  it("renders agent stripe when phaseC === 'ai_drafted' and not selected", () => {
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

  it("selected state shows accent stripe and accent-tinted background", () => {
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

  it("calls onSelect on click", () => {
    const onSelect = vi.fn();
    render(<ThreadRow thread={make()} selected={false} now={NOW} onSelect={onSelect} />);
    screen.getByRole("button").click();
    expect(onSelect).toHaveBeenCalledWith("t1");
  });
});
