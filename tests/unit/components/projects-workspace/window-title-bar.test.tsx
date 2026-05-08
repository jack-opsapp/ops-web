import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { WindowTitleBar } from "@/components/ops/projects/workspace/shell/window-title-bar";

// `WindowTitleBar` — workspace title bar that lives at the top of the
// window. Layout (left → right): traffic-light cluster → vertical
// separator → tactical crumb (`// PROJECT`) + project id → status chip
// → mode pill → flexible spacer → header action slot. Beneath that row
// the title (Cake) and subtitle (Mono) sit on their own line.
//
// User-select is disabled across the whole bar so click-and-drag never
// turns into accidental text selection. The drag pointer-down handler
// fires on every pointer-down except those inside `[data-no-drag]`
// (buttons, inputs, the mode pill — anything interactive).

describe("<WindowTitleBar>", () => {
  const defaultProps = {
    title: "Acme HQ Roof Replacement",
    crumbLabel: "PROJECT",
    projectIdLabel: "JX-4821",
    statusLabel: "ACCEPTED",
    statusTone: "olive" as const,
    mode: "viewing" as const,
    subtitle: "1234 Industry Way · Stockton CA",
    onClose: () => {},
    onMinimize: () => {},
    onMaximize: () => {},
    onPointerDown: () => {},
  };

  it("renders the three traffic-light controls", () => {
    render(<WindowTitleBar {...defaultProps} />);
    expect(screen.getByRole("button", { name: /close/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /minimize/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /maximize/i })).toBeInTheDocument();
  });

  it("renders the // crumb prefix + crumbLabel + projectIdLabel", () => {
    render(<WindowTitleBar {...defaultProps} />);
    expect(screen.getByText("// PROJECT")).toBeInTheDocument();
    expect(screen.getByText("JX-4821")).toBeInTheDocument();
  });

  it("renders the status chip with provided label", () => {
    render(<WindowTitleBar {...defaultProps} />);
    expect(screen.getByText("ACCEPTED")).toBeInTheDocument();
  });

  it("renders the ModePill for the given mode", () => {
    render(<WindowTitleBar {...defaultProps} mode="editing" />);
    expect(screen.getByTestId("mode-pill-editing")).toBeInTheDocument();
  });

  it("renders the title in Cake (font-cakemono font-light)", () => {
    render(<WindowTitleBar {...defaultProps} />);
    const title = screen.getByText("Acme HQ Roof Replacement");
    expect(title).toHaveClass("font-cakemono");
    expect(title).toHaveClass("font-light");
  });

  it("renders the subtitle when provided", () => {
    render(<WindowTitleBar {...defaultProps} />);
    expect(
      screen.getByText("1234 Industry Way · Stockton CA"),
    ).toBeInTheDocument();
  });

  it("omits the subtitle row when subtitle is undefined", () => {
    render(<WindowTitleBar {...defaultProps} subtitle={undefined} />);
    expect(
      screen.queryByText("1234 Industry Way · Stockton CA"),
    ).not.toBeInTheDocument();
  });

  it("renders the headerAction slot when provided", () => {
    render(
      <WindowTitleBar
        {...defaultProps}
        headerAction={<button>Header Action</button>}
      />,
    );
    expect(
      screen.getByRole("button", { name: /header action/i }),
    ).toBeInTheDocument();
  });

  it("uses cursor-grab on the bar (drag affordance)", () => {
    render(<WindowTitleBar {...defaultProps} />);
    expect(screen.getByTestId("workspace-title-bar")).toHaveClass("cursor-grab");
  });

  it("disables user-select across the bar (no drag-text fizzle)", () => {
    render(<WindowTitleBar {...defaultProps} />);
    expect(screen.getByTestId("workspace-title-bar")).toHaveClass("select-none");
  });

  it("close click invokes onClose", async () => {
    const onClose = vi.fn();
    render(<WindowTitleBar {...defaultProps} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("minimize click invokes onMinimize", async () => {
    const onMinimize = vi.fn();
    render(<WindowTitleBar {...defaultProps} onMinimize={onMinimize} />);
    await userEvent.click(screen.getByRole("button", { name: /minimize/i }));
    expect(onMinimize).toHaveBeenCalledOnce();
  });

  it("maximize click invokes onMaximize", async () => {
    const onMaximize = vi.fn();
    render(<WindowTitleBar {...defaultProps} onMaximize={onMaximize} />);
    await userEvent.click(screen.getByRole("button", { name: /maximize/i }));
    expect(onMaximize).toHaveBeenCalledOnce();
  });

  it("traffic light buttons stop propagation so they don't initiate drag", async () => {
    const onPointerDown = vi.fn();
    const onClose = vi.fn();
    render(
      <WindowTitleBar
        {...defaultProps}
        onPointerDown={onPointerDown}
        onClose={onClose}
      />,
    );
    // Click the traffic-light. The pointer-down should NOT bubble to the
    // bar drag handler. We test by inspecting the data-no-drag presence
    // on traffic lights, which is what the drag hook uses to short-circuit.
    const close = screen.getByRole("button", { name: /close/i });
    expect(close.closest("[data-no-drag]")).not.toBeNull();
  });

  it("calls onPointerDown when pointer-down fires on the bar surface", () => {
    const onPointerDown = vi.fn();
    render(<WindowTitleBar {...defaultProps} onPointerDown={onPointerDown} />);
    const bar = screen.getByTestId("workspace-title-bar");
    // jsdom 25 doesn't expose `PointerEvent` globally — use the
    // testing-library `fireEvent.pointerDown` helper which polyfills it
    // through MouseEvent + the React synthetic-event system.
    fireEvent.pointerDown(bar, { clientX: 100, clientY: 50 });
    expect(onPointerDown).toHaveBeenCalledOnce();
  });

  it("forwards status tone to the chip", () => {
    render(<WindowTitleBar {...defaultProps} statusTone="rose" statusLabel="ON-HOLD" />);
    const chip = screen.getByText("ON-HOLD");
    // Chip atom translates tone -> rose-soft + rose text + rose-line.
    expect(chip.className).toContain("text-[var(--rose)]");
  });
});
