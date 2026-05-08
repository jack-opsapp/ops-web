import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ContextRail } from "../context-rail/context-rail";

const baseProps = {
  client: {
    name: "Calloway HVAC",
    subtitle: "Property mgmt · 4 buildings",
    phone: "(604) 555-0184",
    email: "jeanne@callowayroof.co",
    address: "5421 Ash St, Vancouver BC",
  },
  threadId: "t1",
  onOpenClient: () => {},
  counts: { pipeline: 3, tasks: 2, files: 9, threads: 1 },
  pipeline: <div data-testid="pipeline">L</div>,
  tasks: <div data-testid="tasks">T</div>,
  files: <div data-testid="files">F</div>,
  threads: <div data-testid="threads">Th</div>,
};

describe("<ContextRail>", () => {
  it("renders the client mini-header (name + subtitle)", () => {
    render(<ContextRail {...baseProps} />);
    expect(screen.getByText("Calloway HVAC")).toBeInTheDocument();
    expect(screen.getByText(/Property mgmt/)).toBeInTheDocument();
  });

  it("renders contact lines (phone / email / address)", () => {
    render(<ContextRail {...baseProps} />);
    expect(screen.getByText("(604) 555-0184")).toBeInTheDocument();
    expect(screen.getByText("jeanne@callowayroof.co")).toBeInTheDocument();
    expect(screen.getByText(/5421 Ash St/)).toBeInTheDocument();
  });

  it("defaults to the Pipeline tab on mount", () => {
    render(<ContextRail {...baseProps} />);
    expect(screen.getByTestId("pipeline")).toBeInTheDocument();
    expect(screen.queryByTestId("tasks")).not.toBeInTheDocument();
    expect(screen.queryByTestId("files")).not.toBeInTheDocument();
    expect(screen.queryByTestId("threads")).not.toBeInTheDocument();
  });

  it("switches to the Tasks tab on click", () => {
    render(<ContextRail {...baseProps} />);
    fireEvent.click(screen.getByRole("tab", { name: /Tasks/i }));
    expect(screen.getByTestId("tasks")).toBeInTheDocument();
    expect(screen.queryByTestId("pipeline")).not.toBeInTheDocument();
  });

  it("renders the count next to each non-zero tab label", () => {
    render(<ContextRail {...baseProps} />);
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("9")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("re-mounts to Pipeline when threadId changes (no cross-thread persistence)", () => {
    const { rerender } = render(<ContextRail {...baseProps} threadId="t1" />);
    fireEvent.click(screen.getByRole("tab", { name: /Files/i }));
    expect(screen.getByTestId("files")).toBeInTheDocument();
    rerender(<ContextRail {...baseProps} threadId="t2" />);
    expect(screen.getByTestId("pipeline")).toBeInTheDocument();
    expect(screen.queryByTestId("files")).not.toBeInTheDocument();
  });
});
