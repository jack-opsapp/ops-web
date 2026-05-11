import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { TodayBar, type TodayCommitment } from "../today-bar";

const overdue: TodayCommitment = {
  id: "c1",
  threadId: "t1",
  text: "Karen — vinyl",
  clientName: "Karen Etheridge",
  waitingDays: 38,
  state: { tone: "rose", prefix: "+38D", value: "WAITING" },
};
const today: TodayCommitment = {
  id: "c2",
  threadId: "t2",
  text: "Clara — Canpro",
  clientName: "Clara Walden",
  waitingDays: 8,
  state: { tone: "rose", prefix: "+8D", value: "WAITING" },
};

describe("<TodayBar>", () => {
  it("uses brick-tinted gradient when any row waiting > 7d", () => {
    render(<TodayBar commitments={[overdue, today]} />);
    const bar = screen.getByTestId("today-bar");
    expect(bar.className).toMatch(/bg-\[linear-gradient.*147,\s*50,\s*26/);
  });

  it("uses accent gradient when no row waiting > 7d", () => {
    const yoursToday: TodayCommitment = {
      id: "c3",
      threadId: "t3",
      text: "Mia — siding",
      clientName: "Mia Vasquez",
      waitingDays: 1,
      state: { tone: "accent", prefix: "YOURS", value: "18H" },
    };
    render(<TodayBar commitments={[yoursToday]} />);
    const bar = screen.getByTestId("today-bar");
    expect(bar.className).toMatch(/bg-\[linear-gradient.*111,\s*148,\s*176/);
  });

  it("renders // YOUR MOVE :: 2 OVERDUE · 0 TODAY header when both are overdue", () => {
    render(<TodayBar commitments={[overdue, today]} />);
    expect(screen.getByText(/YOUR MOVE :: 2 OVERDUE · 0 TODAY/)).toBeInTheDocument();
  });

  it("renders // CAUGHT UP empty state without a checkmark icon", () => {
    const { container } = render(<TodayBar commitments={[]} />);
    expect(screen.getByText("// CAUGHT UP")).toBeInTheDocument();
    // The Check icon was the canonical empty-state visual — verify it's gone.
    // Lucide renders Check as an SVG; assert no SVG sits inside the empty bar.
    const bar = container.querySelector('[data-testid="today-bar"]');
    expect(bar?.querySelector("svg")).toBeNull();
  });

  it("renders simplified row anatomy (name + tag, no subject line)", () => {
    render(<TodayBar commitments={[overdue]} />);
    expect(screen.getByText("Karen Etheridge")).toBeInTheDocument();
    expect(screen.getByText("+38D · WAITING")).toBeInTheDocument();
    expect(screen.queryByText("Karen — vinyl")).toBeNull();
  });

  it("links each commitment row to its thread", () => {
    render(<TodayBar commitments={[overdue]} />);
    const links = screen.getAllByRole("link");
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link).toHaveAttribute("href", "/inbox/t1");
    }
  });

  it("renders an inline ✓ resolve button when onResolve is provided + fires with id", () => {
    const onResolve = vi.fn();
    render(<TodayBar commitments={[overdue]} onResolve={onResolve} />);
    screen.getByTestId("today-bar-resolve").click();
    expect(onResolve).toHaveBeenCalledWith("c1");
  });

  it("disables the resolve button when commitment is in pendingResolveIds", () => {
    render(
      <TodayBar
        commitments={[overdue]}
        onResolve={() => {}}
        pendingResolveIds={new Set(["c1"])}
      />,
    );
    const button = screen.getByTestId("today-bar-resolve") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("omits the resolve button entirely when no onResolve", () => {
    render(<TodayBar commitments={[overdue]} />);
    expect(screen.queryByTestId("today-bar-resolve")).toBeNull();
  });

  it("caps the rendered list at 3 commitments", () => {
    const many: TodayCommitment[] = Array.from({ length: 5 }, (_, i) => ({
      id: `c${i}`,
      threadId: `t${i}`,
      text: `Commit ${i}`,
      clientName: `Client ${i}`,
      waitingDays: 0,
      state: { tone: "accent", prefix: "YOURS", value: "1H" },
    }));
    render(<TodayBar commitments={many} />);
    // The list elements have role="listitem" inside the ul. Just count them.
    expect(screen.getAllByRole("link")).toHaveLength(3 * 2); // each row has 2 links (body + arrow)
  });
});
