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
    const link = screen.getByTestId("today-bar-commitment");
    expect(link).toHaveAttribute("href", "/inbox/t-abc");
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
