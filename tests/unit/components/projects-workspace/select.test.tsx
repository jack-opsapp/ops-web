import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Select } from "@/components/ops/projects/workspace/atoms/select";
import { Field } from "@/components/ops/projects/workspace/atoms/field";

const STATUS_OPTIONS = [
  { value: "lead", label: "Lead" },
  { value: "scheduled", label: "Scheduled" },
  { value: "in_progress", label: "In progress" },
];

// `Select` — workspace `<Select>` wraps the existing Radix `<Select*>` family
// from `src/components/ui/select.tsx` so callers get a `value`/`onChange`/
// `options` API symmetric with TextInput / TextArea. Behaviour delegates
// entirely to Radix; we test the surface props.

describe("<Select>", () => {
  it("renders the trigger with placeholder when no value is set", () => {
    render(
      <Select
        options={STATUS_OPTIONS}
        placeholder="Pick one"
        onChange={() => {}}
      />,
    );
    expect(screen.getByText("Pick one")).toBeInTheDocument();
  });

  it("renders the selected option label when value is set", () => {
    render(
      <Select
        options={STATUS_OPTIONS}
        value="scheduled"
        onChange={() => {}}
      />,
    );
    expect(screen.getByText("Scheduled")).toBeInTheDocument();
  });

  it("calls onChange with the selected value when an option is picked", async () => {
    const onChange = vi.fn();
    render(
      <Select
        options={STATUS_OPTIONS}
        placeholder="Pick"
        onChange={onChange}
      />,
    );
    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.click(screen.getByRole("option", { name: "Lead" }));
    expect(onChange).toHaveBeenCalledWith("lead");
  });

  it("uses font-mohave on the trigger for body voice", () => {
    render(<Select options={STATUS_OPTIONS} placeholder="X" onChange={() => {}} />);
    expect(screen.getByRole("combobox")).toHaveClass("font-mohave");
  });

  it("uses rounded-[5px] (brand input radius)", () => {
    render(<Select options={STATUS_OPTIONS} placeholder="X" onChange={() => {}} />);
    expect(screen.getByRole("combobox")).toHaveClass("rounded-[5px]");
  });

  it("uses h-8 to match TextInput density", () => {
    render(<Select options={STATUS_OPTIONS} placeholder="X" onChange={() => {}} />);
    expect(screen.getByRole("combobox")).toHaveClass("h-8");
  });

  it("composes with Field for label semantics", () => {
    render(
      <Field label="Status">
        <Select options={STATUS_OPTIONS} placeholder="Pick" onChange={() => {}} />
      </Field>,
    );
    const label = screen.getByText("Status");
    const trigger = screen.getByRole("combobox");
    expect(trigger.getAttribute("id")).toBe(label.getAttribute("for"));
  });

  it("respects disabled", () => {
    render(
      <Select
        options={STATUS_OPTIONS}
        placeholder="X"
        onChange={() => {}}
        disabled
      />,
    );
    expect(screen.getByRole("combobox")).toBeDisabled();
  });
});
