import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { InboxShell } from "../inbox-shell";

describe("<InboxShell> (non-resizable for layout assertions)", () => {
  it("renders three primary regions with correct ARIA roles", () => {
    render(
      <InboxShell
        resizable={false}
        rightRailOpen={true}
        threadList={<div data-testid="thread-list" />}
        detail={<div data-testid="detail" />}
        contextRail={<div data-testid="context" />}
      />,
    );
    expect(screen.getByTestId("thread-list")).toBeInTheDocument();
    expect(screen.getByTestId("detail")).toBeInTheDocument();
    expect(screen.getByTestId("context")).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
    const asides = screen.getAllByRole("complementary");
    expect(asides).toHaveLength(2);
  });

  it("hides the context rail when rightRailOpen=false", () => {
    render(
      <InboxShell
        resizable={false}
        rightRailOpen={false}
        threadList={<div />}
        detail={<div />}
        contextRail={<div data-testid="context" />}
      />,
    );
    expect(screen.queryByTestId("context")).not.toBeInTheDocument();
  });

  it("labels the thread list aside with an accessible name", () => {
    render(
      <InboxShell
        resizable={false}
        rightRailOpen={true}
        threadList={<div />}
        detail={<div />}
        contextRail={<div />}
      />,
    );
    expect(
      screen.getByRole("complementary", { name: /thread list/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("complementary", { name: /thread context/i }),
    ).toBeInTheDocument();
  });
});

describe("<InboxShell> (resizable wiring smoke)", () => {
  it("renders without crashing in resizable mode", () => {
    render(
      <InboxShell
        threadList={<div data-testid="thread-list" />}
        detail={<div data-testid="detail" />}
        contextRail={<div data-testid="context" />}
      />,
    );
    expect(screen.getByTestId("thread-list")).toBeInTheDocument();
    expect(screen.getByTestId("detail")).toBeInTheDocument();
  });
});
