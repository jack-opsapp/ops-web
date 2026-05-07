import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ContextRail } from "../context-rail/context-rail";

const baseProps = {
  client: { name: "Calloway HVAC", tier: "PRIORITY" },
  threadId: "t1",
  onOpenClient: () => {},
  counts: { projects: 2, pipeline: 3, files: 9 },
  projects: <div data-testid="projects">P</div>,
  pipeline: <div data-testid="pipeline">L</div>,
  files: <div data-testid="files">F</div>,
};

describe("<ContextRail>", () => {
  it("renders the client mini-header", () => {
    render(<ContextRail {...baseProps} />);
    expect(screen.getByText("Calloway HVAC")).toBeInTheDocument();
    expect(screen.getByText("PRIORITY")).toBeInTheDocument();
  });

  it("defaults to the Projects tab on mount", () => {
    render(<ContextRail {...baseProps} />);
    expect(screen.getByTestId("projects")).toBeInTheDocument();
    expect(screen.queryByTestId("pipeline")).not.toBeInTheDocument();
    expect(screen.queryByTestId("files")).not.toBeInTheDocument();
  });

  it("switches to the Pipeline tab on click", () => {
    render(<ContextRail {...baseProps} />);
    fireEvent.click(screen.getByRole("tab", { name: /Pipeline/i }));
    expect(screen.getByTestId("pipeline")).toBeInTheDocument();
    expect(screen.queryByTestId("projects")).not.toBeInTheDocument();
  });

  it("renders the count next to each tab label", () => {
    render(<ContextRail {...baseProps} />);
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("9")).toBeInTheDocument();
  });

  it("re-mounts to Projects when threadId changes (no cross-thread persistence)", () => {
    const { rerender } = render(<ContextRail {...baseProps} threadId="t1" />);
    fireEvent.click(screen.getByRole("tab", { name: /Files/i }));
    expect(screen.getByTestId("files")).toBeInTheDocument();
    rerender(<ContextRail {...baseProps} threadId="t2" />);
    expect(screen.getByTestId("projects")).toBeInTheDocument();
    expect(screen.queryByTestId("files")).not.toBeInTheDocument();
  });
});
