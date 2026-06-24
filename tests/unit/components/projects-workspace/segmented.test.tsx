import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Segmented } from "@/components/ops/projects/workspace/atoms/segmented";

const VISIBILITY_OPTIONS = [
  { value: "private", label: "Private" },
  { value: "team", label: "Team" },
  { value: "public", label: "Public" },
];

// `Segmented` — radio-group-style segmented control. Used for mode toggles
// inside form-cards (e.g. visibility: private / team / public). Distinct
// from page-level Tabs.

describe("<Segmented>", () => {
  it("renders one button per option", () => {
    render(
      <Segmented
        options={VISIBILITY_OPTIONS}
        value="team"
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("radio", { name: "Private" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Team" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Public" })).toBeInTheDocument();
  });

  it("uses radiogroup role on the container", () => {
    render(
      <Segmented
        options={VISIBILITY_OPTIONS}
        value="team"
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("radiogroup")).toBeInTheDocument();
  });

  it("marks the selected option as aria-checked=true", () => {
    render(
      <Segmented
        options={VISIBILITY_OPTIONS}
        value="team"
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("radio", { name: "Team" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("radio", { name: "Private" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("calls onChange with the option value when a button is clicked", async () => {
    const onChange = vi.fn();
    render(
      <Segmented
        options={VISIBILITY_OPTIONS}
        value="private"
        onChange={onChange}
      />,
    );
    await userEvent.click(screen.getByRole("radio", { name: "Public" }));
    expect(onChange).toHaveBeenCalledWith("public");
  });

  it("uses Mono uppercase voice on each segment label", () => {
    render(
      <Segmented
        options={VISIBILITY_OPTIONS}
        value="team"
        onChange={() => {}}
      />,
    );
    const team = screen.getByRole("radio", { name: "Team" });
    expect(team).toHaveClass("font-mono");
    expect(team).toHaveClass("uppercase");
  });

  it("uses the 5px brand input radius on the container (rounded token)", () => {
    render(
      <Segmented
        options={VISIBILITY_OPTIONS}
        value="team"
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("radiogroup")).toHaveClass("rounded");
  });

  it("applies selected styling (text-text + accent line) to the active segment", () => {
    render(
      <Segmented
        options={VISIBILITY_OPTIONS}
        value="team"
        onChange={() => {}}
      />,
    );
    const active = screen.getByRole("radio", { name: "Team" });
    // Active segment: white text + accent underline indicator via data-active
    expect(active).toHaveAttribute("data-active", "true");
    expect(active).toHaveClass("text-text");
  });

  it("respects disabled and stops onChange", async () => {
    const onChange = vi.fn();
    render(
      <Segmented
        options={VISIBILITY_OPTIONS}
        value="team"
        onChange={onChange}
        disabled
      />,
    );
    await userEvent.click(screen.getByRole("radio", { name: "Public" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("composes with Field — Field clones id onto the radiogroup", async () => {
    const { Field } = await import(
      "@/components/ops/projects/workspace/atoms/field"
    );
    render(
      <Field label="Visibility">
        <Segmented
          options={VISIBILITY_OPTIONS}
          value="team"
          onChange={() => {}}
        />
      </Field>,
    );
    const label = screen.getByText("Visibility");
    const group = screen.getByRole("radiogroup");
    expect(group.getAttribute("id")).toBe(label.getAttribute("for"));
  });
});
