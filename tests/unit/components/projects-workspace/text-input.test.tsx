import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TextInput } from "@/components/ops/projects/workspace/atoms/text-input";
import { Field } from "@/components/ops/projects/workspace/atoms/field";

// `TextInput` — workspace-specific text input. No internal label (Field
// owns labels). Cleaner / smaller than the existing dashboard <Input>
// (h-32px vs h-56px). Pure presentation; behaviour stays native.

describe("<TextInput>", () => {
  it("renders an input element", () => {
    render(<TextInput placeholder="Type here" />);
    expect(screen.getByPlaceholderText("Type here").tagName).toBe("INPUT");
  });

  it("uses font-mohave body voice", () => {
    render(<TextInput placeholder="X" />);
    expect(screen.getByPlaceholderText("X")).toHaveClass("font-mohave");
  });

  it("uses the 5px brand input radius (rounded token)", () => {
    render(<TextInput placeholder="X" />);
    expect(screen.getByPlaceholderText("X")).toHaveClass("rounded");
  });

  it("has glass-border default border (no hex literal)", () => {
    render(<TextInput placeholder="X" />);
    expect(screen.getByPlaceholderText("X")).toHaveClass("border-glass-border");
  });

  it("renders at h-8 (32px) by default — denser than the dashboard 56px Input", () => {
    render(<TextInput placeholder="X" />);
    expect(screen.getByPlaceholderText("X")).toHaveClass("h-8");
  });

  it("composes with Field for label semantics (Field clones to set id and aria)", () => {
    render(
      <Field label="Name">
        <TextInput placeholder="N" />
      </Field>,
    );
    const label = screen.getByText("Name");
    const input = screen.getByPlaceholderText("N");
    expect(input.getAttribute("id")).toBe(label.getAttribute("for"));
  });

  it("forwards onChange and value", async () => {
    const onChange = vi.fn();
    render(<TextInput placeholder="X" onChange={onChange} />);
    await userEvent.type(screen.getByPlaceholderText("X"), "abc");
    expect(onChange).toHaveBeenCalled();
  });

  it("respects disabled", () => {
    render(<TextInput placeholder="X" disabled />);
    expect(screen.getByPlaceholderText("X")).toBeDisabled();
  });

  it("merges additional className", () => {
    render(<TextInput placeholder="X" className="w-full" />);
    expect(screen.getByPlaceholderText("X")).toHaveClass("w-full");
    expect(screen.getByPlaceholderText("X")).toHaveClass("font-mohave");
  });

  it("forwards aria-invalid when set (for Field error wiring)", () => {
    render(<TextInput placeholder="X" aria-invalid="true" />);
    expect(screen.getByPlaceholderText("X")).toHaveAttribute("aria-invalid", "true");
  });
});
