import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TextArea } from "@/components/ops/projects/workspace/atoms/text-area";
import { Field } from "@/components/ops/projects/workspace/atoms/field";

// `TextArea` — workspace-specific multi-line input. Same Field-aware
// philosophy as TextInput: no internal label, error via aria-invalid.

describe("<TextArea>", () => {
  it("renders a textarea element", () => {
    render(<TextArea placeholder="Type" />);
    expect(screen.getByPlaceholderText("Type").tagName).toBe("TEXTAREA");
  });

  it("uses font-mohave body voice", () => {
    render(<TextArea placeholder="X" />);
    expect(screen.getByPlaceholderText("X")).toHaveClass("font-mohave");
  });

  it("uses the 5px brand input radius (rounded token)", () => {
    render(<TextArea placeholder="X" />);
    expect(screen.getByPlaceholderText("X")).toHaveClass("rounded");
  });

  it("has glass-border default border", () => {
    render(<TextArea placeholder="X" />);
    expect(screen.getByPlaceholderText("X")).toHaveClass("border-glass-border");
  });

  it("renders with a min-height suitable for short notes (~80px)", () => {
    render(<TextArea placeholder="X" />);
    expect(screen.getByPlaceholderText("X")).toHaveClass("min-h-[80px]");
  });

  it("composes with Field for label semantics", () => {
    render(
      <Field label="Notes">
        <TextArea placeholder="N" />
      </Field>,
    );
    const label = screen.getByText("Notes");
    const ta = screen.getByPlaceholderText("N");
    expect(ta.getAttribute("id")).toBe(label.getAttribute("for"));
  });

  it("forwards onChange and value", async () => {
    const onChange = vi.fn();
    render(<TextArea placeholder="X" onChange={onChange} />);
    await userEvent.type(screen.getByPlaceholderText("X"), "hi");
    expect(onChange).toHaveBeenCalled();
  });

  it("respects disabled", () => {
    render(<TextArea placeholder="X" disabled />);
    expect(screen.getByPlaceholderText("X")).toBeDisabled();
  });

  it("merges additional className", () => {
    render(<TextArea placeholder="X" className="min-h-[120px]" />);
    expect(screen.getByPlaceholderText("X")).toHaveClass("min-h-[120px]");
  });

  it("forwards aria-invalid for Field error wiring", () => {
    render(<TextArea placeholder="X" aria-invalid="true" />);
    expect(screen.getByPlaceholderText("X")).toHaveAttribute("aria-invalid", "true");
  });
});
