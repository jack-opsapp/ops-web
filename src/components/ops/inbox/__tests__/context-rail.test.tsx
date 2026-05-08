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
  counts: { work: 3, accounting: 2, files: 9 },
  work: <div data-testid="work">W</div>,
  accounting: <div data-testid="accounting">A</div>,
  files: <div data-testid="files">F</div>,
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

  it("defaults to the WORK tab on mount", () => {
    render(<ContextRail {...baseProps} />);
    expect(screen.getByTestId("work")).toBeInTheDocument();
    expect(screen.queryByTestId("accounting")).not.toBeInTheDocument();
    expect(screen.queryByTestId("files")).not.toBeInTheDocument();
  });

  it("switches to the ACCOUNTING tab on click", () => {
    render(<ContextRail {...baseProps} />);
    fireEvent.click(screen.getByRole("tab", { name: /accounting/i }));
    expect(screen.getByTestId("accounting")).toBeInTheDocument();
    expect(screen.queryByTestId("work")).not.toBeInTheDocument();
  });

  it("renders the count next to each non-zero tab label", () => {
    render(<ContextRail {...baseProps} />);
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("9")).toBeInTheDocument();
  });

  it("re-mounts to WORK when threadId changes (no cross-thread persistence)", () => {
    const { rerender } = render(<ContextRail {...baseProps} threadId="t1" />);
    fireEvent.click(screen.getByRole("tab", { name: /files/i }));
    expect(screen.getByTestId("files")).toBeInTheDocument();
    rerender(<ContextRail {...baseProps} threadId="t2" />);
    expect(screen.getByTestId("work")).toBeInTheDocument();
    expect(screen.queryByTestId("files")).not.toBeInTheDocument();
  });
});
