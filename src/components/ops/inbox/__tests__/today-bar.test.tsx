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
  it("renders urgent obligations as fixed list-integrated rows", () => {
    render(<TodayBar commitments={[overdue, today]} />);
    const bar = screen.getByTestId("today-bar");
    expect(bar.className).not.toContain("px-3");
    expect(bar.className).not.toContain("bg-brick");
    expect(screen.queryByText(/YOUR MOVE ::/)).toBeNull();
    expect(screen.getByText("Karen Etheridge")).toBeInTheDocument();
    expect(screen.getByText("Clara Walden")).toBeInTheDocument();
    expect(screen.getAllByLabelText("Karen — vinyl")[0].className).toContain(
      "h-7",
    );
  });

  it("renders no strip when there are no obligations", () => {
    const { container } = render(<TodayBar commitments={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("links each obligation row to its thread", () => {
    render(<TodayBar commitments={[overdue]} />);
    expect(screen.getByRole("link", { name: /Karen — vinyl/i })).toHaveAttribute(
      "href",
      "/inbox/t1",
    );
  });

  it("renders a compact inline resolve button when onResolve is provided + fires with id", () => {
    const onResolve = vi.fn();
    render(<TodayBar commitments={[overdue]} onResolve={onResolve} />);
    const button = screen.getByTestId("today-bar-resolve");
    expect(button.className).toContain("h-4");
    expect(button.className).toContain("w-4");
    button.click();
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

  it("caps the rendered list at 5 commitments and shows overflow count", () => {
    const many: TodayCommitment[] = Array.from({ length: 7 }, (_, i) => ({
      id: `c${i}`,
      threadId: `t${i}`,
      text: `Commit ${i}`,
      clientName: `Client ${i}`,
      waitingDays: 0,
      state: { tone: "accent", prefix: "YOURS", value: "1H" },
    }));
    render(<TodayBar commitments={many} />);
    expect(screen.getAllByRole("link")).toHaveLength(5);
    expect(screen.getByTestId("today-bar-overflow")).toHaveTextContent(
      "+2 MORE IN YOUR MOVE",
    );
  });
});
