import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { TodayBar } from "../today-bar";

describe("<TodayBar>", () => {
  it("renders the empty state when there are zero commitments", () => {
    render(<TodayBar commitments={[]} />);
    expect(screen.getByText(/ALL CLEAR/)).toBeInTheDocument();
    expect(screen.getByText(/no commitments today/)).toBeInTheDocument();
  });

  it("shows the next commitment summary when one exists", () => {
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
        ]}
      />,
    );
    expect(screen.getByText(/BALL IN YOUR COURT/)).toBeInTheDocument();
    expect(
      screen.getByText(/Confirm revised start date · Calloway/),
    ).toBeInTheDocument();
  });

  it("links the next commitment to its thread", () => {
    render(
      <TodayBar
        commitments={[
          { id: "c1", text: "X", due: "TODAY", threadId: "t-abc", urgent: false },
        ]}
      />,
    );
    expect(screen.getByRole("link", { name: /X/ })).toHaveAttribute(
      "href",
      "/inbox/t-abc",
    );
  });

  it("shows the count when more than one commitment", () => {
    render(
      <TodayBar
        commitments={[
          { id: "c1", text: "A", due: "TODAY", threadId: "t1", urgent: false },
          { id: "c2", text: "B", due: "TODAY", threadId: "t2", urgent: false },
          { id: "c3", text: "C", due: "TODAY", threadId: "t3", urgent: false },
        ]}
      />,
    );
    expect(screen.getByText(/3/)).toBeInTheDocument();
  });

  it("renders the urgent indicator when next commitment is urgent", () => {
    render(
      <TodayBar
        commitments={[
          { id: "c1", text: "A", due: "TODAY", threadId: "t1", urgent: true },
        ]}
      />,
    );
    // urgent dot has data-testid for query
    expect(screen.getByTestId("today-bar-urgent")).toBeInTheDocument();
  });
});
