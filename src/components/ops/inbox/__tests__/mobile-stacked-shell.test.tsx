import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MobileStackedShell } from "../mobile-stacked-shell";

describe("<MobileStackedShell>", () => {
  it("renders the list pane when activePane='list'", () => {
    render(
      <MobileStackedShell
        activePane="list"
        onPaneChange={() => {}}
        threadList={<div data-testid="list" />}
        detail={<div data-testid="detail" />}
        contextRail={<div data-testid="context" />}
      />,
    );
    expect(screen.getByTestId("list")).toBeInTheDocument();
    expect(screen.queryByTestId("detail")).not.toBeInTheDocument();
    expect(screen.queryByTestId("context")).not.toBeInTheDocument();
  });

  it("renders the detail pane with a back arrow when activePane='detail'", () => {
    const onPaneChange = vi.fn();
    render(
      <MobileStackedShell
        activePane="detail"
        onPaneChange={onPaneChange}
        threadList={<div data-testid="list" />}
        detail={<div data-testid="detail" />}
        contextRail={<div data-testid="context" />}
      />,
    );
    expect(screen.getByTestId("detail")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(onPaneChange).toHaveBeenCalledWith("list");
  });

  it("renders the context pane and back returns to detail", () => {
    const onPaneChange = vi.fn();
    render(
      <MobileStackedShell
        activePane="context"
        onPaneChange={onPaneChange}
        threadList={<div />}
        detail={<div />}
        contextRail={<div data-testid="context" />}
      />,
    );
    expect(screen.getByTestId("context")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(onPaneChange).toHaveBeenCalledWith("detail");
  });
});
