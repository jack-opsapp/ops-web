import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { TodayBar } from "../today-bar";

describe("<TodayBar>", () => {
  it("renders the empty state with 'All caught up' when there are zero commitments", () => {
    render(<TodayBar commitments={[]} />);
    expect(screen.getByText(/All caught up/i)).toBeInTheDocument();
    expect(screen.getByText(/Nothing waiting on you/i)).toBeInTheDocument();
  });

  it("shows the YOUR MOVE header and renders each commitment as a link", () => {
    render(
      <TodayBar
        commitments={[
          {
            id: "c1",
            text: "Confirm revised start date · Calloway",
            due: "TODAY 17:00",
            threadId: "t1",
            urgent: true,
          },
          {
            id: "c2",
            text: "Walk site & quote · Martinez",
            due: "FRI 16:00",
            threadId: "t2",
            urgent: false,
          },
        ]}
      />,
    );
    expect(screen.getByText(/YOUR MOVE/)).toBeInTheDocument();
    expect(
      screen.getByText(/Confirm revised start date · Calloway/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Walk site & quote · Martinez/)).toBeInTheDocument();
  });

  it("links each commitment to its thread", () => {
    render(
      <TodayBar
        commitments={[
          { id: "c1", text: "X", due: "TODAY", threadId: "t-abc", urgent: false },
        ]}
      />,
    );
    // The row is a <li> wrapper now (so we can split the navigate Link
    // from the inline ✓ resolve button). Both the body Link and the arrow
    // Link inside should target the same thread.
    const row = screen.getByTestId("today-bar-commitment");
    const links = row.querySelectorAll("a");
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link).toHaveAttribute("href", "/inbox/t-abc");
    }
  });

  it("renders an inline ✓ resolve button when onResolve is provided", () => {
    const calls: string[] = [];
    render(
      <TodayBar
        commitments={[
          { id: "c1", text: "X", due: "TODAY", threadId: "t1", urgent: false },
        ]}
        onResolve={(id) => calls.push(id)}
      />,
    );
    const button = screen.getByTestId("today-bar-resolve");
    button.click();
    expect(calls).toEqual(["c1"]);
  });

  it("disables the resolve button when the commitment id is in pendingResolveIds", () => {
    render(
      <TodayBar
        commitments={[
          { id: "c1", text: "X", due: "TODAY", threadId: "t1", urgent: false },
        ]}
        onResolve={() => {}}
        pendingResolveIds={new Set(["c1"])}
      />,
    );
    const button = screen.getByTestId("today-bar-resolve") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("omits the resolve button entirely when no onResolve handler is passed", () => {
    render(
      <TodayBar
        commitments={[
          { id: "c1", text: "X", due: "TODAY", threadId: "t1", urgent: false },
        ]}
      />,
    );
    expect(screen.queryByTestId("today-bar-resolve")).toBeNull();
  });

  it("renders an item count line ('3 items') when more than one commitment", () => {
    render(
      <TodayBar
        commitments={[
          { id: "c1", text: "A", due: "TODAY", threadId: "t1", urgent: false },
          { id: "c2", text: "B", due: "TODAY", threadId: "t2", urgent: false },
          { id: "c3", text: "C", due: "TODAY", threadId: "t3", urgent: false },
        ]}
      />,
    );
    expect(screen.getByText(/3 items/i)).toBeInTheDocument();
  });

  it("caps the rendered list at 3 commitments even when more are passed", () => {
    render(
      <TodayBar
        commitments={Array.from({ length: 5 }, (_, i) => ({
          id: `c${i}`,
          text: `Commit ${i}`,
          due: "TODAY",
          threadId: `t${i}`,
          urgent: false,
        }))}
      />,
    );
    expect(screen.getAllByTestId("today-bar-commitment")).toHaveLength(3);
  });
});
